import * as vscode from 'vscode';
import {
    Context,
    ContextAtParams,
    ContextAtResult,
    DependenciesResult,
    ListObligationsParams,
    MarksParams,
    MarksResult,
    PositionParams,
    PositionResult,
    Methods,
    Obligation,
    ObligationsResult,
    OptionChange,
    PrunedResult,
    ProjectConfig,
    ProofOutcome,
    ProverOptions,
    SetOptionsParams,
    SetProverParams,
    TrashPolicy,
    ValidateParams,
    ValidateResult,
} from './protocol';
import { Deadline, KeySession, report } from './session';

/** One obligation as the views show it: what it is, and what the last attempt measured. */
export interface Row {
    contextId: string;
    contractName: string;
    obligation?: Obligation;
    outcome: ProofOutcome;
}

/** Which level a change to the proof options applies to. */
export interface Level {
    contextId: string | null;
    contractNames: string[];
    /** How the level reads in a title or a message. */
    label: string;
}

/**
 * What the extension knows about the project, and the only place it is kept.
 *
 * Every view and every action reads the project from here rather than asking the bridge for
 * itself, so a listing is made once per change instead of once per view, and no two views
 * can disagree about what a proof is worth.
 *
 * Reading is cached until something changes it. What changes it is either an edit made
 * through this model, or the bridge reporting that proof states have moved; both end in one
 * event, which is what the views redraw from.
 */
export class ProjectModel implements vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();

    /** The project has changed: what the views show is out of date. */
    readonly onChanged = this.changed.event;

    private readonly subscription: vscode.Disposable;

    private configuration: Promise<ProjectConfig> | undefined;
    private listings = new Map<string, Promise<Obligation[]>>();
    private uses = new Map<string, Promise<Map<string, string[]>>>();

    /** What the last run or replay measured, by context and contract. */
    private measured = new Map<string, ProofOutcome>();

    constructor(private readonly session: KeySession) {
        this.subscription = session.onObligationsChanged((params) =>
            this.forget(params.contextId ?? undefined),
        );
    }

    /** The project's configuration, as the settings file holds it. */
    config(): Promise<ProjectConfig> {
        if (!this.configuration) {
            this.configuration = this.session
                .configuration()
                .then((bridge) =>
                    this.session.request<ProjectConfig>(
                        bridge,
                        Methods.configGet,
                        undefined,
                        Deadline.config,
                    ),
                );
        }
        return this.configuration;
    }

    /** The contexts the project declares. */
    async contexts(): Promise<Context[]> {
        return (await this.config()).contexts;
    }

    /**
     * Everything a context can be asked to prove, with the status of each.
     *
     * Callers that arrive together share one request, which is what keeps a change from
     * listing the project once per view.
     */
    obligations(contextId: string): Promise<Obligation[]> {
        const listed = this.listings.get(contextId);
        if (listed) {
            return listed;
        }
        const asked = this.session
            .verification()
            .then((bridge) => {
                const params: ListObligationsParams = { contextId };
                return this.session.request<ObligationsResult>(
                    bridge,
                    Methods.list,
                    params,
                    Deadline.context,
                );
            })
            .then((result) => {
                // The context loaded, so nothing KeY refused it for before stands any more.
                this.session.refused.accept(contextId);
                return result.obligations;
            })
            .catch((failure) => {
                // A context that does not load is asked about again next time rather than
                // remembered as empty. Where KeY refused it is marked here, since every view
                // lists through this one call and each would otherwise mark it again.
                this.listings.delete(contextId);
                report(failure, this.session);
                throw failure;
            });
        this.listings.set(contextId, asked);
        return asked;
    }

    /** Everything the project can be asked to prove, by context. */
    async everything(): Promise<Map<string, Obligation[]>> {
        const byContext = new Map<string, Obligation[]>();
        for (const context of await this.contexts()) {
            byContext.set(context.id, await this.obligations(context.id));
        }
        return byContext;
    }

    /** One obligation, or undefined where the context no longer holds it. */
    async obligation(contextId: string, contractName: string): Promise<Obligation | undefined> {
        return (await this.obligations(contextId)).find(
            (one) => one.contractName === contractName,
        );
    }

    /**
     * The context whose sources hold a file.
     *
     * @throws Error if no context covers the file
     */
    async contextFor(file: vscode.Uri): Promise<string> {
        const bridge = await this.session.configuration();
        const params: ContextAtParams = { uri: file.toString() };
        const found = await this.session.request<ContextAtResult>(
            bridge,
            Methods.configContextAt,
            params,
            Deadline.config,
        );
        if (!found.contextId) {
            throw new Error(
                `No context in .key/settings.json covers ${file.fsPath}. ` +
                    'Add one whose javaSource contains this file.',
            );
        }
        return found.contextId;
    }

    /** Which contracts each proof of a context used, as KeY reported them. */
    dependencies(contextId: string): Promise<Map<string, string[]>> {
        const known = this.uses.get(contextId);
        if (known) {
            return known;
        }
        const asked = this.session
            .verification()
            .then((bridge) => {
                const params: ListObligationsParams = { contextId };
                return this.session.request<DependenciesResult>(
                    bridge,
                    Methods.dependencies,
                    params,
                    Deadline.context,
                );
            })
            .then(
                (result) =>
                    new Map(result.obligations.map((used) => [used.contractName, used.uses])),
            )
            .catch((failure) => {
                this.uses.delete(contextId);
                throw failure;
            });
        this.uses.set(contextId, asked);
        return asked;
    }

    /**
     * What a position in a file stands for, as the bridge decided.
     *
     * A cursor inside a method means that method's contracts, and a cursor anywhere else
     * means the whole file. Which method a cursor sits in, and which contracts are about it,
     * follow from what KeY loaded, so the bridge answers both.
     */
    async at(file: vscode.Uri, line: number, column: number): Promise<PositionResult> {
        const bridge = await this.session.verification();
        const params: PositionParams = { uri: file.toString(), line, column };
        return this.session.request<PositionResult>(bridge, Methods.at, params, Deadline.context);
    }

    /** What to mark in the margin of a file, as the bridge decided. */
    async marks(file: vscode.Uri): Promise<MarksResult> {
        const bridge = await this.session.verification();
        const params: MarksParams = { uri: file.toString() };
        return this.session.request<MarksResult>(bridge, Methods.marks, params, Deadline.context);
    }

    /**
     * Every obligation of the project, with what the last attempt measured.
     *
     * The listing says what a proof is worth; a run in this session also says what it cost,
     * and that is kept until the obligation is listed with another status.
     */
    async rows(): Promise<Row[]> {
        const rows: Row[] = [];
        for (const [contextId, obligations] of await this.everything()) {
            for (const obligation of obligations) {
                const measured = this.measured.get(keyOf(contextId, obligation.contractName));
                rows.push({
                    contextId,
                    contractName: obligation.contractName,
                    obligation,
                    outcome:
                        measured && measured.status === obligation.status
                            ? measured
                            : listed(obligation),
                });
            }
        }
        return rows;
    }

    /** Records what a run or a replay measured, and tells the views. */
    record(contextId: string, outcomes: ProofOutcome[]): void {
        for (const outcome of outcomes) {
            this.measured.set(keyOf(contextId, outcome.contractName), outcome);
        }
        this.forget(contextId);
    }

    /** Forgets what runs measured, which is what a user asks for before a fresh run. */
    clearMeasurements(): void {
        this.measured.clear();
        this.changed.fire();
    }

    /** Writes the configuration, and tells the views. */
    async setConfig(config: ProjectConfig): Promise<void> {
        const bridge = await this.session.configuration();
        await this.session.request(bridge, Methods.configSet, config, Deadline.config);
        this.forget();
    }

    /** Checks the paths against the rules KeY imposes, without loading anything. */
    async validate(): Promise<ValidateResult> {
        const bridge = await this.session.configuration();
        const params: ValidateParams = { contextId: null };
        return this.session.request<ValidateResult>(
            bridge,
            Methods.configValidate,
            params,
            Deadline.config,
        );
    }

    /** Changes the settings configured at one level, and tells the views. */
    async setOptions(level: Level, change: OptionChange): Promise<void> {
        const bridge = await this.session.configuration();
        const params: SetOptionsParams = {
            contextId: level.contextId,
            contractNames: level.contractNames,
            change,
        };
        await this.session.request(bridge, Methods.configSetOptions, params, Deadline.config);
        this.forget(level.contextId ?? undefined);
    }

    /** Chooses the prover the project runs its proofs with, and tells the views. */
    async setProver(prover: ProverOptions): Promise<void> {
        const bridge = await this.session.configuration();
        const params: SetProverParams = { prover };
        await this.session.request(bridge, Methods.configSetProver, params, Deadline.config);
        this.forget();
    }

    /** Throws away the replaced proofs a policy no longer keeps. */
    async pruneTrash(policy: TrashPolicy): Promise<PrunedResult> {
        const bridge = await this.session.configuration();
        const pruned = await this.session.request<PrunedResult>(
            bridge,
            Methods.configPruneTrash,
            policy,
            Deadline.config,
        );
        if (pruned.files > 0) {
            this.session.output.appendLine(
                `trash: deleted ${pruned.files} file(s), ` +
                    `${(pruned.bytes / 1024 / 1024).toFixed(1)} MB`,
            );
        }
        return pruned;
    }

    /**
     * Forgets what was read, and tells the views.
     *
     * @param contextId the context that changed, or undefined when the whole project did
     */
    forget(contextId?: string): void {
        this.configuration = undefined;
        if (contextId) {
            this.listings.delete(contextId);
            this.uses.delete(contextId);
        } else {
            this.listings.clear();
            this.uses.clear();
        }
        this.changed.fire();
    }

    dispose(): void {
        this.subscription.dispose();
        this.changed.dispose();
    }
}

/** What a listing says about an obligation nothing has measured in this session. */
function listed(obligation: Obligation): ProofOutcome {
    return {
        contractName: obligation.contractName,
        status: obligation.status,
        statusExplanation: obligation.statusExplanation,
        nodes: 0,
        branches: 0,
        milliseconds: 0,
        proofFile: obligation.proofFile,
        message: '',
    };
}

function keyOf(contextId: string, contractName: string): string {
    return `${contextId} ${contractName}`;
}
