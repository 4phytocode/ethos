// The right-click menu and the "/" menu inside a note: the same list of things
// to insert (a table, a task list, a toggle, bullets, a rule, a footnote, code,
// an image, a link or bookmark, a text style), offered two ways.
//
// Right-click anywhere in the page opens the menu at the pointer; what is
// inserted goes after the block under the pointer. Typing "/" at the start of a
// block or after a space opens a small list under the caret that filters as you
// type: "/table", "/tracker", "/grades", "/code"...

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { COMMANDS, runCommand, insertTextBlock, insertDivider } from './commands.js';
import { showCtx, closeCtx } from '../views.js';
import { makeTable, TEMPLATES } from '../notes-table.js';
import { blockItems } from './handles.js';
import { bookmarkForm, imageItems, bookmarkItems } from './image.js';
import { caretRect } from './caret.js';
import { pastePlain } from './keys.js';
import { LANG_NAMES } from './highlight.js';

// ─── What can be inserted ───

export function insertTable(templateId) {
  const t = makeTable(templateId);
  S.tables.push(t);
  const b = M.newBlock('table', { table: t.id });
  ops.insertAfterCurrent(b, { focus: false });
  // Something to type in after the table.
  const at = ops.indexOf(b.id);
  if (!S.blocks[at + 1]) ops.insertBlock(at + 1, M.newBlock('p'), { focus: false });
  const root = ops.blockEl(b.id);
  const first = root && root.querySelector('input, select, button.nt-table-tool');
  if (first) first.focus();
}

export function insertCode() {
  ops.insertAfterCurrent(M.newBlock('code', { lang: 'plain', text: '', wrap: false }));
}

async function insertBookmark() {
  const v = await bookmarkForm();
  if (!v) return;
  ops.insertAfterCurrent(M.newBlock('bookmark', { url: v.url, title: v.title }), { focus: false });
}

// Each entry: label, words it can be found by when typing "/", and what it does.
const ENTRIES = () => [
  ...TEMPLATES.map(t => ({ label: t.id === 'blank' ? 'Table' : t.label, keys: 'table ' + t.id + ' ' + t.label, run: () => insertTable(t.id) })),
  { label: 'Task list', keys: 'todo task checkbox check', run: () => insertTextBlock('todo') },
  { label: 'Toggle', keys: 'toggle collapse fold', run: () => insertTextBlock('toggle') },
  { label: 'Bulleted list', keys: 'bullet bulleted list ul', run: () => insertTextBlock('bullet') },
  { label: 'Numbered list', keys: 'number numbered list ol', run: () => insertTextBlock('number') },
  { label: 'Divider', keys: 'divider rule line hr horizontal', run: () => insertDivider() },
  { label: 'Footnote', keys: 'footnote note reference', run: () => S.hooks.footnote && S.hooks.footnote() },
  { label: 'Code block', keys: 'code block snippet pre', run: () => insertCode() },
  { label: 'Image', keys: 'image picture photo img', run: () => S.hooks.pickImage && S.hooks.pickImage() },
  { label: 'Link / bookmark', keys: 'link bookmark url web', run: () => insertBookmark() },
  { label: 'Heading 1', keys: 'h1 heading title', run: () => runCommand('h1') },
  { label: 'Heading 2', keys: 'h2 heading', run: () => runCommand('h2') },
  { label: 'Heading 3', keys: 'h3 heading', run: () => runCommand('h3') },
  { label: 'Body text', keys: 'body text paragraph', run: () => runCommand('body') },
  { label: 'Caption', keys: 'caption small', run: () => runCommand('caption') },
  { label: 'Quote', keys: 'quote blockquote', run: () => runCommand('quote') },
];

// The menu's own list, in menu form. `forId` is the block the menu was opened on.
export function insertItems(forId) {
  const via = (fn) => () => { S.forceId = forId || null; try { fn(); } finally { S.forceId = null; } };
  return [
    { label: 'Table', submenu: TEMPLATES.map(t => ({ label: t.label, onClick: via(() => insertTable(t.id)) })) },
    { label: 'Task list', onClick: via(() => insertTextBlock('todo')) },
    { label: 'Toggle', onClick: via(() => insertTextBlock('toggle')) },
    { label: 'Bulleted list', onClick: via(() => insertTextBlock('bullet')) },
    { label: 'Numbered list', onClick: via(() => insertTextBlock('number')) },
    { label: 'Divider (horizontal rule)', onClick: via(() => insertDivider()) },
    { label: 'Footnote', hint: 'Ctrl+Alt+F', onClick: via(() => S.hooks.footnote && S.hooks.footnote()) },
    { label: 'Code block', onClick: via(() => insertCode()) },
    { label: 'Image…', onClick: via(() => S.hooks.pickImage && S.hooks.pickImage()) },
    { label: 'Link / bookmark…', onClick: via(() => insertBookmark()) },
    { separator: true },
    { label: 'Text style', submenu: ['h1', 'h2', 'h3', 'body', 'caption', 'quote'].map(id => ({ label: COMMANDS[id].label, hint: COMMANDS[id].hint, checked: COMMANDS[id].active && COMMANDS[id].active(), onClick: via(() => { if (forId) S.lastId = forId; runCommand(id); }) })) },
  ];
}

// ─── Clipboard ───

async function copySelection(cut) {
  const s = ops.selection();
  if (!s || s.collapsed) return;
  const b = ops.block(s.id);
  const spans = M.slice(b.spans, s.start.off, s.end.off);
  const text = M.textOf(spans);
  try { await navigator.clipboard.writeText(text); } catch { S.hooks.notify('Could not copy', 'Press Ctrl+C.', 'error'); return; }
  if (cut) {
    ops.snapshot();
    b.spans = M.deleteRange(b.spans, s.start.off, s.end.off);
    ops.refreshText(s.id);
    ops.setSelection(s.id, s.start.off);
    changed();
  }
}

async function paste() {
  try { pastePlain(await navigator.clipboard.readText()); } catch { S.hooks.notify('Press Ctrl+V to paste', 'The menu cannot read the clipboard here.'); }
}

// ─── Right-click ───

function onContext(e) {
  const root = e.target.closest && e.target.closest('.eb');
  if (!root || !S.host.contains(root)) return;
  // A table cell's own menu (tables.js) has already taken it.
  if (e.defaultPrevented) return;
  e.preventDefault();
  const id = root.dataset.id;
  const b = ops.block(id);
  const items = [];
  const inText = e.target.closest('.eb-text');
  const sel = ops.selection();
  if (inText && sel && !sel.collapsed) {
    items.push(
      { label: 'Cut', hint: 'Ctrl+X', onClick: () => copySelection(true) },
      { label: 'Copy', hint: 'Ctrl+C', onClick: () => copySelection(false) },
      { label: 'Paste', hint: 'Ctrl+V', onClick: paste },
      { separator: true },
    );
    for (const c of ['bold', 'italic', 'underline', 'strike', 'link', 'clear']) {
      const cmd = COMMANDS[c];
      items.push({ label: cmd.label, hint: cmd.hint, checked: cmd.active ? cmd.active() : undefined, onClick: () => cmd.run() });
    }
    items.push({ separator: true });
  } else if (inText) {
    items.push({ label: 'Paste', hint: 'Ctrl+V', onClick: paste }, { separator: true });
  }
  if (b && b.type === 'image') items.push(...imageItems(b), { separator: true });
  if (b && b.type === 'bookmark') items.push(...bookmarkItems(b), { separator: true });
  items.push({ heading: 'Insert' }, ...insertItems(id));
  if (b) items.push({ separator: true }, ...blockItems(id));
  showCtx(e, items);
}

// ─── The "/" menu ───

let slash = null;     // { el, entries, active, id, from, to }

function closeSlash() {
  if (slash) { slash.el.remove(); slash = null; }
}

function matches(query) {
  const q = query.toLowerCase().trim();
  const all = ENTRIES();
  if (!q) return all.slice(0, 12);
  return all.filter(en => en.label.toLowerCase().includes(q) || en.keys.toLowerCase().split(/\s+/).some(k => k.startsWith(q)));
}

function paintSlash() {
  const s = slash;
  s.el.replaceChildren();
  s.entries.forEach((en, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-item' + (i === s.active ? ' active' : '');
    row.setAttribute('role', 'option');
    row.textContent = en.label;
    row.addEventListener('mousedown', (ev) => ev.preventDefault());
    row.addEventListener('click', () => choose(i));
    s.el.appendChild(row);
  });
}

function choose(i) {
  const s = slash;
  if (!s) return;
  const en = s.entries[i];
  const { id, from, to } = s;
  closeSlash();
  const b = ops.block(id);
  if (!b) return;
  // The "/word" you typed goes, then the thing is made.
  ops.snapshot();
  b.spans = M.deleteRange(b.spans, from, to);
  ops.refreshText(id);
  ops.setSelection(id, from);
  en.run();
}

function onSlash(id) {
  const s = ops.selection();
  const b = ops.block(id);
  if (!s || !s.collapsed || !b || b.type === 'code') { closeSlash(); return; }
  const before = M.flat(b.spans).slice(0, s.a.off);
  const m = /(^|\s)\/([^\s/]{0,24})$/.exec(before);
  if (!m) { closeSlash(); return; }
  const entries = matches(m[2]);
  if (!entries.length) { closeSlash(); return; }
  const from = s.a.off - m[2].length - 1;
  if (!slash) {
    const el = document.createElement('div');
    el.className = 'slash-menu menu';
    el.setAttribute('role', 'listbox');
    document.body.appendChild(el);
    slash = { el, entries, active: 0, id, from, to: s.a.off };
  } else Object.assign(slash, { entries, id, from, to: s.a.off, active: Math.min(slash.active, entries.length - 1) });
  paintSlash();
  const r = caretRect();
  if (r) {
    const box = slash.el.getBoundingClientRect();
    slash.el.style.left = Math.max(4, Math.min(r.left, window.innerWidth - box.width - 4)) + 'px';
    const below = r.top + r.height + 4;
    slash.el.style.top = (below + box.height > window.innerHeight ? Math.max(4, r.top - box.height - 4) : below) + 'px';
  }
}

function slashKey(e) {
  if (!slash) return false;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop();
    slash.active = (slash.active + (e.key === 'ArrowDown' ? 1 : slash.entries.length - 1)) % slash.entries.length;
    paintSlash();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { stop(); choose(slash.active); return true; }
  if (e.key === 'Escape') { stop(); closeSlash(); return true; }
  return false;
}

export function attach() {
  S.host.addEventListener('contextmenu', onContext);
  S.hooks.slash = onSlash;
  S.hooks.slashKey = slashKey;
  S.hooks.insertItems = insertItems;
  S.host.addEventListener('focusout', (e) => { if (!e.relatedTarget || !S.host.contains(e.relatedTarget)) setTimeout(() => { if (!document.activeElement || !document.activeElement.closest || !document.activeElement.closest('.eb-text')) closeSlash(); }, 0); });
  void closeCtx; void LANG_NAMES;
}

export function resetSlash() { closeSlash(); }
