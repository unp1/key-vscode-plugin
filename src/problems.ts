import * as vscode from 'vscode';
import { ENVIRONMENT_LOAD_FAILED, LoadFailure, SourceProblem } from './protocol';

/**
 * The sources KeY refused to read, and everything the extension does about them.
 *
 * KeY refuses a context whose Java or JML it cannot read, and names the file and the line of
 * each problem. This recognises such a refusal in a failure, remembers what each context was
 * last refused for, puts the places into the editor's own problems so the line is underlined
 * and the Problems view lists them, says so once with a button per place, and forgets it all
 * when the context loads again.
 *
 * It is one owner because the views that list a context all hear of one refusal at the same
 * time. Each reports it here; the problems of a context are replaced rather than added to,
 * and the message is shown for the first report only.
 */
export class RefusedSources implements vscode.Disposable {
    private readonly diagnostics = vscode.languages.createDiagnosticCollection('KeY');

    /** What each context was last refused for, while it is refused. */
    private readonly refused = new Map<string, LoadFailure>();

    /** The files each context's problems were put on, so they can be taken off again. */
    private readonly shownOn = new Map<string, string[]>();

    /**
     * Reports a failure, if it is a refusal.
     *
     * @param failure what went wrong
     * @returns true when the failure was a refusal and has been dealt with here; false when
     *          it is some other failure the caller should report itself
     */
    report(failure: unknown): boolean {
        const refusal = refusalIn(failure);
        if (!refusal) {
            return false;
        }
        const before = this.refused.get(refusal.contextId);
        const news = !before || JSON.stringify(before) !== JSON.stringify(refusal);
        this.refused.set(refusal.contextId, refusal);
        this.mark(refusal);
        if (news) {
            void say(refusal);
        }
        return true;
    }

    /** Forgets what a context was refused for, which is what a load that succeeds means. */
    accept(contextId: string): void {
        this.unmark(contextId);
        this.refused.delete(contextId);
    }

    dispose(): void {
        this.diagnostics.dispose();
    }

    private mark(refusal: LoadFailure): void {
        this.unmark(refusal.contextId);
        const byFile = new Map<string, vscode.Diagnostic[]>();
        for (const problem of refusal.problems.filter(placed)) {
            const uri = problem.uri as string;
            byFile.set(uri, [...(byFile.get(uri) ?? []), diagnosticOf(problem)]);
        }
        for (const [uri, list] of byFile) {
            this.diagnostics.set(vscode.Uri.parse(uri), list);
        }
        this.shownOn.set(refusal.contextId, [...byFile.keys()]);
    }

    private unmark(contextId: string): void {
        for (const uri of this.shownOn.get(contextId) ?? []) {
            this.diagnostics.delete(vscode.Uri.parse(uri));
        }
        this.shownOn.delete(contextId);
    }
}

/** The refusal inside a failure, or undefined when the failure is something else. */
function refusalIn(failure: unknown): LoadFailure | undefined {
    const error = failure as { code?: number; data?: LoadFailure } | null;
    if (!error || error.code !== ENVIRONMENT_LOAD_FAILED || !error.data?.problems?.length) {
        return undefined;
    }
    return error.data;
}

/** Whether KeY named a place that can be marked: a file, and a line above zero. */
function placed(problem: SourceProblem): boolean {
    return problem.uri !== null && problem.line > 0;
}

/** One problem as the editor draws it: from the column KeY named to the end of the line. */
function diagnosticOf(problem: SourceProblem): vscode.Diagnostic {
    // KeY counts lines and columns from one, the editor from zero. The range runs to the end
    // of the line, since KeY names where a problem starts and not where it stops; the editor
    // clips a range past the line's end to the line.
    const line = problem.line - 1;
    const column = Math.max(problem.column - 1, 0);
    const range = new vscode.Range(line, column, line, Number.MAX_SAFE_INTEGER);
    const diagnostic = new vscode.Diagnostic(range, problem.message, vscode.DiagnosticSeverity.Error);
    diagnostic.source = 'KeY';
    return diagnostic;
}

/** Says what KeY refused, once, with a button per place that opens the file at the line. */
async function say(refusal: LoadFailure): Promise<void> {
    const listed = refusal.problems
        .map((problem) => {
            const place = placeOf(problem);
            return place ? `${place}: ${problem.message}` : problem.message;
        })
        .join('\n');
    // One button per place: two problems on one line open the same file the same way.
    const places = [
        ...new Map(refusal.problems.filter(placed).map((problem) => [placeOf(problem), problem])).values(),
    ];
    const chosen = await vscode.window.showErrorMessage(
        `KeY could not read the sources of '${refusal.contextId}'.\n${listed}`,
        { modal: false },
        ...places.map((problem) => `Open ${placeOf(problem)}`),
    );
    const open = places.find((problem) => `Open ${placeOf(problem)}` === chosen);
    if (open?.uri) {
        // KeY counts lines and columns from one, the editor from zero.
        const position = new vscode.Position(Math.max(open.line - 1, 0), Math.max(open.column - 1, 0));
        await vscode.window.showTextDocument(vscode.Uri.parse(open.uri), {
            selection: new vscode.Range(position, position),
        });
    }
}

/** How a problem's place reads: the file name, and the line where KeY named one. */
function placeOf(problem: SourceProblem): string | undefined {
    if (!problem.uri) {
        return undefined;
    }
    const name = problem.uri.slice(problem.uri.lastIndexOf('/') + 1);
    return problem.line > 0 ? `${name}:${problem.line}` : name;
}
