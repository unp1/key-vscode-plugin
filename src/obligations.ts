import * as vscode from 'vscode';
import { StatusIcons } from './icons';
import { ProjectModel } from './model';
import { Obligation } from './protocol';

/**
 * What a node in the tree stands for.
 *
 * A context holds classes, a class holds its methods, and a method with several
 * specification cases holds one node per case. Every action works on obligations, so a node
 * above one stands for all the obligations under it.
 */
export type Node = ContextNode | ClassNode | MethodNode | ObligationNode | MessageNode;

export interface ContextNode {
    kind: 'context';
    contextId: string;
    obligations: Obligation[];
}

export interface ClassNode {
    kind: 'class';
    contextId: string;
    className: string;
    obligations: Obligation[];
}

/** A method with several specification cases, each of which is proved on its own. */
export interface MethodNode {
    kind: 'method';
    contextId: string;
    target: string;
    obligations: Obligation[];
}

export interface ObligationNode {
    kind: 'obligation';
    contextId: string;
    obligation: Obligation;
}

/** A line of text where there is nothing to list, or a reason why. */
export interface MessageNode {
    kind: 'message';
    text: string;
}

/** The obligations a node stands for, which is what an action on it works on. */
export function obligationsOf(node: Node): Obligation[] {
    switch (node.kind) {
        case 'context':
        case 'class':
        case 'method':
            return node.obligations;
        case 'obligation':
            return [node.obligation];
        default:
            return [];
    }
}

/**
 * Lists what the project can be asked to prove, by context, class and method.
 *
 * Everything shown comes from the model, so this view and the others cannot disagree, and a
 * change lists the project once rather than once per view.
 */
export class ObligationTree implements vscode.TreeDataProvider<Node>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<Node | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly model: ProjectModel,
        private readonly icons: StatusIcons,
    ) {
        this.subscriptions.push(
            model.onChanged(() => this.changed.fire(undefined)),
            icons.onDidFetch(() => this.changed.fire(undefined)),
        );
    }

    async getChildren(node?: Node): Promise<Node[]> {
        try {
            return await this.children(node);
        } catch (failure) {
            return [
                {
                    kind: 'message',
                    text: failure instanceof Error ? failure.message : String(failure),
                },
            ];
        }
    }

    private async children(node?: Node): Promise<Node[]> {
        if (!node) {
            const contexts = await this.model.contexts();
            if (contexts.length === 0) {
                return [
                    {
                        kind: 'message',
                        text: 'No context yet. Run KeY: Edit Contexts to declare one.',
                    },
                ];
            }
            return contexts.map((context) => ({
                kind: 'context',
                contextId: context.id,
                obligations: [],
            }));
        }
        if (node.kind === 'context') {
            node.obligations = await this.model.obligations(node.contextId);
            return classesOf(node.contextId, node.obligations);
        }
        if (node.kind === 'class') {
            return methodsOf(node);
        }
        if (node.kind === 'method') {
            return node.obligations.map((obligation) => ({
                kind: 'obligation',
                contextId: node.contextId,
                obligation,
            }));
        }
        return [];
    }

    async getTreeItem(node: Node): Promise<vscode.TreeItem> {
        switch (node.kind) {
            case 'context':
                return contextItem(node);
            case 'class':
                return classItem(node);
            case 'method':
                return methodItem(node);
            case 'obligation':
                return this.obligationItem(node);
            default:
                return new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        }
    }

    private async obligationItem(node: ObligationNode): Promise<vscode.TreeItem> {
        const obligation = node.obligation;
        const item = new vscode.TreeItem(obligation.label, vscode.TreeItemCollapsibleState.None);
        item.description =
            obligation.differingSettings.length > 0 ? 'settings differ' : '';
        item.tooltip = tooltipOf(obligation);
        item.iconPath = await this.icons.forStatus(obligation.status);
        item.contextValue = obligation.proofFileExists ? 'keyObligationProved' : 'keyObligation';
        item.command = { command: 'key.goToSource', title: 'Go to Source', arguments: [node] };
        return item;
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.changed.dispose();
    }
}

function contextItem(node: ContextNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.contextId, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'keyContext';
    return item;
}

function classItem(node: ClassNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
        simpleNameOf(node.className),
        vscode.TreeItemCollapsibleState.Expanded,
    );
    item.description = `${node.obligations.length} proof obligation(s)`;
    item.tooltip = node.className;
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'keyClass';
    return item;
}

function methodItem(node: MethodNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.target, vscode.TreeItemCollapsibleState.Expanded);
    item.description = `${node.obligations.length} specification cases`;
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'keyMethod';
    return item;
}

/** The classes of a context, each with the obligations declared in it. */
function classesOf(contextId: string, obligations: Obligation[]): ClassNode[] {
    const byClass = new Map<string, Obligation[]>();
    for (const obligation of obligations) {
        const found = byClass.get(obligation.className);
        if (found) {
            found.push(obligation);
        } else {
            byClass.set(obligation.className, [obligation]);
        }
    }
    return [...byClass.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([className, ofClass]) => ({
            kind: 'class',
            contextId,
            className,
            obligations: ofClass,
        }));
}

/**
 * The rows under a class: one per method, and one per specification case where a method has
 * several of them.
 */
function methodsOf(node: ClassNode): Node[] {
    const byTarget = new Map<string, Obligation[]>();
    for (const obligation of node.obligations) {
        const found = byTarget.get(obligation.target);
        if (found) {
            found.push(obligation);
        } else {
            byTarget.set(obligation.target, [obligation]);
        }
    }
    const rows: Node[] = [];
    for (const cases of byTarget.values()) {
        if (cases.length === 1) {
            rows.push({ kind: 'obligation', contextId: node.contextId, obligation: cases[0] });
        } else {
            rows.push({
                kind: 'method',
                contextId: node.contextId,
                // The bridge names each case after the target and what tells the cases
                // apart, so the method itself is named by the part they share.
                target: sharedStart(cases.map((one) => one.label)),
                obligations: cases,
            });
        }
    }
    return rows;
}

function tooltipOf(obligation: Obligation): vscode.MarkdownString {
    const lines = [
        `**${obligation.label}**`,
        '',
        obligation.statusExplanation,
        '',
        `Proof: \`${obligation.proofFile}\`${obligation.proofFileExists ? '' : ' (not saved yet)'}`,
    ];
    for (const difference of obligation.differingSettings) {
        lines.push(
            `Differs: ${difference.label} was \`${difference.saved}\`, ` +
                `now \`${difference.current}\``,
        );
    }
    return new vscode.MarkdownString(lines.join('\n\n'));
}

/** The class without its package, which is what a row has room for. */
function simpleNameOf(className: string): string {
    return className.slice(className.lastIndexOf('.') + 1);
}

/** What several labels begin with, which is the method they are all cases of. */
function sharedStart(labels: string[]): string {
    const first = labels[0] ?? '';
    let at = first.length;
    for (const label of labels) {
        while (at > 0 && label.slice(0, at) !== first.slice(0, at)) {
            at -= 1;
        }
    }
    return first.slice(0, at).replace(/[\s\u2014]+$/, '') || first;
}
