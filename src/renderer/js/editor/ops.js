// Everything that changes the page: blocks added, removed, moved, retyped,
// split and joined; formatting applied; undo and redo. The model (S.blocks) is
// changed first and the page is brought in line with it, except typing, which
// the browser does and readBlock() copies back.
//
// A block's text element is rebuilt only when a command changed it; typing never
// rebuilds anything, so the caret is never disturbed.

import { S, changed } from './state.js';
import * as M from './model.js';
import { buildTextBlock, applyAttrs, renderSpans, readSpans, offsetOf, positionAt } from './dom.js';

export const indexOf = (id) => S.blocks.findIndex(b => b.id === id);
export const block = (id) => S.blocks.find(b => b.id === id) || null;
export const blockEl = (id) => S.els.get(id) || null;
export const textEl = (id) => { const e = S.els.get(id); return e ? e.querySelector('.eb-text') : null; };

// ─── Page in step with the model ───

function build(b) {
  if (M.isText(b.type)) return buildTextBlock(b);
  const fn = S.builders[b.type];
  if (fn) return fn(b);
  const d = document.createElement('div');
  d.className = 'eb eb-unknown';
  d.dataset.id = b.id;
  return d;
}

export function syncDOM() {
  const host = S.host;
  if (!host) return;
  const keep = new Set(S.blocks.map(b => b.id));
  for (const [id, el] of S.els) if (!keep.has(id)) { el.remove(); S.els.delete(id); }
  S.blocks.forEach((b, i) => {
    let el = S.els.get(b.id);
    if (!el) { el = build(b); S.els.set(b.id, el); }
    if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
  });
  decorate();
  for (const fn of S.after) fn();
}

// Numbers, bullets, indent, toggles: what depends on the neighbours.
export function decorate() {
  const hidden = M.hiddenIds(S.blocks);
  S.blocks.forEach((b, i) => {
    const el = S.els.get(b.id);
    if (!el) return;
    applyAttrs(el, b);
    el.hidden = hidden.has(b.id);
    el.classList.toggle('selected', S.selected.has(b.id));
    const mark = el.querySelector('.eb-mark');
    if (mark && b.type === 'number') mark.textContent = M.numberLabel(M.numberOf(S.blocks, i), b.indent);
    else if (mark && b.type === 'bullet') mark.textContent = M.BULLETS[b.indent % 3];
    if (b.type === 'toggle') {
      const next = S.blocks[i + 1];
      el.classList.toggle('has-kids', !!next && next.indent > b.indent);
    }
  });
  let n = 0;
  S.host.querySelectorAll('.eb-text .fn').forEach((f) => { n += 1; f.dataset.n = String(n); });
}

// Replaces one block's element, e.g. after its type changed.
export function rebuildBlock(id) {
  const b = block(id);
  const old = S.els.get(id);
  if (!b || !old) return;
  const el = build(b);
  old.replaceWith(el);
  S.els.set(id, el);
  decorate();
  for (const fn of S.after) fn();
}

// Redraws the spans of a text block in place (formatting changed them).
export function refreshText(id) {
  const b = block(id);
  const t = textEl(id);
  if (!b || !t) return;
  t.replaceChildren(renderSpans(b.spans));
  decorate();
  for (const fn of S.after) fn();
}

// Typing changed the page; copy it into the model.
export function readBlock(id) {
  const b = block(id);
  const t = textEl(id);
  if (!b || !t || !M.isText(b.type)) return;
  b.spans = readSpans(t);
}

// ─── Selection ───

function locate(node, off) {
  const el = node && (node.nodeType === 3 ? node.parentElement : node);
  const t = el && el.closest ? el.closest('.eb-text') : null;
  if (!t || !S.host.contains(t)) return null;
  return { id: t.closest('.eb').dataset.id, off: offsetOf(t, node, off), el: t };
}

// Where the caret or selection is, in blocks and offsets; null when it is
// outside the text blocks. A selection never spans blocks (each block is its own
// editing area), so start and end are in one block unless blocks are selected.
export function selection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode) return null;
  const a = locate(sel.anchorNode, sel.anchorOffset);
  const f = locate(sel.focusNode, sel.focusOffset);
  if (!a || !f) return null;
  const forward = a.id !== f.id ? indexOf(a.id) <= indexOf(f.id) : a.off <= f.off;
  const start = forward ? a : f;
  const end = forward ? f : a;
  return { a, f, start, end, id: start.id, collapsed: a.id === f.id && a.off === f.off };
}

export function setSelection(id, from, to = from) {
  const t = textEl(id);
  if (!t) return;
  t.focus({ preventScroll: true });
  const p1 = positionAt(t, from);
  const p2 = from === to ? p1 : positionAt(t, to);
  const r = document.createRange();
  r.setStart(p1.node, p1.offset);
  r.setEnd(p2.node, p2.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  S.lastId = id;
}

export function focusBlock(id, atEnd = false) {
  const b = block(id);
  if (!b) return;
  if (M.isText(b.type)) { setSelection(id, atEnd ? M.lengthOf(b.spans) : 0); const t = textEl(id); if (t) t.scrollIntoView({ block: 'nearest' }); return; }
  const code = S.els.get(id) && S.els.get(id).querySelector('.code-in');
  if (code) { code.focus(); if (atEnd) code.setSelectionRange(code.value.length, code.value.length); }
}

// The block the next inserted thing goes after.
export function currentId() {
  // A menu opened on a block (right-click, the + button) names it.
  if (S.forceId && block(S.forceId)) return S.forceId;
  const s = selection();
  if (s) return s.id;
  const ae = document.activeElement;
  const root = ae && ae.closest ? ae.closest('.eb') : null;
  if (root && S.host.contains(root)) return root.dataset.id;
  if (S.lastId && block(S.lastId)) return S.lastId;
  return S.blocks.length ? S.blocks[S.blocks.length - 1].id : null;
}

// ─── History ───

function pack() {
  const s = selection();
  return JSON.stringify({
    blocks: S.blocks, tables: S.tables,
    sel: s && s.a.id === s.f.id ? { id: s.a.id, a: s.a.off, f: s.f.off } : null,
  });
}

export function snapshot() {
  if (S.histLock) return;
  S.history.push(pack());
  if (S.history.length > 200) S.history.shift();
  S.future = [];
}

function restore(text) {
  const o = JSON.parse(text);
  S.blocks = o.blocks;
  S.tables = o.tables;
  S.selected.clear();
  for (const el of S.els.values()) el.remove();
  S.els.clear();
  syncDOM();
  if (o.sel && block(o.sel.id)) setSelection(o.sel.id, o.sel.a, o.sel.f);
}

export function undo() {
  if (!S.history.length) return false;
  S.future.push(pack());
  restore(S.history.pop());
  changed();
  return true;
}

export function redo() {
  if (!S.future.length) return false;
  S.history.push(pack());
  restore(S.future.pop());
  changed();
  return true;
}

// ─── Blocks ───

export function emptyBlocksFix() {
  if (!S.blocks.length) S.blocks.push(M.newBlock('p'));
}

export function insertBlock(index, b, { focus = true } = {}) {
  S.blocks.splice(index, 0, b);
  syncDOM();
  if (focus) focusBlock(b.id);
  changed();
  return b;
}

// After the current block; replaces it if it is an empty paragraph.
export function insertAfterCurrent(b, { focus = true } = {}) {
  const id = currentId();
  let i = id ? indexOf(id) : S.blocks.length - 1;
  snapshot();
  const cur = S.blocks[i];
  if (cur && cur.type === 'p' && !M.lengthOf(cur.spans) && !cur.indent) {
    S.blocks.splice(i, 1, b);
  } else {
    // After a toggle's contents too, so a block never lands inside the wrong one.
    S.blocks.splice(i + 1, 0, b);
  }
  syncDOM();
  if (focus) focusBlock(b.id);
  changed();
  return b;
}

// A block and what belongs to it (a toggle's contents).
export function withChildren(ids) {
  const out = new Set(ids);
  for (const id of ids) {
    const i = indexOf(id);
    if (i >= 0 && S.blocks[i].type === 'toggle') {
      const [a, z] = M.toggleRange(S.blocks, i);
      for (let k = a; k < z; k++) out.add(S.blocks[k].id);
    }
  }
  return [...out];
}

export function removeBlocks(ids, { snap = true } = {}) {
  const set = new Set(ids);
  if (!set.size) return;
  if (snap) snapshot();
  const first = Math.min(...[...set].map(indexOf).filter(i => i >= 0));
  const gone = S.blocks.filter(b => set.has(b.id));
  S.blocks = S.blocks.filter(b => !set.has(b.id));
  const used = new Set(S.blocks.filter(b => b.type === 'table').map(b => b.table));
  S.tables = S.tables.filter(t => used.has(t.id) || !gone.some(g => g.table === t.id));
  for (const id of set) S.selected.delete(id);
  emptyBlocksFix();
  syncDOM();
  const next = S.blocks[Math.min(first, S.blocks.length - 1)];
  if (next) focusBlock(next.id, first >= S.blocks.length);
  changed();
}

export function moveBlocks(ids, to) {
  const set = new Set(withChildren(ids));
  const moving = S.blocks.filter(b => set.has(b.id));
  const rest = S.blocks.filter(b => !set.has(b.id));
  const at = Math.max(0, Math.min(to, rest.length));
  snapshot();
  S.blocks = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
  syncDOM();
  changed();
}

export function duplicateBlocks(ids) {
  const set = new Set(withChildren(ids));
  const src = S.blocks.filter(b => set.has(b.id));
  if (!src.length) return [];
  snapshot();
  const copies = src.map((b) => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = M.newKey();
    if (b.type === 'table') {
      const t = S.tables.find(x => x.id === b.table);
      if (t) { const t2 = JSON.parse(JSON.stringify(t)); t2.id = M.newKey(); S.tables.push(t2); c.table = t2.id; }
    }
    return c;
  });
  const last = indexOf(src[src.length - 1].id);
  S.blocks.splice(last + 1, 0, ...copies);
  syncDOM();
  changed();
  return copies;
}

// Turn a block into another type. Text keeps its words; code keeps its text.
export function setType(id, type, extra = {}) {
  const b = block(id);
  if (!b || b.type === type) return;
  snapshot();
  const keepSel = selection();
  if (M.isText(b.type) && M.isText(type)) {
    b.type = type;
    if (type === 'todo') b.checked = false; else delete b.checked;
    if (type === 'toggle') b.open = true; else delete b.open;
  } else if (M.isText(b.type) && type === 'code') {
    const text = M.textOf(b.spans);
    for (const k of ['spans', 'align', 'checked', 'open']) delete b[k];
    Object.assign(b, { type: 'code', lang: extra.lang || 'plain', text, wrap: false });
  } else if (b.type === 'code' && M.isText(type)) {
    const lines = b.text.split('\n');
    const first = lines.shift();
    for (const k of ['lang', 'text', 'wrap']) delete b[k];
    Object.assign(b, { type, align: 'left', spans: M.spansFrom(first) });
    if (type === 'todo') b.checked = false;
    if (type === 'toggle') b.open = true;
    const at = indexOf(id);
    S.blocks.splice(at + 1, 0, ...lines.map(l => M.newBlock('p', { spans: M.spansFrom(l), indent: b.indent })));
  } else return;
  rebuildBlock(id);
  syncDOM();
  if (M.isText(type) && keepSel && keepSel.a.id === id) setSelection(id, keepSel.a.off, keepSel.f.off); else focusBlock(id);
  changed();
}

export function setAlign(ids, align) {
  snapshot();
  for (const id of ids) { const b = block(id); if (b && (M.isText(b.type) || b.type === 'image')) b.align = align; }
  decorate();
  changed();
}

export function shiftIndent(ids, delta) {
  snapshot();
  for (const id of withChildren(ids)) {
    const b = block(id);
    if (b) b.indent = Math.max(0, Math.min(M.MAX_INDENT, (b.indent || 0) + delta));
  }
  decorate();
  changed();
}

export function setChecked(id, on) {
  const b = block(id);
  if (!b || b.type !== 'todo') return;
  snapshot();
  b.checked = on;
  decorate();
  changed();
}

export function setOpen(id, on) {
  const b = block(id);
  if (!b || b.type !== 'toggle') return;
  b.open = on;
  decorate();
  changed();
}

// ─── Splitting and joining ───

// Enter. Returns the id of the block that got the caret.
export function splitBlock(id, off) {
  const b = block(id);
  if (!b || !M.isText(b.type)) return null;
  const len = M.lengthOf(b.spans);
  snapshot();
  const i = indexOf(id);

  // An empty list item ends the list (or steps out one level).
  if (len === 0 && ['bullet', 'number', 'todo'].includes(b.type)) {
    if (b.indent > 0) b.indent -= 1; else { b.type = 'p'; delete b.checked; rebuildBlock(id); }
    decorate();
    setSelection(id, 0);
    changed();
    return id;
  }
  // At the very start of a filled block: an empty one goes above, the caret stays.
  if (off === 0 && len > 0) {
    const above = M.newBlock(b.type, { indent: b.indent, align: b.align });
    S.blocks.splice(i, 0, above);
    syncDOM();
    setSelection(id, 0);
    changed();
    return id;
  }
  const [left, right] = M.splitAt(b.spans, off);
  let type = b.type;
  let indent = b.indent;
  if (['h1', 'h2', 'h3', 'caption', 'quote'].includes(type)) type = 'p';
  if (type === 'toggle') {
    if (b.open) { type = 'p'; indent += 1; } else type = 'p';
  }
  const next = M.newBlock(type, { indent, align: b.align, spans: right });
  b.spans = left;
  S.blocks.splice(i + 1, 0, next);
  refreshText(id);
  syncDOM();
  setSelection(next.id, 0);
  changed();
  return next.id;
}

// Backspace at the start of a block. True when it did something.
export function backspaceAtStart(id) {
  const b = block(id);
  if (!b || !M.isText(b.type)) return false;
  const i = indexOf(id);
  // A styled block first becomes plain.
  if (b.type !== 'p') {
    setType(id, 'p');
    return true;
  }
  if (b.indent > 0) { shiftIndent([id], -1); return true; }
  if (i === 0) return true;
  const prev = S.blocks[i - 1];
  if (!M.isText(prev.type)) {
    if (!M.lengthOf(b.spans)) { removeBlocks([id]); return true; }
    if (S.hooks.selectBlock) S.hooks.selectBlock(prev.id);
    return true;
  }
  snapshot();
  const at = M.lengthOf(prev.spans);
  prev.spans = M.normalize([...prev.spans, ...b.spans]);
  S.blocks.splice(i, 1);
  S.els.get(id).remove();
  S.els.delete(id);
  refreshText(prev.id);
  syncDOM();
  setSelection(prev.id, at);
  changed();
  return true;
}

// Delete at the end of a block: the next text block joins this one.
export function deleteAtEnd(id) {
  const b = block(id);
  const i = indexOf(id);
  const next = S.blocks[i + 1];
  if (!b || !next || !M.isText(b.type) || !M.isText(next.type)) return false;
  snapshot();
  const at = M.lengthOf(b.spans);
  b.spans = M.normalize([...b.spans, ...next.spans]);
  S.blocks.splice(i + 1, 1);
  S.els.get(next.id).remove();
  S.els.delete(next.id);
  refreshText(id);
  syncDOM();
  setSelection(id, at);
  changed();
  return true;
}

// ─── Formatting ───

// Blocks a command applies to: the selected blocks, else the caret's block.
export function targetBlocks() {
  if (S.selected.size) return S.blocks.filter(b => S.selected.has(b.id)).map(b => b.id);
  const s = selection();
  return s ? [s.id] : [];
}

// fn(spans, from, to) returns new spans. With blocks selected it applies to all
// of each; otherwise to the selected text. A bare caret returns false, so the
// caller can set a pending look instead.
export function formatText(fn) {
  if (S.selected.size) {
    snapshot();
    for (const b of S.blocks) {
      if (!S.selected.has(b.id) || !M.isText(b.type)) continue;
      b.spans = fn(b.spans, 0, M.lengthOf(b.spans));
      refreshText(b.id);
    }
    changed();
    return true;
  }
  const s = selection();
  if (!s || s.collapsed) return false;
  snapshot();
  const b = block(s.id);
  b.spans = fn(b.spans, s.start.off, s.end.off);
  refreshText(s.id);
  setSelection(s.id, s.start.off, s.end.off);
  changed();
  return true;
}

// ─── Tables ───

export function removeTableById(tableId) {
  const b = S.blocks.find(x => x.type === 'table' && x.table === tableId);
  if (b) removeBlocks([b.id]);
}
