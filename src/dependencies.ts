import * as vscode from 'vscode';
import { StatusIcons } from './icons';
import { ProjectModel } from './model';
import { isClosed, Obligation, Status } from './protocol';

/** One node: a proof, and under it the contracts KeY reported its proof used. */
interface UsedNode {
    contextId: string;
    contractName: string;
    obligation: Obligation | undefined;
    /** The contracts on the path to this node, so a cycle is not followed twice. */
    seen: string[];
}

/**
 * What a proof rests on, as KeY reported it.
 *
 * KeY says which contracts each proof used; this shows them under the proof that used them.
 * A contract KeY has not reported on has no children here, which is what an obligation that
 * has not been run or read back in this session looks like.
 */
export class DependencyView implements vscode.TreeDataProvider<UsedNode>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    private readonly subscriptions: vscode.Disposable[] = [];
    private root: { contextId: string; contractName: string } | undefined;
    private uses = new Map<string, string[]>();
    private obligations = new Map<string, Obligation>();

    constructor(
        private readonly model: ProjectModel,
        private readonly icons: StatusIcons,
    ) {
        this.subscriptions.push(
            model.onChanged(() => {
                if (this.root) {
                    void this.show(this.root.contextId, this.root.contractName);
                }
            }),
            icons.onDidFetch(() => this.changed.fire()),
        );
    }

    /**
     * Shows what one obligation rests on.
     *
     * @param contextId the context holding it
     * @param contractName the contract to root the tree at
     */
    async show(contextId: string, contractName: string): Promise<void> {
        this.uses = await this.model.dependencies(contextId);
        this.obligations = new Map(
            (await this.model.obligations(contextId)).map((one) => [one.contractName, one]),
        );
        this.root = { contextId, contractName };
        this.changed.fire();
    }

    /** The contracts the shown proof rests on that are not proved themselves. */
    unproved(): { contextId: string; contractNames: string[] } | undefined {
        if (!this.root) {
            return undefined;
        }
        const pending = [this.root.contractName];
        const seen = new Set(pending);
        const unproved: string[] = [];
        while (pending.length > 0) {
            for (const used of this.uses.get(pending.shift() as string) ?? []) {
                if (seen.has(used)) {
                    continue;
                }
                seen.add(used);
                if (!isClosed(this.obligations.get(used)?.status ?? Status.none)) {
                    unproved.push(used);
                    pending.push(used);
                }
            }
        }
        return { contextId: this.root.contextId, contractNames: unproved };
    }

    getChildren(node?: UsedNode): UsedNode[] {
        if (!node) {
            return this.root ? [this.nodeFor(this.root.contractName, [])] : [];
        }
        return (this.uses.get(node.contractName) ?? [])
            .filter((used) => !node.seen.includes(used))
            .map((used) => this.nodeFor(used, node.seen));
    }

    private nodeFor(contractName: string, seen: string[]): UsedNode {
        return {
            contextId: this.root?.contextId ?? '',
            contractName,
            obligation: this.obligations.get(contractName),
            seen: [...seen, contractName],
        };
    }

    async getTreeItem(node: UsedNode): Promise<vscode.TreeItem> {
        const children = this.getChildren(node).length;
        const item = new vscode.TreeItem(
            node.obligation?.label ?? node.contractName,
            children > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None,
        );
        item.description = node.obligation ? '' : 'not listed in this context';
        item.tooltip = node.obligation?.statusExplanation ?? node.contractName;
        item.iconPath = await this.icons.forStatus(node.obligation?.status ?? Status.none);
        item.contextValue = 'keyDependency';
        return item;
    }

    dispose(): void {
        this.subscriptions.forEach((subscription) => subscription.dispose());
        this.changed.dispose();
    }
}
