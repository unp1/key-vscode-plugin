import * as vscode from 'vscode';
import { StatusIcons } from './icons';
import { ProjectModel, Row } from './model';
import { ProofOutcome, Status } from './protocol';
import { KeySession } from './session';

/** A row as the table shows it, which is what crosses into the page. */
interface Shown {
    contextId: string;
    contractName: string;
    label: string;
    context: string;
    status: string;
    icon: string;
    /** The same icon as a dark theme draws it, which the bridge decided. */
    darkIcon: string;
    time: number | null;
    nodes: number | null;
    branches: number | null;
    differs: number;
}

/**
 * Where each of the project's proof obligations stands.
 *
 * One row per obligation, showing how it ended and, once a run in this session has attempted
 * it, what it cost. It is a table because that is what the columns are for: sorting by time
 * finds the proof worth looking at, and sorting by status finds the work left.
 *
 * A tree cannot hold columns, so this pane is a page. What it draws comes from the model,
 * like every other view, and what it does with a row goes through the same commands.
 */
export class ResultsView implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[] = [];
    private view: vscode.WebviewView | undefined;
    private listing = false;

    constructor(
        private readonly model: ProjectModel,
        private readonly session: KeySession,
        private readonly icons: StatusIcons,
        private readonly extension: vscode.Uri,
    ) {
        this.subscriptions.push(
            model.onChanged(() => void this.draw()),
            icons.onDidFetch(() => void this.draw()),
        );
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = {
            enableScripts: true,
            // KeY's icons are written into the extension's storage, which a page may not
            // read from unless it is named here.
            localResourceRoots: [this.extension, this.session.storage],
        };
        view.webview.html = page(view.webview, this.extension);
        this.subscriptions.push(
            view.webview.onDidReceiveMessage((message) => void this.received(message)),
            view.onDidChangeVisibility(() => void this.draw()),
        );
        void this.draw();
    }

    /**
     * Draws the rows the model holds.
     *
     * KeY's icons are fetched first, since the page addresses them by file and a row drawn
     * before they arrive would carry no icon until something else redrew it.
     */
    private async draw(): Promise<void> {
        if (!this.view?.visible || this.listing) {
            return;
        }
        this.listing = true;
        try {
            await this.icons.ensure().catch(() => undefined);
            const rows = await this.model.rows();
            const several = new Set(rows.map((row) => row.contextId)).size > 1;
            await this.view.webview.postMessage({
                type: 'rows',
                rows: rows.map((row) => this.shown(row, several)),
            });
        } catch (failure) {
            await this.view.webview.postMessage({
                type: 'failed',
                message: failure instanceof Error ? failure.message : String(failure),
            });
        } finally {
            this.listing = false;
        }
    }

    private shown(row: Row, severalContexts: boolean): Shown {
        const outcome = row.outcome;
        const measured = outcome.nodes > 0;
        return {
            contextId: row.contextId,
            contractName: row.contractName,
            label: row.obligation?.label ?? row.contractName,
            context: severalContexts ? row.contextId : '',
            status: statusText(outcome),
            icon: this.iconFor(outcome.status, false),
            darkIcon: this.iconFor(outcome.status, true),
            time: measured ? outcome.milliseconds / 1000 : null,
            nodes: measured ? outcome.nodes : null,
            branches: measured ? outcome.branches : null,
            differs: row.obligation?.differingSettings.length ?? 0,
        };
    }

    /**
     * KeY's own icon for a state, as a page can address it.
     *
     * KeY draws four proof states and a question mark for the two it does not classify. A
     * state it draws nothing for gets nothing here: an empty cell rather than the editor's
     * broken-image mark.
     *
     * @param status the state as the bridge reports it
     * @param dark whether to address the set a dark theme draws
     */
    private iconFor(status: string, dark: boolean): string {
        if (!this.view || !this.icons.has(status)) {
            return '';
        }
        const file = vscode.Uri.joinPath(this.session.storage, 'icons', '32',
            `${status}${dark ? '-dark' : ''}.png`);
        return this.view.webview.asWebviewUri(file).toString();
    }

    /** The only message a row sends: the settings-differ link. The menu is the editor's own. */
    private async received(message: {
        type: string;
        contextId?: string;
        contractNames?: string[];
    }): Promise<void> {
        if (!message.contextId || !message.contractNames) {
            return;
        }
        await vscode.commands.executeCommand(`key.${message.type}`, {
            contextId: message.contextId,
            contractNames: message.contractNames,
        });
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
    }
}

/** The status as a table shows it, with what went wrong after it. */
function statusText(outcome: ProofOutcome): string {
    const status = outcome.status === Status.none ? 'NOT YET STARTED' : outcome.status;
    return outcome.message.trim().length > 0 ? `${status} \u2014 ${outcome.message}` : status;
}

/**
 * The page the pane draws.
 *
 * It holds the table and nothing else: the rows arrive as messages, and what a row is asked
 * to do goes back as one. The colours are the editor's own, so the pane follows the theme.
 */
function page(webview: vscode.Webview, extension: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'media', 'results.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline';
               script-src ${webview.cspSource};">
<style>
  body { padding: 0; margin: 0; font-family: var(--vscode-font-family);
         font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  table { border-collapse: collapse; width: 100%; }
  thead th { position: sticky; top: 0; text-align: left; font-weight: 600;
             background: var(--vscode-sideBar-background); cursor: pointer;
             padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border);
             white-space: nowrap; }
  thead th.right, td.right { text-align: right; }
  tbody td { padding: 2px 8px; white-space: nowrap; overflow: hidden;
             text-overflow: ellipsis; }
  tbody tr.selected { background: var(--vscode-list-activeSelectionBackground);
                      color: var(--vscode-list-activeSelectionForeground); }
  tbody tr:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
  td.state { display: flex; align-items: center; gap: 6px; }
  img.icon { width: 16px; height: 16px; }
  /* KeY serves a set of icons per theme; the page shows the one this theme asks for. */
  img.icon.dark { display: none; }
  body.vscode-dark img.icon.light, body.vscode-high-contrast img.icon.light { display: none; }
  body.vscode-dark img.icon.dark, body.vscode-high-contrast img.icon.dark { display: inline; }
  a.differs { color: var(--vscode-textLink-foreground); cursor: pointer;
              text-decoration: underline; }
  .empty { padding: 12px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="empty" id="empty">Nothing listed yet.</div>
  <table id="table" hidden>
    <thead>
      <tr>
        <th data-sort="label">Proof obligation</th>
        <th data-sort="context" id="contextHead" hidden>Context</th>
        <th data-sort="time" class="right">Time</th>
        <th data-sort="nodes" class="right">Nodes</th>
        <th data-sort="branches" class="right">Branches</th>
        <th data-sort="status">Status</th>
      </tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <script src="${script}"></script>
</body>
</html>`;
}
