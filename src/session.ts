import * as vscode from 'vscode';
import { Bridge } from './bridge';
import { RefusedSources } from './problems';
import { Bridges } from './bridges';
import { ObligationsChanged, ProveProgress } from './protocol';

/** Thrown when a request has waited longer than the deadline for its kind. */
export class DeadlinePassed extends Error {}

/**
 * How long to wait for the bridge, by what is being waited for.
 *
 * Named in one place because the deadline belongs to the kind of request, not to the view
 * that happens to make it.
 */
export const Deadline = {
    /** Reading or writing settings, which the configuration bridge answers without KeY. */
    config: 30_000,
    /** Anything that may load a context, which reads the sources, taclets and contracts. */
    context: 600_000,
    /** A proof run, which takes as long as the proofs take. */
    proof: 12 * 3_600_000,
};

/**
 * The connection to KeY, for one window.
 *
 * It owns the two bridge processes, waits for a request no longer than the deadline for its
 * kind, and passes on what the bridge reports. What the project holds is not kept here: that
 * is the model's, which reads it through this.
 */
export class KeySession implements vscode.Disposable {
    private bridges: Bridges | undefined;

    private readonly changed = new vscode.EventEmitter<ObligationsChanged>();
    private readonly progressed = new vscode.EventEmitter<ProveProgress>();

    /** Proof states may have changed, for the named context or for all of them. */
    readonly onObligationsChanged = this.changed.event;

    /** A run has reported how far it has got. */
    readonly onProgress = this.progressed.event;

    /** The sources KeY refused to read, and everything done about them. */
    readonly refused = new RefusedSources();

    private constructor(
        readonly root: string,
        readonly output: vscode.OutputChannel,
        readonly storage: vscode.Uri,
    ) {}

    /**
     * The session for a window that has a folder open.
     *
     * @returns the session, or undefined when no folder is open and there is no project to
     *          verify
     */
    static start(
        context: vscode.ExtensionContext,
        output: vscode.OutputChannel,
    ): KeySession | undefined {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return undefined;
        }
        const session = new KeySession(folder.uri.fsPath, output, context.globalStorageUri);
        context.subscriptions.push(session);
        return session;
    }

    /** The bridge that can verify, starting KeY if it is not running. */
    async verification(): Promise<Bridge> {
        return this.running().forVerification();
    }

    /** The bridge that reads and writes settings, which never starts KeY. */
    async configuration(): Promise<Bridge> {
        return this.running().forConfiguration();
    }

    /**
     * Makes a request and waits no longer than the deadline for its kind.
     *
     * A deadline that passes says nothing about the bridge on its own, so the bridge is
     * asked whether it still answers, and only one that does not is restarted.
     *
     * @param bridge the bridge to ask
     * @param method the request
     * @param params what it takes
     * @param deadline how long to wait, from {@link Deadline}
     */
    async request<T>(
        bridge: Bridge,
        method: string,
        params: unknown,
        deadline: number,
    ): Promise<T> {
        let timer: NodeJS.Timeout | undefined;
        const expired = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
                () =>
                    reject(
                        new DeadlinePassed(
                            `KeY did not answer ${method} within the time allowed.`,
                        ),
                    ),
                deadline,
            );
        });
        try {
            return await Promise.race([bridge.request<T>(method, params), expired]);
        } catch (failure) {
            if (failure instanceof DeadlinePassed) {
                await this.bridges?.restartIfUnresponsive();
            }
            throw failure;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /** Restarts KeY, whether or not it is still answering. */
    async restart(): Promise<boolean> {
        return this.running().restart();
    }

    /** Stops both bridges. They are started again on the next request. */
    stop(): void {
        this.bridges?.dispose();
        this.bridges = undefined;
    }

    private running(): Bridges {
        if (!this.bridges) {
            this.bridges = new Bridges(this.root, this.output, {
                obligationsChanged: (params) => this.changed.fire(params),
                progress: (params) => this.progressed.fire(params),
            });
        }
        return this.bridges;
    }

    dispose(): void {
        this.stop();
        this.changed.dispose();
        this.progressed.dispose();
        this.refused.dispose();
    }
}

/**
 * Shows the message a user can act on, rather than the wrapper around it.
 *
 * A source KeY could not read is marked at the lines KeY named and said once, by the owner
 * of refusals. Every other failure is a sentence.
 */
export function report(failure: unknown, session: KeySession): void {
    if (session.refused.report(failure)) {
        return;
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    void vscode.window.showErrorMessage(message);
}
