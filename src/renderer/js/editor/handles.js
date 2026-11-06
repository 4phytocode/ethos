// The block handle (the dots in the left margin), dragging blocks to reorder
// them, and selecting whole blocks.
//
// Block selection is how anything that spans blocks is done: each block is its
// own editing area, so text cannot be selected across two of them, but whole
// blocks can. Esc in a block selects it; Shift+click on a handle extends the
// selection; Ctrl+A twice selects everything. With blocks selected, Backspace
// or Delete removes them, Ctrl+C and Ctrl+X copy and cut them, Ctrl+D copies
// them in place, Tab indents them, and typing a letter goes back to writing.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { COMMANDS, runCommand } from './commands.js';
import { showCtx } from '../views.js';
import { Spring } from '../spring.js';
import { tagColorPalette } from '../state.js';
import { spansToHtml } from './keys.js';
import { imageItems, bookmarkItems } from './image.js';

export const COLOR_NAMES = ['Blue', 'Red', 'Green', 'Amber', 'Violet', 'Pink', 'Teal', 'Orange'];
const TURN_INTO = [['p', 'Body'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['caption', 'Caption'], ['quote', 'Quote'],
  ['bullet', 'Bulleted list'], ['number', 'Numbered list'], ['todo', 'Task list'], ['toggle', 'Toggle'], ['code', 'Code block']];

// ─── Block selection ───

export function selectBlock(id, { extend = false } = {}) {
  const b = ops.block(id);
  if (!b) return;
  if (extend && S.anchorId && ops.block(S.anchorId)) {
    const a = ops.indexOf(S.anchorId);
    const z = ops.indexOf(id);
    S.selected = new Set(S.blocks.slice(Math.min(a, z), Math.max(a, z) + 1).map(x => x.id));
  } else {
    S.selected = new Set([id]);
    S.anchorId = id;
  }
  ops.decorate();
  const root = ops.blockEl(id);
  root.tabIndex = -1;
  root.focus({ preventScroll: true });
  window.getSelection().removeAllRanges();
  root.scrollIntoView({ block: 'nearest' });
  if (S.hooks.refreshUI) S.hooks.refreshUI();
}

export function clearBlockSelection() {
  if (!S.selected.size) return;
  S.selected.clear();
  ops.decorate();
  if (S.hooks.refreshUI) S.hooks.refreshUI();
}

export function selectAllBlocks() {
  S.selected = new Set(S.blocks.map(b => b.id));
  S.anchorId = S.blocks[0] && S.blocks[0].id;
  ops.decorate();
  const first = ops.blockEl(S.blocks[0].id);
  first.tabIndex = -1;
  first.focus({ preventScroll: true });
  window.getSelection().removeAllRanges();
}

function selectedInOrder() { return S.blocks.filter(b => S.selected.has(b.id)); }

async function writeClipboard(text, html) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      })]);
    } else await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

export async function copyBlocks(blocks) {
  const text = blocks.map(b => M.blockText(b, S.tables)).join('\n');
  const html = blocks.filter(b => M.isText(b.type)).map(b => '<p>' + spansToHtml(b.spans) + '</p>').join('');
  if (!(await writeClipboard(text, html))) S.hooks.notify('Could not copy', 'Press Ctrl+C again.', 'error');
}

// Keys while blocks are selected. True when the key was used.
export function blockKey(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;
  const ids = selectedInOrder().map(b => b.id);
  if (!ids.length) return false;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (key === 'Escape') { stop(); const id = ids[0]; clearBlockSelection(); ops.focusBlock(id); return true; }
  if (key === 'Backspace' || key === 'Delete') { stop(); S.selected.clear(); ops.removeBlocks(ids); return true; }
  if (ctrl && key.toLowerCase() === 'c') { stop(); copyBlocks(selectedInOrder()); return true; }
  if (ctrl && key.toLowerCase() === 'x') { stop(); copyBlocks(selectedInOrder()).then(() => { S.selected.clear(); ops.removeBlocks(ids); }); return true; }
  if (ctrl && key.toLowerCase() === 'd') { stop(); runCommand('duplicate'); return true; }
  if (ctrl && key.toLowerCase() === 'a') { stop(); selectAllBlocks(); return true; }
  if (ctrl && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) { stop(); if (key.toLowerCase() === 'y' || e.shiftKey) ops.redo(); else ops.undo(); return true; }
  if (key === 'Tab') { stop(); ops.shiftIndent(ids, e.shiftKey ? -1 : 1); return true; }
  if (e.altKey && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) { stop(); runCommand(key === 'ArrowUp' ? 'moveUp' : 'moveDown'); return true; }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    stop();
    const list = S.blocks.filter(b => { const el = ops.blockEl(b.id); return el && !el.hidden; });
    const from = e.shiftKey ? S.anchorId : (key === 'ArrowUp' ? ids[0] : ids[ids.length - 1]);
    const i = list.findIndex(b => b.id === (e.shiftKey ? (S.focusId || ids[ids.length - 1]) : from));
    const n = list[i + (key === 'ArrowUp' ? -1 : 1)];
    if (n) { S.focusId = n.id; selectBlock(n.id, { extend: e.shiftKey }); }
    return true;
  }
  if (key === 'Enter') {
    stop();
    const first = ops.block(ids[0]);
    clearBlockSelection();
    ops.focusBlock(ids[0], first && M.isText(first.type));
    return true;
  }
  // A letter goes back to writing in the first selected block.
  if (key.length === 1 && !ctrl && !e.altKey) {
    const first = ops.block(ids[0]);
    clearBlockSelection();
    if (first) ops.focusBlock(first.id, true);
    return false;
  }
  return false;
}

// ─── The block menu ───

function applyToBlocks(ids, fn) {
  const prev = S.selected;
  S.selected = new Set(ids);
  try { ops.formatText(fn); } finally { S.selected = prev; }
}

export function blockItems(id) {
  const b = ops.block(id);
  if (!b) return [];
  const ids = S.selected.has(id) ? selectedInOrder().map(x => x.id) : [id];
  const items = [];
  const textual = M.isText(b.type) || b.type === 'code';
  if (textual) {
    items.push({ label: 'Turn into', submenu: TURN_INTO.map(([t, label]) => ({ label, checked: b.type === t, onClick: () => { for (const i of ids) ops.setType(i, t); } })) });
  }
  if (M.isText(b.type)) {
    const colors = tagColorPalette();
    items.push({ label: 'Colour', submenu: [
      { label: 'Default', onClick: () => applyToBlocks(ids, (sp, f, t) => M.setAttr(sp, f, t, 'c', null)) },
      ...colors.map((c, i) => ({ label: COLOR_NAMES[i] || c, color: c, onClick: () => applyToBlocks(ids, (sp, f, t) => M.setAttr(sp, f, t, 'c', c)) })),
    ] });
  }
  if (b.type === 'image') items.push(...imageItems(b));
  if (b.type === 'bookmark') items.push(...bookmarkItems(b));
  if (items.length) items.push({ separator: true });
  items.push(
    { label: 'Duplicate', hint: 'Ctrl+D', onClick: () => { const c = ops.duplicateBlocks(ids); if (c.length) ops.focusBlock(c[0].id); } },
    { label: 'Move up', hint: 'Alt+Shift+Up', onClick: () => { const prev = S.selected; S.selected = new Set(ids); runCommand('moveUp'); S.selected = prev; } },
    { label: 'Move down', hint: 'Alt+Shift+Down', onClick: () => { const prev = S.selected; S.selected = new Set(ids); runCommand('moveDown'); S.selected = prev; } },
    { label: 'Copy text', onClick: () => copyBlocks(ids.map(ops.block)) },
    { separator: true },
    { label: ids.length > 1 ? 'Delete ' + ids.length + ' blocks' : 'Delete block', danger: true, onClick: () => { S.selected.clear(); ops.removeBlocks(ids); } },
  );
  return items;
}

// ─── Dragging ───

function startDrag(e, grip) {
  const root = grip.closest('.eb');
  const id = root.dataset.id;
  const startY = e.clientY;
  let dragging = false;
  let spring = null;
  let moving = [];
  let line = null;
  let target = 0;
  let ids = [];

  const begin = () => {
    dragging = true;
    ids = ops.withChildren(S.selected.has(id) ? selectedInOrder().map(b => b.id) : [id]);
    moving = ids.map(i => ops.blockEl(i)).filter(Boolean);
    moving.forEach(n => n.classList.add('dragging'));
    spring = new Spring(moving[0], (s) => { for (const n of moving) n.style.transform = 'translateY(' + s.cur.y.toFixed(1) + 'px)'; });
    line = document.createElement('div');
    line.className = 'eb-dropline';
    S.host.appendChild(line);
  };
  const place = (y) => {
    const set = new Set(ids);
    const rest = S.blocks.filter(b => !set.has(b.id) && ops.blockEl(b.id) && !ops.blockEl(b.id).hidden);
    let idx = rest.length;
    let lineY = null;
    for (let i = 0; i < rest.length; i++) {
      const r = ops.blockEl(rest[i].id).getBoundingClientRect();
      if (y < r.top + r.height / 2) { idx = i; lineY = r.top; break; }
    }
    if (lineY === null && rest.length) lineY = ops.blockEl(rest[rest.length - 1].id).getBoundingClientRect().bottom;
    const all = S.blocks.filter(b => !set.has(b.id));
    target = idx < rest.length ? all.indexOf(rest[idx]) : all.length;
    const host = S.host.getBoundingClientRect();
    line.style.top = ((lineY === null ? host.top : lineY) - host.top) + 'px';
  };
  const move = (m) => {
    if (!dragging && Math.abs(m.clientY - startY) > 4) begin();
    if (!dragging) return;
    spring.to({ x: 0, y: m.clientY - startY });
    place(m.clientY);
  };
  const up = (m) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!dragging) {
      // A click, not a drag: the block menu (Shift extends the selection).
      if (m.shiftKey) { selectBlock(id, { extend: true }); return; }
      selectBlock(id);
      const r = grip.getBoundingClientRect();
      showCtx({ x: r.left, y: r.bottom + 2 }, blockItems(id));
      return;
    }
    spring.stop();
    moving.forEach((n) => { n.classList.remove('dragging'); n.style.transform = ''; });
    line.remove();
    ops.moveBlocks(ids, target);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export function attach() {
  S.hooks.selectBlock = selectBlock;
  S.hooks.selectAllBlocks = selectAllBlocks;
  S.hooks.blockKey = blockKey;
  S.host.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest && e.target.closest('.eb-grip');
    if (grip && e.button === 0) { e.preventDefault(); startDrag(e, grip); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (!S.selected.size) return;
    if (e.target.closest && (e.target.closest('.eb-grip') || e.target.closest('.ctx-menu'))) return;
    clearBlockSelection();
  }, true);
  // The click that follows a handle press would close the menu it opened.
  S.host.addEventListener('click', (e) => {
    const plus = e.target.closest && e.target.closest('.eb-plus');
    if (plus) {
      e.stopPropagation();
      const id = plus.closest('.eb').dataset.id;
      const r = plus.getBoundingClientRect();
      window.getSelection().removeAllRanges();
      if (S.hooks.insertItems) showCtx({ x: r.left, y: r.bottom + 2 }, [{ heading: 'Insert' }, ...S.hooks.insertItems(id)]);
      return;
    }
    if (e.target.closest && e.target.closest('.eb-grip')) e.stopPropagation();
  }, true);
  S.host.addEventListener('focusin', (e) => { if (S.selected.size && e.target.closest && e.target.closest('.eb-text, .code-in')) clearBlockSelection(); });
  void COMMANDS; void changed;
}
