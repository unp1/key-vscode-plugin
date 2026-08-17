import * as vscode from 'vscode';
import { StatusIcons } from './icons';
import { ProjectModel } from './model';
import { KeySession } from './session';
import { ProofMark } from './protocol';

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

        const byMark = new Map<ProofMark, vscode.DecorationOptions[]>();
        for (const mark of reported.marks) {
            const options = byMark.get(mark.mark) ?? [];
            options.push({
                // The bridge counts lines from one, the editor from zero.
                range: new vscode.Range(mark.line - 1, 0, mark.line - 1, 0),
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
        });
        return this.unjudged;
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.decorations.forEach((decoration) => decoration.dispose());
        this.unjudged?.dispose();
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
