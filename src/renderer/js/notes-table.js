// Tables inside a Notes page, Notion-style: typed columns (text, number,
// percent, progress, checkbox, select, date), rows you add and reorder, and a
// summary row that totals each column.
//
// This module only draws a table and edits a working copy of it. notes.js owns
// where the table sits in the page and when it is saved: every change calls
// `onChange(table, immediate)`, typing on a debounce, structure at once.
// Values are written with textContent and into form fields, never as markup.
// Main re-validates the whole table on save (schema.js parseTable).

import { showCtx } from './views.js';
import { tickButton } from './todo.js';
import { confirmDialog } from './dialog.js';

export const COL_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'percent', label: 'Percent' },
  { id: 'progress', label: 'Progress bar' },
  { id: 'check', label: 'Checkbox' },
  { id: 'select', label: 'Status / select' },
  { id: 'date', label: 'Date' },
];
const MAX_COLS = 20;
const MAX_ROWS = 500;
const STATUS = ['Not started', 'In progress', 'Done'];

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

const blankRow = () => ({ id: newKey(), cells: {} });

// Starting points offered by "+ Table".
export const TEMPLATES = [
  { id: 'blank', label: 'Blank table', make: () => ({
    columns: [{ id: newKey(), name: 'Name', type: 'text', options: [] },
              { id: newKey(), name: 'Notes', type: 'text', options: [] }] }) },
  { id: 'tracker', label: 'Progress tracker', make: () => ({
    columns: [{ id: newKey(), name: 'Topic', type: 'text', options: [] },
              { id: newKey(), name: 'Status', type: 'select', options: [...STATUS] },
              { id: newKey(), name: 'Progress', type: 'progress', options: [] },
              { id: newKey(), name: 'Done', type: 'check', options: [] }] }) },
  { id: 'grades', label: 'Scores / grades', make: () => ({
    columns: [{ id: newKey(), name: 'Subject', type: 'text', options: [] },
              { id: newKey(), name: 'Score', type: 'number', options: [] },
              { id: newKey(), name: 'Percent', type: 'percent', options: [] },
              { id: newKey(), name: 'Date', type: 'date', options: [] }] }) },
];

export function makeTable(templateId = 'blank') {
  const t = (TEMPLATES.find(x => x.id === templateId) || TEMPLATES[0]).make();
  return { id: newKey(), title: '', columns: t.columns, rows: [blankRow(), blankRow(), blankRow()] };
}

// A menu under a button, through the shared context menu.
function menuAt(button, items) {
  const r = button.getBoundingClientRect();
  showCtx({ clientX: r.left, clientY: r.bottom + 2 }, items);
}

// Converts a value when a column changes type, so filled cells survive where
// they reasonably can (a "45" text becomes 45, a checked box becomes 100%).
function convert(v, from, to, options) {
  if (v === undefined || v === null || from === to) return v;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : v === true ? 100 : NaN;
  switch (to) {
    case 'text': return v === true ? 'Yes' : String(v);
    case 'number': return Number.isFinite(n) ? n : undefined;
    case 'percent': case 'progress': return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
    case 'check': return v === true || n >= 100 || /^(y|yes|done|true|x)$/i.test(String(v)) ? true : undefined;
    case 'select': return typeof v === 'string' && options.includes(v) ? v : undefined;
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    default: return undefined;
  }
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, '');
}

// The footer line for one column.
function summary(col, rows) {
  const vals = rows.map(r => r.cells[col.id]).filter(v => v !== undefined && v !== null && v !== '');
  switch (col.type) {
    case 'number': return vals.length ? 'Sum ' + fmt(vals.reduce((a, b) => a + b, 0)) : '';
    case 'percent':
    case 'progress': return vals.length ? 'Avg ' + fmt(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '';
    case 'check': return rows.length ? vals.length + ' / ' + rows.length + ' done' : '';
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
// last status option. Null when the table has nothing to measure.
export function tableProgress(t) {
  if (!t.rows.length) return null;
  const check = t.columns.find(c => c.type === 'check');
  if (check) return t.rows.filter(r => r.cells[check.id] === true).length / t.rows.length;
  const prog = t.columns.find(c => c.type === 'progress' || c.type === 'percent');
  if (prog) return t.rows.reduce((a, r) => a + (r.cells[prog.id] || 0), 0) / (100 * t.rows.length);
  const sel = t.columns.find(c => c.type === 'select' && c.options.length);
  if (sel) return t.rows.filter(r => r.cells[sel.id] === sel.options[sel.options.length - 1]).length / t.rows.length;
  return null;
}

// Builds one table. `t` is mutated in place; `onChange(t, immediate)` is told
// after every edit. Returns the root element.
export function buildTable(t, { onChange, onDelete }) {
  const root = el('div', 'nt-table');
  root.dataset.table = t.id;

  const changed = (immediate) => { onChange(t, immediate); };
  const redraw = () => { draw(); changed(true); };

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
    title.addEventListener('input', () => { t.title = title.value; changed(false); });
    const prog = tableProgress(t);
    head.append(title);
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
    more.addEventListener('click', () => menuAt(more, [
      { label: 'Add row', onClick: () => addRow(t.rows.length) },
      { label: 'Add column', onClick: () => addCol(t.columns.length) },
      { label: 'Clear empty rows', onClick: () => {
        t.rows = t.rows.filter(r => Object.keys(r.cells).length);
        redraw();
      } },
      { label: 'Delete table', onClick: async () => {
        const sure = await confirmDialog({ title: 'Delete table',
          message: 'Delete "' + (t.title || 'Untitled table') + '" and its ' + t.rows.length + ' rows?', okLabel: 'Delete', danger: true });
        if (sure) onDelete();
      } },
    ]));
    head.append(more);
    root.append(head);

    const scroll = el('div', 'nt-table-scroll');
    const table = el('table', 'nt-grid');

    // Header: one button per column, a menu on each.
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', 'nt-grip-cell'));
    t.columns.forEach((col, ci) => {
      const th = el('th', 'nt-th nt-type-' + col.type);
      const name = el('input', 'nt-th-name');
      name.type = 'text';
      name.maxLength = 40;
      name.value = col.name;
      name.placeholder = 'Column';
      name.dataset.key = 'h:' + col.id;
      name.setAttribute('aria-label', 'Column name');
      name.addEventListener('input', () => { col.name = name.value; changed(false); });
      const menu = el('button', 'nt-th-menu', '▾');
      menu.type = 'button';
      menu.title = 'Column type and options';
      menu.setAttribute('aria-label', 'Options for column ' + (col.name || ci + 1));
      menu.addEventListener('click', () => menuAt(menu, [
        ...COL_TYPES.map(ty => ({ label: (ty.id === col.type ? '● ' : '   ') + ty.label, onClick: () => setType(col, ty.id) })),
        ...(col.type === 'select' ? [{ label: 'Edit options…', onClick: () => editOptions(col, th) }] : []),
        { label: 'Insert column left', onClick: () => addCol(ci) },
        { label: 'Insert column right', onClick: () => addCol(ci + 1) },
        ...(ci > 0 ? [{ label: 'Move left', onClick: () => moveCol(ci, -1) }] : []),
        ...(ci < t.columns.length - 1 ? [{ label: 'Move right', onClick: () => moveCol(ci, 1) }] : []),
        ...(t.columns.length > 1 ? [{ label: 'Delete column', onClick: () => {
          t.columns.splice(ci, 1);
          for (const r of t.rows) delete r.cells[col.id];
          redraw();
        } }] : []),
      ]));
      th.append(name, menu);
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
    t.rows.forEach((row, ri) => {
      const tr = el('tr');
      const grip = el('td', 'nt-grip-cell');
      const gb = el('button', 'nt-row-menu', '⋮');
      gb.type = 'button';
      gb.title = 'Row options';
      gb.setAttribute('aria-label', 'Options for row ' + (ri + 1));
      gb.addEventListener('click', () => menuAt(gb, [
        { label: 'Insert row above', onClick: () => addRow(ri) },
        { label: 'Insert row below', onClick: () => addRow(ri + 1) },
        { label: 'Duplicate row', onClick: () => {
          if (t.rows.length >= MAX_ROWS) return;
          t.rows.splice(ri + 1, 0, { id: newKey(), cells: structuredClone(row.cells) });
          redraw();
        } },
        ...(ri > 0 ? [{ label: 'Move up', onClick: () => moveRow(ri, -1) }] : []),
        ...(ri < t.rows.length - 1 ? [{ label: 'Move down', onClick: () => moveRow(ri, 1) }] : []),
        { label: 'Delete row', onClick: () => { t.rows.splice(ri, 1); redraw(); } },
      ]));
      grip.append(gb);
      tr.append(grip);
      for (const col of t.columns) tr.append(cell(row, col, ri));
      tr.append(el('td', 'nt-td-pad'));
      tbody.append(tr);
    });

    const tfoot = el('tfoot');
    const fr = el('tr');
    const addCell = el('td', 'nt-grip-cell');
    fr.append(addCell);
    for (const col of t.columns) fr.append(el('td', 'nt-sum', summary(col, t.rows)));
    fr.append(el('td', 'nt-td-pad'));
    tfoot.append(fr);

    table.append(thead, tbody, tfoot);
    scroll.append(table);
    root.append(scroll);

    if (t.rows.length < MAX_ROWS) {
      const newRow = el('button', 'nt-table-newrow', '+ New row');
      newRow.type = 'button';
      newRow.addEventListener('click', () => {
        addRow(t.rows.length);
        const last = root.querySelector('tbody tr:last-child input, tbody tr:last-child select');
        if (last) last.focus();
      });
      root.append(newRow);
    }

    if (focusKey) {
      const again = root.querySelector('[data-key="' + CSS.escape(focusKey) + '"]');
      if (again) again.focus();
    }
  }

  // Refreshes only the footer and progress after a value edit, so the field
  // being typed in is never rebuilt under the caret.
  function refreshTotals() {
    const sums = root.querySelectorAll('tfoot .nt-sum');
    t.columns.forEach((col, i) => { if (sums[i]) sums[i].textContent = summary(col, t.rows); });
    const prog = tableProgress(t);
    const fill = root.querySelector('.nt-table-progress > i');
    const pct = root.querySelector('.nt-table-pct');
    if (prog === null || !fill) { if ((prog === null) !== !fill) draw(); return; }
    fill.style.setProperty('--p', Math.round(prog * 100) + '%');
    pct.textContent = Math.round(prog * 100) + '%';
  }

  function setValue(row, col, v, immediate) {
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) delete row.cells[col.id];
    else row.cells[col.id] = v;
    refreshTotals();
    changed(immediate);
  }

  function cell(row, col, ri) {
    const td = el('td', 'nt-td nt-type-' + col.type);
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
        const next = root.querySelector('[data-key="' + CSS.escape((t.rows[ri + 1] || {}).id + ':' + col.id) + '"]');
        if (next) next.focus();
        else if (t.rows.length < MAX_ROWS) {
          addRow(t.rows.length);
          const made = root.querySelector('[data-key="' + CSS.escape(t.rows[t.rows.length - 1].id + ':' + col.id) + '"]');
          if (made) made.focus();
        }
      });
      return i;
    };
    switch (col.type) {
      case 'text': {
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
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') n = Math.min(100, cur + step);
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') n = Math.max(0, cur - step);
          else if (e.key === 'Home') n = 0;
          else if (e.key === 'End') n = 100;
          if (n === null) return;
          e.preventDefault();
          show(n);
          setValue(row, col, n || undefined, false);
        });
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
        s.setAttribute('aria-label', (col.name || 'Status') + ', row ' + (ri + 1));
        const none = el('option', null, '—');
        none.value = '';
        s.append(none);
        col.options.forEach((o, oi) => {
          const opt = el('option', null, o);
          opt.value = o;
          s.append(opt);
          if (o === v) s.dataset.step = String(oi === col.options.length - 1 ? 'last' : oi === 0 ? 'first' : 'mid');
        });
        s.value = v || '';
        s.addEventListener('change', () => {
          const oi = col.options.indexOf(s.value);
          s.dataset.step = oi === -1 ? '' : oi === col.options.length - 1 ? 'last' : oi === 0 ? 'first' : 'mid';
          setValue(row, col, s.value || undefined, true);
        });
        td.append(s);
        break;
      }
      case 'date': {
        const i = field('date');
        i.value = v || '';
        i.addEventListener('change', () => setValue(row, col, i.value || undefined, true));
        td.append(i);
        break;
      }
    }
    return td;
  }

  function addRow(at) {
    if (t.rows.length >= MAX_ROWS) return;
    t.rows.splice(at, 0, blankRow());
    redraw();
  }

  function addCol(at) {
    if (t.columns.length >= MAX_COLS) return;
    const col = { id: newKey(), name: '', type: 'text', options: [] };
    t.columns.splice(at, 0, col);
    redraw();
    const name = root.querySelector('[data-key="h:' + col.id + '"]');
    if (name) name.focus();
  }

  function moveCol(i, d) {
    const [c] = t.columns.splice(i, 1);
    t.columns.splice(i + d, 0, c);
    redraw();
  }

  function moveRow(i, d) {
    const [r] = t.rows.splice(i, 1);
    t.rows.splice(i + d, 0, r);
    redraw();
  }

  function setType(col, type) {
    if (col.type === type) return;
    if (type === 'select' && !col.options.length) col.options = [...STATUS];
    for (const r of t.rows) {
      const nv = convert(r.cells[col.id], col.type, type, col.options);
      if (nv === undefined) delete r.cells[col.id]; else r.cells[col.id] = nv;
    }
    col.type = type;
    redraw();
  }

  // Options are edited in place: one per line, in order. The last option
  // counts as "finished" for the summary and the table's progress.
  function editOptions(col, th) {
    const box = el('div', 'nt-options win');
    const help = el('p', 'nt-options-help', 'One option per line. The last one means finished.');
    const ta = el('textarea', 'nt-options-text');
    ta.rows = Math.max(3, col.options.length + 1);
    ta.value = col.options.join('\n');
    const ok = el('button', 'primary', 'Save');
    ok.type = 'button';
    const done = () => {
      const opts = [...new Set(ta.value.split('\n').map(s => s.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
      col.options = opts.length ? opts : [...STATUS];
      for (const r of t.rows) if (r.cells[col.id] !== undefined && !col.options.includes(r.cells[col.id])) delete r.cells[col.id];
      box.remove();
      redraw();
    };
    ok.addEventListener('click', done);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); box.remove(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); }
    });
    box.append(help, ta, ok);
    th.append(box);
    ta.focus();
  }

  draw();
  return root;
}
