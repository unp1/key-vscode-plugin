import * as vscode from 'vscode';
import { Level, ProjectModel } from './model';
import {
    AvailableOptions,
    AvailableOptionsParams,
    Methods,
    OptionCategory,
    OptionChange,
    ProjectConfig,
    ProofOptions,
} from './protocol';
import { Deadline, KeySession } from './session';

/** One option as the form shows it: what it accepts, what this level sets, what it inherits. */
interface Shown {
    key: string;
    label: string;
    description: string;
    values: { value: string; label: string; description: string }[];
    /** What this level sets, or null where it inherits. */
    stated: string | null;
    /** What it uses where this level sets nothing. */
    inherited: string;
}

/**
 * The form that edits the settings a proof is attempted with.
 *
 * The options are listed on the left and the selected one is chosen on the right, so that
 * each option is read with what it means rather than as one row in a wall of them. The list
 * shows the value every option has and marks the ones this level decides, which is how one
 * sees at a glance what the level changes.
 *
 * Every option offers what the level above says as well as the values themselves, so a
 * setting can be put back to being inherited. Only the options the user changed are sent,
 * which is what makes editing several obligations at once safe: each keeps what was not
 * touched, rather than being overwritten with the settings of whichever one the form showed.
 */
export class OptionsForm {
    private static open: OptionsForm | undefined;

    private panel: vscode.WebviewPanel;

    private constructor(
        private readonly session: KeySession,
        private readonly model: ProjectModel,
        extension: vscode.Uri,
        private level: Level,
    ) {
        this.panel = vscode.window.createWebviewPanel(
            'key.options',
            'KeY Proof Options',
            vscode.ViewColumn.Active,
            { enableScripts: true, localResourceRoots: [extension], retainContextWhenHidden: true },
        );
        this.panel.webview.html = page(this.panel.webview, extension);
        this.panel.webview.onDidReceiveMessage((message) => void this.received(message));
        this.panel.onDidDispose(() => {
            if (OptionsForm.open === this) {
                OptionsForm.open = undefined;
            }
        });
    }

    /**
     * Opens the form on a level, reusing the one that is open.
     *
     * @param session the project's session
     * @param extension where the form's page and script live
     * @param level what to edit
     */
    static async show(
        session: KeySession,
        model: ProjectModel,
        extension: vscode.Uri,
        level: Level,
    ): Promise<void> {
        const form = OptionsForm.open ?? new OptionsForm(session, model, extension, level);
        OptionsForm.open = form;
        form.level = level;
        form.panel.reveal(vscode.ViewColumn.Active);
        await form.fill();
    }

    /** Reads what the level states and what it would inherit, and shows both. */
    private async fill(): Promise<void> {
        const config = await this.model.config();
        // Which options KeY offers does not depend on the project, so the form opens before
        // any context is declared: what is set at project level is what every context starts
        // from. A context that is loaded is read from, since it knows what it was loaded with.
        const contextId = this.level.contextId ?? config.contexts[0]?.id ?? null;
        const bridge = await this.session.verification();
        const params: AvailableOptionsParams = { contextId };
        const available = await this.session.request<AvailableOptions>(
            bridge,
            Methods.availableOptions,
            params,
            Deadline.context,
        );

        const stated = statedAt(config, this.level);
        const inherited = inheritedAt(config, this.level, available.defaults);
        await this.panel.webview.postMessage({
            type: 'options',
            title: this.level.label,
            fallback: fallbackName(this.level),
            taclet: shownFor(available.taclet, stated.taclet, inherited.taclet),
            strategy: shownFor(available.strategy, stated.strategy, inherited.strategy),
            maxSteps: stated.maxSteps > 0 ? String(stated.maxSteps) : '',
            inheritedMaxSteps: inherited.maxSteps,
            timeout: stated.timeout !== 0 ? String(stated.timeout) : '',
            inheritedTimeout: inherited.timeout,
        });
    }

    private async received(message: {
        type: string;
        change?: OptionChange;
    }): Promise<void> {
        if (message.type !== 'apply' || !message.change) {
            return;
        }
        await this.model.setOptions(this.level, message.change);
        void vscode.window.showInformationMessage(`Saved the proof options of ${this.level.label}.`);
        await this.fill();
    }
}

/** What the level states, which is what it changes about the level above it. */
function statedAt(config: ProjectConfig, level: Level): ProofOptions {
    if (level.contextId === null) {
        return config.options ?? empty();
    }
    if (level.contractNames.length === 0) {
        return config.contexts.find((one) => one.id === level.contextId)?.options ?? empty();
    }
    // Several obligations may state different things. What they agree on is shown; where
    // they differ the form shows nothing, and leaving it alone keeps each as it is.
    const perObligation = level.contractNames.map(
        (name) => config.obligationOptions?.[level.contextId as string]?.[name] ?? empty(),
    );
    return agreed(perObligation);
}

/** What the level uses where it states nothing, which is what the levels above it say. */
function inheritedAt(config: ProjectConfig, level: Level, defaults: ProofOptions): ProofOptions {
    const project = merge(defaults, config.options);
    if (level.contextId === null) {
        return defaults;
    }
    const context = config.contexts.find((one) => one.id === level.contextId);
    if (level.contractNames.length === 0) {
        return project;
    }
    return merge(project, context?.options);
}

/** How the level above reads in the form, so that "inherit" says what it inherits. */
function fallbackName(level: Level): string {
    if (level.contextId === null) {
        return "KeY's default";
    }
    return level.contractNames.length === 0
        ? "the project's setting"
        : "the context's setting";
}

function shownFor(
    categories: OptionCategory[],
    stated: Record<string, string>,
    inherited: Record<string, string>,
): Shown[] {
    return categories.map((category) => ({
        key: category.key,
        label: category.label,
        description: category.description,
        values: category.values,
        stated: stated[category.key] ?? null,
        inherited: inherited[category.key] ?? '',
    }));
}

function merge(under: ProofOptions, over: ProofOptions | null | undefined): ProofOptions {
    if (!over) {
        return under;
    }
    return {
        taclet: { ...under.taclet, ...over.taclet },
        strategy: { ...under.strategy, ...over.strategy },
        maxSteps: over.maxSteps > 0 ? over.maxSteps : under.maxSteps,
        timeout: over.timeout !== 0 ? over.timeout : under.timeout,
    };
}

/** What several levels agree on; an option they disagree about is shown as unset. */
function agreed(levels: ProofOptions[]): ProofOptions {
    const first = levels[0] ?? empty();
    return levels.slice(1).reduce(
        (kept, one) => ({
            taclet: sameEntries(kept.taclet, one.taclet),
            strategy: sameEntries(kept.strategy, one.strategy),
            maxSteps: kept.maxSteps === one.maxSteps ? kept.maxSteps : 0,
            timeout: kept.timeout === one.timeout ? kept.timeout : 0,
        }),
        first,
    );
}

function sameEntries(
    left: Record<string, string>,
    right: Record<string, string>,
): Record<string, string> {
    const same: Record<string, string> = {};
    for (const [key, value] of Object.entries(left)) {
        if (right[key] === value) {
            same[key] = value;
        }
    }
    return same;
}

function empty(): ProofOptions {
    return { taclet: {}, strategy: {}, maxSteps: 0, timeout: 0 };
}

/** The page the form draws. The values arrive as a message, and the edit goes back as one. */
function page(webview: vscode.Webview, extension: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'media', 'options.js'));
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
    <h1 id="title">Proof options</h1>
    <p id="fallback" class="hint"></p>
  </header>
  <nav class="tabs">
    <button data-tab="taclet" class="chosen">Taclet options</button>
    <button data-tab="strategy">Strategy options</button>
    <button data-tab="limits">Limits</button>
  </nav>
  <section class="panes">
    <div class="master"><ul id="list"></ul></div>
    <div class="detail" id="detail"></div>
  </section>
  <footer>
    <button id="apply" class="primary">Apply</button>
    <button id="inheritAll">Set all to inherit</button>
    <span id="note" class="hint"></span>
  </footer>
  <script src="${script}"></script>
</body>
</html>`;
}
