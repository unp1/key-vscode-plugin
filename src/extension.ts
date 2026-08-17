import * as vscode from 'vscode';
import { Actions } from './actions';
import { DependencyView } from './dependencies';
import { StatusIcons } from './icons';
import { GutterMarks } from './marks';
import { ProjectModel } from './model';
import { ObligationTree } from './obligations';
import { ProverSwitch } from './prover';
import { ResultsView } from './results';
import { KeySession } from './session';
import { Trash } from './trash';
import { VerifyOnSave } from './verifyOnSave';
import { WatchProofs } from './watch';

/**
 * Puts the parts together.
 *
 * The session owns the connection to KeY, the model owns what the project holds, and every
 * view and action reads the project from the model. Nothing here decides anything: it makes
 * the parts and hands each of them what it needs.
 */
export function activate(context: vscode.ExtensionContext): void {
    // A log channel rather than a plain one: it carries timestamps and levels, and the
    // editor keeps it on disk, which is what a bug report can be read from.
    const output = vscode.window.createOutputChannel('KeY', { log: true });
    context.subscriptions.push(output);

    const session = KeySession.start(context, output);
    if (!session) {
        // No folder is open, so there is no project to verify.
        return;
    }

    const model = new ProjectModel(session);
    const icons = new StatusIcons(session);
    const tree = new ObligationTree(model, icons);
    const results = new ResultsView(model, session, icons, context.extensionUri);
    const dependencies = new DependencyView(model, icons);
    const marks = new GutterMarks(model, icons, session, context.extensionUri);
    const prover = new ProverSwitch(model);
    const onSave = new VerifyOnSave(session, model);

    context.subscriptions.push(
        model,
        tree,
        results,
        dependencies,
        marks,
        prover,
        onSave,
        new WatchProofs(model),
        // Several rows can be selected, so that one action covers them, as the IntelliJ
        // plugin's tree allows.
        vscode.window.createTreeView('key.obligations', {
            treeDataProvider: tree,
            canSelectMany: true,
        }),
        vscode.window.createTreeView('key.dependencies', { treeDataProvider: dependencies }),
        vscode.window.registerWebviewViewProvider('key.results', results),
        ...new Actions(
            session,
            model,
            dependencies,
            prover,
            onSave,
            context.extensionUri,
        ).register(),
    );

    void marks.markAll();
    void Trash.applyAtStart(model).catch(() => {
        // There is nothing to prune, or no shared component is configured yet. Neither is
        // reported at start-up.
    });
}

export function deactivate(): void {
    // Everything this extension made was registered for disposal when it was made.
}
