import * as vscode from 'vscode';
import { ProjectModel } from './model';

/** How long to wait for a burst of file events to end before telling the views. */
const SETTLE_MILLIS = 500;

/**
 * Notices when what the views show has stopped being true, without the extension doing it.
 *
 * A proof deleted in the explorer, or by anything else on the machine, leaves every view
 * saying what used to be true, and so does an edit to a verified source: KeY judged the
 * sources as they were. The bridge reports what it does itself; this reports the rest, so
 * that a manual refresh is for when this has failed rather than for ordinary work.
 */
export class WatchProofs implements vscode.Disposable {
    private readonly watchers: vscode.FileSystemWatcher[] = [];
    private settling: NodeJS.Timeout | undefined;

    constructor(private readonly model: ProjectModel) {
        for (const pattern of ['**/*.proof', '**/*.java']) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidCreate(() => this.changed());
            watcher.onDidDelete(() => this.changed());
            watcher.onDidChange(() => this.changed());
            this.watchers.push(watcher);
        }
    }

    /**
     * Reports the change once a burst has ended.
     *
     * A checkout or a build touches many files at once, and each of them would otherwise
     * make every view list the project again.
     */
    private changed(): void {
        if (this.settling) {
            clearTimeout(this.settling);
        }
        this.settling = setTimeout(() => {
            this.settling = undefined;
            this.model.forget();
        }, SETTLE_MILLIS);
    }

    dispose(): void {
        if (this.settling) {
            clearTimeout(this.settling);
        }
        this.watchers.forEach((watcher) => watcher.dispose());
    }
}
