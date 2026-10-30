// The verification table.
//
// The rows arrive from the extension grouped by class and are drawn here. Sorting, folding,
// selecting and asking for an action happen in the page. Every action goes back to the
// extension as a message, so the same commands run whether they were asked for here or
// from a menu.

const editor = acquireVsCodeApi();

// The folded groups and the sorting survive the page being hidden and shown again.
const saved = editor.getState() || {};
let groups = [];
let sortBy = saved.sortBy || null;
let ascending = saved.ascending !== false;
const folded = new Set(saved.folded || []);
const selected = new Set();
const selectedGroups = new Set();
let lastClicked = null;

window.addEventListener('message', (event) => {
    if (event.data.type === 'rows') {
        groups = event.data.groups;
        draw();
    }
    if (event.data.type === 'failed') {
        groups = [];
        draw();
        document.getElementById('empty').textContent = event.data.message;
    }
});

const headings = [...document.querySelectorAll('th[data-sort]')];
headings.forEach((heading) => {
    heading.dataset.name = heading.textContent;
    heading.addEventListener('click', () => {
        // The first click sorts ascending, the second descending, and the third restores
        // the listing order.
        const column = heading.dataset.sort;
        if (column !== sortBy) {
            sortBy = column;
            ascending = true;
        } else if (ascending) {
            ascending = false;
        } else {
            sortBy = null;
        }
        save();
        draw();
    });
});

function save() {
    editor.setState({ folded: [...folded], sortBy, ascending });
}

/** A row is identified by its context and contract, so a redraw keeps the selection. */
function idOf(row) {
    return `${row.contextId} ${row.contractName}`;
}

/** A line is a group's header or one of its rows. */
function lineIdOf(line) {
    return line.row ? `row ${idOf(line.row)}` : `group ${line.group.id}`;
}

/**
 * The rows of a group in the order of the sorted column.
 *
 * Rows without a value come last in both directions and keep their listing order. A proof
 * that was not measured has no time, and sorting it among the short times would misreport
 * it.
 */
function ordered(rows) {
    if (!sortBy) {
        return rows;
    }
    const valued = rows.filter((row) => row[sortBy] !== null);
    const without = rows.filter((row) => row[sortBy] === null);
    valued.sort((left, right) => {
        const a = left[sortBy];
        const b = right[sortBy];
        const order = typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b));
        return ascending ? order : -order;
    });
    return [...valued, ...without];
}

/** The lines the table shows: each group's header, then its rows unless it is folded. */
function lines() {
    return groups.flatMap((group) => [
        { group },
        ...(folded.has(group.id) ? [] : ordered(group.rows).map((row) => ({ group, row }))),
    ]);
}

function draw() {
    const table = document.getElementById('table');
    const empty = document.getElementById('empty');
    const body = document.getElementById('rows');
    table.hidden = groups.length === 0;
    empty.hidden = groups.length > 0;
    if (groups.length === 0) {
        empty.textContent = 'Nothing listed yet.';
    }
    for (const heading of headings) {
        const arrow = heading.dataset.sort !== sortBy ? '' : ascending ? ' ▲' : ' ▼';
        heading.textContent = heading.dataset.name + arrow;
    }

    body.textContent = '';
    for (const line of lines()) {
        body.append(line.row ? rowLine(line) : headerLine(line));
    }
}

/** The header of a group: the fold arrow, the class, and the number of its obligations. */
function headerLine(line) {
    const group = line.group;
    const tr = document.createElement('tr');
    tr.className = 'group';
    if (selectedGroups.has(group.id)) {
        tr.classList.add('selected');
    }
    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    twisty.textContent = folded.has(group.id) ? '▸' : '▾';
    // The arrow folds the group and leaves the selection as it is.
    twisty.addEventListener('click', (event) => {
        event.stopPropagation();
        toggle(group);
    });
    twisty.addEventListener('dblclick', (event) => event.stopPropagation());
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = group.title;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = group.rows.length === 1
        ? '1 proof obligation'
        : `${group.rows.length} proof obligations`;
    const td = document.createElement('td');
    td.colSpan = headings.length;
    td.append(twisty, title, count);
    tr.append(td);
    tr.addEventListener('click', (event) => select(line, event));
    // A double click folds or unfolds the group, as in a tree.
    tr.addEventListener('dblclick', () => toggle(group));
    whenMenuOpens(tr, line);
    setContext(tr, group.rows);
    return tr;
}

function rowLine(line) {
    const row = line.row;
    const tr = document.createElement('tr');
    if (selected.has(idOf(row))) {
        tr.classList.add('selected');
    }
    tr.append(
        cell(row.label, 'name'),
        cell(row.time === null ? '' : `${row.time.toFixed(1)} s`, 'right'),
        cell(row.nodes === null ? '' : String(row.nodes), 'right'),
        cell(row.branches === null ? '' : String(row.branches), 'right'),
        statusCell(row),
    );
    tr.addEventListener('click', (event) => select(line, event));
    tr.addEventListener('dblclick', () => act('goToSource', [row]));
    whenMenuOpens(tr, line);
    setContext(tr, [row]);
    return tr;
}

/**
 * Writes what the editor's menu acts on, just before the menu opens.
 *
 * The editor opens its own menu at the pointer and hands the command what the line's
 * attribute holds. A right click outside the selection selects the line first, as a left
 * click does.
 */
function whenMenuOpens(tr, line) {
    tr.addEventListener('contextmenu', () => {
        if (!isSelected(line)) {
            select(line, {});
        }
        setContext(tr, chosen());
    });
}

/** What the editor's menu is given when it is opened on a line. */
function setContext(element, rows) {
    if (rows.length === 0) {
        return;
    }
    element.dataset.vscodeContext = JSON.stringify({
        webviewSection: 'keyRow',
        preventDefaultContextMenuItems: true,
        contextId: rows[0].contextId,
        contractNames: rows.map((row) => row.contractName),
    });
}

function cell(text, className) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) {
        td.className = className;
    }
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

/** Folds an unfolded group, or unfolds a folded one. */
function toggle(group) {
    if (folded.delete(group.id)) {
        // Unfolding a selected header selects the rows under it.
        if (selectedGroups.has(group.id)) {
            group.rows.forEach((row) => selected.add(idOf(row)));
        }
    } else {
        // A hidden row is not selected. A selected folded header stands for the whole class.
        folded.add(group.id);
        group.rows.forEach((row) => selected.delete(idOf(row)));
    }
    save();
    draw();
}

function isSelected(line) {
    return line.row ? selected.has(idOf(line.row)) : selectedGroups.has(line.group.id);
}

/** Selects or deselects one line, without the rows of a header. */
function mark(line, on) {
    const ids = line.row ? selected : selectedGroups;
    const id = line.row ? idOf(line.row) : line.group.id;
    if (on) {
        ids.add(id);
    } else {
        ids.delete(id);
    }
}

/**
 * Changes the selection at a line, as a click asks.
 *
 * A plain click selects the line. A Ctrl or Cmd click toggles it. A Shift click selects the
 * range from the line clicked last. Selecting a header selects the rows shown under it.
 * Deselecting a header deselects them. Deselecting a row deselects its header, because the
 * class is no longer selected as a whole.
 */
function select(line, event) {
    const all = lines();
    const index = all.findIndex((one) => lineIdOf(one) === lineIdOf(line));
    const from = all.findIndex((one) => lineIdOf(one) === lastClicked);
    if (event.shiftKey && from >= 0) {
        for (let at = Math.min(from, index); at <= Math.max(from, index); at += 1) {
            mark(all[at], true);
        }
    } else if (event.ctrlKey || event.metaKey) {
        mark(line, !isSelected(line));
        lastClicked = lineIdOf(line);
    } else {
        selected.clear();
        selectedGroups.clear();
        mark(line, true);
        lastClicked = lineIdOf(line);
    }
    const shown = folded.has(line.group.id) ? [] : line.group.rows;
    if (!line.row && isSelected(line)) {
        shown.forEach((row) => selected.add(idOf(row)));
    } else if (!line.row) {
        shown.forEach((row) => selected.delete(idOf(row)));
    } else if (!isSelected(line)) {
        selectedGroups.delete(line.group.id);
    }
    draw();
}

/**
 * The obligations the selection stands for, in the order the table shows them.
 *
 * A selected row stands for itself. A selected header of a folded group stands for every
 * obligation of the group, since they cannot be selected while hidden.
 */
function chosen() {
    return lines().flatMap((line) => {
        if (line.row) {
            return selected.has(idOf(line.row)) ? [line.row] : [];
        }
        return folded.has(line.group.id) && selectedGroups.has(line.group.id)
            ? line.group.rows
            : [];
    });
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
