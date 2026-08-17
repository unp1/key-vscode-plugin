import * as vscode from 'vscode';
import { ProjectModel } from './model';
import {
    CancelParams,
    isClosed,
    Methods,
    Obligation,
    ObligationsParams,
    ProveParams,
    ProveResult,
    RemovedResult,
} from './protocol';
import { Trash } from './trash';
import { Deadline, KeySession } from './session';

let nextRun = 0;

/**
 * Attempts proof obligations, reporting progress and stopping when the user asks.
 *
 * The run is named by the caller, so a stop can name the run it stops, and several
 * contexts can be proved at once. What the run measured goes to the results view whether
 * it finished or was stopped.
 *
 * @param session the project's session
 * @param results where the outcomes are shown
 * @param contextId the context holding the obligations
 * @param obligations what to attempt, empty for everything the context can prove
 * @param label how the run reads in the progress bar
 */
export async function prove(
    session: KeySession,
    model: ProjectModel,
    contextId: string,
    obligations: Obligation[],
    label: string,
): Promise<void> {
    nextRun += 1;
    const runId = `run-${nextRun}`;
    const contractNames = obligations.map((obligation) => obligation.contractName);
    const labels = new Map(obligations.map((one) => [one.contractName, one.label]));

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Verifying ${label} with KeY`,
            cancellable: true,
        },
        async (progress, token) => {
            const bridge = await session.verification();
            const following = session.onProgress((report) => {
                if (report.runId !== runId) {
                    return;
                }
                progress.report({
                    message: `${report.completed} of ${report.total}: ${
                        labels.get(report.contractName) ?? report.contractName
                    }`,
                });
            });
            token.onCancellationRequested(() => {
                const params: CancelParams = { runId };
                void bridge.request(Methods.cancel, params);
            });
            try {
                const params: ProveParams = { runId, contextId, contractNames };
                const result = await session.request<ProveResult>(
                    bridge,
                    Methods.prove,
                    params,
                    Deadline.proof,
                );
                model.record(contextId, result.outcomes);
                report(result, label, obligations);
            } finally {
                following.dispose();
            }
        },
    );
    // A run replaces proofs, and what it replaced went to the trash.
    await Trash.applyAfterRun(model).catch(() => undefined);
}

/**
 * Reads saved proofs back and reports what they turn out to be.
 *
 * A saved proof file only shows that a proof was saved. Replaying establishes whether it
 * still closes against the sources as they are now.
 */
export async function replay(
    session: KeySession,
    model: ProjectModel,
    contextId: string,
    obligations: Obligation[],
    label: string,
): Promise<void> {
    const contractNames = obligations.map((obligation) => obligation.contractName);
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Replaying ${label}` },
        async () => {
            const result = await replayed(session, model, contextId, contractNames);
            report(result, label, obligations);
        },
    );
}

/**
 * Reads saved proofs back and records what they turn out to be, without saying anything.
 *
 * This is what a replay is; [[replay]] adds the progress bar and the summary a user asked
 * for one wants. Verify on save replays without either, having its own message to give.
 *
 * @param session the project's session
 * @param model where the outcomes are recorded
 * @param contextId the context holding the proofs
 * @param contractNames the contracts to replay, empty for all of the context
 * @return what each replayed proof turned out to be
 */
export async function replayed(
    session: KeySession,
    model: ProjectModel,
    contextId: string,
    contractNames: string[],
): Promise<ProveResult> {
    const bridge = await session.verification();
    const params: ObligationsParams = { contextId, contractNames };
    const result = await session.request<ProveResult>(
        bridge,
        Methods.replay,
        params,
        Deadline.proof,
    );
    model.record(contextId, result.outcomes);
    return result;
}

/** Deletes saved proofs, after asking, since a proof can take a long time to make again. */
export async function removeProofs(
    session: KeySession,
    model: ProjectModel,
    contextId: string,
    obligations: Obligation[],
    label: string,
): Promise<void> {
    const saved = obligations.filter((obligation) => obligation.proofFileExists);
    if (saved.length === 0) {
        void vscode.window.showInformationMessage(`There is no saved proof of ${label}.`);
        return;
    }
    const confirmed = await vscode.window.showWarningMessage(
        `Delete ${saved.length} saved proof(s) of ${label}?`,
        { modal: true },
        'Delete',
    );
    if (confirmed !== 'Delete') {
        return;
    }
    const bridge = await session.verification();
    const params: ObligationsParams = {
        contextId,
        contractNames: saved.map((obligation) => obligation.contractName),
    };
    const removed = await session.request<RemovedResult>(
        bridge,
        Methods.removeProof,
        params,
        Deadline.context,
    );
    void vscode.window.showInformationMessage(`Deleted ${removed.removed} proof file(s).`);
    model.forget(contextId);
}

/**
 * Reports the result of a run in one line, naming what is left open.
 *
 * A run that proved everything is worth a quiet line; one that did not is worth a warning,
 * since it leaves work behind.
 */
function report(result: ProveResult, label: string, of: Obligation[]): void {
    const labels = new Map(of.map((one) => [one.contractName, one.label]));
    const closed = result.outcomes.filter((outcome) => isClosed(outcome.status)).length;
    const unfinished = result.outcomes.filter((outcome) => !isClosed(outcome.status));
    let message = `KeY proved ${closed} of ${result.outcomes.length} in ${label}`;
    if (result.cancelled) {
        message += ', stopped before the rest';
    }
    if (unfinished.length > 0) {
        message += `. Left open: ${unfinished
            .map((outcome) => labels.get(outcome.contractName) ?? outcome.contractName)
            .join(', ')}`;
    }
    if (closed === result.outcomes.length && !result.cancelled) {
        void vscode.window.showInformationMessage(message);
    } else {
        void vscode.window.showWarningMessage(message);
    }
}
