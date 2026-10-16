import * as vscode from 'vscode';
import { StatusIcons } from './icons';
import { ProjectModel } from './model';
import { KeySession } from './session';
import { Mark, ProofMark } from './protocol';

/** The marks this extension draws, and the file each is drawn from. */
const DRAWN: Partial<Record<ProofMark, string>> = {
    CLOSED: 'mark-closed.svg',
    LEMMAS_LEFT: 'mark-lemmas-left.svg',
    OPEN: 'mark-open.svg',
};

/**
 * Marks in the gutter what can be verified, and how far it has got.
 *
 * A mark appears beside every method that has a contract, and beside the class. The bridge
 * says which line carries which mark and what it says when hovered, so a mark means the same
 * here as it does in every other editor. Nothing here parses Java, and nothing here decides
 * what counts as proved.
 */
export class GutterMarks implements vscode.Disposable {
    private readonly decorations = new Map<ProofMark, vscode.TextEditorDecorationType>();
    private readonly subscriptions: vscode.Disposable[] = [];
    private unjudged: vscode.TextEditorDecorationType | undefined;

    /** What the bridge last said to mark, by file, for whoever else shows it. */
    private readonly latest = new Map<string, Mark[]>();
    private readonly fetched = new vscode.EventEmitter<void>();

    /** The marks of some file have been fetched again. */
    readonly onMarked = this.fetched.event;

    /**
     * The marks the bridge last reported for a file.
     *
     * Answered from what [mark] fetched, so asking costs nothing: the code lenses ask once
     * per visible file on every change.
     *
     * @param file the file to ask about
     */
    marksIn(file: vscode.Uri): Mark[] {
        return this.latest.get(file.toString()) ?? [];
    }

    constructor(
        private readonly model: ProjectModel,
        private readonly icons: StatusIcons,
        private readonly session: KeySession,
        extension: vscode.Uri,
    ) {
        for (const [mark, file] of Object.entries(DRAWN) as [ProofMark, string][]) {
            this.decorations.set(
                mark,
                vscode.window.createTextEditorDecorationType({
                    gutterIconPath: vscode.Uri.joinPath(extension, 'media', file),
                    gutterIconSize: 'contain',
                    // The range spans the marked line as the hover surface. It must not grow
                    // when the user types at its edges, or pressing Enter at the end of a
                    // marked line carries the mark onto the new line.
                    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
                }),
            );
        }
        this.subscriptions.push(
            model.onChanged(() => void this.markAll()),
            // Which editors are visible changes on a split or a close; which one is active
            // changes on every tab. A mark has to survive both, and a file opened before the
            // project was read has to be marked once it has been.
            vscode.window.onDidChangeVisibleTextEditors(() => void this.markAll()),
            vscode.window.onDidChangeActiveTextEditor(() => void this.markAll()),
            icons.onDidFetch(() => void this.markAll()),
            // A closed file's marks are refetched when it is opened again, so keeping them
            // would only serve them stale and keep the store growing for the whole session.
            vscode.workspace.onDidCloseTextDocument((document) => {
                if (this.latest.delete(document.uri.toString())) {
                    this.fetched.fire();
                }
            }),
            // A save changes the file the bridge's line numbers describe, whether or not a
            // verification follows it, so that file's marks are read again.
            vscode.workspace.onDidSaveTextDocument((document) => {
                for (const editor of vscode.window.visibleTextEditors) {
                    if (editor.document === document) {
                        void this.mark(editor);
                    }
                }
            }),
        );
    }

    /** Marks every visible editor again, after proof states have changed. */
    async markAll(): Promise<void> {
        for (const editor of vscode.window.visibleTextEditors) {
            await this.mark(editor);
        }
    }

    /**
     * Marks one editor.
     *
     * @param editor the editor to mark
     */
    async mark(editor: vscode.TextEditor): Promise<void> {
        if (editor.document.languageId !== 'java') {
            return;
        }
        const marked = await this.marksFor(editor.document.uri).catch((failure) => {
            // Marking is attempted whenever an editor or the project changes, so a failure
            // here is usually KeY not being ready yet and the next attempt succeeding. It is
            // still said out loud: a gutter that silently stays empty looks like a verdict.
            this.session.output.appendLine(
                `marks: ${editor.document.uri.fsPath}: ${
                    failure instanceof Error ? failure.message : String(failure)
                }`,
            );
            return undefined;
        });
        if (!marked) {
            // KeY could not read the file, so nothing it said about it before holds: the
            // marks come off and the lenses with them, rather than offering actions on a
            // source KeY refuses. The next successful fetch puts both back.
            this.latest.delete(editor.document.uri.toString());
            this.fetched.fire();
            for (const decoration of this.decorations.values()) {
                editor.setDecorations(decoration, []);
            }
            if (this.unjudged) {
                editor.setDecorations(this.unjudged, []);
            }
            return;
        }
        for (const [mark, decoration] of this.decorations) {
            editor.setDecorations(decoration, marked.get(mark) ?? []);
        }
        const invitation = await this.invitation();
        if (invitation) {
            editor.setDecorations(invitation, marked.get('UNJUDGED') ?? []);
        }
    }

    /**
     * What the bridge says to mark in a file, as the editor draws it.
     *
     * @param file the file shown in the editor
     * @returns the ranges to decorate, by the mark they carry
     */
    private async marksFor(file: vscode.Uri): Promise<Map<ProofMark, vscode.DecorationOptions[]>> {
        const reported = await this.model.marks(file);
        this.latest.set(file.toString(), reported.marks);
        this.fetched.fire();

        const byMark = new Map<ProofMark, vscode.DecorationOptions[]>();
        for (const mark of reported.marks) {
            const options = byMark.get(mark.mark) ?? [];
            options.push({
                // The bridge counts lines from one, the editor from zero. The range spans
                // the line, since it is the hover surface for the tooltip and the actions:
                // a gutter icon itself takes neither hovers nor clicks in this editor.
                range: new vscode.Range(mark.line - 1, 0, mark.line - 1, Number.MAX_SAFE_INTEGER),
                hoverMessage: hoverFor(file, mark.line, mark.tooltip),
            });
            byMark.set(mark.mark, options);
        }
        return byMark;
    }

    /** KeY's continue button, for a line KeY has judged nothing about. */
    private async invitation(): Promise<vscode.TextEditorDecorationType | undefined> {
        if (this.unjudged) {
            return this.unjudged;
        }
        const icon = await this.icons.verifyIcon();
        if (!icon) {
            return undefined;
        }
        this.unjudged = vscode.window.createTextEditorDecorationType({
            gutterIconPath: icon,
            gutterIconSize: 'contain',
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        });
        return this.unjudged;
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.decorations.forEach((decoration) => decoration.dispose());
        this.unjudged?.dispose();
        this.fetched.dispose();
    }
}

/**
 * What a mark says, and what can be done from it.
 *
 * A gutter icon takes no clicks in this editor, so the actions live in its hover, which is
 * where the mark can be acted on without moving the cursor first.
 *
 * @param file the file the mark is in
 * @param line the 1-based line it sits on
 * @param tooltip the sentence the bridge offers for that line
 */
function hoverFor(file: vscode.Uri, line: number, tooltip: string): vscode.MarkdownString {
    const args = encodeURIComponent(JSON.stringify([{ uri: file.toString(), line }]));
    const hover = new vscode.MarkdownString(
        `${tooltip}\n\n[Verify](command:key.verify?${args}) · ` +
            `[Replay](command:key.replay?${args}) · ` +
            `[Open proof](command:key.openProof?${args})`,
    );
    // Command links are inert unless the hover says it trusts them.
    hover.isTrusted = true;
    return hover;
}
