/**
 * The wire form the bridge speaks.
 *
 * These declarations are a copy rather than a shared library. The bridge is GPL-2.0-only
 * because it links KeY, and this extension stays independent of it by sharing only the
 * message format. What has to match is the JSON, not the code.
 */

export interface InitializeParams {
    clientName: string;
    clientVersion: string;
    protocolVersion: number;
    projectRoot: string;
}

export interface InitializeResult {
    keyVersion: string;
    keyJarSha256: string;
    bridgeVersion: string;
    protocolVersion: number;
    capabilities: string[];
}

export interface Context {
    id: string;
    javaSource: string;
    classpath: string[];
    bootclasspath: string | null;
    includes: string[];
    options?: ProofOptions | null;
}

/** The settings a proof is attempted with, as configured at one level. */
export interface ProofOptions {
    taclet: Record<string, string>;
    strategy: Record<string, string>;
    maxSteps: number;
    /** How long one attempt may take, in milliseconds. -1 is no timeout, 0 says nothing. */
    timeout: number;
}

/** Which prover runs the proofs, which the project configures once for all of them. */
export interface ProverOptions {
    parallel: boolean;
    threads: number;
}

export interface ProjectConfig {
    version: number;
    contexts: Context[];
    /** The directory where the project stores its proofs, relative to its root. */
    proofDirectory: string;
    options?: ProofOptions | null;
    prover?: ProverOptions | null;
    obligationOptions?: Record<string, Record<string, ProofOptions>>;
}

export interface Problem {
    severity: string;
    contextId: string;
    field: string;
    message: string;
}

export interface ContextAtParams {
    uri: string;
}

export interface ContextAtResult {
    contextId: string | null;
}

/** Asks for one context to be checked, or for all of them. */
export interface ValidateParams {
    contextId: string | null;
}

export interface ValidateResult {
    problems: Problem[];
}

export interface ResolveParams {
    contextId: string;
    uri: string;
    line: number;
    column: number;
}

export interface Method {
    className: string;
    name: string;
    parameterTypes: string[];
    constructor: boolean;
    startLine: number;
    endLine: number;
}

/** One option whose value in a saved proof differs from the value configured now. */
export interface OptionDifference {
    kind: string;
    label: string;
    saved: string;
    current: string;
}

/** One proof obligation and its status. */
export interface Obligation {
    contractName: string;
    className: string;
    target: string;
    displayName: string;
    /**
     * How the obligation reads to a user: the target as KeY writes it, with its parameters,
     * and what tells it from the other contracts of that target where there are several.
     *
     * The bridge decides it, so that every editor reads the same.
     */
    label: string;
    status: string;
    statusExplanation: string;
    sourceFile: string;
    classLine: number;
    targetLine: number;
    proofFile: string;
    proofFileExists: boolean;
    differingSettings: OptionDifference[];
}

export interface ObligationsResult {
    obligations: Obligation[];
}

export interface ListObligationsParams {
    contextId: string;
}

/** Names the proof obligations a request acts on, or all of a context when empty. */
export interface ObligationsParams {
    contextId: string;
    contractNames: string[];
}

export interface StartParams {
    contextId: string;
    contractName: string;
}

export interface ProveParams {
    runId: string;
    contextId: string;
    contractNames: string[];
}

export interface CancelParams {
    runId: string;
}

/** The result of attempting or reading one proof. */
export interface ProofOutcome {
    contractName: string;
    status: string;
    statusExplanation: string;
    nodes: number;
    branches: number;
    milliseconds: number;
    proofFile: string;
    message: string;
}

export interface ProveResult {
    outcomes: ProofOutcome[];
    cancelled: boolean;
}

export interface ProveProgress {
    runId: string;
    contextId: string;
    contractName: string;
    completed: number;
    total: number;
}

export interface RemovedResult {
    removed: number;
}

export interface PreparedResult {
    proofFile: string;
}

/** Which contracts one obligation's proof used, as KeY reported them. */
export interface UsedContracts {
    contractName: string;
    known: boolean;
    uses: string[];
}

export interface DependenciesResult {
    obligations: UsedContracts[];
}

export interface StaleOptionsResult {
    contractNames: string[];
}

export interface MarksParams {
    uri: string;
}

/**
 * One problem KeY found in a source, as the bridge reported it.
 *
 * KeY refuses a context whose Java or JML it cannot read, and says where.
 */
export interface SourceProblem {
    /** The file, as a `file:` URI, or null when KeY named none. */
    uri: string | null;
    /** The 1-based line, 0 when KeY named none. */
    line: number;
    /** The 1-based column, 0 when KeY named none. */
    column: number;
    message: string;
}

/** What a failed context load carries besides its message. */
export interface LoadFailure {
    contextId: string;
    problems: SourceProblem[];
}

/** The code the bridge gives a context KeY could not load. */
export const ENVIRONMENT_LOAD_FAILED = -32004;

/** A position in a source file, as a caret sits in it. */
export interface PositionParams {
    uri: string;
    line: number;
    column: number;
}

/**
 * What a position in a source file stands for, as the bridge decided.
 *
 * A caret inside a method means that method's contracts, and a caret anywhere else means
 * everything the file declares.
 */
export interface PositionResult {
    contextId: string | null;
    contractNames: string[];
    label: string;
}

/** One line to mark, and what the mark says. */
export interface Mark {
    line: number;
    mark: ProofMark;
    tooltip: string;
}

export interface MarksResult {
    contextId: string | null;
    marks: Mark[];
}

export interface IconsParams {
    size: number;
}

export interface IconsResult {
    icons: Record<string, string>;
    /** The same icons as a dark theme draws them, the ones KeY draws as a dark glyph inverted. */
    darkIcons: Record<string, string>;
}

/** One value an option accepts. */
export interface OptionValue {
    value: string;
    label: string;
    description: string;
}

/** One option and the values it accepts. */
export interface OptionCategory {
    key: string;
    label: string;
    description: string;
    values: OptionValue[];
}

export interface AvailableOptions {
    taclet: OptionCategory[];
    strategy: OptionCategory[];
    defaults: ProofOptions;
}

/** Asks what KeY offers; a null context reads KeY's rules rather than a project. */
export interface AvailableOptionsParams {
    contextId: string | null;
}

/** A change to the settings configured at one level; only touched fields are sent. */
export interface OptionChange {
    taclet: Record<string, string>;
    tacletCleared: string[];
    strategy: Record<string, string>;
    strategyCleared: string[];
    maxSteps: number | null;
    timeout: number | null;
}

export interface SetOptionsParams {
    contextId: string | null;
    contractNames: string[];
    change: OptionChange;
}

export interface SetProverParams {
    prover: ProverOptions;
}

/** How the trash of replaced proofs is kept. */
export interface TrashPolicy {
    mode: 'NEVER' | 'EMPTY' | 'BELOW_SIZE' | 'OLDER_THAN';
    megabytes: number;
    days: number;
}

export interface PrunedResult {
    files: number;
    bytes: number;
}

export interface ObligationsChanged {
    contextId: string | null;
}

export interface State {
    state: string;
    detail: string | null;
}

export interface LogMessage {
    level: string;
    text: string;
}

/** The protocol version this extension speaks. */
export const PROTOCOL_VERSION = 1;

/** Method names, matching the segments the bridge declares. */
export const Methods = {
    initialize: 'initialize',
    ping: 'ping',
    exit: 'exit',
    configGet: 'config/get',
    configSet: 'config/set',
    configValidate: 'config/validate',
    configContextAt: 'config/contextAt',
    configSetOptions: 'config/setOptions',
    configSetProver: 'config/setProver',
    configPruneTrash: 'config/pruneTrash',
    resolveAt: 'method/resolveAt',
    browse: 'po/browse',
    verifyAt: 'key/verifyAt',
    list: 'po/list',
    start: 'po/start',
    marks: 'po/marks',
    at: 'po/at',
    icons: 'po/icons',
    prove: 'po/prove',
    cancel: 'po/cancel',
    replay: 'po/replay',
    removeProof: 'po/removeProof',
    prepare: 'po/prepare',
    dependencies: 'po/dependencies',
    staleOptions: 'options/stale',
    removeStaleOptions: 'options/removeStale',
    availableOptions: 'options/available',
    changed: 'po/changed',
    progress: 'po/progress',
    state: 'key/state',
    log: 'log/message',
} as const;

/** How a method reads in a message to the user. */
export function signatureOf(method: Method): string {
    return `${method.className}.${method.name}(${method.parameterTypes.join(', ')})`;
}

/**
 * The proof states the bridge reports.
 *
 * Comparing against them belongs here rather than in every view that shows a state.
 */
export const Status = {
    none: 'NONE',
    saved: 'SAVED',
    open: 'OPEN',
    closedButLemmasLeft: 'CLOSED_BUT_LEMMAS_LEFT',
    closedByCache: 'CLOSED_BY_CACHE',
    closed: 'CLOSED',
    unknown: 'UNKNOWN',
} as const;

/** Whether KeY has closed the proof. */
export function isClosed(status: string): boolean {
    return status === Status.closed || status === Status.closedByCache;
}

/**
 * How far the proofs of one declaration have got, as a gutter mark shows it.
 *
 * The bridge decides which of these a line carries, so that a mark means the same in every
 * editor.
 */
export type ProofMark = 'CLOSED' | 'LEMMAS_LEFT' | 'OPEN' | 'UNJUDGED';
