import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectModel } from './model';
import { Node, obligationsOf } from './obligations';
import { Obligation } from './protocol';
import { KeySession } from './session';

/** Contracts a view named itself, as the verification table does. */
export interface Contracts {
    contextId: string;
    contractNames: string[];
}

/** A line of a file, as a gutter mark's actions name it. */
export interface AtLine {
    uri: string;
    line: number;
}

/** What an action was invoked on, whichever surface invoked it. */
export type Invocation = Node | vscode.Uri | AtLine | Contracts | undefined;

/** Obligations of one context, and how they read in a message. */
export interface Selection {
    contextId: string;
    obligations: Obligation[];
    label: string;
}

/**
 * What an action acts on.
 *
 * The same actions are offered in the editor, in the explorer, on a gutter mark, in the KeY
 * view and in the verification table, and each hands over something different: a row, a
 * file, a line, contracts, or nothing at all. What was meant is worked out here, once, so
 * that an action is written once and a new surface costs a line in the manifest.
 *
 * A selection may span contexts, since a directory can hold several, and a run belongs to
 * one context; the answer is therefore one selection per context.
 */
export class Selections {
    constructor(
        private readonly model: ProjectModel,
        private readonly session: KeySession,
    ) {}

    /**
     * What an invocation means.
     *
     * @param first what the command was invoked on
     * @param rest everything else that was selected, where the surface passes it
     * @returns what to act on, one entry per context, empty when it holds nothing
     */
    async of(first: Invocation, rest?: readonly (Node | vscode.Uri)[]): Promise<Selection[]> {
        if (isNode(first)) {
            return this.fromNodes(first, rest as Node[] | undefined);
        }
        if (first instanceof vscode.Uri) {
            return this.fromFiles([first, ...((rest as vscode.Uri[]) ?? [])]);
        }
        if (isContracts(first)) {
            return this.fromContracts(first);
        }
        if (isAtLine(first)) {
            return this.fromLine(first);
        }
        return this.fromEditor();
    }

    /** Rows of the KeY view: what they stand for, with rows of another context left out. */
    private async fromNodes(node: Node, nodes: Node[] | undefined): Promise<Selection[]> {
        if (node.kind === 'message') {
            return [];
        }
        const contextId = node.contextId;
        const chosen = (nodes ?? []).length > 1 ? (nodes as Node[]) : [node];
        const ofContext = chosen.filter(
            (one) => one.kind !== 'message' && one.contextId === contextId,
        );
        const obligations = deduplicate(ofContext.flatMap(obligationsOf));
        return [
            {
                contextId,
                obligations:
                    obligations.length > 0 ? obligations : await this.model.obligations(contextId),
                label: labelOf(node, obligations.length, ofContext.length),
            },
        ];
    }

    /** Files and directories: everything below them, by context. */
    private async fromFiles(files: vscode.Uri[]): Promise<Selection[]> {
        const selected = files.map((file) => file.fsPath);
        const label =
            selected.length === 1 ? path.basename(selected[0]) : `${selected.length} selections`;

        const selections: Selection[] = [];
        for (const [contextId, obligations] of await this.model.everything()) {
            const under = obligations.filter((obligation) => {
                const source = path.resolve(this.session.root, obligation.sourceFile);
                return selected.some((one) => source === one || source.startsWith(one + path.sep));
            });
            if (under.length > 0) {
                selections.push({ contextId, obligations: under, label });
            }
        }
        return selections;
    }

    /** Contracts a view named: exactly those, as the listing has them. */
    private async fromContracts(named: Contracts): Promise<Selection[]> {
        const wanted = new Set(named.contractNames);
        const obligations = (await this.model.obligations(named.contextId)).filter((obligation) =>
            wanted.has(obligation.contractName),
        );
        if (obligations.length === 0) {
            return [];
        }
        return [
            {
                contextId: named.contextId,
                obligations,
                label:
                    obligations.length === 1
                        ? obligations[0].label
                        : `${obligations.length} selected`,
            },
        ];
    }

    /** A marked line: what the mark stands for, which is a method or its class. */
    private async fromLine(at: AtLine): Promise<Selection[]> {
        const file = vscode.Uri.parse(at.uri);
        const contextId = await this.model.contextFor(file);
        const ofLine = (await this.model.obligations(contextId)).filter(
            (obligation) =>
                path.resolve(this.session.root, obligation.sourceFile) === file.fsPath &&
                (obligation.targetLine === at.line || obligation.classLine === at.line),
        );
        if (ofLine.length === 0) {
            return [];
        }
        return [
            {
                contextId,
                obligations: ofLine,
                label: ofLine.length === 1 ? ofLine[0].label : path.basename(file.fsPath),
            },
        ];
    }

    /**
     * The editor: the method the cursor is in, or the whole file.
     *
     * Which of the two, and which contracts that means, is the bridge's answer: it knows
     * where KeY read each declaration and which method each contract is about, so a cursor
     * in one of two overloads means that one.
     */
    private async fromEditor(): Promise<Selection[]> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'java') {
            return [];
        }
        const position = editor.selection.active;
        // The bridge counts lines and columns from one; the editor counts from zero.
        const stands = await this.model.at(
            editor.document.uri,
            position.line + 1,
            position.character + 1,
        );
        if (!stands.contextId || stands.contractNames.length === 0) {
            return [];
        }
        const listed = await this.model.obligations(stands.contextId);
        const obligations = listed.filter((obligation) =>
            stands.contractNames.includes(obligation.contractName),
        );
        return [{ contextId: stands.contextId, obligations, label: stands.label }];
    }

}

function isNode(invocation: Invocation): invocation is Node {
    return (
        typeof invocation === 'object' &&
        invocation !== null &&
        'kind' in invocation &&
        typeof (invocation as Node).kind === 'string'
    );
}

function isContracts(invocation: Invocation): invocation is Contracts {
    return (
        typeof invocation === 'object' &&
        invocation !== null &&
        'contractNames' in invocation &&
        Array.isArray((invocation as Contracts).contractNames)
    );
}

function isAtLine(invocation: Invocation): invocation is AtLine {
    return (
        typeof invocation === 'object' &&
        invocation !== null &&
        'uri' in invocation &&
        'line' in invocation
    );
}

/** The obligations of several rows, each of them once, in the order they were reached. */
function deduplicate(obligations: Obligation[]): Obligation[] {
    const seen = new Set<string>();
    return obligations.filter((obligation) => {
        if (seen.has(obligation.contractName)) {
            return false;
        }
        seen.add(obligation.contractName);
        return true;
    });
}

/** How a selection reads in a progress bar or a message. */
function labelOf(node: Node, obligations: number, rows: number): string {
    if (rows > 1) {
        return `${obligations} selected`;
    }
    switch (node.kind) {
        case 'context':
            return node.contextId;
        case 'class':
            return node.className.slice(node.className.lastIndexOf('.') + 1);
        case 'method':
            return node.target;
        case 'obligation':
            return node.obligation.label;
        default:
            return 'KeY';
    }
}
