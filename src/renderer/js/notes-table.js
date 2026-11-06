// Tables inside a Notes page, Notion-style: typed columns (text, number,
// percent, progress, checkbox, select, status, multi-select, date, link), rows
// you add, reorder and delete, sorting and filtering, resizable columns, a
// calculation under each column, and right-click menus for all of it.
//
// This module only draws a table and edits a working copy of it. The editor
// (editor/index.js) owns where the table sits in the page and when it is saved:
// every change calls `onChange(table, immediate)`, typing on a debounce,
// structure at once. `before()` is called before a structural change so the
// editor can take an undo step, and `undo()` is what a toast's Undo runs.
// Values are written with textContent and into form fields, never as markup.
// Main re-validates the whole table on save (schema.js parseTable).

import { showCtx } from './views.js';
import { tickButton } from './todo.js';
import { confirmDialog, formDialog } from './dialog.js';
import { notify } from './notifications.js';

export const COL_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'percent', label: 'Percent' },
  { id: 'progress', label: 'Progress bar' },
  { id: 'check', label: 'Checkbox' },
  { id: 'select', label: 'Select' },
  { id: 'status', label: 'Status' },
  { id: 'multiselect', label: 'Multi-select' },
  { id: 'date', label: 'Date' },
  { id: 'url', label: 'Link' },
];
const MAX_COLS = 20;
const MAX_ROWS = 500;
const STATUS = ['Not started', 'In progress', 'Done'];
const STATUS_GROUPS = ['todo', 'doing', 'done'];
const CALCS = [
  ['none', 'None'], ['count', 'Count all'], ['filled', 'Count filled'], ['empty', 'Count empty'],
  ['sum', 'Sum'], ['avg', 'Average'], ['min', 'Minimum'], ['max', 'Maximum'], ['checked', 'Count ticked'],
];
const FILTER_OPS = [
  ['contains', 'contains'], ['is', 'is'], ['isnot', 'is not'], ['empty', 'is empty'], ['notempty', 'is not empty'], ['gt', 'is greater than'], ['lt', 'is less than'],
];
const HTTP = /^https?:\/\/\S+$/i;

// Short keys, unique inside one page. They match schema.js `key()`.
export function newKey() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const blankRow = () => ({ id: newKey(), createdAt: Date.now(), cells: {} });
const statusCol = (name) => ({ id: newKey(), name, type: 'status', options: [...STATUS], groups: [...STATUS_GROUPS] });

// Starting points offered by "Table".
export const TEMPLATES = [
  { id: 'blank', label: 'Blank table', make: () => ({
    columns: [{ id: newKey(), name: 'Name', type: 'text', options: [] },
              { id: newKey(), name: 'Notes', type: 'text', options: [] }] }) },
  { id: 'tracker', label: 'Progress tracker', make: () => ({
    columns: [{ id: newKey(), name: 'Topic', type: 'text', options: [] },
              statusCol('Status'),
              { id: newKey(), name: 'Progress', type: 'progress', options: [] },
              { id: newKey(), name: 'Done', type: 'check', options: [] }] }) },
  { id: 'grades', label: 'Scores / grades', make: () => ({
    columns: [{ id: newKey(), name: 'Subject', type: 'text', options: [] },
              { id: newKey(), name: 'Score', type: 'number', options: [] },
              { id: newKey(), name: 'Percent', type: 'percent', options: [] },
              { id: newKey(), name: 'Date', type: 'date', options: [] }] }) },
  { id: 'board', label: 'Status board', make: () => ({
    columns: [{ id: newKey(), name: 'Task', type: 'text', options: [] },
              statusCol('Status'),
              { id: newKey(), name: 'Due', type: 'date', options: [] },
              { id: newKey(), name: 'Done', type: 'check', options: [] }] }) },
];

export function makeTable(templateId = 'blank') {
  const t = (TEMPLATES.find(x => x.id === templateId) || TEMPLATES[0]).make();
  return { id: newKey(), title: '', columns: t.columns, rows: [blankRow(), blankRow(), blankRow()],
    sort: null, filter: null, showTitle: true, showFooter: true };
}

// A menu under a button, through the shared context menu.
function menuAt(button, items) {
  const r = button.getBoundingClientRect();
  showCtx({ x: r.left, y: r.bottom + 2 }, items);
}

// Converts a value when a column changes type, so filled cells survive where
// they reasonably can (a "45" text becomes 45, a checked box becomes 100%).
function convert(v, from, to, col) {
  if (v === undefined || v === null || from === to) return v;
  const options = col.options;
  const one = Array.isArray(v) ? v[0] : v;
  if (to === 'multiselect') return Array.isArray(v) ? v : (typeof v === 'string' && options.includes(v) ? [v] : undefined);
  if (from === 'multiselect') return to === 'text' ? v.join(', ') : ((to === 'select' || to === 'status') && options.includes(one) ? one : undefined);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : v === true ? 100 : NaN;
  switch (to) {
    case 'text': return v === true ? 'Yes' : String(v);
    case 'number': return Number.isFinite(n) ? n : undefined;
    case 'percent': case 'progress': return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
    case 'check': return v === true || n >= 100 || /^(y|yes|done|true|x)$/i.test(String(v)) ? true : undefined;
    case 'select': case 'status': return typeof v === 'string' && options.includes(v) ? v : undefined;
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case 'url': return typeof v === 'string' && HTTP.test(v) ? v : undefined;
    default: return undefined;
  }
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

const groupOf = (col, option) => (col.groups && col.groups[col.options.indexOf(option)]) || 'todo';

function isFilled(v) { return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length); }

// The footer line for one column: the chosen calculation, else a sensible default.
function summary(col, rows) {
  const vals = rows.map(r => r.cells[col.id]).filter(isFilled);
  const nums = vals.filter(v => typeof v === 'number');
  switch (col.calc) {
    case 'count': return 'Count ' + rows.length;
    case 'filled': return 'Filled ' + vals.length;
    case 'empty': return 'Empty ' + (rows.length - vals.length);
    case 'sum': return nums.length ? 'Sum ' + fmt(nums.reduce((a, b) => a + b, 0)) : '';
    case 'avg': return nums.length ? 'Avg ' + fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
    case 'min': return nums.length ? 'Min ' + fmt(Math.min(...nums)) : '';
    case 'max': return nums.length ? 'Max ' + fmt(Math.max(...nums)) : '';
    case 'checked': return rows.length ? vals.filter(v => v === true).length + ' / ' + rows.length + ' ticked' : '';
    default: break;
  }
  switch (col.type) {
    case 'number': return vals.length ? 'Sum ' + fmt(vals.reduce((a, b) => a + b, 0)) : '';
    case 'percent':
    case 'progress': return vals.length ? 'Avg ' + fmt(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '';
    case 'check': return rows.length ? vals.length + ' / ' + rows.length + ' done' : '';
    case 'status': {
      if (!rows.length) return '';
      return rows.filter(r => groupOf(col, r.cells[col.id]) === 'done' && r.cells[col.id] !== undefined).length + ' / ' + rows.length + ' done';
    }
    case 'select': {
      if (!vals.length) return '';
      const last = col.options[col.options.length - 1];
      return last ? rows.filter(r => r.cells[col.id] === last).length + ' / ' + rows.length + ' ' + last.toLowerCase() : vals.length + ' set';
    }
    case 'date': return vals.length ? vals.length + ' dated' : '';
    default: return vals.length ? vals.length + ' filled' : '';
  }
}

// How far along the whole table is: checkboxes first, then progress, then the
// finished status. Null when the table has nothing to measure.
export function tableProgress(t) {
  if (!t.rows.length) return null;
  const check = t.columns.find(c => c.type === 'check');
  if (check) return t.rows.filter(r => r.cells[check.id] === true).length / t.rows.length;
  const prog = t.columns.find(c => c.type === 'progress' || c.type === 'percent');
  if (prog) return t.rows.reduce((a, r) => a + (r.cells[prog.id] || 0), 0) / (100 * t.rows.length);
  const st = t.columns.find(c => c.type === 'status' && c.options.length);
  if (st) return t.rows.filter(r => r.cells[st.id] !== undefined && groupOf(st, r.cells[st.id]) === 'done').length / t.rows.length;
  const sel = t.columns.find(c => c.type === 'select' && c.options.length);
  if (sel) return t.rows.filter(r => r.cells[sel.id] === sel.options[sel.options.length - 1]).length / t.rows.length;
  return null;
}

// What a cell is, as text, for sorting and filtering.
function cellText(v) {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (v === true) return 'yes';
  return String(v);
}

function passes(filter, col, row) {
  if (!filter || !col) return true;
  const v = row.cells[col.id];
  const text = cellText(v).toLowerCase();
  const want = String(filter.value || '').toLowerCase();
  switch (filter.op) {
    case 'contains': return text.includes(want);
    case 'is': return text === want;
    case 'isnot': return text !== want;
    case 'empty': return !isFilled(v);
    case 'notempty': return isFilled(v);
    case 'gt': return typeof v === 'number' ? v > Number(want) : text > want;
    case 'lt': return typeof v === 'number' ? v < Number(want) : text < want;
    default: return true;
  }
}

// The rows to show: filtered, then sorted. They are the table's own row objects.
function viewRows(t) {
  const fcol = t.filter && t.columns.find(c => c.id === t.filter.col);
  let rows = t.filter && fcol ? t.rows.filter(r => passes(t.filter, fcol, r)) : t.rows.slice();
  const scol = t.sort && t.columns.find(c => c.id === t.sort.col);
  if (scol) {
    const dir = t.sort.dir === 'desc' ? -1 : 1;
    const key = (r) => {
      const v = r.cells[scol.id];
      if (scol.type === 'select' || scol.type === 'status') return scol.options.indexOf(v);
      return v;
    };
    rows = rows.map((r, i) => ({ r, i })).sort((a, b) => {
      const x = key(a.r);
      const y = key(b.r);
      const ex = !isFilled(x);
      const ey = !isFilled(y);
      if (ex || ey) return ex === ey ? a.i - b.i : (ex ? 1 : -1) * (dir === 1 ? 1 : 1);   // empty cells last either way
      let c;
      if (typeof x === 'number' && typeof y === 'number') c = x - y;
      else c = cellText(x).localeCompare(cellText(y), undefined, { numeric: true, sensitivity: 'base' });
      return c * dir || a.i - b.i;
    }).map(x => x.r);
  }
  return rows;
}

// Builds one table. `t` is mutated in place; `onChange(t, immediate)` is told
// after every edit. Returns the root element.
export function buildTable(t, { onChange, onDelete, before, extraMenu, undo, duplicate }) {
  const root = el('div', 'nt-table');
  root.dataset.table = t.id;
  root.tabIndex = -1;
  if (!t.sort) t.sort = null;
  if (!t.filter) t.filter = null;
  if (t.showTitle === undefined) t.showTitle = true;
  if (t.showFooter === undefined) t.showFooter = true;

  const changed = (immediate) => { onChange(t, immediate); };
  const pre = () => { if (before) before(); };
  // A structural change: an undo step first, then draw and save at once.
  const redraw = () => { draw(); changed(true); };
  const structural = (fn) => { pre(); fn(); redraw(); };
  const toastUndo = (title, message) => notify.show({ title, message, type: 'info', duration: 7000,
    action: undo ? { label: 'Undo', onClick: () => undo() } : undefined });

  function draw() {
    const focusKey = document.activeElement && root.contains(document.activeElement)
      ? document.activeElement.dataset.key : null;
    root.replaceChildren();

    // Title and tools.
    const head = el('div', 'nt-table-head');
    const title = el('input', 'nt-table-title');
    title.type = 'text';
    title.maxLength = 100;
    title.placeholder = 'Untitled table';
    title.value = t.title;
    title.dataset.key = 'title';
    title.hidden = !t.showTitle;
    title.addEventListener('input', () => { t.title = title.value; changed(false); });
    const prog = tableProgress(t);
    head.append(title);
    if (!t.showTitle) head.append(el('span', 'nt-table-grow'));
    if (prog !== null) {
      const bar = el('div', 'progress nt-table-progress');
      bar.title = Math.round(prog * 100) + '% complete';
      const fill = el('i');
      fill.style.setProperty('--p', Math.round(prog * 100) + '%');
      bar.append(fill);
      head.append(bar, el('span', 'nt-table-pct', Math.round(prog * 100) + '%'));
    }
    const more = el('button', 'nt-table-tool', '⋯');
    more.type = 'button';
    more.title = 'Table options';
    more.setAttribute('aria-label', 'Table options');
    more.addEventListener('click', (e) => { e.stopPropagation(); menuAt(more, tableItems()); });
    head.append(more);
    root.append(head);

    // The filter in force, with a way to drop it.
    const fcol = t.filter && t.columns.find(c => c.id === t.filter.col);
    if (t.filter && fcol) {
      const chip = el('div', 'nt-filter');
      const op = (FILTER_OPS.find(o => o[0] === t.filter.op) || [0, t.filter.op])[1];
      chip.append(el('span', null, 'Filter: ' + (fcol.name || 'Column') + ' ' + op + (/empty/.test(t.filter.op) ? '' : ' "' + t.filter.value + '"')));
      const x = el('button', 'nt-filter-x', '×');
      x.type = 'button';
      x.setAttribute('aria-label', 'Remove the filter');
      x.addEventListener('click', () => { t.filter = null; redraw(); });
      chip.append(x);
      root.append(chip);
    }

    const rows = viewRows(t);
    const scroll = el('div', 'nt-table-scroll');
    const table = el('table', 'nt-grid');
    const visible = t.columns.filter(c => !c.hidden);

    // Header: one cell per column, a menu on each, a handle on its edge to resize.
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', 'nt-grip-cell'));
    visible.forEach((col) => {
      const ci = t.columns.indexOf(col);
      const th = el('th', 'nt-th nt-type-' + col.type);
      if (col.width) th.style.width = th.style.minWidth = col.width + 'px';
      const name = el('input', 'nt-th-name');
      name.type = 'text';
      name.maxLength = 40;
      name.value = col.name;
      name.placeholder = 'Column';
      name.dataset.key = 'h:' + col.id;
      name.setAttribute('aria-label', 'Column name');
      name.addEventListener('input', () => { col.name = name.value; changed(false); });
      th.append(name);
      if (t.sort && t.sort.col === col.id) {
        const arrow = el('span', 'nt-sort', t.sort.dir === 'desc' ? '↓' : '↑');
        arrow.title = 'Sorted ' + (t.sort.dir === 'desc' ? 'descending' : 'ascending');
        th.append(arrow);
      }
      const menu = el('button', 'nt-th-menu', '▾');
      menu.type = 'button';
      menu.title = 'Column options';
      menu.setAttribute('aria-label', 'Options for column ' + (col.name || ci + 1));
      menu.addEventListener('click', (e) => { e.stopPropagation(); menuAt(menu, columnItems(col, ci)); });
      th.append(menu);
      const grip = el('span', 'nt-th-resize');
      grip.setAttribute('aria-hidden', 'true');
      grip.addEventListener('pointerdown', (e) => resizeColumn(e, col, th));
      th.append(grip);
      th.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e, [...columnItems(col, ci), ...(extraMenu ? extraMenu() : [])]); });
      hr.append(th);
    });
    const addTh = el('th', 'nt-th-add');
    if (t.columns.length < MAX_COLS) {
      const add = el('button', 'nt-table-tool', '+');
      add.type = 'button';
      add.title = 'Add a column';
      add.setAttribute('aria-label', 'Add a column');
      add.addEventListener('click', () => addCol(t.columns.length));
      addTh.append(add);
    }
    hr.append(addTh);
    thead.append(hr);

    const tbody = el('tbody');
    rows.forEach((row) => {
      const ri = t.rows.indexOf(row);
      const tr = el('tr');
      tr.dataset.row = row.id;
      const grip = el('td', 'nt-grip-cell');
      const gb = el('button', 'nt-row-menu', '⋮');
      gb.type = 'button';
      gb.title = 'Drag to move, click for options';
      gb.setAttribute('aria-label', 'Options for row ' + (ri + 1));
      gb.addEventListener('pointerdown', (e) => dragRow(e, gb, tr, row));
      grip.append(gb);
      tr.append(grip);
      for (const col of visible) tr.append(cell(row, col, ri));
      tr.append(el('td', 'nt-td-pad'));
      tr.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e, [...rowItems(row, ri), { separator: true }, ...tableItems(), ...(extraMenu ? extraMenu() : [])]); });
      tbody.append(tr);
    });

    table.append(thead, tbody);
    if (t.showFooter) {
      const tfoot = el('tfoot');
      const fr = el('tr');
      fr.append(el('td', 'nt-grip-cell'));
      for (const col of visible) {
        const td = el('td', 'nt-sum');
        const b = el('button', 'nt-sum-btn', summary(col, rows) || ' ');
        b.type = 'button';
        b.title = 'Choose a calculation';
        b.addEventListener('click', (e) => { e.stopPropagation(); menuAt(b, calcItems(col)); });
        td.append(b);
        fr.append(td);
      }
      fr.append(el('td', 'nt-td-pad'));
      tfoot.append(fr);
      table.append(tfoot);
    }
    scroll.append(table);
    root.append(scroll);

    if (t.rows.length < MAX_ROWS) {
      const newRow = el('button', 'nt-table-newrow', '+ New row');
      newRow.type = 'button';
      newRow.addEventListener('click', () => {
        addRow(t.rows.length);
        const last = root.querySelector('tbody tr:last-child input, tbody tr:last-child select, tbody tr:last-child textarea');
        if (last) last.focus();
      });
      root.append(newRow);
    }

    if (focusKey) {
      const again = root.querySelector('[data-key="' + CSS.escape(focusKey) + '"]');
      if (again) again.focus();
    }
  }

  // ─── Menus ───

  function tableItems() {
    const hidden = t.columns.filter(c => c.hidden).length;
    return [
      { label: 'Table', submenu: [
        { label: 'Rename', onClick: () => { const i = root.querySelector('.nt-table-title'); if (i) { i.hidden = false; t.showTitle = true; redraw(); root.querySelector('.nt-table-title').focus(); } } },
        { label: 'Show title', checked: t.showTitle, onClick: () => { t.showTitle = !t.showTitle; redraw(); } },
        { label: 'Show footer', checked: t.showFooter, onClick: () => { t.showFooter = !t.showFooter; redraw(); } },
        ...(hidden ? [{ label: 'Show ' + hidden + ' hidden column' + (hidden === 1 ? '' : 's'), onClick: () => structural(() => t.columns.forEach(c => { c.hidden = false; })) }] : []),
        ...(t.sort ? [{ label: 'Clear sort', onClick: () => { t.sort = null; redraw(); } }] : []),
        ...(t.filter ? [{ label: 'Clear filter', onClick: () => { t.filter = null; redraw(); } }] : []),
        { label: 'Clear empty rows', onClick: () => structural(() => { t.rows = t.rows.filter(r => Object.keys(r.cells).length); }) },
        ...(duplicate ? [{ label: 'Duplicate table', onClick: () => duplicate() }] : []),
        { separator: true },
        { label: 'Delete table', danger: true, onClick: async () => {
          const sure = await confirmDialog({ title: 'Delete table',
            message: 'Delete "' + (t.title || 'Untitled table') + '" and its ' + t.rows.length + ' rows?', okLabel: 'Delete', danger: true });
          if (sure) { pre(); onDelete(); }
        } },
      ] },
    ];
  }

  function rowItems(row, ri) {
    return [
      { label: 'Row', submenu: [
        { label: 'Insert above', onClick: () => addRow(ri) },
        { label: 'Insert below', onClick: () => addRow(ri + 1) },
        { label: 'Duplicate', disabled: t.rows.length >= MAX_ROWS, onClick: () => structural(() => { t.rows.splice(ri + 1, 0, { id: newKey(), createdAt: Date.now(), cells: structuredClone(row.cells) }); }) },
        { label: 'Move up', disabled: ri === 0, onClick: () => moveRow(ri, -1) },
        { label: 'Move down', disabled: ri >= t.rows.length - 1, onClick: () => moveRow(ri, 1) },
        { separator: true },
        { label: 'Delete row', danger: true, onClick: () => { structural(() => { t.rows.splice(ri, 1); }); toastUndo('Row deleted', 'Undo brings it back.'); } },
      ] },
    ];
  }

  function calcItems(col) {
    return CALCS.map(([id, label]) => ({ label, checked: (col.calc || 'none') === id, onClick: () => { col.calc = id; redraw(); } }));
  }

  function columnItems(col, ci) {
    const filterOp = (op) => async () => {
      if (op === 'empty' || op === 'notempty') { t.filter = { col: col.id, op, value: '' }; redraw(); return; }
      const v = await formDialog({ title: 'Filter ' + (col.name || 'column'), okLabel: 'Filter',
        fields: [{ key: 'value', label: (col.name || 'Column') + ' ' + (FILTER_OPS.find(o => o[0] === op) || [0, op])[1], value: t.filter && t.filter.col === col.id ? t.filter.value : '' }],
        validate: (x) => (x.value.trim() ? '' : 'Type a value to match.') });
      if (v) { t.filter = { col: col.id, op, value: v.value.trim().slice(0, 200) }; redraw(); }
    };
    return [
      { label: 'Column', submenu: [
        { label: 'Rename', onClick: () => { const i = root.querySelector('[data-key="h:' + col.id + '"]'); if (i) { i.focus(); i.select(); } } },
        { label: 'Type', submenu: COL_TYPES.map(ty => ({ label: ty.label, checked: ty.id === col.type, onClick: () => setType(col, ty.id) })) },
        ...(['select', 'status', 'multiselect'].includes(col.type) ? [{ label: 'Edit options…', onClick: () => editOptions(col) }] : []),
        { label: 'Calculation', submenu: calcItems(col) },
        { separator: true },
        { label: 'Sort ascending', checked: !!t.sort && t.sort.col === col.id && t.sort.dir === 'asc', onClick: () => { t.sort = { col: col.id, dir: 'asc' }; redraw(); } },
        { label: 'Sort descending', checked: !!t.sort && t.sort.col === col.id && t.sort.dir === 'desc', onClick: () => { t.sort = { col: col.id, dir: 'desc' }; redraw(); } },
        ...(t.sort && t.sort.col === col.id ? [{ label: 'Remove sort', onClick: () => { t.sort = null; redraw(); } }] : []),
        { label: 'Filter', submenu: FILTER_OPS.map(([op, label]) => ({ label: label.replace(/^./, c => c.toUpperCase()), onClick: filterOp(op) })) },
        { label: 'Wrap text', checked: !!col.wrap, disabled: col.type !== 'text', onClick: () => { col.wrap = !col.wrap; redraw(); } },
        { label: 'Hide', disabled: t.columns.filter(c => !c.hidden).length <= 1, onClick: () => structural(() => { col.hidden = true; if (t.sort && t.sort.col === col.id) t.sort = null; }) },
        { separator: true },
        { label: 'Insert left', onClick: () => addCol(ci) },
        { label: 'Insert right', onClick: () => addCol(ci + 1) },
        ...(ci > 0 ? [{ label: 'Move left', onClick: () => moveCol(ci, -1) }] : []),
        ...(ci < t.columns.length - 1 ? [{ label: 'Move right', onClick: () => moveCol(ci, 1) }] : []),
        { label: 'Duplicate', disabled: t.columns.length >= MAX_COLS, onClick: () => structural(() => {
          const copy = structuredClone(col);
          copy.id = newKey();
          copy.name = (col.name + ' copy').slice(0, 40);
          t.columns.splice(ci + 1, 0, copy);
          for (const r of t.rows) if (r.cells[col.id] !== undefined) r.cells[copy.id] = structuredClone(r.cells[col.id]);
        }) },
        { separator: true },
        { label: 'Delete column', danger: true, disabled: t.columns.length <= 1, onClick: () => {
          structural(() => {
            t.columns.splice(ci, 1);
            for (const r of t.rows) delete r.cells[col.id];
            if (t.sort && t.sort.col === col.id) t.sort = null;
            if (t.filter && t.filter.col === col.id) t.filter = null;
          });
          toastUndo('Column deleted', (col.name || 'Column') + '. Undo brings it back.');
        } },
      ] },
    ];
  }

  // ─── Cells ───

  // Refreshes only the footer and progress after a value edit, so the field
  // being typed in is never rebuilt under the caret.
  function refreshTotals() {
    const rows = viewRows(t);
    const visible = t.columns.filter(c => !c.hidden);
    const sums = root.querySelectorAll('tfoot .nt-sum-btn');
    visible.forEach((col, i) => { if (sums[i]) sums[i].textContent = summary(col, rows) || ' '; });
    const prog = tableProgress(t);
    const fill = root.querySelector('.nt-table-progress > i');
    const pct = root.querySelector('.nt-table-pct');
    if (prog === null || !fill) { if ((prog === null) !== !fill) draw(); return; }
    fill.style.setProperty('--p', Math.round(prog * 100) + '%');
    pct.textContent = Math.round(prog * 100) + '%';
  }

  function setValue(row, col, v, immediate) {
    if (!isFilled(v) || (typeof v === 'number' && !Number.isFinite(v))) delete row.cells[col.id];
    else row.cells[col.id] = v;
    refreshTotals();
    changed(immediate);
  }

  // Up and Down move between rows in the same column, like a spreadsheet.
  function arrows(i, row, col) {
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); root.focus(); return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        const rows = [...root.querySelectorAll('tbody tr')];
        const at = rows.findIndex(r => r.dataset.row === row.id);
        const next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)];
        const f = next && next.querySelector('[data-key="' + CSS.escape(next.dataset.row + ':' + col.id) + '"]');
        if (f) { e.preventDefault(); f.focus(); }
      }
    });
  }

  function cell(row, col, ri) {
    const td = el('td', 'nt-td nt-type-' + col.type);
    if (col.width) td.style.width = td.style.minWidth = col.width + 'px';
    const v = row.cells[col.id];
    const key = row.id + ':' + col.id;
    const field = (type) => {
      const i = el('input', 'nt-cell');
      i.type = type;
      i.dataset.key = key;
      i.setAttribute('aria-label', (col.name || 'Cell') + ', row ' + (ri + 1));
      // Enter moves down a row, like a spreadsheet.
      i.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const rows = viewRows(t);
        const at = rows.indexOf(row);
        const nextRow = rows[at + 1];
        const next = nextRow && root.querySelector('[data-key="' + CSS.escape(nextRow.id + ':' + col.id) + '"]');
        if (next) next.focus();
        else if (t.rows.length < MAX_ROWS) {
          addRow(t.rows.length);
          const made = root.querySelector('[data-key="' + CSS.escape(t.rows[t.rows.length - 1].id + ':' + col.id) + '"]');
          if (made) made.focus();
        }
      });
      arrows(i, row, col);
      return i;
    };
    switch (col.type) {
      case 'text': {
        if (col.wrap) {
          const ta = el('textarea', 'nt-cell nt-cell-wrap');
          ta.rows = 1;
          ta.maxLength = 2000;
          ta.dataset.key = key;
          ta.value = v || '';
          ta.setAttribute('aria-label', (col.name || 'Cell') + ', row ' + (ri + 1));
          const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
          ta.addEventListener('input', () => { fit(); setValue(row, col, ta.value, false); });
          requestAnimationFrame(fit);
          td.append(ta);
          break;
        }
        const i = field('text');
        i.maxLength = 2000;
        i.value = v || '';
        i.addEventListener('input', () => setValue(row, col, i.value, false));
        td.append(i);
        break;
      }
      case 'number':
      case 'percent': {
        const i = field('number');
        i.step = 'any';
        if (col.type === 'percent') { i.min = 0; i.max = 100; }
        i.value = v === undefined ? '' : String(v);
        i.addEventListener('input', () => {
          let n = i.value === '' ? undefined : Number(i.value);
          if (col.type === 'percent' && n !== undefined) n = Math.min(100, Math.max(0, n));
          setValue(row, col, n, false);
        });
        td.append(i);
        if (col.type === 'percent') td.append(el('span', 'nt-unit', '%'));
        break;
      }
      case 'progress': {
        const wrap = el('div', 'nt-prog');
        const bar = el('div', 'progress nt-prog-bar');
        bar.setAttribute('role', 'slider');
        bar.tabIndex = 0;
        bar.dataset.key = key;
        bar.setAttribute('aria-label', (col.name || 'Progress') + ', row ' + (ri + 1));
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        const fill = el('i');
        const num = el('span', 'nt-prog-num');
        const show = (n) => {
          fill.style.setProperty('--p', (n || 0) + '%');
          num.textContent = (n || 0) + '%';
          bar.setAttribute('aria-valuenow', String(n || 0));
        };
        show(v);
        // Click or drag along the bar, snapping to 5%.
        const at = (e) => {
          const r = bar.getBoundingClientRect();
          return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 20) * 5;
        };
        bar.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          bar.focus();
          const move = (ev) => { const n = at(ev); show(n); row.cells[col.id] = n; refreshTotals(); };
          const up = (ev) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            setValue(row, col, at(ev) || undefined, true);
          };
          move(e);
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        bar.addEventListener('keydown', (e) => {
          const cur = row.cells[col.id] || 0;
          const step = e.shiftKey ? 25 : 5;
          let n = null;
          if (e.key === 'ArrowRight') n = Math.min(100, cur + step);
          else if (e.key === 'ArrowLeft') n = Math.max(0, cur - step);
          else if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = 100;
          if (n === null) return;
          e.preventDefault();
          show(n);
          setValue(row, col, n || undefined, false);
        });
        arrows(bar, row, col);
        bar.append(fill);
        wrap.append(bar, num);
        td.append(wrap);
        break;
      }
      case 'check': {
        const b = tickButton(v === true, (v ? 'Untick ' : 'Tick ') + (col.name || 'box') + ', row ' + (ri + 1), (d) => {
          setValue(row, col, d ? true : undefined, true);
          draw();
        });
        b.dataset.key = key;
        td.append(b);
        break;
      }
      case 'select': {
        const s = el('select', 'nt-cell nt-select');
        s.dataset.key = key;
        s.setAttribute('aria-label', (col.name || 'Select') + ', row ' + (ri + 1));
        const none = el('option', null, '—');
        none.value = '';
        s.append(none);
        col.options.forEach((o) => {
          const opt = el('option', null, o);
          opt.value = o;
          s.append(opt);
        });
        s.value = v || '';
        s.addEventListener('change', () => setValue(row, col, s.value || undefined, true));
        td.append(s);
        break;
      }
      case 'status': {
        // A coloured pill; a click opens the options, grouped by to do / doing / done.
        const b = el('button', 'nt-pill nt-group-' + (v === undefined ? 'none' : groupOf(col, v)), v === undefined ? '—' : v);
        b.type = 'button';
        b.dataset.key = key;
        b.setAttribute('aria-label', (col.name || 'Status') + ', row ' + (ri + 1) + ': ' + (v === undefined ? 'none' : v));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          menuAt(b, [
            { label: 'None', checked: v === undefined, onClick: () => { setValue(row, col, undefined, true); draw(); } },
            ...col.options.map(o => ({ label: o, checked: v === o, onClick: () => { setValue(row, col, o, true); draw(); } })),
            { separator: true },
            { label: 'Edit options…', onClick: () => editOptions(col) },
          ]);
        });
        arrows(b, row, col);
        td.append(b);
        break;
      }
      case 'multiselect': {
        const wrap = el('div', 'nt-chips');
        const list = Array.isArray(v) ? v : [];
        for (const o of list) wrap.append(el('span', 'nt-chip-opt', o));
        const add = el('button', 'nt-chip-add', list.length ? '+' : 'Pick…');
        add.type = 'button';
        add.dataset.key = key;
        add.setAttribute('aria-label', (col.name || 'Multi-select') + ', row ' + (ri + 1));
        add.addEventListener('click', (e) => {
          e.stopPropagation();
          menuAt(add, [
            ...col.options.map(o => ({ label: o, checked: list.includes(o), onClick: () => {
              const next = list.includes(o) ? list.filter(x => x !== o) : [...list, o];
              setValue(row, col, next, true);
              draw();
            } })),
            { separator: true },
            { label: 'New option…', disabled: col.options.length >= 20, onClick: async () => {
              const r = await formDialog({ title: 'New option', okLabel: 'Add', fields: [{ key: 'name', label: 'Name', maxLength: 40 }],
                validate: (x) => (!x.name.trim() ? 'Give it a name.' : col.options.includes(x.name.trim()) ? 'That option exists.' : '') });
              if (!r) return;
              pre();
              col.options.push(r.name.trim());
              setValue(row, col, [...list, r.name.trim()], true);
              draw();
            } },
          ]);
        });
        wrap.append(add);
        td.append(wrap);
        break;
      }
      case 'date': {
        const i = field('date');
        i.value = v || '';
        i.addEventListener('change', () => setValue(row, col, i.value || undefined, true));
        td.append(i);
        break;
      }
      case 'url': {
        const wrap = el('div', 'nt-url');
        const i = field('text');
        i.maxLength = 2000;
        i.value = v || '';
        i.placeholder = 'https://';
        const open = el('button', 'nt-url-open', '↗');
        open.type = 'button';
        open.title = 'Open the link (https only)';
        open.setAttribute('aria-label', 'Open link');
        const sync = () => {
          const ok = HTTP.test(i.value.trim());
          i.classList.toggle('invalid', !!i.value.trim() && !ok);
          open.disabled = !(ok && /^https:/i.test(i.value.trim()));
          return ok;
        };
        i.addEventListener('input', () => { const ok = sync(); setValue(row, col, ok ? i.value.trim() : undefined, false); });
        i.addEventListener('click', (e) => { if ((e.ctrlKey || e.metaKey) && !open.disabled) window.open(i.value.trim()); });
        open.addEventListener('click', () => window.open(i.value.trim()));
        sync();
        wrap.append(i, open);
        td.append(wrap);
        break;
      }
      default: break;
    }
    td.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtx(e, [...rowItems(row, t.rows.indexOf(row)), ...columnItems(col, t.columns.indexOf(col)), { separator: true }, ...tableItems(), ...(extraMenu ? extraMenu() : [])]);
      e.stopPropagation();
    });
    return td;
  }

  // ─── Structure ───

  function addRow(at) {
    if (t.rows.length >= MAX_ROWS) return;
    structural(() => { t.rows.splice(at, 0, blankRow()); });
  }

  function addCol(at) {
    if (t.columns.length >= MAX_COLS) return;
    const col = { id: newKey(), name: '', type: 'text', options: [] };
    structural(() => { t.columns.splice(at, 0, col); });
    const name = root.querySelector('[data-key="h:' + col.id + '"]');
    if (name) name.focus();
  }

  function moveCol(i, d) { structural(() => { const [c] = t.columns.splice(i, 1); t.columns.splice(i + d, 0, c); }); }
  function moveRow(i, d) { structural(() => { const [r] = t.rows.splice(i, 1); t.rows.splice(i + d, 0, r); }); }

  function setType(col, type) {
    if (col.type === type) return;
    structural(() => {
      if ((type === 'select' || type === 'status' || type === 'multiselect') && !col.options.length) col.options = [...STATUS];
      if (type === 'status') col.groups = col.options.map((_, i) => (i === 0 ? 'todo' : i === col.options.length - 1 ? 'done' : 'doing'));
      for (const r of t.rows) {
        const nv = convert(r.cells[col.id], col.type, type, col);
        if (nv === undefined) delete r.cells[col.id]; else r.cells[col.id] = nv;
      }
      if (type !== 'status') delete col.groups;
      col.type = type;
      if (t.sort && t.sort.col === col.id) t.sort = null;
    });
  }

  // Dragging the edge of a header: the width is live, saved when it is let go.
  function resizeColumn(e, col, th) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    pre();
    const move = (m) => {
      col.width = Math.round(Math.min(600, Math.max(60, startW + m.clientX - startX)));
      th.style.width = th.style.minWidth = col.width + 'px';
      root.querySelectorAll('td.nt-td.nt-type-' + col.type).forEach(() => { /* cells follow the header's column */ });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      redraw();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // A row's handle: a click opens its menu, a drag moves it.
  function dragRow(e, handle, tr, row) {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    let dragging = false;
    let line = null;
    let target = null;
    const rowsEls = () => [...root.querySelectorAll('tbody tr')];
    const move = (m) => {
      if (!dragging && Math.abs(m.clientY - startY) > 4) {
        dragging = true;
        tr.classList.add('dragging');
        line = el('div', 'nt-dropline');
        root.append(line);
      }
      if (!dragging) return;
      const els = rowsEls().filter(r => r !== tr);
      target = els.find(r => m.clientY < r.getBoundingClientRect().top + r.getBoundingClientRect().height / 2) || null;
      const box = root.getBoundingClientRect();
      const y = target ? target.getBoundingClientRect().top : (els.length ? els[els.length - 1].getBoundingClientRect().bottom : box.top);
      line.style.top = (y - box.top) + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!dragging) { menuAt(handle, rowItems(row, t.rows.indexOf(row))); return; }
      tr.classList.remove('dragging');
      line.remove();
      const to = target ? t.rows.findIndex(r => r.id === target.dataset.row) : t.rows.length;
      const from = t.rows.indexOf(row);
      if (to === from || to === from + 1) return;
      structural(() => { t.rows.splice(from, 1); t.rows.splice(to > from ? to - 1 : to, 0, row); });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // Options are edited in place: one per line, in order. For a status the line's
  // group follows its position: the first is to do, the last is done, the rest doing.
  function editOptions(col) {
    const th = root.querySelector('[data-key="h:' + col.id + '"]');
    const host = th ? th.closest('th') : root;
    const box = el('div', 'nt-options win');
    const help = el('p', 'nt-options-help', col.type === 'status'
      ? 'One option per line. The first is "to do", the last is "done".' : 'One option per line.');
    const ta = el('textarea', 'nt-options-text');
    ta.rows = Math.max(3, col.options.length + 1);
    ta.value = col.options.join('\n');
    const ok = el('button', 'primary', 'Save');
    ok.type = 'button';
    const done = () => {
      const opts = [...new Set(ta.value.split('\n').map(s => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
      pre();
      col.options = opts.length ? opts : [...STATUS];
      if (col.type === 'status') col.groups = col.options.map((_, i) => (i === 0 ? 'todo' : i === col.options.length - 1 ? 'done' : 'doing'));
      for (const r of t.rows) {
        const cv = r.cells[col.id];
        if (Array.isArray(cv)) { const k = cv.filter(x => col.options.includes(x)); if (k.length) r.cells[col.id] = k; else delete r.cells[col.id]; }
        else if (cv !== undefined && !col.options.includes(cv)) delete r.cells[col.id];
      }
      box.remove();
      redraw();
    };
    ok.addEventListener('click', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); box.remove(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); }
    });
    box.append(help, ta, ok);
    host.append(box);
    ta.focus();
  }

  draw();
  return root;
}

// Exported for tests: the rows a table shows once sorted and filtered.
export { viewRows };
void STATUS_GROUPS;
