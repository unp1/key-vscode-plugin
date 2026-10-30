import * as path from 'path';
import * as vscode from 'vscode';
import { Bridge } from './bridge';
import { ObligationsChanged, ProveProgress } from './protocol';
import { Settings } from './settings';

/** How often a bridge is started before the extension gives up on it. */
const ATTEMPTS = 3;

/** How long to wait before starting a bridge again. */
const RETRY_MILLIS = 10_000;

export interface BridgeEvents {
    /** Run when proof states may have changed, whoever changed them. */
    obligationsChanged(params: ObligationsChanged): void;
    /** Run as a proof run reports its progress. */
    progress(params: ProveProgress): void;
}

/**
 * The two bridges this extension talks to.
 *
 * Configuration needs no prover, so it is served by a bridge running the shared jar alone:
 * the settings commands answer at once and work before KeY is configured. Verification
 * needs KeY, which is started headless on first use and kept, because starting it costs
 * seconds and a user verifies several methods in a row.
 *
 * A bridge that is gone is started again on the next use. One that is stuck is restarted
 * once it has failed to answer a ping.
 */
export class Bridges implements vscode.Disposable {
    private key?: Bridge;
    private config?: Bridge;

    constructor(
        private readonly workspaceRoot: string,
        private readonly output: vscode.OutputChannel,
        private readonly events: BridgeEvents,
    ) {}

    /** The bridge that can verify, starting KeY if it is not running. */
    async forVerification(): Promise<Bridge> {
        if (this.key?.alive) {
            return this.key;
        }
        this.key?.dispose();
        const keyJar = Settings.keyJar();
        const bridgeJar = Settings.bridgeJar();
        const keyHome = Settings.keyHome(this.workspaceRoot);
        this.key = await Bridge.launch({
            commandFor: (runtimeDir) => [
                Settings.javaExecutable(),
                // KeY touches Swing while reading its settings, and a JVM that does so with
                // a display attached puts an icon in the dock and steals the focus. Headless
                // it does neither, and still draws KeY's icons off screen.
                '-Djava.awt.headless=true',
                ...(keyHome ? [`-Dkey.home=${keyHome}`] : []),
                ...transportProperty(),
                '-cp',
                [keyJar, bridgeJar].join(path.delimiter),
                'org.key_project.ide.server.BridgeMain',
                runtimeDir,
            ],
            projectRoot: this.workspaceRoot,
            clientName: 'key-vscode',
            // KeY has its taclets to read before it can serve.
            timeoutMillis: 180_000,
            log: (line) => this.output.appendLine(`[key] ${line}`),
            onObligationsChanged: (params) => this.events.obligationsChanged(params),
            onProgress: (params) => this.events.progress(params),
        });
        return this.key;
    }

    /** The bridge that reads and writes settings, which never starts KeY. */
    async forConfiguration(): Promise<Bridge> {
        if (this.config?.alive) {
            return this.config;
        }
        this.config?.dispose();
        const bridgeJar = Settings.bridgeJar();
        this.config = await Bridge.launch({
            commandFor: (runtimeDir) => [
                Settings.javaExecutable(),
                '-Djava.awt.headless=true',
                ...transportProperty(),
                '-cp',
                bridgeJar,
                'org.key_project.ide.server.ConfigBridgeMain',
                runtimeDir,
            ],
            projectRoot: this.workspaceRoot,
            clientName: 'key-vscode-config',
            // No prover to load, so this one starts in about the time a JVM takes.
            timeoutMillis: 30_000,
            log: (line) => this.output.appendLine(`[config] ${line}`),
        });
        return this.config;
    }

    /**
     * Stops both bridges and starts KeY again.
     *
     * A start that fails is tried again, because the reasons it fails are often over in a
     * moment: a socket still held by the process that just died, or a machine too busy to
     * start a JVM in time. After three tries the extension says so and stops.
     *
     * @returns whether KeY is running again
     */
    async restart(): Promise<boolean> {
        this.dispose();
        let lastFailure: unknown;
        for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
            if (attempt > 1) {
                await delay(RETRY_MILLIS);
            }
            try {
                await this.forVerification();
                this.events.obligationsChanged({ contextId: null });
                return true;
            } catch (failure) {
                lastFailure = failure;
                this.dispose();
            }
        }
        const message = lastFailure instanceof Error ? lastFailure.message : String(lastFailure);
        this.output.appendLine(`error: KeY did not start after ${ATTEMPTS} attempts: ${message}`);
        void vscode.window.showErrorMessage(
            `KeY did not start after ${ATTEMPTS} attempts: ${message}`,
        );
        return false;
    }

    /**
     * Restarts a bridge that has stopped answering, and leaves one that answers alone.
     *
     * A request that passes its deadline says nothing on its own, since a proof takes as
     * long as it takes. What decides is whether the bridge still answers a ping.
     *
     * The settings bridge is only stopped: it is started again by the next request, and it
     * holds nothing that a restart has to report.
     */
    async restartIfUnresponsive(): Promise<void> {
        const config = this.config;
        if (config && !(await config.isResponsive())) {
            config.dispose();
            this.config = undefined;
        }
        const key = this.key;
        if (!key || (await key.isResponsive())) {
            return;
        }
        void vscode.window.showWarningMessage('KeY has stopped answering. Restarting it.');
        await this.restart();
    }





    dispose(): void {
        this.key?.dispose();
        this.config?.dispose();
        this.key = undefined;
        this.config = undefined;
    }
}

/** Asks the bridge for a loopback port where a Unix domain socket cannot be reached. */
function transportProperty(): string[] {
    return Settings.wantsLoopback() ? ['-Dkey.ide.transport=tcp'] : [];
}

function delay(millis: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, millis));
}
