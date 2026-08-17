import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { prove, replayed as replayProofs } from './runs';
import { isClosed, Obligation, ProveResult, Status } from './protocol';
import { Settings } from './settings';
import { KeySession, report } from './session';

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
        const replayed = await replayProofs(this.session, this.model, contextId, []);
        const listed = await this.model.obligations(contextId);

        // A proof that was saved and no longer closes is what the edit broke. One that was
        // never proved is not attempted: saving a file is not a request to prove the project.
        const broken = replayed.outcomes
            .filter(
                (outcome) =>
                    !isClosed(outcome.status) &&
                    outcome.status !== Status.none &&
                    outcome.status !== Status.closedButLemmasLeft,
            )
            .map((outcome) => outcome.contractName);
        const lemmas = await this.lemmasLeftAfter(contextId, replayed, listed);

        const toProve = [...new Set([...broken, ...lemmas])];
        if (toProve.length === 0) {
            void vscode.window.showInformationMessage(
                `${contextId}: every saved proof still proves its contract after the change.`,
            );
            return;
        }
        void vscode.window.showInformationMessage(
            `${contextId}: ${describe(broken.length, lemmas.length)} Proving them.`,
        );
        const byName = new Map(listed.map((obligation) => [obligation.contractName, obligation]));
        await prove(
            this.session,
            this.model,
            contextId,
            toProve.map((name) => byName.get(name)).filter(isObligation),
            `${contextId} after the change`,
        );
    }

    /**
     * The contracts the replayed proofs rest on that are not proved themselves.
     *
     * A proof that comes back closed but for lemmas is not the one to attempt again: it
     * closes, and what it waits for are the contracts it used. KeY reports which those are,
     * and the replay has just judged every saved proof of the context, so a contract it
     * reports as unproved has either no proof or one that does not close.
     */
    private async lemmasLeftAfter(
        contextId: string,
        replayed: ProveResult,
        listed: Obligation[],
    ): Promise<string[]> {
        const waiting = replayed.outcomes
            .filter((outcome) => outcome.status === Status.closedButLemmasLeft)
            .map((outcome) => outcome.contractName);
        if (waiting.length === 0) {
            return [];
        }
        const uses = await this.model.dependencies(contextId);
        const status = new Map(listed.map((one) => [one.contractName, one.status]));

        const unproved: string[] = [];
        const seen = new Set(waiting);
        const pending = [...waiting];
        while (pending.length > 0) {
            for (const used of uses.get(pending.shift() as string) ?? []) {
                if (seen.has(used) || isClosed(status.get(used) ?? Status.none)) {
                    continue;
                }
                seen.add(used);
                unproved.push(used);
                pending.push(used);
            }
        }
        return unproved;
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
    }
}

/** What was found, for the line the user reads before the run starts. */
function describe(broken: number, lemmas: number): string {
    if (lemmas === 0) {
        return `${broken} proof(s) no longer prove their contract.`;
    }
    if (broken === 0) {
        return `${lemmas} contract(s) the saved proofs rest on are not proved.`;
    }
    return (
        `${broken} proof(s) no longer prove their contract, and ` +
        `${lemmas} contract(s) they rest on are not proved.`
    );
}

function isObligation(obligation: Obligation | undefined): obligation is Obligation {
    return obligation !== undefined;
}
