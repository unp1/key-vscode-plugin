/**
 * Drives the bridges from Node, with no editor involved.
 *
 * The point of interest is the wire: this side speaks vscode-jsonrpc and the bridge speaks
 * LSP4J, and the two have to agree on how a request carries its parameters. A mismatch
 * there would otherwise first appear as a failing command inside an editor.
 *
 *   node out/smoke.js config <bridge-jar> <project-root>
 *   node out/smoke.js verify <key-jar> <bridge-jar> <project-root>
 */
import * as path from 'path';
import { Bridge } from './bridge';
import {
    AvailableOptions,
    DependenciesResult,
    IconsResult,
    isClosed,
    MarksParams,
    MarksResult,
    PositionParams,
    PositionResult,
    Method,
    Methods,
    ObligationsResult,
    ProjectConfig,
    ProveResult,
    ValidateResult,
} from './protocol';

async function main(): Promise<void> {
    const [mode, ...rest] = process.argv.slice(2);
    if (mode === 'verify') {
        await verification(rest);
        return;
    }
    await configuration(mode === 'config' ? rest : process.argv.slice(2));
}

/** What the settings commands rest on, which needs no KeY. */
async function configuration(args: string[]): Promise<void> {
    const [bridgeJar, projectRoot] = args;
    if (!bridgeJar || !projectRoot) {
        throw new Error('usage: node out/smoke.js config <bridge-jar> <project-root>');
    }

    const bridge = await Bridge.launch({
        commandFor: (runtimeDir) => [
            'java',
            '-cp',
            bridgeJar,
            'org.key_project.ide.server.ConfigBridgeMain',
            runtimeDir,
        ],
        projectRoot,
        clientName: 'smoke',
        timeoutMillis: 30_000,
        log: (line) => console.log(`  bridge: ${line}`),
    });

    console.log('capabilities  =', bridge.info.capabilities);
    console.log('bridgeVersion =', bridge.info.bridgeVersion);
    console.log('responsive    =', await bridge.isResponsive());

    const config = await bridge.request<ProjectConfig>(Methods.configGet);
    console.log('contexts      =', config.contexts.map((c) => c.id));
    console.log('classpath[web]=', config.contexts.find((c) => c.id === 'web')?.classpath);

    const validated = await bridge.request<ValidateResult>(Methods.configValidate, {
        contextId: null,
    });
    console.log('problems      =', validated.problems.length);
    for (const problem of validated.problems) {
        console.log(
            `   ${problem.severity} ${problem.contextId}.${problem.field}: ${problem.message}`,
        );
    }

    try {
        await bridge.request<Method>(Methods.verifyAt, {
            contextId: 'core',
            uri: 'file:///nowhere.java',
            line: 1,
            column: 1,
        });
        console.log('verify        = unexpectedly succeeded');
    } catch (failure) {
        console.log('verify        =', (failure as Error).message);
    }

    bridge.dispose();
    console.log('== ok');
}

/**
 * What the views and the actions rest on, which needs KeY.
 *
 * Every request the extension makes of the verifying bridge is made here once, in the
 * order a session makes them: list, prove the smallest obligation, replay it, and ask what
 * it rests on and what it may be configured with.
 */
async function verification(args: string[]): Promise<void> {
    const [keyJar, bridgeJar, projectRoot] = args;
    if (!keyJar || !bridgeJar || !projectRoot) {
        throw new Error('usage: node out/smoke.js verify <key-jar> <bridge-jar> <project-root>');
    }

    const bridge = await Bridge.launch({
        commandFor: (runtimeDir) => [
            'java',
            '-Djava.awt.headless=true',
            // A run of its own keeps the developer's own KeY configuration out of it, as
            // the extension does for a project.
            `-Dkey.home=${path.join(runtimeDir, 'keyhome')}`,
            '-cp',
            [keyJar, bridgeJar].join(':'),
            'org.key_project.ide.server.BridgeMain',
            runtimeDir,
        ],
        projectRoot,
        clientName: 'smoke-verify',
        timeoutMillis: 180_000,
        log: (line) => console.log(`  bridge: ${line}`),
        onObligationsChanged: (params) => console.log(`  changed: ${params.contextId ?? 'all'}`),
        onProgress: (params) =>
            console.log(`  progress: ${params.completed}/${params.total} ${params.contractName}`),
    });

    console.log('capabilities  =', bridge.info.capabilities);
    console.log('keyVersion    =', bridge.info.keyVersion);
    console.log('responsive    =', await bridge.isResponsive());

    const listed = await bridge.request<ObligationsResult>(Methods.list, { contextId: 'core' });
    console.log('obligations   =', listed.obligations.length);
    for (const obligation of listed.obligations) {
        console.log(
            `   ${obligation.status.padEnd(12)} ${obligation.label.padEnd(38)} ` +
                `line ${obligation.targetLine}`,
        );
    }
    const first = listed.obligations[0];
    if (first) {
        const params: MarksParams = { uri: `${projectRoot}/${first.sourceFile}` };
        const marked = await bridge.request<MarksResult>(Methods.marks, params);
        console.log(
            'marks         =',
            marked.marks.map((mark) => `${mark.line}:${mark.mark}`).join(' '),
        );

        // What the caret stands for is the bridge's answer, so a method with a contract
        // has to come back as that method rather than as the whole file. A constructor is
        // reported at its declaration, which is not a position KeY resolves, so this asks
        // about a plain method.
        const method = listed.obligations.find((one) => one.label.includes('deposit')) ?? first;
        const at: PositionParams = {
            uri: `${projectRoot}/${method.sourceFile}`,
            line: method.targetLine,
            column: 5,
        };
        const stands = await bridge.request<PositionResult>(Methods.at, at);
        console.log(
            'at line',
            String(method.targetLine).padEnd(6),
            '=',
            `${stands.label} -> ${stands.contractNames.length} contract(s)`,
        );
        const wholeFile = await bridge.request<PositionResult>(Methods.at, { ...at, line: 1 });
        console.log(
            'at line 1     =',
            `${wholeFile.label} -> ${wholeFile.contractNames.length} contract(s)`,
        );
    }

    const icons = await bridge.request<IconsResult>(Methods.icons, { size: 32 });
    console.log('icons         =', Object.keys(icons.icons).join(', '));
    const inverted = Object.keys(icons.darkIcons).filter(
        (status) => icons.darkIcons[status] !== icons.icons[status],
    );
    console.log('dark icons    =', `${Object.keys(icons.darkIcons).length}, differing: ${inverted.join(', ')}`);

    const options = await bridge.request<AvailableOptions>(Methods.availableOptions, {
        contextId: 'core',
    });
    console.log(
        'options       =',
        `${options.taclet.length} taclet, ${options.strategy.length} strategy`,
    );

    const smallest = listed.obligations.find((obligation) => obligation.target.includes('deposit'));
    if (smallest) {
        const proved = await bridge.request<ProveResult>(Methods.prove, {
            runId: 'smoke-1',
            contextId: 'core',
            contractNames: [smallest.contractName],
        });
        for (const outcome of proved.outcomes) {
            console.log(
                `proved        = ${outcome.status} in ${outcome.milliseconds}ms, ` +
                    `${outcome.nodes} nodes, file ${outcome.proofFile}` +
                    (outcome.message ? `, ${outcome.message}` : ''),
            );
        }

        const replayed = await bridge.request<ProveResult>(Methods.replay, {
            contextId: 'core',
            contractNames: [smallest.contractName],
        });
        console.log(
            'replayed      =',
            replayed.outcomes.map((outcome) => outcome.status).join(', '),
            replayed.outcomes.every((outcome) => isClosed(outcome.status)) ? '(closed)' : '',
        );
    }

    const dependencies = await bridge.request<DependenciesResult>(Methods.dependencies, {
        contextId: 'core',
    });
    console.log('dependencies  =', dependencies.obligations.length, 'reported');
    for (const used of dependencies.obligations) {
        console.log(`   ${used.contractName.slice(0, 60)} uses ${used.uses.length}`);
    }

    bridge.dispose();
    console.log('== ok');
}

main().catch((failure) => {
    console.error('FAILED:', failure);
    process.exit(1);
});
