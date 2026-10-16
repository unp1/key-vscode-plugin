// The proof options form.
//
// The options of a tab are listed on the left and the chosen one is set on the right, so
// each option is read with what it means. Only what the user changed is sent back, which is
// what makes editing several obligations at once safe: each keeps what was not touched.

const editor = acquireVsCodeApi();

/** What the extension sent: the options of each tab, and what the level inherits. */
let shown = {
    taclet: [],
    strategy: [],
    maxSteps: '',
    inheritedMaxSteps: 0,
    timeout: '',
    inheritedTimeout: 0,
    fallback: '',
};

/** What the user changed, by tab and option key. A value of null means "inherit". */
const changed = { taclet: new Map(), strategy: new Map() };
let changedMaxSteps = null;
let changedTimeout = null;

let tab = 'taclet';
let chosen = 0;

window.addEventListener('message', (event) => {
    if (event.data.type !== 'options') {
        return;
    }
    shown = event.data;
    changed.taclet.clear();
    changed.strategy.clear();
    changedMaxSteps = null;
    changedTimeout = null;
    document.getElementById('title').textContent = `Proof options of ${shown.title}`;
    document.getElementById('fallback').textContent =
        `An option that is not set here uses ${shown.fallback}.`;
    draw();
});

document.querySelectorAll('nav.tabs button').forEach((button) => {
    button.addEventListener('click', () => {
        tab = button.dataset.tab;
        chosen = 0;
        document.querySelectorAll('nav.tabs button').forEach((one) => {
            one.classList.toggle('chosen', one === button);
        });
        draw();
    });
});

document.getElementById('apply').addEventListener('click', () => {
    editor.postMessage({ type: 'apply', change: change() });
});

document.getElementById('inheritAll').addEventListener('click', () => {
    for (const kind of ['taclet', 'strategy']) {
        for (const option of shown[kind]) {
            changed[kind].set(option.key, null);
        }
    }
    changedMaxSteps = '';
    changedTimeout = '';
    draw();
});

/** What an option is set to now: what the user chose, or what the level states. */
function valueOf(kind, option) {
    return changed[kind].has(option.key) ? changed[kind].get(option.key) : option.stated;
}

function draw() {
    const list = document.getElementById('list');
    const detail = document.getElementById('detail');
    list.textContent = '';
    detail.textContent = '';

    // The limits are fields rather than a list, so that tab uses the whole width.
    document.querySelector('section.panes').classList.toggle('single', tab === 'limits');
    if (tab === 'limits') {
        drawLimits(detail);
        note();
        return;
    }

    const options = shown[tab];
    options.forEach((option, index) => {
        const value = valueOf(tab, option);
        const item = document.createElement('li');
        item.className = index === chosen ? 'chosen' : '';
        if (value !== null) {
            item.classList.add('stated');
        }
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = option.label;
        const shows = document.createElement('span');
        shows.className = 'value';
        shows.textContent = labelOf(option, value ?? option.inherited);
        item.append(name, shows);
        item.addEventListener('click', () => {
            chosen = index;
            draw();
        });
        list.append(item);
    });

    const option = options[chosen];
    if (option) {
        drawOption(detail, option);
    }
    note();
}

function drawOption(detail, option) {
    const heading = document.createElement('h2');
    heading.textContent = option.label;
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = option.description;
    detail.append(heading, description);

    const value = valueOf(tab, option);
    detail.append(
        choice(
            option,
            null,
            `Inherit (${labelOf(option, option.inherited) || shown.fallback})`,
            `Use ${shown.fallback}.`,
            value === null,
        ),
    );
    for (const accepted of option.values) {
        detail.append(
            choice(
                option,
                accepted.value,
                accepted.label,
                accepted.description,
                value === accepted.value,
            ),
        );
    }
}

function choice(option, value, label, what, picked) {
    const wrapper = document.createElement('label');
    wrapper.className = 'choice';
    const button = document.createElement('input');
    button.type = 'radio';
    button.name = option.key;
    button.checked = picked;
    button.addEventListener('change', () => {
        changed[tab].set(option.key, value);
        draw();
    });
    const text = document.createElement('span');
    text.textContent = ` ${label}`;
    wrapper.append(button, text);
    if (what) {
        const explains = document.createElement('span');
        explains.className = 'what';
        explains.textContent = what;
        wrapper.append(explains);
    }
    return wrapper;
}

function drawLimits(detail) {
    detail.append(
        limit(
            'Max. rule applications',
            'How many rule applications one proof attempt may make. Empty means: use ' +
                `${shown.fallback} (${shown.inheritedMaxSteps}).`,
            `${shown.inheritedMaxSteps} (inherited)`,
            changedMaxSteps === null ? shown.maxSteps : changedMaxSteps,
            (value) => {
                changedMaxSteps = value;
            },
        ),
        limit(
            'Timeout',
            'How long one proof attempt may take, in milliseconds. -1 is no timeout. ' +
                `Empty means: use ${shown.fallback} (${timeoutText(shown.inheritedTimeout)}).`,
            `${timeoutText(shown.inheritedTimeout)} (inherited)`,
            changedTimeout === null ? shown.timeout : changedTimeout,
            (value) => {
                changedTimeout = value;
            },
        ),
    );
}

/** One limit: a heading, what it decides, and the field that sets it. */
function limit(label, what, placeholder, value, set) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const heading = document.createElement('h2');
    heading.textContent = label;
    const description = document.createElement('p');
    description.className = 'description';
    description.textContent = what;
    const field = document.createElement('input');
    field.type = 'text';
    field.placeholder = placeholder;
    field.value = value;
    field.addEventListener('input', () => {
        set(field.value.trim());
        note();
    });
    wrapper.append(heading, description, field);
    return wrapper;
}

/** How a timeout reads: KeY's -1 is no timeout at all. */
function timeoutText(timeout) {
    return timeout === -1 ? 'no timeout' : `${timeout} ms`;
}

/** How a value reads in the list: the option's own label for it. */
function labelOf(option, value) {
    const found = option.values.find((one) => one.value === value);
    return found ? found.label : value;
}

function note() {
    const count =
        changed.taclet.size +
        changed.strategy.size +
        (changedMaxSteps === null ? 0 : 1) +
        (changedTimeout === null ? 0 : 1);
    document.getElementById('note').textContent =
        count === 0 ? 'Nothing changed yet.' : `${count} option(s) changed, not yet applied.`;
}

/** The change to send: the options the user touched, and nothing else. */
function change() {
    const taclet = {};
    const tacletCleared = [];
    const strategy = {};
    const strategyCleared = [];
    for (const [key, value] of changed.taclet) {
        if (value === null) {
            tacletCleared.push(key);
        } else {
            taclet[key] = value;
        }
    }
    for (const [key, value] of changed.strategy) {
        if (value === null) {
            strategyCleared.push(key);
        } else {
            strategy[key] = value;
        }
    }
    return {
        taclet,
        tacletCleared,
        strategy,
        strategyCleared,
        maxSteps: changedMaxSteps === null ? null : Number(changedMaxSteps || 0),
        timeout: changedTimeout === null ? null : Number(changedTimeout || 0),
    };
}
