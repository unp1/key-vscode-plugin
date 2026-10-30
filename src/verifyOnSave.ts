import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { prove } from './runs';
import {
    AfterSaveResult,
    ListObligationsParams,
    Methods,
    Obligation,
} from './protocol';
import { Settings } from './settings';
import { Deadline, KeySession, report } from './session';

/**
 * Keeps a project's proofs up with its sources, when the user has asked for that.
 *
 * Saving a verified source makes KeY read the context again, after which nothing it said
 * about the old sources applies. The status of the proofs now is KeY's to report, and
 * reporting it means reading them back. Every saved proof of the context goes into one environment,
 * so KeY judges each of them against the others.
 *
 * What it then reports as unproved is attempted again: a proof that no longer closes, and
 * the contracts a proof rests on that are not proved themselves.
 *
 * The work of one context is done one job at a time. Saving twice while a job runs asks for
 * one more job after it, not two, since the second would read the same files as the first.
 */
export class VerifyOnSave implements vscode.Disposable {
    private readonly running = new Set<string>();
    private readonly asked = new Set<string>();
    private readonly subscriptions: vscode.Disposable[] = [];


    constructor(
        private readonly session: KeySession,
        private readonly model: ProjectModel,
    ) {
        this.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((document) => this.saved(document)),
            // The setting can also be changed in the editor's own settings, and the button
            // has to show which of the two states it is in.
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (change.affectsConfiguration('key.verifyOnSave')) {
                    void this.showState();
                }
            }),
        );
        void this.showState();
    }

    /** Turns it on or off, and remembers the choice. */
    async toggle(): Promise<void> {
        const on = Settings.verifyOnSave();
        await Settings.setVerifyOnSave(!on);
        await this.showState();
        void vscode.window.showInformationMessage(
            on
                ? 'Verify on save is off. The proofs are left as they are until you ask.'
                : 'Verify on save is on. Saving a source replays its context and proves what ' +
                      'the change left unproved.',
        );
    }

    /** Tells the view title which of the two buttons to show. */
    private async showState(): Promise<void> {
        await vscode.commands.executeCommand(
            'setContext',
            'key.verifyOnSave',
            Settings.verifyOnSave(),
        );
    }

    private saved(document: vscode.TextDocument): void {
        if (document.languageId !== 'java') {
            return;
        }
        if (!Settings.verifyOnSave()) {
            return;
        }
        void this.model
            .contextFor(document.uri)
            .then((contextId) => this.start(contextId))
            .catch(() => {
                // A file outside every context is not this extension's business.
            });
    }

    private start(contextId: string): void {
        if (this.running.has(contextId)) {
            // Another save arrived while this context was being worked on. One more round
            // after this one covers every save that arrives meanwhile.
            this.asked.add(contextId);
            return;
        }
        this.running.add(contextId);
        void this.catchUp(contextId)
            .catch((failure) => {
                // A source KeY refused after the save is what the user most wants to hear
                // about, so it is reported the way any other failure is: at the lines KeY
                // named, and once.
                report(failure, this.session);
            })
            .finally(() => {
                this.running.delete(contextId);
                if (this.asked.delete(contextId)) {
                    this.start(contextId);
                }
            });
    }

    /**
     * Reads the context's saved proofs back and attempts what they leave unproved.
     *
     * @param contextId the context to catch up
     */
    private async catchUp(contextId: string): Promise<void> {
        // What the save asks to be proved is the bridge's answer, so that saving means the
        // same in every editor: the proofs the edit broke, the contracts it added, and the
        // unproved contracts the closed-but-waiting proofs rest on.
        const bridge = await this.session.verification();
        const params: ListObligationsParams = { contextId };
        const asked = await this.session.request<AfterSaveResult>(
            bridge,
            Methods.afterSave,
            params,
            Deadline.proof,
        );
        this.model.record(contextId, asked.outcomes);

        if (asked.toProve.length === 0) {
            void vscode.window.showInformationMessage(
                `${contextId}: every saved proof still proves its contract after the change.`,
            );
            return;
        }
        void vscode.window.showInformationMessage(
            `${contextId}: ${describe(asked.broken.length, asked.lemmasLeft.length, asked.added.length)} Proving them.`,
        );
        const listed = await this.model.obligations(contextId);
        const byName = new Map(listed.map((obligation) => [obligation.contractName, obligation]));
        await prove(
            this.session,
            this.model,
            contextId,
            asked.toProve.map((name) => byName.get(name)).filter(isObligation),
            `${contextId} after the change`,
        );
    }


    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
    }
}

/** What was found, for the line the user reads before the run starts. */
function describe(broken: number, lemmas: number, added: number): string {
    const parts = [];
    if (broken > 0) {
        parts.push(`${broken} proof(s) no longer prove their contract`);
    }
    if (lemmas > 0) {
        parts.push(`${lemmas} contract(s) the saved proofs rest on are not proved`);
    }
    if (added > 0) {
        parts.push(`${added} contract(s) are new`);
    }
    return parts.join(', and ') + '.';
}

function isObligation(obligation: Obligation | undefined): obligation is Obligation {
    return obligation !== undefined;
}
