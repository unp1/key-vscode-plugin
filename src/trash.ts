import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { Settings } from './settings';
import { TrashPolicy } from './protocol';

/**
 * What becomes of a proof that a rerun replaced.
 *
 * A replaced proof is kept in the project's trash, so a rerun that turns out worse than what
 * it replaced can be undone by hand. How long they are kept is the user's choice, and it is
 * applied at two moments: when a window opens, because an editor is asked to shut down
 * quickly, and after a run, because a run is what fills the trash.
 */
export const Trash = {
    /** Applies the policy for a window that is opening. */
    async applyAtStart(model: ProjectModel): Promise<void> {
        const policy = Settings.trashPolicy();
        if (policy) {
            await model.pruneTrash(policy);
        }
    },

    /**
     * Applies the policy after a run wrote proofs.
     *
     * Emptying is left to the start of a session: a user who asked for that expects the
     * trash to survive the session they are working in.
     */
    async applyAfterRun(model: ProjectModel): Promise<void> {
        const policy = Settings.trashPolicy();
        if (policy && policy.mode !== 'EMPTY') {
            await model.pruneTrash(policy);
        }
    },

    /** Empties the trash now, whatever the policy says, and reports what went. */
    async emptyNow(model: ProjectModel): Promise<void> {
        const policy: TrashPolicy = { mode: 'EMPTY', megabytes: 0, days: 0 };
        const pruned = await model.pruneTrash(policy);
        void vscode.window.showInformationMessage(
            `Deleted ${pruned.files} replaced proof(s), ` +
                `${(pruned.bytes / 1024 / 1024).toFixed(1)} MB.`,
        );
    },
};
