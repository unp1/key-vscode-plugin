import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ContextsForm } from './contextsForm';
import { DependencyView } from './dependencies';
import { Level, ProjectModel } from './model';
import { OptionsForm } from './optionsForm';
import { ProverSwitch } from './prover';
import {
    ListObligationsParams,
    Methods,
    Obligation,
    PreparedResult,
    StaleOptionsResult,
    StartParams,
} from './protocol';
import { prove, removeProofs, replay } from './runs';
import { Invocation, Selection, Selections } from './selection';
import { Deadline, KeySession, report } from './session';
import { Settings } from './settings';
import { Trash } from './trash';
import { VerifyOnSave } from './verifyOnSave';

/** What an action does with the obligations of one context. */
type Run = (
    session: KeySession,
    model: ProjectModel,
    contextId: string,
    obligations: Obligation[],
    label: string,
) => Promise<void>;

/**
 * The actions the user can ask for.
 *
 * Each action is registered once and offered wherever it makes sense: the editor, the
 * explorer, a gutter mark, the KeY view and the verification table. What an invocation means
 * is worked out by {@link Selections}, so a new surface is a line in the manifest rather
 * than a command of its own.
 *
 * Nothing here keeps what the project holds: it is read from the model, and every change is
 * made through the model, which is what tells the views.
 */
export class Actions {
    private readonly selections: Selections;

    constructor(
        private readonly session: KeySession,
        private readonly model: ProjectModel,
        private readonly dependencies: DependencyView,
        private readonly prover: ProverSwitch,
        private readonly onSave: VerifyOnSave,
        private readonly extension: vscode.Uri,
    ) {
        this.selections = new Selections(model, session);
    }

    /** Registers every command, and returns them for the extension to dispose. */
    register(): vscode.Disposable[] {
        const on = (name: string, run: (...args: never[]) => Promise<void> | void) =>
            vscode.commands.registerCommand(name, async (...args: never[]) => {
                try {
                    await run(...args);
                } catch (failure) {
                    report(failure, this.session);
                }
            });

        return [
            on('key.verify', (at: Invocation, rest: Invocation[]) => this.act(at, rest, prove)),
            on('key.replay', (at: Invocation, rest: Invocation[]) => this.act(at, rest, replay)),
            on('key.removeProof', (at: Invocation, rest: Invocation[]) => this.remove(at, rest)),
            on('key.openProof', (at: Invocation) => this.openProof(at)),
            on('key.goToSource', (at: Invocation) => this.goToSource(at)),
            on('key.showDependencies', (at: Invocation) => this.showDependencies(at)),
            on('key.verifyDependencies', () => this.verifyDependencies()),
            on('key.settingDifferences', (at: Invocation) => this.settingDifferences(at)),
            on('key.options', (at: Invocation, rest: Invocation[]) => this.options(at, rest)),
            on('key.projectOptions', () => this.projectOptions()),
            on('key.toggleProver', () => this.prover.toggle()),
            on('key.chooseProver', () => this.prover.choose()),
            on('key.pruneTrash', () => Trash.emptyNow(this.model)),
            on('key.cleanUpOptions', (at: Invocation) => this.cleanUpOptions(at)),
            on('key.verifyAll', () => this.everything(prove)),
            on('key.replayAll', () => this.everything(replay)),
            on('key.refresh', () => this.model.forget()),
            on('key.clearResults', () => this.model.clearMeasurements()),
            on('key.restart', () => this.restart()),
            on('key.verifyOnSaveOn', () => this.onSave.toggle()),
            on('key.verifyOnSaveOff', () => this.onSave.toggle()),
            on('key.editContexts', () =>
                ContextsForm.show(this.session, this.model, this.extension),
            ),
            on('key.validateConfiguration', () =>
                ContextsForm.show(this.session, this.model, this.extension),
            ),
            on('key.showConfiguration', () => this.showConfiguration()),
            on('key.stop', () => this.stop()),
        ];
    }

    /**
     * Proves or replays what was invoked on, a run for each context it holds.
     *
     * @param at what the command was invoked on
     * @param rest everything else that was selected
     * @param run what to do with each context's obligations
     */
    private async act(at: Invocation, rest: Invocation[] | undefined, run: Run): Promise<void> {
        for (const selection of await this.selected(at, rest)) {
            await run(
                this.session,
                this.model,
                selection.contextId,
                selection.obligations,
                selection.label,
            );
        }
    }

    private async remove(at: Invocation, rest: Invocation[] | undefined): Promise<void> {
        for (const selection of await this.selected(at, rest)) {
            await removeProofs(
                this.session,
                this.model,
                selection.contextId,
                selection.obligations,
                selection.label,
            );
        }
    }

    /**
     * Opens a proof in a KeY window of its own.
     *
     * The bridge has no user interface, so looking at a proof means starting KeY on the
     * saved file. An obligation with no proof yet is prepared first, so that the window
     * opens under the settings the obligation is configured with, and a saved proof that was
     * made under other settings is not opened without asking.
     */
    private async openProof(at: Invocation): Promise<void> {
        const selection = (await this.selected(at))[0];
        if (selection.obligations.length !== 1) {
            void vscode.window.showWarningMessage('Choose one proof obligation to open.');
            return;
        }
        const obligation = selection.obligations[0];
        let file = obligation.proofFile;
        if (obligation.proofFileExists && obligation.differingSettings.length > 0) {
            const chosen = await this.askAboutDifferences(selection, obligation);
            if (chosen === undefined) {
                return;
            }
            if (chosen) {
                file = await this.prepared(selection.contextId, obligation.contractName);
            }
        } else if (!obligation.proofFileExists) {
            file = await this.prepared(selection.contextId, obligation.contractName);
        }
        openInKeY(path.resolve(this.session.root, file));
    }

    /**
     * Asks what to do with a saved proof made under other settings.
     *
     * @returns true to start a new proof, false to open the saved one, undefined to do
     *          nothing
     */
    private async askAboutDifferences(
        selection: Selection,
        obligation: Obligation,
    ): Promise<boolean | undefined> {
        const chosen = await vscode.window.showQuickPick(
            [
                { label: 'Open the saved proof', start: false },
                { label: 'Start a new proof under the current settings', start: true },
            ],
            {
                title: `${selection.label}: the saved proof was made under other settings`,
                placeHolder: obligation.differingSettings
                    .map((one) => `${one.label}: ${one.saved} \u2192 ${one.current}`)
                    .join('  \u00b7  '),
            },
        );
        return chosen?.start;
    }

    /** Shows how a saved proof's settings differ, and offers what to do about it. */
    private async settingDifferences(at: Invocation): Promise<void> {
        const selection = (await this.selected(at))[0];
        const obligation = selection.obligations[0];
        if (!obligation || obligation.differingSettings.length === 0) {
            void vscode.window.showInformationMessage(
                `The saved proof of ${selection.label} was made under the current settings.`,
            );
            return;
        }
        const start = await this.askAboutDifferences(selection, obligation);
        if (start === undefined) {
            return;
        }
        if (start) {
            await this.act(at, undefined, prove);
        } else {
            openInKeY(path.resolve(this.session.root, obligation.proofFile));
        }
    }

    /**
     * Builds a proof with the settings the obligation is configured with, and saves it.
     *
     * A KeY window reads the settings from the file, so this is how a proof reaches the
     * window under the settings that hold now. A proof that was there is moved to the trash.
     *
     * @returns the file the proof was saved to
     */
    private async prepared(contextId: string, contractName: string): Promise<string> {
        const bridge = await this.session.verification();
        const params: StartParams = { contextId, contractName };
        const prepared = await this.session.request<PreparedResult>(
            bridge,
            Methods.prepare,
            params,
            Deadline.context,
        );
        this.model.forget(contextId);
        return prepared.proofFile;
    }

    /** Opens the source the contract is written on, at the declaration it is about. */
    private async goToSource(at: Invocation): Promise<void> {
        const obligation = (await this.selected(at))[0]?.obligations[0];
        if (!obligation) {
            return;
        }
        const file = vscode.Uri.file(path.resolve(this.session.root, obligation.sourceFile));
        const document = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(document);
        const line = Math.max(0, (obligation.targetLine || obligation.classLine) - 1);
        editor.selection = new vscode.Selection(line, 0, line, 0);
        editor.revealRange(
            new vscode.Range(line, 0, line, 0),
            vscode.TextEditorRevealType.InCenter,
        );
    }

    /** Shows what the selected proof rests on, in the Dependencies view. */
    private async showDependencies(at: Invocation): Promise<void> {
        const selection = (await this.selected(at))[0];
        const obligation = selection?.obligations[0];
        if (!obligation) {
            return;
        }
        await this.dependencies.show(selection.contextId, obligation.contractName);
        await vscode.commands.executeCommand('key.dependencies.focus');
    }

    /** Proves what the shown proof rests on and is not proved itself. */
    private async verifyDependencies(): Promise<void> {
        const unproved = this.dependencies.unproved();
        if (!unproved || unproved.contractNames.length === 0) {
            void vscode.window.showInformationMessage(
                'Everything this proof rests on is proved already.',
            );
            return;
        }
        await this.act(unproved, undefined, prove);
    }

    /** Edits the settings of what was invoked on, which is a context or its obligations. */
    private async options(at: Invocation, rest: Invocation[] | undefined): Promise<void> {
        const selection = (await this.selected(at, rest))[0];
        const wholeContext = isNodeOfKind(at, 'context');
        const level: Level = wholeContext
            ? { contextId: selection.contextId, contractNames: [], label: selection.contextId }
            : {
                  contextId: selection.contextId,
                  contractNames: selection.obligations.map((one) => one.contractName),
                  label: selection.label,
              };
        await OptionsForm.show(this.session, this.model, this.extension, level);
    }

    /** Edits the settings the whole project attempts its proofs with. */
    private async projectOptions(): Promise<void> {
        await OptionsForm.show(this.session, this.model, this.extension, {
            contextId: null,
            contractNames: [],
            label: 'this project',
        });
    }

    /**
     * Removes the settings of obligations that no longer exist.
     *
     * Settings are stored by contract name. Renaming or removing a method leaves its
     * settings under a name that no longer resolves; they are not removed on their own,
     * since a method may be absent only for a while.
     */
    private async cleanUpOptions(at: Invocation): Promise<void> {
        const selections = await this.selections.of(at);
        const contextId = selections[0]?.contextId ?? (await this.firstContext());
        const bridge = await this.session.verification();
        const params: ListObligationsParams = { contextId };
        const stale = await this.session.request<StaleOptionsResult>(
            bridge,
            Methods.staleOptions,
            params,
            Deadline.context,
        );
        if (stale.contractNames.length === 0) {
            void vscode.window.showInformationMessage(
                'Every proof obligation with settings still exists.',
            );
            return;
        }
        const confirmed = await vscode.window.showWarningMessage(
            `Remove the settings of ${stale.contractNames.length} proof obligation(s) that no ` +
                'longer exist?',
            { modal: true },
            'Remove',
        );
        if (confirmed !== 'Remove') {
            return;
        }
        const removed = await this.session.request<StaleOptionsResult>(
            bridge,
            Methods.removeStaleOptions,
            params,
            Deadline.context,
        );
        void vscode.window.showInformationMessage(
            `Removed the settings of ${removed.contractNames.length} proof obligation(s).`,
        );
        this.model.forget(contextId);
    }

    /** Proves or replays everything the project holds, a run for each context. */
    private async everything(run: Run): Promise<void> {
        for (const [contextId, obligations] of await this.model.everything()) {
            await run(this.session, this.model, contextId, obligations, contextId);
        }
    }

    private async restart(): Promise<void> {
        if (await this.session.restart()) {
            void vscode.window.showInformationMessage('KeY was restarted.');
        }
        this.model.forget();
    }

    private stop(): void {
        this.session.stop();
        this.model.forget();
        void vscode.window.showInformationMessage('KeY stopped.');
    }

    /**
     * Opens the project's configuration file, creating a starting point when there is none.
     *
     * The file is plain JSON in the project and can be edited directly. The bridge owns its
     * schema and checks it through the contexts form.
     */
    private async showConfiguration(): Promise<void> {
        const file = vscode.Uri.file(path.join(this.session.root, '.key', 'settings.json'));
        try {
            await vscode.workspace.fs.stat(file);
        } catch {
            const starter = {
                version: 1,
                contexts: [
                    { id: 'main', javaSource: 'src/main/java', classpath: [], includes: [] },
                ],
            };
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file.fsPath)));
            await vscode.workspace.fs.writeFile(
                file,
                Buffer.from(`${JSON.stringify(starter, null, 2)}\n`, 'utf8'),
            );
        }
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }

    /** What the invocation means, refusing an empty one rather than doing nothing quietly. */
    private async selected(at: Invocation, rest?: Invocation[]): Promise<Selection[]> {
        const selections = await this.selections.of(at, rest as never);
        if (selections.length === 0) {
            throw new Error(
                'Nothing to prove here. Put the cursor in a Java file KeY reads, or choose a ' +
                    'file, a directory or a row in the KeY view.',
            );
        }
        return selections;
    }

    private async firstContext(): Promise<string> {
        const first = (await this.model.contexts())[0];
        if (!first) {
            throw new Error('No context yet. Run KeY: Edit Contexts to declare one.');
        }
        return first.id;
    }
}

/**
 * Opens a proof in a KeY window of its own.
 *
 * The window outlives this editor, so KeY is started detached rather than in a terminal
 * whose quoting differs per platform.
 */
function openInKeY(proofFile: string): void {
    const started = spawn(
        Settings.javaExecutable(),
        ['-cp', Settings.keyJar(), 'de.uka.ilkd.key.core.Main', proofFile],
        { detached: true, stdio: 'ignore' },
    );
    started.unref();
    void vscode.window.showInformationMessage(`Opening ${path.basename(proofFile)} in KeY.`);
}

function isNodeOfKind(invocation: Invocation, kind: string): boolean {
    return (
        typeof invocation === 'object' &&
        invocation !== null &&
        (invocation as { kind?: string }).kind === kind
    );
}
