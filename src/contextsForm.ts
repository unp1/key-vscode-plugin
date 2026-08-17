import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { Context, ProjectConfig, ValidateResult } from './protocol';
import { KeySession } from './session';

/**
 * The form that declares what KeY reads.
 *
 * A context is one set of paths KeY can load, and a project has one per module, so the
 * contexts are a list on the left and the selected one is a form on the right. Paths can be
 * typed or picked, and a path inside the project is stored relative to it, so that the file
 * travels with the project.
 *
 * What is entered is checked by the bridge, against the rules KeY imposes, and a problem is
 * shown on the field it belongs to rather than as a message about the whole file.
 */
export class ContextsForm {
    private static open: ContextsForm | undefined;

    private panel: vscode.WebviewPanel;

    private constructor(
        private readonly session: KeySession,
        private readonly model: ProjectModel,
        extension: vscode.Uri,
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'key.contexts',
            'KeY Contexts',
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [extension], retainContextWhenHidden: true },
        );
        this.panel.webview.html = page(this.panel.webview, extension);
        this.panel.webview.onDidReceiveMessage((message) => void this.received(message));
        this.panel.onDidDispose(() => {
            if (ContextsForm.open === this) {
                ContextsForm.open = undefined;
            }
        });
    }

    /** Opens the form, reusing the one that is open. */
    static async show(
        session: KeySession,
        model: ProjectModel,
        extension: vscode.Uri,
    ): Promise<void> {
        const form = ContextsForm.open ?? new ContextsForm(session, model, extension);
        ContextsForm.open = form;
        form.panel.reveal(vscode.ViewColumn.Active);
        await form.fill();
    }

    private async fill(problems: ValidateResult['problems'] = []): Promise<void> {
        const config = await this.model.config();
        await this.panel.webview.postMessage({
            type: 'contexts',
            contexts: config.contexts,
            proofDirectory: config.proofDirectory,
            problems,
        });
    }

    private async received(message: {
        type: string;
        contexts?: Context[];
        proofDirectory?: string;
        field?: string;
        index?: number;
        kind?: 'folder' | 'file';
    }): Promise<void> {
        switch (message.type) {
            case 'save':
                await this.save(message.contexts ?? [], message.proofDirectory ?? 'proofs');
                return;
            case 'validate':
                await this.validate();
                return;
            case 'browse':
                await this.browse(message.field ?? '', message.index ?? 0, message.kind ?? 'folder');
                return;
            default:
        }
    }

    /** Writes the configuration, then checks it and shows what KeY would refuse. */
    private async save(contexts: Context[], proofDirectory: string): Promise<void> {
        const config = await this.model.config();
        const written: ProjectConfig = {
            ...config,
            contexts,
            proofDirectory: proofDirectory.trim() || 'proofs',
        };
        await this.model.setConfig(written);
        await this.validate();
    }

    /** Checks the paths against the rules KeY imposes, without loading anything. */
    private async validate(): Promise<void> {
        const checked: ValidateResult = await this.model.validate();
        await this.fill(checked.problems);
        if (checked.problems.length === 0) {
            void vscode.window.showInformationMessage('KeY can load every context.');
        }
    }

    /**
     * Asks for a path and sends it back to the field that asked.
     *
     * A path inside the project is sent relative to it, so the settings file travels with
     * the project; one outside stays absolute, since there is nothing to write it against.
     */
    private async browse(field: string, index: number, kind: 'folder' | 'file'): Promise<void> {
        const picked = await vscode.window.showOpenDialog({
            canSelectFolders: kind === 'folder',
            canSelectFiles: kind === 'file',
            canSelectMany: false,
            defaultUri: vscode.Uri.file(this.session.root),
            openLabel: 'Use this',
        });
        const chosen = picked?.[0];
        if (!chosen) {
            return;
        }
        const relative = path.relative(this.session.root, chosen.fsPath);
        const inside = relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
        await this.panel.webview.postMessage({
            type: 'picked',
            field,
            index,
            path: inside ? relative : chosen.fsPath,
        });
    }
}

/** The page the form draws. */
function page(webview: vscode.Webview, extension: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'media', 'contexts.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'media', 'form.css'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
<link rel="stylesheet" href="${style}">
</head>
<body>
  <header>
    <h1>Contexts</h1>
    <p class="hint">What KeY reads for this project. Stored in <code>.key/settings.json</code>,
    which is meant to be committed.</p>
  </header>
  <section class="panes">
    <div class="master">
      <ul id="list"></ul>
      <div class="listActions">
        <button id="add">Add</button>
        <button id="remove">Remove</button>
      </div>
    </div>
    <div class="detail" id="detail"></div>
  </section>
  <footer>
    <button id="save" class="primary">Save</button>
    <button id="validate">Validate</button>
    <span id="note" class="hint"></span>
  </footer>
  <script src="${script}"></script>
</body>
</html>`;
}
