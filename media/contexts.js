// The contexts form.
//
// The contexts are a list on the left and the selected one is a form on the right. Paths can
// be typed or picked; picking asks the extension, which knows how to write a path against
// the project. Nothing is written until Save, and Save is followed by a check.

const editor = acquireVsCodeApi();

let contexts = [];
let proofDirectory = 'proofs';
let problems = [];
let chosen = 0;

window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'contexts') {
        contexts = message.contexts.map((context) => ({
            id: context.id,
            javaSource: context.javaSource,
            classpath: [...context.classpath],
            bootclasspath: context.bootclasspath,
            includes: [...context.includes],
        }));
        proofDirectory = message.proofDirectory;
        problems = message.problems;
        chosen = Math.min(chosen, Math.max(0, contexts.length - 1));
        draw();
    }
    if (message.type === 'picked') {
        put(message.field, message.index, message.path);
        draw();
    }
});

document.getElementById('add').addEventListener('click', () => {
    contexts.push({
        id: nextId(),
        javaSource: 'src/main/java',
        classpath: [],
        bootclasspath: null,
        includes: [],
    });
    chosen = contexts.length - 1;
    draw();
});

document.getElementById('remove').addEventListener('click', () => {
    if (contexts.length === 0) {
        return;
    }
    contexts.splice(chosen, 1);
    chosen = Math.max(0, chosen - 1);
    draw();
});

document.getElementById('save').addEventListener('click', () => {
    editor.postMessage({ type: 'save', contexts, proofDirectory });
});

document.getElementById('validate').addEventListener('click', () => {
    editor.postMessage({ type: 'validate' });
});

function nextId() {
    const taken = new Set(contexts.map((context) => context.id));
    for (let at = 1; ; at += 1) {
        const id = at === 1 ? 'main' : `context${at}`;
        if (!taken.has(id)) {
            return id;
        }
    }
}

/** Puts a picked path where the field that asked for it holds its value. */
function put(field, index, value) {
    const context = contexts[chosen];
    if (!context) {
        return;
    }
    if (field === 'javaSource' || field === 'bootclasspath') {
        context[field] = value;
    } else if (field === 'classpath' || field === 'includes') {
        context[field][index] = value;
    } else if (field === 'proofDirectory') {
        proofDirectory = value;
    }
}

function draw() {
    const list = document.getElementById('list');
    list.textContent = '';
    contexts.forEach((context, index) => {
        const item = document.createElement('li');
        item.className = index === chosen ? 'chosen' : '';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = context.id;
        const where = document.createElement('span');
        where.className = 'value';
        where.textContent = context.javaSource;
        item.append(name, where);
        item.addEventListener('click', () => {
            chosen = index;
            draw();
        });
        list.append(item);
    });

    const detail = document.getElementById('detail');
    detail.textContent = '';
    const context = contexts[chosen];
    if (!context) {
        const empty = document.createElement('p');
        empty.className = 'description';
        empty.textContent = 'No context yet. Add one, and say where its Java sources are.';
        detail.append(empty);
    } else {
        detail.append(
            field('Id', 'Names the context within the project.', text(context, 'id')),
            field(
                'Java source',
                'The directory holding the sources to verify.',
                pathField(context, 'javaSource', 'javaSource', 'folder'),
            ),
            field(
                'Classpath',
                'Directories or jars holding Java sources KeY reads as library classes.',
                pathList(context, 'classpath', 'folder'),
            ),
            field(
                'Bootclasspath',
                "A directory replacing KeY's own JavaRedux. Leave empty unless you need your own.",
                pathField(context, 'bootclasspath', 'bootclasspath', 'folder'),
            ),
            field(
                'Includes',
                'Further .key files to include.',
                pathList(context, 'includes', 'file'),
            ),
        );
    }
    detail.append(
        field(
            'Proof directory',
            'Where the project stores its proofs, relative to its root.',
            proofDirectoryField(),
        ),
    );
    note();
}

function field(label, what, control) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const heading = document.createElement('h2');
    heading.textContent = label;
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = what;
    wrapper.append(heading, description, control);
    for (const problem of problemsFor(label)) {
        const line = document.createElement('p');
        line.className = problem.severity === 'ERROR' ? 'problem error' : 'problem warning';
        line.textContent = problem.message;
        wrapper.append(line);
    }
    return wrapper;
}

/** The problems the bridge reported for the shown context, by the field they belong to. */
function problemsFor(label) {
    const context = contexts[chosen];
    if (!context) {
        return [];
    }
    const wanted = label.toLowerCase().replace(' ', '');
    return problems.filter(
        (problem) =>
            problem.contextId === context.id &&
            problem.field.toLowerCase().replace(/\[\d+\]/, '') === wanted,
    );
}

function text(holder, key) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = holder[key] ?? '';
    input.addEventListener('input', () => {
        holder[key] = input.value;
        if (key === 'id') {
            draw();
        }
    });
    return input;
}

function pathField(context, key, field, kind) {
    const row = document.createElement('div');
    row.className = 'row';
    const input = text(context, key);
    const browse = document.createElement('button');
    browse.textContent = 'Browse…';
    browse.addEventListener('click', () => {
        editor.postMessage({ type: 'browse', field, index: 0, kind });
    });
    row.append(input, browse);
    return row;
}

function pathList(context, key, kind) {
    const wrapper = document.createElement('div');
    context[key].forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'row';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = entry;
        input.addEventListener('input', () => {
            context[key][index] = input.value;
        });
        const browse = document.createElement('button');
        browse.textContent = 'Browse…';
        browse.addEventListener('click', () => {
            editor.postMessage({ type: 'browse', field: key, index, kind });
        });
        const remove = document.createElement('button');
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
            context[key].splice(index, 1);
            draw();
        });
        row.append(input, browse, remove);
        wrapper.append(row);
    });
    const add = document.createElement('button');
    add.textContent = 'Add entry';
    add.addEventListener('click', () => {
        context[key].push('');
        draw();
    });
    wrapper.append(add);
    return wrapper;
}

function proofDirectoryField() {
    const row = document.createElement('div');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = proofDirectory;
    input.addEventListener('input', () => {
        proofDirectory = input.value;
    });
    row.append(input);
    return row;
}

function note() {
    const errors = problems.filter((problem) => problem.severity === 'ERROR').length;
    document.getElementById('note').textContent =
        problems.length === 0
            ? ''
            : `${errors} error(s), ${problems.length - errors} warning(s) from the last check.`;
}
