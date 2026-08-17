import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { TrashPolicy } from './protocol';

/**
 * Everything the editor's settings say about KeY.
 *
 * Read in one place, so that a setting has one name, one default and one meaning, and a
 * change to what a setting decides is made where it is read rather than in each caller.
 */
export const Settings = {
    /** The KeY distribution the extension starts, checked so a missing jar is named here. */
    keyJar(): string {
        return requireFile('keyJar', 'KeY jar');
    },

    /** The shared KeY component the extension starts alongside it. */
    bridgeJar(): string {
        return requireFile('bridgeJar', 'shared KeY component');
    },

    /** The Java that runs them: what the user configured, then JAVA_HOME, then the path. */
    javaExecutable(): string {
        const configured = read<string>('javaHome', '').trim();
        const home = configured.length > 0 ? configured : process.env.JAVA_HOME;
        const name = process.platform === 'win32' ? 'java.exe' : 'java';
        return home ? path.join(home, 'bin', name) : name;
    },

    /**
     * Where the KeY the extension starts keeps its settings, logs and caches.
     *
     * @param root the project, which holds the directory unless the user asked for their own
     * @returns the directory to give KeY, or undefined to let KeY use the user's own
     */
    keyHome(root: string): string | undefined {
        if (read<string>('keyHome', 'project') !== 'project') {
            return undefined;
        }
        const directory = path.join(root, '.key', 'tool');
        fs.mkdirSync(directory, { recursive: true });
        return directory;
    },

    /**
     * Whether to ask the bridge for a loopback port.
     *
     * The bridge prefers a Unix domain socket, and this extension has to say when it cannot
     * connect to one. Node reaches a local socket on Windows only as a named pipe, so a
     * loopback port is the transport there.
     */
    wantsLoopback(): boolean {
        const transport = read<string>('transport', 'auto');
        return transport === 'tcp' || (transport === 'auto' && process.platform === 'win32');
    },

    /** Whether saving a source replays that context's proofs and proves what is left. */
    verifyOnSave(): boolean {
        return read<boolean>('verifyOnSave', true);
    },

    /** Turns verify on save on or off, and remembers the choice. */
    async setVerifyOnSave(on: boolean): Promise<void> {
        await vscode.workspace
            .getConfiguration('key')
            .update('verifyOnSave', on, vscode.ConfigurationTarget.Global);
    },

    /**
     * What becomes of a proof a rerun replaced.
     *
     * @returns the policy, or undefined where the user keeps everything
     */
    trashPolicy(): TrashPolicy | undefined {
        const modes: Record<string, TrashPolicy['mode'] | undefined> = {
            never: undefined,
            emptyOnStart: 'EMPTY',
            belowSize: 'BELOW_SIZE',
            olderThan: 'OLDER_THAN',
        };
        const mode = modes[read<string>('trashPolicy', 'never')];
        return mode
            ? {
                  mode,
                  megabytes: read<number>('trashMegabytes', 200),
                  days: read<number>('trashDays', 30),
              }
            : undefined;
    },
};

function read<T>(name: string, fallback: T): T {
    return vscode.workspace.getConfiguration('key').get<T>(name, fallback);
}

/**
 * A configured file, refused here rather than as a process that dies at once.
 *
 * @param name the setting to read
 * @param description how it reads in the message
 */
function requireFile(name: string, description: string): string {
    const value = read<string>(name, '').trim();
    if (value.length === 0) {
        throw new Error(`No ${description} is configured. Set key.${name} in your settings.`);
    }
    if (!fs.existsSync(value)) {
        throw new Error(`The ${description} ${value} does not exist.`);
    }
    return value;
}
