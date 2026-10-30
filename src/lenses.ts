import * as vscode from 'vscode';
import { GutterMarks } from './marks';
import { Mark } from './protocol';
import { Settings } from './settings';

/**
 * The KeY actions above each declaration that has a contract.
 *
 * A gutter icon takes no clicks in this editor, so the click lives here: Verify, Replay and
 * Open proof over the line the mark is on, the way a test is offered its run. The lenses
 * come from the marks the gutter already fetched and follow the same refresh, so showing
 * them asks the bridge for nothing.
 */
export class MarkLenses implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly subscriptions: vscode.Disposable[] = [];

    readonly onDidChangeCodeLenses = this.changed.event;

    constructor(private readonly marks: GutterMarks) {
        this.subscriptions.push(
            vscode.languages.registerCodeLensProvider({ language: 'java', scheme: 'file' }, this),
            marks.onMarked(() => this.changed.fire()),
            vscode.workspace.onDidChangeConfiguration((change) => {
                if (change.affectsConfiguration('key.codeLens')) {
                    this.changed.fire();
                }
            }),
        );
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!Settings.codeLens()) {
            return [];
        }
        // The bridge's line numbers describe the saved file. In an edited buffer the gutter
        // icons move with the text but these lines do not, so a lens could sit over one
        // method and act on another. No lenses until the file is saved again; the save
        // refetches the marks, which brings them back where they belong.
        if (document.isDirty) {
            return [];
        }
        return this.marks
            .marksIn(document.uri)
            .filter((mark) => mark.line > 0 && mark.line <= document.lineCount)
            .flatMap((mark) => lensesAt(document.uri, mark));
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.changed.dispose();
    }
}

/** The actions on one marked line, in the order a user reaches for them. */
function lensesAt(file: vscode.Uri, mark: Mark): vscode.CodeLens[] {
    // The bridge counts lines from one, the editor from zero. The commands take the same
    // invocation the mark's hover sends, so clicking a lens and clicking a hover link mean
    // the same thing.
    const range = new vscode.Range(mark.line - 1, 0, mark.line - 1, 0);
    const at = [{ uri: file.toString(), line: mark.line }];
    return [
        new vscode.CodeLens(range, { title: 'Verify with KeY', command: 'key.verify', arguments: at }),
        new vscode.CodeLens(range, { title: 'Replay', command: 'key.replay', arguments: at }),
        new vscode.CodeLens(range, { title: 'Open proof', command: 'key.openProof', arguments: at }),
    ];
}
