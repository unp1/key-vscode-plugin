// The verification table.
//
// The rows arrive from the extension and are drawn here; sorting, selecting and asking for
// an action happen in the page, and every action goes back to the extension as a message,
// so the same commands run whether they were asked for here or from a menu.

const editor = acquireVsCodeApi();

let rows = [];
let sortBy = 'label';
let ascending = true;
const selected = new Set();
let lastClicked = -1;

window.addEventListener('message', (event) => {
    if (event.data.type === 'rows') {
        rows = event.data.rows;
        draw();
    }
    if (event.data.type === 'failed') {
        rows = [];
        draw();
        document.getElementById('empty').textContent = event.data.message;
    }
});

document.querySelectorAll('th[data-sort]').forEach((header) => {
    header.addEventListener('click', () => {
        const column = header.dataset.sort;
        ascending = column === sortBy ? !ascending : true;
        sortBy = column;
        draw();
    });
});

/** A row is identified by its context and contract, so a redraw keeps the selection. */
function idOf(row) {
    return `${row.contextId} ${row.contractName}`;
}

function sorted() {
    const order = [...rows].sort((left, right) => {
        const a = left[sortBy];
        const b = right[sortBy];
        // A row with no measurement sorts after one that has it, whichever way the column
        // is sorted: "not measured" is not a small number.
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        return String(a).localeCompare(String(b));
    });
    return ascending ? order : order.reverse();
}

function draw() {
    const table = document.getElementById('table');
    const empty = document.getElementById('empty');
    const body = document.getElementById('rows');
    table.hidden = rows.length === 0;
    empty.hidden = rows.length > 0;
    if (rows.length === 0) {
        empty.textContent = 'Nothing listed yet.';
    }
    document.getElementById('contextHead').hidden = !rows.some((row) => row.context);

    body.textContent = '';
    for (const row of sorted()) {
        const tr = document.createElement('tr');
        tr.dataset.id = idOf(row);
        if (selected.has(idOf(row))) {
            tr.classList.add('selected');
        }
        tr.append(
            cell(row.label, 'name'),
            cell(row.context, 'context', !rows.some((one) => one.context)),
            cell(row.time === null ? '' : `${row.time.toFixed(1)} s`, 'right'),
            cell(row.nodes === null ? '' : String(row.nodes), 'right'),
            cell(row.branches === null ? '' : String(row.branches), 'right'),
            statusCell(row),
        );
        tr.addEventListener('click', (event) => select(row, event));
        tr.addEventListener('dblclick', () => act('goToSource', [row]));
        tr.addEventListener('contextmenu', () => {
            // The editor opens its own menu at the pointer and hands the command what this
            // attribute holds, so the rows it acts on are written just before it opens.
            if (!selected.has(idOf(row))) {
                selected.clear();
                selected.add(idOf(row));
                draw();
            }
            setContext(tr, chosen());
        });
        setContext(tr, [row]);
        body.append(tr);
    }
}

/** What the editor's menu is given when it is opened on a row. */
function setContext(element, rows) {
    element.dataset.vscodeContext = JSON.stringify({
        webviewSection: 'keyRow',
        preventDefaultContextMenuItems: true,
        contextId: rows[0].contextId,
        contractNames: rows.map((row) => row.contractName),
    });
}

function cell(text, className, hidden) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) {
        td.className = className;
    }
    td.hidden = Boolean(hidden);
    return td;
}

/** The status, with KeY's own icon before it and a link where the settings differ. */
function statusCell(row) {
    const td = document.createElement('td');
    td.className = 'state';
    if (row.icon) {
        // One image per theme, the editor's own class on the body deciding which shows.
        for (const [theme, src] of [['light', row.icon], ['dark', row.darkIcon || row.icon]]) {
            const icon = document.createElement('img');
            icon.className = `icon ${theme}`;
            icon.src = src;
            icon.alt = '';
            td.append(icon);
        }
    }
    td.append(document.createTextNode(row.status));
    if (row.differs > 0) {
        const link = document.createElement('a');
        link.className = 'differs';
        link.textContent = 'settings differ';
        link.title = 'The saved proof was made under other settings than the current ones';
        link.addEventListener('click', (event) => {
            event.stopPropagation();
            act('settingDifferences', [row]);
        });
        td.append(link);
    }
    return td;
}

function select(row, event) {
    const order = sorted();
    const index = order.findIndex((one) => idOf(one) === idOf(row));
    if (event.shiftKey && lastClicked >= 0) {
        const [from, to] = [Math.min(lastClicked, index), Math.max(lastClicked, index)];
        for (let at = from; at <= to; at += 1) {
            selected.add(idOf(order[at]));
        }
    } else if (event.ctrlKey || event.metaKey) {
        if (!selected.delete(idOf(row))) {
            selected.add(idOf(row));
        }
        lastClicked = index;
    } else {
        selected.clear();
        selected.add(idOf(row));
        lastClicked = index;
    }
    draw();
}

/** The selected rows, in the order the table shows them. */
function chosen() {
    return sorted().filter((row) => selected.has(idOf(row)));
}

function act(type, of) {
    if (of.length === 0) {
        return;
    }
    editor.postMessage({
        type,
        contextId: of[0].contextId,
        contractNames: of.map((row) => row.contractName),
    });
}
