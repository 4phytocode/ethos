// Find and replace in the open note (Ctrl+F, Ctrl+H).
//
// Matches in text blocks, image captions, code and bookmark titles are marked
// with the CSS Custom Highlight API, which paints ranges without touching the
// page. Matches inside table cells cannot be painted that way, so they are
// counted and stepping to one focuses its cell. Replacing edits the model (or
// the field) and is one step of undo; "Replace all" is one step in total.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { positionAt } from './dom.js';

let bar = null;
let inp = null;
let rep = null;
let count = null;
let caseBtn = null;
let repRow = null;
let items = [];
let current = -1;
let caseSensitive = false;
let timer = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const hasHighlights = () => typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';

function indexes(hay, needle) {
  const out = [];
  if (!needle) return out;
  const h = caseSensitive ? hay : hay.toLowerCase();
  const n = caseSensitive ? needle : needle.toLowerCase();
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + n.length)) out.push(i);
  return out;
}

// Every match, in page order.
function collect(query) {
  const out = [];
  for (const b of S.blocks) {
    const root = ops.blockEl(b.id);
    if (!root) continue;
    if (M.isText(b.type)) {
      for (const i of indexes(M.flat(b.spans), query)) out.push({ kind: 'text', id: b.id, from: i, to: i + query.length });
    } else if (b.type === 'code') {
      for (const i of indexes(b.text, query)) out.push({ kind: 'code', id: b.id, from: i, to: i + query.length });
    } else if (b.type === 'image') {
      for (const i of indexes(M.textOf(b.caption || []), query)) out.push({ kind: 'cap', id: b.id, from: i, to: i + query.length });
    } else if (b.type === 'bookmark') {
      for (const i of indexes(b.title, query)) out.push({ kind: 'bm', id: b.id, from: i, to: i + query.length });
    } else if (b.type === 'table') {
      const t = S.tables.find(x => x.id === b.table);
      if (!t) continue;
      for (const r of t.rows) for (const c of t.columns) {
        const v = r.cells[c.id];
        if (typeof v === 'string') for (const i of indexes(v, query)) out.push({ kind: 'cell', id: b.id, row: r.id, col: c.id, from: i, to: i + query.length });
      }
    }
  }
  return out;
}

function rangeFor(it) {
  const root = ops.blockEl(it.id);
  if (!root) return null;
  let host = null;
  if (it.kind === 'text') host = ops.textEl(it.id);
  else if (it.kind === 'cap') host = root.querySelector('.img-cap');
  else if (it.kind === 'code') host = root.querySelector('.code-hl');
  if (!host) return null;
  const r = document.createRange();
  if (it.kind === 'text' || it.kind === 'cap') {
    const a = positionAt(host, it.from);
    const z = positionAt(host, it.to);
    r.setStart(a.node, a.offset);
    r.setEnd(z.node, z.offset);
    return r;
  }
  // The code layer is plain text nodes inside token spans.
  let n = 0;
  let start = null;
  let end = null;
  const walk = (node) => {
    if (end) return;
    if (node.nodeType === 3) {
      const len = node.nodeValue.length;
      if (!start && it.from <= n + len) start = { node, offset: it.from - n };
      if (start && it.to <= n + len) { end = { node, offset: it.to - n }; return; }
      n += len;
      return;
    }
    for (const c of node.childNodes) walk(c);
  };
  walk(host);
  if (!start || !end) return null;
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset);
  return r;
}

function paint() {
  if (hasHighlights()) {
    const ranges = items.map(rangeFor);
    CSS.highlights.set('find', new Highlight(...ranges.filter((r, i) => r && i !== current)));
    if (current >= 0 && ranges[current]) CSS.highlights.set('find-current', new Highlight(ranges[current]));
    else CSS.highlights.delete('find-current');
  }
  count.textContent = items.length ? (current + 1) + ' of ' + items.length : (inp.value ? 'No matches' : '');
}

function clearPaint() {
  if (hasHighlights()) { CSS.highlights.delete('find'); CSS.highlights.delete('find-current'); }
}

function go(i, { focus = false } = {}) {
  if (!items.length) { current = -1; paint(); return; }
  current = (i + items.length) % items.length;
  paint();
  const it = items[current];
  const root = ops.blockEl(it.id);
  if (root) root.scrollIntoView({ block: 'center' });
  if (it.kind === 'cell') {
    const cell = root && root.querySelector('[data-key="' + CSS.escape(it.row + ':' + it.col) + '"]');
    if (cell && focus) cell.focus();
  } else if (focus && it.kind === 'text') ops.setSelection(it.id, it.from, it.to);
}

function search(keepIndex = false) {
  const q = inp.value;
  items = q ? collect(q) : [];
  if (!keepIndex || current >= items.length) current = items.length ? 0 : -1;
  if (!items.length) current = -1;
  paint();
  if (current >= 0 && !keepIndex) go(current);
}

// ─── Replace ───

function replaceItem(it, text) {
  const b = ops.block(it.id);
  if (it.kind === 'text') {
    const look = M.marksAt(b.spans, it.from + 1);
    let spans = M.deleteRange(b.spans, it.from, it.to);
    spans = M.insertText(spans, it.from, text, look);
    b.spans = spans;
    ops.refreshText(it.id);
  } else if (it.kind === 'code') {
    b.text = b.text.slice(0, it.from) + text + b.text.slice(it.to);
    const ta = ops.blockEl(it.id).querySelector('.code-in');
    ta.value = b.text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (it.kind === 'cap') {
    const plain = M.textOf(b.caption || []);
    b.caption = M.spansFrom(plain.slice(0, it.from) + text + plain.slice(it.to));
    ops.rebuildBlock(it.id);
  } else if (it.kind === 'bm') {
    b.title = b.title.slice(0, it.from) + text + b.title.slice(it.to);
    ops.rebuildBlock(it.id);
  } else if (it.kind === 'cell') {
    const t = S.tables.find(x => x.id === b.table);
    const row = t && t.rows.find(r => r.id === it.row);
    if (row) { const v = row.cells[it.col]; row.cells[it.col] = v.slice(0, it.from) + text + v.slice(it.to); ops.rebuildBlock(it.id); }
  }
}

function replaceOne() {
  if (current < 0 || !items.length) return;
  ops.snapshot();
  replaceItem(items[current], rep.value);
  changed();
  const keep = current;
  search(true);
  go(Math.min(keep, items.length - 1));
}

function replaceAll() {
  if (!items.length) return;
  ops.snapshot();
  const n = items.length;
  // Last to first, so earlier offsets stay right within a block.
  for (const it of [...items].reverse()) replaceItem(it, rep.value);
  changed();
  search();
  S.hooks.notify('Replaced', n + (n === 1 ? ' match' : ' matches'));
}

// ─── The bar ───

export function open(withReplace = false) {
  if (!bar) return;
  bar.hidden = false;
  repRow.hidden = !withReplace;
  bar.classList.toggle('with-replace', withReplace);
  const s = ops.selection();
  if (s && !s.collapsed && s.a.id === s.f.id) {
    const b = ops.block(s.id);
    const word = M.textOf(M.slice(b.spans, s.start.off, s.end.off));
    if (word && !word.includes('\n')) inp.value = word.slice(0, 100);
  }
  inp.focus();
  inp.select();
  search();
}

export function close() {
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  items = [];
  current = -1;
  clearPaint();
}

export function refreshIfOpen() {
  if (!bar || bar.hidden) return;
  clearTimeout(timer);
  timer = setTimeout(() => search(true), 150);
}

export function mount(container, before) {
  bar = el('div', 'ed-find');
  bar.hidden = true;
  bar.setAttribute('role', 'search');
  const row = el('div', 'find-row');
  const toggle = el('button', 'find-btn', '▸');
  toggle.type = 'button';
  toggle.title = 'Replace';
  toggle.setAttribute('aria-label', 'Show replace');
  inp = el('input', 'find-input');
  inp.type = 'text';
  inp.placeholder = 'Find';
  inp.setAttribute('aria-label', 'Find in this note');
  count = el('span', 'find-count');
  const prev = el('button', 'find-btn', '↑');
  prev.type = 'button'; prev.title = 'Previous (Shift+Enter)'; prev.setAttribute('aria-label', 'Previous match');
  const next = el('button', 'find-btn', '↓');
  next.type = 'button'; next.title = 'Next (Enter)'; next.setAttribute('aria-label', 'Next match');
  caseBtn = el('button', 'find-btn', 'Aa');
  caseBtn.type = 'button'; caseBtn.title = 'Match case'; caseBtn.setAttribute('aria-pressed', 'false'); caseBtn.setAttribute('aria-label', 'Match case');
  const x = el('button', 'find-btn', '×');
  x.type = 'button'; x.title = 'Close (Esc)'; x.setAttribute('aria-label', 'Close find');
  row.append(toggle, inp, count, prev, next, caseBtn, x);
  repRow = el('div', 'find-row find-rep');
  repRow.hidden = true;
  rep = el('input', 'find-input');
  rep.type = 'text';
  rep.placeholder = 'Replace with';
  rep.setAttribute('aria-label', 'Replace with');
  const one = el('button', 'find-btn find-wide', 'Replace');
  one.type = 'button';
  const all = el('button', 'find-btn find-wide', 'Replace all');
  all.type = 'button';
  repRow.append(rep, one, all);
  bar.append(row, repRow);
  container.insertBefore(bar, before);

  inp.addEventListener('input', () => search());
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); go(current + (e.shiftKey ? -1 : 1), { focus: false }); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); const id = S.lastId && ops.block(S.lastId) ? S.lastId : null; if (id) ops.focusBlock(id); }
  });
  rep.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  prev.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () => go(current + 1));
  caseBtn.addEventListener('click', () => { caseSensitive = !caseSensitive; caseBtn.setAttribute('aria-pressed', String(caseSensitive)); search(); });
  toggle.addEventListener('click', () => { repRow.hidden = !repRow.hidden; bar.classList.toggle('with-replace', !repRow.hidden); });
  x.addEventListener('click', close);
  one.addEventListener('click', replaceOne);
  all.addEventListener('click', replaceAll);
  S.hooks.find = open;
  S.after.push(() => { if (bar && !bar.hidden && hasHighlights()) { items = items.filter(it => ops.blockEl(it.id)); paint(); } });
}
