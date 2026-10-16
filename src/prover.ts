import * as os from 'os';
import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { ProverOptions } from './protocol';

/**
 * Which prover the project runs its proofs with.
 *
 * KeY decides between the single-threaded and the parallel prover from a setting that
 * belongs to the prover rather than to any proof, so a project states it once and every
 * context uses it. It is shown in the status bar, because it is the kind of thing one
 * changes while working and wants to see without opening anything.
 */
export class ProverSwitch implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly subscription: vscode.Disposable;

    /** How many workers the parallel prover last used, offered again when it is turned on. */
    private lastThreads = 4;

    constructor(private readonly model: ProjectModel) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // A click offers every prover. The editor gives an extension no menu of its own on
        // a status bar item, so the click has to be the whole choice rather than a toggle
        // with the rest behind a right click.
        this.item.command = 'key.chooseProver';
        this.subscription = model.onChanged(() => void this.show());
        void this.show();
    }

    /** Shows which prover the project uses. */
    private async show(): Promise<void> {
        try {
            const prover = (await this.model.config()).prover;
            if (prover?.parallel && prover.threads > 0) {
                this.lastThreads = prover.threads;
            }
            this.item.text = `KeY ${labelOf(prover)}`;
            this.item.tooltip = 'Select Single Core or Multi-Core Prover';
            this.item.show();
        } catch {
            // No project, or no KeY configured yet. Nothing to say about a prover.
            this.item.hide();
        }
    }

    /**
     * Switches between one core and several, keeping the number of workers last used.
     *
     * This is the IntelliJ button's behaviour, offered in the KeY view for a user who wants
     * the two-way switch without choosing from a list.
     */
    async toggle(): Promise<void> {
        const prover = (await this.model.config()).prover;
        const parallel = !(prover?.parallel ?? false);
        await this.model.setProver({ parallel, threads: parallel ? this.lastThreads : 0 });
        void vscode.window.showInformationMessage(
            `KeY proves with ${labelOf({ parallel, threads: this.lastThreads })}.`,
        );
    }

    /** Asks which prover to use, one core or a number of workers. */
    async choose(): Promise<void> {
        const cores = Math.max(2, os.cpus().length);
        const counts = [2, 4, 8, 16, 32].filter((threads) => threads <= cores);
        const current = (await this.model.config()).prover;
        const picked = await vscode.window.showQuickPick(
            [
                { label: 'SC', description: 'single core', threads: 0, parallel: false },
                ...counts.map((threads) => ({
                    label: `MT ${threads}x`,
                    description: `${threads} workers`,
                    threads,
                    parallel: true,
                })),
            ],
            {
                title: 'Select Single Core or Multi-Core Prover',
                placeHolder: `Now: ${labelOf(current)}`,
            },
        );
        if (!picked) {
            return;
        }
        await this.model.setProver({ parallel: picked.parallel, threads: picked.threads });
        void vscode.window.showInformationMessage(`KeY proves with ${picked.label}.`);
    }

    dispose(): void {
        this.subscription.dispose();
        this.item.dispose();
    }
}

/** How the prover reads in the status bar and in a picker. */
export function labelOf(prover: ProverOptions | null | undefined): string {
    if (!prover || !prover.parallel) {
        return 'SC';
    }
    return prover.threads > 0 ? `MT ${prover.threads}x` : 'MT';
}
