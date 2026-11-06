// Every editor command by id. Keys, the toolbar, the selection bubble and the
// menus all run these, so a command behaves the same wherever it is started.
//
// A command is { label, hint, run(), active?(), enabled?() }. Formatting a
// selection goes through ops.formatText; with only a caret, bold and the rest
// set a "pending" look that the next typed character takes (like Word).

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { formDialog } from '../dialog.js';

const refresh = () => { if (S.hooks.refreshUI) S.hooks.refreshUI(); };

// ─── Looks ───

function caretLook() {
  const s = ops.selection();
  if (!s) return {};
  if (S.pending) return S.pending;
  const b = ops.block(s.id);
  return M.marksAt(b.spans, s.a.off);
}

function toggleInline(mark) {
  const s = ops.selection();
  if (S.selected.size || (s && !s.collapsed)) {
    // With several blocks, the first decides: all marked means take it off.
    ops.formatText((sp, f, t) => M.toggleMark(sp, f, t, mark));
    refresh();
    return;
  }
  if (!s) return;
  const look = caretLook();
  const set = new Set(look.m || []);
  if (set.has(mark)) set.delete(mark);
  else {
    set.add(mark);
    if (mark === 'sup') set.delete('sub');
    if (mark === 'sub') set.delete('sup');
  }
  S.pending = { ...look, m: [...set] };
  refresh();
}

function inlineActive(mark) {
  const s = ops.selection();
  if (s && !s.collapsed) return M.hasMark(ops.block(s.id).spans, s.start.off, s.end.off, mark);
  if (S.selected.size) {
    const bs = ops.targetBlocks().map(ops.block).filter(b => b && M.isText(b.type));
    return bs.length > 0 && bs.every(b => M.hasMark(b.spans, 0, M.lengthOf(b.spans), mark));
  }
  return (caretLook().m || []).includes(mark);
}

function setLook(key, value) {
  const s = ops.selection();
  if ((s && !s.collapsed) || S.selected.size) { ops.formatText((sp, f, t) => M.setAttr(sp, f, t, key, value)); refresh(); return; }
  if (!s) return;
  S.pending = { ...caretLook(), [key]: value || undefined };
  refresh();
}

export const colorOf = (key) => {
  const s = ops.selection();
  if (s && !s.collapsed) return M.attrAt(ops.block(s.id).spans, s.start.off, s.end.off, key);
  return caretLook()[key] || null;
};

export function setColor(c) { setLook('c', c); }
export function setHighlight(c) { setLook('bg', c); }

// ─── Blocks ───

function setBlockType(type) {
  const ids = ops.targetBlocks();
  if (!ids.length) return;
  const all = ids.every(id => ops.block(id).type === type);
  for (const id of ids) ops.setType(id, all && type !== 'p' ? 'p' : type);
  refresh();
}

function blockTypeActive(type) {
  const ids = ops.targetBlocks();
  return ids.length > 0 && ids.every(id => ops.block(id).type === type);
}

function align(a) {
  const ids = ops.targetBlocks();
  if (ids.length) ops.setAlign(ids, a);
  refresh();
}
const alignActive = (a) => {
  const ids = ops.targetBlocks();
  return ids.length > 0 && ids.every(id => (ops.block(id).align || 'left') === a);
};

// A new list, task, toggle: the empty paragraph you are on becomes it.
export function insertTextBlock(type) {
  const id = ops.currentId();
  const cur = id && ops.block(id);
  if (cur && cur.type === 'p' && !M.lengthOf(cur.spans)) { ops.setType(id, type); return; }
  ops.insertAfterCurrent(M.newBlock(type, { indent: cur && ['bullet', 'number', 'todo'].includes(type) && cur.type === type ? cur.indent : 0 }));
}

export function insertDivider() {
  const id = ops.currentId();
  const cur = id && ops.block(id);
  ops.snapshot();
  const rule = M.newBlock('divider');
  const para = M.newBlock('p');
  const i = id ? ops.indexOf(id) : S.blocks.length - 1;
  if (cur && cur.type === 'p' && !M.lengthOf(cur.spans) && !cur.indent) S.blocks.splice(i, 1, rule, para);
  else S.blocks.splice(i + 1, 0, rule, para);
  ops.syncDOM();
  ops.focusBlock(para.id);
  changed();
}

function indentBlocks(delta) {
  const ids = ops.targetBlocks();
  if (ids.length) ops.shiftIndent(ids, delta);
}

function moveSelected(delta) {
  const ids = ops.withChildren(ops.targetBlocks());
  if (!ids.length) return;
  const idx = ids.map(ops.indexOf).sort((a, b) => a - b);
  const first = idx[0];
  const last = idx[idx.length - 1];
  if (delta < 0 && first === 0) return;
  if (delta > 0 && last >= S.blocks.length - 1) return;
  // Where it lands among the blocks that stay.
  const to = delta < 0 ? first - 1 : first + 1;
  const sel = ops.selection();
  ops.moveBlocks(ids, to);
  if (sel) ops.setSelection(sel.id, sel.a.off, sel.f.off);
}

// ─── Links ───

function cleanUrl(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = 'https://' + v;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? v : ''; } catch { return ''; }
}
export const validUrl = (v) => cleanUrl(v) !== '';
export { cleanUrl };

export async function linkDialog() {
  const s = ops.selection();
  if (!s) return;
  const b = ops.block(s.id);
  const picked = !s.collapsed ? M.textOf(M.slice(b.spans, s.start.off, s.end.off)) : '';
  const existing = !s.collapsed ? M.attrAt(b.spans, s.start.off, s.end.off, 'href') : null;
  const id = s.id;
  const from = s.start.off;
  const to = s.end.off;
  const v = await formDialog({
    title: existing ? 'Edit link' : 'Link', okLabel: 'OK',
    fields: [
      { key: 'text', label: 'Text to show', value: picked, maxLength: 200 },
      { key: 'url', label: 'Address', value: existing || 'https://', placeholder: 'https://example.com', maxLength: 2000 },
    ],
    validate: (x) => (!x.text.trim() ? 'Type the text to show.' : validUrl(x.url) ? '' : 'Use a web address, like https://example.com'),
  });
  ops.setSelection(id, from, to);
  if (!v) return;
  const href = cleanUrl(v.url);
  ops.snapshot();
  const cur = ops.block(id);
  let spans = cur.spans;
  if (v.text !== picked) {
    spans = M.deleteRange(spans, from, to);
    spans = M.insertText(spans, from, v.text, {});
  }
  cur.spans = M.setAttr(spans, from, from + v.text.length, 'href', href);
  ops.refreshText(id);
  ops.setSelection(id, from, from + v.text.length);
  changed();
}

export function removeLink() {
  ops.formatText((sp, f, t) => M.setAttr(sp, f, t, 'href', null));
}

// ─── The registry ───

const mark = (id, label, hint) => ({ label, hint, run: () => toggleInline(id), active: () => inlineActive(id) });
const blockType = (type, label, hint) => ({ label, hint, run: () => setBlockType(type), active: () => blockTypeActive(type) });
const alignCmd = (a, label, hint) => ({ label, hint, run: () => align(a), active: () => alignActive(a) });

export const COMMANDS = {
  bold: mark('b', 'Bold', 'Ctrl+B'),
  italic: mark('i', 'Italic', 'Ctrl+I'),
  underline: mark('u', 'Underline', 'Ctrl+U'),
  strike: mark('s', 'Strikethrough', 'Ctrl+Shift+X'),
  code: mark('code', 'Inline code', 'Ctrl+E'),
  sup: mark('sup', 'Superscript', 'Ctrl+.'),
  sub: mark('sub', 'Subscript', 'Ctrl+,'),
  clear: { label: 'Clear formatting', hint: 'Ctrl+Space', run: () => { S.pending = null; ops.formatText(M.clearFormatting); refresh(); } },
  link: { label: 'Link…', hint: 'Ctrl+K', run: () => linkDialog() },
  body: blockType('p', 'Body', 'Ctrl+Alt+0'),
  h1: blockType('h1', 'Heading 1', 'Ctrl+Alt+1'),
  h2: blockType('h2', 'Heading 2', 'Ctrl+Alt+2'),
  h3: blockType('h3', 'Heading 3', 'Ctrl+Alt+3'),
  caption: blockType('caption', 'Caption', 'Ctrl+Alt+9'),
  quote: blockType('quote', 'Quote', 'Ctrl+Shift+Q'),
  bullet: blockType('bullet', 'Bulleted list', 'Ctrl+Shift+8'),
  number: blockType('number', 'Numbered list', 'Ctrl+Shift+7'),
  todo: blockType('todo', 'Task list', 'Ctrl+Shift+9'),
  toggle: blockType('toggle', 'Toggle', ''),
  alignLeft: alignCmd('left', 'Align left', 'Ctrl+Shift+L'),
  alignCenter: alignCmd('center', 'Align centre', 'Ctrl+Shift+E'),
  alignRight: alignCmd('right', 'Align right', 'Ctrl+Shift+R'),
  alignJustify: alignCmd('justify', 'Justify', 'Ctrl+Shift+J'),
  indent: { label: 'Indent', hint: 'Tab', run: () => indentBlocks(1) },
  outdent: { label: 'Outdent', hint: 'Shift+Tab', run: () => indentBlocks(-1) },
  duplicate: { label: 'Duplicate block', hint: 'Ctrl+D', run: () => { const c = ops.duplicateBlocks(ops.targetBlocks()); if (c.length) ops.focusBlock(c[0].id); } },
  moveUp: { label: 'Move block up', hint: 'Alt+Shift+Up', run: () => moveSelected(-1) },
  moveDown: { label: 'Move block down', hint: 'Alt+Shift+Down', run: () => moveSelected(1) },
  undo: { label: 'Undo', hint: 'Ctrl+Z', run: () => ops.undo(), enabled: () => S.history.length > 0 },
  redo: { label: 'Redo', hint: 'Ctrl+Y', run: () => ops.redo(), enabled: () => S.future.length > 0 },
  divider: { label: 'Divider (horizontal rule)', hint: '---', run: () => insertDivider() },
  find: { label: 'Find', hint: 'Ctrl+F', run: () => S.hooks.find && S.hooks.find(false) },
  replace: { label: 'Find and replace', hint: 'Ctrl+H', run: () => S.hooks.find && S.hooks.find(true) },
};

// Ctrl+Alt+digit and friends come through `code`, because the character a
// digit gives with Shift or Alt depends on the keyboard.
export function commandForKey(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = (e.key || '').toLowerCase();
  if (ctrl && e.altKey && !e.shiftKey) {
    return { Digit0: 'body', Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', Digit9: 'caption', KeyF: 'footnote' }[e.code] || null;
  }
  if (ctrl && e.shiftKey && !e.altKey) {
    const byCode = { Digit7: 'number', Digit8: 'bullet', Digit9: 'todo' }[e.code];
    if (byCode) return byCode;
    return { x: 'strike', z: 'redo', l: 'alignLeft', e: 'alignCenter', r: 'alignRight', j: 'alignJustify', q: 'quote' }[k] || null;
  }
  if (ctrl && !e.shiftKey && !e.altKey) {
    return { b: 'bold', i: 'italic', u: 'underline', e: 'code', k: 'link', z: 'undo', y: 'redo', d: 'duplicate', f: 'find', h: 'replace',
      ',': 'sub', '.': 'sup', ' ': 'clear', '[': 'outdent', ']': 'indent' }[k] || null;
  }
  if (e.altKey && e.shiftKey && !ctrl) {
    if (e.key === 'ArrowUp') return 'moveUp';
    if (e.key === 'ArrowDown') return 'moveDown';
    if (e.code === 'Digit5') return 'strike';
  }
  return null;
}

export function runCommand(id) {
  const c = COMMANDS[id];
  if (c && (!c.enabled || c.enabled())) c.run();
}
