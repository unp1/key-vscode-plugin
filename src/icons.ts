import * as vscode from 'vscode';
import { IconsParams, IconsResult, Methods, Status } from './protocol';
import { Deadline, KeySession } from './session';

/** The size a tree row's icon is drawn at, doubled so it stays sharp on a dense screen. */
const SIZE = 32;

/**
 * KeY's own status icons.
 *
 * They come from KeY as image data, so the extension ships none of KeY's assets, and they
 * can only be fetched while KeY is running. A tree item takes a file rather than data, so
 * each is written once into the extension's storage and handed out as a file.
 *
 * A state KeY draws nothing for gets nothing: an obligation nobody has proved is drawn as
 * KeY draws it, and a state this extension does not recognise gets the editor's own
 * question mark rather than borrowing KeY's authority.
 *
 * KeY draws two of its states as a dark glyph, which a dark theme would swallow. The bridge
 * serves a set for each theme, and this hands out the one the current theme asks for, so
 * nothing here decides which states need it. A theme change reports as a fetch, since what a
 * view holds was made for the theme it drew in.
 */
export class StatusIcons {
    private readonly fetched = new vscode.EventEmitter<void>();

    /** KeY's icons have arrived: a view that drew a row without one draws it again. */
    readonly onDidFetch = this.fetched.event;

    private files = new Map<string, vscode.Uri>();
    private darkFiles = new Map<string, vscode.Uri>();
    private fetching: Promise<void> | undefined;
    private readonly themes: vscode.Disposable;

    constructor(private readonly session: KeySession) {
        this.themes = vscode.window.onDidChangeActiveColorTheme(() => this.fetched.fire());
    }

    /**
     * The icon for a state, as the current theme draws it, fetching on first use.
     *
     * @param status the state as the bridge reports it
     */
    async forStatus(status: string): Promise<vscode.Uri | undefined> {
        if (status === Status.none) {
            return undefined;
        }
        await this.fetchOnce();
        // A state KeY draws nothing for, and a state it does not know, get nothing rather
        // than an icon of the editor's that would mean something else.
        return this.forTheme(status);
    }

    /**
     * The file for a state in the theme that is current.
     *
     * @param status the state as the bridge reports it
     */
    private forTheme(status: string): vscode.Uri | undefined {
        const kind = vscode.window.activeColorTheme.kind;
        const dark =
            kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
        return dark ? this.darkFiles.get(status) ?? this.files.get(status) : this.files.get(status);
    }

    /** Fetches KeY's icons if that has not happened yet, so a view can ask what exists. */
    async ensure(): Promise<void> {
        await this.fetchOnce();
    }

    /**
     * Whether KeY draws this state.
     *
     * Answered from what was fetched, so a view that draws its own image asks before it
     * addresses a file that is not there.
     */
    has(status: string): boolean {
        return this.files.has(status);
    }

    /** Stops listening for theme changes. */
    dispose(): void {
        this.themes.dispose();
        this.fetched.dispose();
    }

    /** The icon KeY draws for continuing, which offers to prove something. */
    async verifyIcon(): Promise<vscode.Uri | undefined> {
        await this.fetchOnce();
        return this.files.get('VERIFY');
    }

    private fetchOnce(): Promise<void> {
        if (!this.fetching) {
            this.fetching = this.fetch().catch((failure) => {
                this.session.output.appendLine(
                    `icons: could not be fetched: ${
                        failure instanceof Error ? failure.message : String(failure)
                    }`,
                );
                // KeY is not running or could not draw them. The views fall back to the
                // editor's own icons, and the next session tries again.
                this.fetching = undefined;
            });
        }
        return this.fetching;
    }

    private async fetch(): Promise<void> {
        this.session.output.appendLine('icons: asking KeY for its status icons');
        const bridge = await this.session.verification();
        const params: IconsParams = { size: SIZE };
        const served = await this.session.request<IconsResult>(
            bridge,
            Methods.icons,
            params,
            Deadline.context,
        );
        const directory = vscode.Uri.joinPath(this.session.storage, 'icons', String(SIZE));
        await vscode.workspace.fs.createDirectory(directory);
        await this.write(served.icons, directory, '', this.files);
        await this.write(served.darkIcons, directory, '-dark', this.darkFiles);
        this.session.output.appendLine(`icons: ${[...this.files.keys()].join(', ')}`);
        this.fetched.fire();
    }

    /** Writes one set of icons, since a tree item takes a file rather than image data. */
    private async write(
        served: Record<string, string>,
        directory: vscode.Uri,
        suffix: string,
        into: Map<string, vscode.Uri>,
    ): Promise<void> {
        for (const [status, dataUri] of Object.entries(served)) {
            const comma = dataUri.indexOf(',');
            if (comma < 0) {
                continue;
            }
            const file = vscode.Uri.joinPath(directory, `${status}${suffix}.png`);
            await vscode.workspace.fs.writeFile(
                file,
                Buffer.from(dataUri.slice(comma + 1), 'base64'),
            );
            // The storage a client is given carries the vscode-userdata scheme. A webview
            // resolves that, but a tree row's icon and a gutter icon do not: they take a
            // file, and anything else draws nothing at all. The file is the same one.
            into.set(status, vscode.Uri.file(file.fsPath));
        }
    }
}
