import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
    MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
    createMessageConnection,
} from 'vscode-jsonrpc/node';
import {
    InitializeResult,
    LogMessage,
    Methods,
    ObligationsChanged,
    PROTOCOL_VERSION,
    ProveProgress,
    State,
} from './protocol';

/** Where the bridge publishes how to reach it. */
interface Address {
    endpoint?: string;
    token?: string;
    error?: string;
    pid?: string;
}

export interface BridgeOptions {
    /** Builds the command, given the directory the bridge publishes its address in. */
    commandFor(runtimeDir: string): string[];
    /** What relative paths in the configuration are written against. */
    projectRoot: string;
    /** How this client identifies itself. */
    clientName: string;
    /** How long to wait for an address, in milliseconds. */
    timeoutMillis: number;
    /** Where to report what the bridge says. */
    log: (line: string) => void;
    /** Run when the bridge reports that proof states may have changed. */
    onObligationsChanged?: (params: ObligationsChanged) => void;
    /** Run as a proof run reports its progress. */
    onProgress?: (params: ProveProgress) => void;
}

/**
 * A bridge process and the connection to it.
 *
 * The steps mirror the reference implementation in the bridge's own BridgeClient: read the
 * published address, refuse one whose process has gone, present the token when the
 * transport asks for it, and shut down by stopping the reader before closing the socket.
 */
export class Bridge {
    private constructor(
        private readonly process: ChildProcess,
        private readonly socket: net.Socket,
        private readonly connection: MessageConnection,
        readonly info: InitializeResult,
        readonly runtimeDir: string,
    ) {}

    static async launch(options: BridgeOptions): Promise<Bridge> {
        const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'key-ide-'));
        const logFile = path.join(runtimeDir, 'bridge.log');
        const command = options.commandFor(runtimeDir);
        options.log(`starting: ${command.join(' ')}`);

        const output = fs.openSync(logFile, 'a');
        const child = spawn(command[0], command.slice(1), {
            stdio: ['ignore', output, output],
        });

        let address: Address;
        try {
            address = await waitForAddress(runtimeDir, child, options.timeoutMillis, logFile);
        } catch (failure) {
            child.kill();
            throw failure;
        }

        const socket = await connect(address);
        const connection = createMessageConnection(
            new StreamMessageReader(socket),
            new StreamMessageWriter(socket),
        );
        connection.onNotification(Methods.state, (params: State) =>
            options.log(`state: ${params.state}${params.detail ? ` (${params.detail})` : ''}`),
        );
        connection.onNotification(Methods.log, (params: LogMessage) =>
            options.log(`${params.level}: ${params.text}`),
        );
        connection.onNotification(Methods.changed, (params: ObligationsChanged) =>
            options.onObligationsChanged?.(params),
        );
        connection.onNotification(Methods.progress, (params: ProveProgress) =>
            options.onProgress?.(params),
        );
        connection.listen();

        const info: InitializeResult = await connection.sendRequest(Methods.initialize, {
            clientName: options.clientName,
            clientVersion: '0.1.0',
            protocolVersion: PROTOCOL_VERSION,
            projectRoot: options.projectRoot,
        });
        options.log(`connected to bridge ${info.bridgeVersion}, capabilities ${info.capabilities}`);

        return new Bridge(child, socket, connection, info, runtimeDir);
    }

    get alive(): boolean {
        return this.process.exitCode === null && !this.process.killed;
    }

    request<T>(method: string, params?: unknown): Promise<T> {
        return this.connection.sendRequest<T>(method, params);
    }

    /**
     * Whether the bridge still answers.
     *
     * The bridge answers a ping from its message loop, so this says whether it is serving
     * at all. It is not a measure of how busy it is: a bridge in the middle of a long proof
     * answers at once.
     */
    async isResponsive(): Promise<boolean> {
        if (!this.alive) {
            return false;
        }
        const answered = this.request<boolean>(Methods.ping);
        const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000));
        try {
            return await Promise.race([answered, timeout]);
        } catch {
            return false;
        }
    }

    /**
     * Asks the bridge to stop and closes the connection.
     *
     * The order matters. Sending is asynchronous, so disposing or destroying the socket
     * straight away leaves the farewell to be written to a stream that is already gone,
     * which surfaces as a stream error during an ordinary shutdown. The socket is ended
     * rather than destroyed, so the bridge sees the close instead of a severed connection.
     */
    dispose(): void {
        void this.shutdown();
    }

    private async shutdown(): Promise<void> {
        try {
            await this.connection.sendNotification(Methods.exit);
        } catch {
            // The bridge may already be gone; nothing here can act on that.
        }
        this.connection.dispose();
        this.socket.end();
        await this.removeRuntimeDirectoryIfTheProcessIsGone();
    }

    /**
     * Removes the socket, the address and the log once the process that owned them ends.
     *
     * A bridge inside KeY keeps running after the editor disconnects, because the window
     * is the user's, and its log is still being written. Such a directory is left alone.
     * A bridge that exists only for this editor ends with the connection, and its
     * directory is of no further use.
     */
    private async removeRuntimeDirectoryIfTheProcessIsGone(): Promise<void> {
        for (let waited = 0; waited < 2000; waited += 100) {
            if (this.process.exitCode !== null) {
                await fs.promises.rm(this.runtimeDir, { recursive: true, force: true });
                return;
            }
            await delay(100);
        }
    }
}

/**
 * Waits for the bridge to publish where it listens.
 *
 * The address arrives through a file because KeY's log occupies standard output. A bridge
 * that cannot start writes its reason to the same file, so a refusal is reported rather
 * than waited out.
 */
async function waitForAddress(
    runtimeDir: string,
    child: ChildProcess,
    timeoutMillis: number,
    logFile: string,
): Promise<Address> {
    const endpoint = path.join(runtimeDir, 'endpoint');
    const deadline = Date.now() + timeoutMillis;
    while (Date.now() < deadline) {
        if (fs.existsSync(endpoint)) {
            const address = readAddress(endpoint);
            if (address.error) {
                throw new Error(`The bridge did not start: ${address.error}`);
            }
            if (address.endpoint) {
                return address;
            }
        }
        if (child.exitCode !== null) {
            throw new Error(
                `The bridge exited with status ${child.exitCode} before reporting an address. ` +
                    `Its output is in ${logFile}.`,
            );
        }
        await delay(200);
    }
    throw new Error(
        `The bridge did not report an address within ${Math.round(timeoutMillis / 1000)} seconds. ` +
            `Its output is in ${logFile}.`,
    );
}

function readAddress(file: string): Address {
    const address: Address = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const separator = line.indexOf('=');
        if (separator > 0) {
            (address as Record<string, string>)[line.slice(0, separator)] =
                line.slice(separator + 1);
        }
    }
    return address;
}

function connect(address: Address): Promise<net.Socket> {
    const endpoint = address.endpoint as string;
    return new Promise((resolve, reject) => {
        const socket = endpoint.startsWith('unix:')
            ? net.createConnection({ path: endpoint.slice('unix:'.length) })
            : net.createConnection(tcpTarget(endpoint));
        socket.once('error', reject);
        socket.once('connect', () => {
            socket.removeListener('error', reject);
            if (!endpoint.startsWith('unix:')) {
                // A loopback port is reachable by every local process, so it asks for the
                // token the bridge published alongside its address.
                socket.write(`${address.token ?? ''}\n`);
            }
            resolve(socket);
        });
    });
}

function tcpTarget(endpoint: string): net.NetConnectOpts {
    const hostAndPort = endpoint.slice('tcp:'.length);
    const separator = hostAndPort.lastIndexOf(':');
    return {
        host: hostAndPort.slice(0, separator),
        port: Number(hostAndPort.slice(separator + 1)),
    };
}

function delay(millis: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, millis));
}
