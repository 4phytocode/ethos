// Typing, keys and paste in the text blocks. The browser types the characters;
// this file handles everything else: Enter, Backspace, Tab, arrows between
// blocks, shortcuts, Markdown shortcuts, Insert (overwrite) mode, history
// coalescing and paste.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { COMMANDS, commandForKey, runCommand } from './commands.js';
import { htmlToBlocks, textToBlocks, isLoneUrl } from './paste.js';
import { caretRect, refresh as refreshCaret } from './caret.js';
import { CODE_LANGS } from './highlight.js';

const LANG_ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp',
  rs: 'rust', md: 'markdown', yml: 'plain', htm: 'html', golang: 'go' };
const BLOCK_SHORTCUTS = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'bullet', '*': 'bullet', '1.': 'number', '[]': 'todo', '[ ]': 'todo', '>': 'toggle', '"': 'quote' };

const textOfEl = (t) => t.closest('.eb').dataset.id;

// ─── Insert / overwrite ───

export function toggleOverwrite() {
  S.overwrite = !S.overwrite;
  refreshCaret();
  if (S.hooks.refreshUI) S.hooks.refreshUI();
}

// ─── Typing ───

function typeViaModel(id, off, text, look) {
  const b = ops.block(id);
  b.spans = M.insertText(b.spans, off, text, look);
  ops.refreshText(id);
  ops.setSelection(id, off + text.length);
  changed();
}

// Space after a Markdown prefix at the start of a paragraph turns it into that block.
function blockShortcut(id, off) {
  const b = ops.block(id);
  if (b.type !== 'p') return false;
  const before = M.textOf(b.spans).slice(0, off);
  const type = BLOCK_SHORTCUTS[before];
  if (!type) return false;
  ops.snapshot();
  b.spans = M.deleteRange(b.spans, 0, off);
  ops.setType(id, type);
  return true;
}

// `**bold**`, `*italic*`, `~~strike~~` and `code` as the closing marker is typed.
const INLINE_RULES = [
  { re: /(\*\*)([^*\s](?:[^*]*[^*\s])?)\*\*$/, mark: 'b', open: 2 },
  { re: /(~~)([^~\s](?:[^~]*[^~\s])?)~~$/, mark: 's', open: 2 },
  { re: /(?:^|[^*])(\*)([^*\s](?:[^*]*[^*\s])?)\*$/, mark: 'i', open: 1 },
  { re: /(`)([^`]+)`$/, mark: 'code', open: 1 },
];

function inlineShortcut(id) {
  const s = ops.selection();
  if (!s || !s.collapsed) return;
  const b = ops.block(id);
  const before = M.flat(b.spans).slice(0, s.a.off);
  for (const rule of INLINE_RULES) {
    const m = rule.re.exec(before);
    if (!m) continue;
    const inner = m[2];
    const closeLen = rule.open;
    const end = s.a.off;
    const start = end - (inner.length + rule.open + closeLen);
    if (start < 0) continue;
    ops.snapshot();
    let spans = M.deleteRange(b.spans, end - closeLen, end);
    spans = M.deleteRange(spans, start, start + rule.open);
    b.spans = M.toggleMark(spans, start, start + inner.length, rule.mark);
    ops.refreshText(id);
    ops.setSelection(id, start + inner.length);
    // What is typed next is plain, not another bold word.
    S.pending = { m: [] };
    changed();
    return;
  }
}

function onBeforeInput(e) {
  const t = e.target.closest && e.target.closest('.eb-text');
  if (!t || !S.host.contains(t)) return;
  const id = textOfEl(t);
  switch (e.inputType) {
    case 'historyUndo': e.preventDefault(); ops.undo(); return;
    case 'historyRedo': e.preventDefault(); ops.redo(); return;
    case 'insertParagraph': e.preventDefault(); enter(null, id); return;
    case 'insertLineBreak': e.preventDefault(); lineBreak(id); return;
    default: break;
  }
  if (e.isComposing) return;
  const sel = ops.selection();
  if (!sel) return;
  const b = ops.block(id);
  if (e.inputType === 'insertText' && e.data) {
    const now = Date.now();
    if (now - S.lastTypeAt > 800 || /[\s.,;:!?)]/.test(e.data)) ops.snapshot();
    S.lastTypeAt = now;
    if (e.data === ' ' && sel.collapsed && blockShortcut(id, sel.a.off)) { e.preventDefault(); return; }
    if (!sel.collapsed) S.pending = null;
    if (S.overwrite && sel.collapsed && e.data.length === 1) {
      const flat = M.flat(b.spans);
      if (sel.a.off < flat.length && flat[sel.a.off] !== '\n') window.getSelection().modify('extend', 'forward', 'character');
    }
    // A pending look, or the end of a link, means the model types, not the browser.
    if (sel.collapsed && (S.pending || M.endsLink(b.spans, sel.a.off))) {
      e.preventDefault();
      typeViaModel(id, sel.a.off, e.data, S.pending || M.marksAt(b.spans, sel.a.off));
      S.pending = null;
      return;
    }
  } else if (e.inputType.startsWith('delete')) {
    const now = Date.now();
    if (now - S.lastTypeAt > 800) ops.snapshot();
    S.lastTypeAt = now;
  }
}

function onInput(e) {
  const t = e.target.closest && e.target.closest('.eb-text');
  if (!t || !S.host.contains(t)) return;
  const id = textOfEl(t);
  ops.readBlock(id);
  changed();
  if (e.inputType === 'insertText') inlineShortcut(id);
  if (S.hooks.slash) S.hooks.slash(id);
}

// ─── Enter, line breaks ───

function lineBreak(id) {
  const s = ops.selection();
  if (!s) return;
  const b = ops.block(id);
  ops.snapshot();
  let spans = b.spans;
  if (!s.collapsed) spans = M.deleteRange(spans, s.start.off, s.end.off);
  typeViaModelFrom(id, spans, s.start.off, '\n');
}

function typeViaModelFrom(id, spans, off, text) {
  const b = ops.block(id);
  b.spans = M.insertText(spans, off, text, M.marksAt(spans, off));
  ops.refreshText(id);
  ops.setSelection(id, off + text.length);
  changed();
}

function enter(e, id) {
  if (e) e.preventDefault();
  const s = ops.selection();
  if (!s) return;
  const b = ops.block(id);
  if (e && e.shiftKey) { lineBreak(id); return; }
  let off = s.start.off;
  if (!s.collapsed) {
    ops.snapshot();
    b.spans = M.deleteRange(b.spans, s.start.off, s.end.off);
    ops.refreshText(id);
  }
  if (b.type === 'p') {
    const txt = M.textOf(b.spans);
    const fence = /^```([a-z+#]*)$/i.exec(txt);
    if (fence && off === txt.length) {
      ops.snapshot();
      const alias = LANG_ALIAS[fence[1].toLowerCase()] || fence[1].toLowerCase();
      b.spans = [];
      ops.setType(id, 'code', { lang: CODE_LANGS.includes(alias) ? alias : 'plain' });
      return;
    }
    if (txt === '---' && off === 3) {
      ops.snapshot();
      const i = ops.indexOf(id);
      S.blocks.splice(i, 1, M.newBlock('divider', { id }), M.newBlock('p'));
      ops.syncDOM();
      ops.rebuildBlock(id);
      ops.focusBlock(S.blocks[i + 1].id);
      changed();
      return;
    }
  }
  ops.splitBlock(id, off);
}

// ─── Moving between blocks ───

function visibleBlocks() { return S.blocks.filter(b => { const el = S.els.get(b.id); return el && !el.hidden; }); }

// Caret to the neighbouring block, near x if it is text.
function toNeighbour(id, dir, x) {
  const list = visibleBlocks();
  const i = list.findIndex(b => b.id === id);
  const n = list[i + dir];
  if (!n) return false;
  if (M.isText(n.type)) {
    const t = ops.textEl(n.id);
    const box = t.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 24;
    const y = dir < 0 ? box.bottom - lh / 2 : box.top + lh / 2;
    let range = null;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p && t.contains(p.offsetNode)) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); range.collapse(true); }
    } else if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
      if (range && !t.contains(range.startContainer)) range = null;
    }
    t.focus({ preventScroll: true });
    if (range) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); } else ops.focusBlock(n.id, dir < 0);
    t.scrollIntoView({ block: 'nearest' });
    return true;
  }
  const code = S.els.get(n.id).querySelector('.code-in');
  if (code) { code.focus(); if (dir < 0) code.setSelectionRange(code.value.length, code.value.length); else code.setSelectionRange(0, 0); return true; }
  if (S.hooks.selectBlock) S.hooks.selectBlock(n.id);
  return true;
}

// ─── Keys ───

function wholeBlockSelected(id) {
  const s = ops.selection();
  const b = ops.block(id);
  return !!s && s.a.id === s.f.id && s.start.off === 0 && s.end.off === M.lengthOf(b.spans) && M.lengthOf(b.spans) > 0;
}

function onKeydown(e) {
  // Block selection owns the keyboard while blocks are selected.
  if (S.selected.size && S.hooks.blockKey && S.hooks.blockKey(e)) return;
  if (e.key === 'Insert' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) { e.preventDefault(); toggleOverwrite(); return; }
  const t = e.target.closest && e.target.closest('.eb-text');
  if (!t || !S.host.contains(t)) return;
  if (e.isComposing) return;
  const id = textOfEl(t);

  const cmd = commandForKey(e);
  if (cmd) {
    e.preventDefault();
    if (cmd === 'footnote') { if (S.hooks.footnote) S.hooks.footnote(); } else runCommand(cmd);
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'a' && wholeBlockSelected(id) && S.hooks.selectAllBlocks) { e.preventDefault(); S.hooks.selectAllBlocks(); }
    return;
  }

  const s = ops.selection();
  if (!s) return;
  const b = ops.block(id);
  const len = M.lengthOf(b.spans);

  switch (e.key) {
    case 'Enter':
      if (S.hooks.slashKey && S.hooks.slashKey(e)) return;
      enter(e, id);
      return;
    case 'Backspace':
      if (s.collapsed && s.a.off === 0) { e.preventDefault(); ops.backspaceAtStart(id); }
      else if (s.collapsed && s.a.off > 0 && M.flat(b.spans)[s.a.off - 1] === M.ATOM) {
        // Next to a footnote marker: the first Backspace selects it, the second removes it.
        e.preventDefault();
        ops.setSelection(id, s.a.off - 1, s.a.off);
      }
      return;
    case 'Delete':
      if (s.collapsed && s.a.off === len) { e.preventDefault(); ops.deleteAtEnd(id); }
      return;
    case 'Tab':
      if (S.hooks.slashKey && S.hooks.slashKey(e)) return;
      e.preventDefault();
      runCommand(e.shiftKey ? 'outdent' : 'indent');
      return;
    case 'Escape':
      if (S.hooks.slashKey && S.hooks.slashKey(e)) return;
      e.preventDefault();
      if (S.hooks.selectBlock) S.hooks.selectBlock(id);
      return;
    case 'ArrowLeft':
      if (!e.shiftKey && s.collapsed && s.a.off === 0) {
        const list = visibleBlocks();
        const n = list[list.findIndex(x => x.id === id) - 1];
        if (n && M.isText(n.type)) { e.preventDefault(); ops.setSelection(n.id, M.lengthOf(n.spans)); }
        else if (n) { e.preventDefault(); toNeighbour(id, -1, 0); }
      }
      return;
    case 'ArrowRight':
      if (!e.shiftKey && s.collapsed && s.a.off === len) {
        const list = visibleBlocks();
        const n = list[list.findIndex(x => x.id === id) + 1];
        if (n && M.isText(n.type)) { e.preventDefault(); ops.setSelection(n.id, 0); }
      }
      return;
    case 'ArrowUp':
    case 'ArrowDown': {
      if (e.shiftKey || !s.collapsed) return;
      if (S.hooks.slashKey && S.hooks.slashKey(e)) return;
      const r = caretRect();
      if (!r) return;
      const box = t.getBoundingClientRect();
      const up = e.key === 'ArrowUp';
      if (up ? r.top - box.top < r.height * 0.9 : box.bottom - (r.top + r.height) < r.height * 0.9) {
        if (toNeighbour(id, up ? -1 : 1, r.left)) e.preventDefault();
      }
      return;
    }
    default:
      if (S.hooks.slashKey && S.hooks.slashKey(e)) return;
  }
}

// ─── Paste ───

function inlineIntoBlock(id, off, selEnd, spans) {
  const b = ops.block(id);
  const base = M.deleteRange(b.spans, off, selEnd);
  const [l, r] = M.splitAt(base, off);
  b.spans = M.normalize([...l, ...spans, ...r]);
  ops.refreshText(id);
  ops.setSelection(id, off + M.lengthOf(spans));
}

function pasteBlocks(id, s, parsed) {
  const { blocks, tables } = parsed;
  if (!blocks.length) return;
  const b = ops.block(id);
  ops.snapshot();
  const off = s.start.off;
  // One plain paragraph goes into the text at the caret.
  if (blocks.length === 1 && blocks[0].type === 'p') {
    inlineIntoBlock(id, off, s.end.off, blocks[0].spans);
    changed();
    return;
  }
  b.spans = M.deleteRange(b.spans, s.start.off, s.end.off);
  const [l, r] = M.splitAt(b.spans, off);
  const i = ops.indexOf(id);
  const empty = M.lengthOf(l) === 0 && M.lengthOf(r) === 0 && b.type === 'p';
  b.spans = l;
  const inserted = blocks.map(x => ({ ...x, indent: Math.min(M.MAX_INDENT, (x.indent || 0) + (empty ? 0 : b.indent || 0)) }));
  let tail = null;
  if (r.length) {
    const last = inserted[inserted.length - 1];
    if (M.isText(last.type)) { last.spans = M.normalize([...last.spans, ...r]); } else tail = M.newBlock('p', { spans: r });
  }
  const all = tail ? [...inserted, tail] : inserted;
  S.tables.push(...tables);
  if (empty) S.blocks.splice(i, 1, ...all); else S.blocks.splice(i + 1, 0, ...all);
  if (!empty) ops.refreshText(id);
  ops.syncDOM();
  const lastBlock = inserted[inserted.length - 1];
  if (M.isText(lastBlock.type)) ops.setSelection(lastBlock.id, M.lengthOf(lastBlock.spans) - (tail ? 0 : r.length));
  changed();
}

function onPaste(e) {
  const t = e.target.closest && e.target.closest('.eb-text');
  if (!t || !S.host.contains(t)) return;
  e.preventDefault();
  const dt = e.clipboardData;
  if (!dt) return;
  const id = textOfEl(t);
  const s = ops.selection();
  if (!s) return;
  const files = [...(dt.files || [])].filter(f => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
  if (files.length && S.hooks.importImages) { S.hooks.importImages(files, id); return; }
  const html = dt.getData('text/html');
  const plain = dt.getData('text/plain');
  const b = ops.block(id);
  // A web address over selected text makes it a link.
  if (plain && isLoneUrl(plain) && !s.collapsed) {
    ops.formatText((sp, f, to) => M.setAttr(sp, f, to, 'href', plain.trim()));
    return;
  }
  if (plain && isLoneUrl(plain) && s.collapsed && !M.lengthOf(b.spans)) {
    ops.snapshot();
    const href = plain.trim();
    b.spans = [{ t: href, href }];
    ops.refreshText(id);
    ops.setSelection(id, href.length);
    changed();
    return;
  }
  const parsed = html ? htmlToBlocks(html) : textToBlocks(plain);
  // Pasted code or text with no structure: plain text wins.
  if (!parsed.blocks.length && plain) { pasteBlocks(id, s, textToBlocks(plain)); return; }
  pasteBlocks(id, s, parsed);
}

// Plain text from the menu's Paste: into the block with the caret.
export function pastePlain(text) {
  const s = ops.selection();
  if (!s || !text) return;
  pasteBlocks(s.id, s, textToBlocks(text));
}

// Copy and cut keep the text readable elsewhere and Ethos-shaped in here.
function onCopy(e) {
  const s = ops.selection();
  if (!s || s.collapsed || s.a.id !== s.f.id) return;
  const b = ops.block(s.id);
  const spans = M.slice(b.spans, s.start.off, s.end.off);
  e.clipboardData.setData('text/plain', M.textOf(spans));
  e.clipboardData.setData('text/html', spansToHtml(spans));
  e.preventDefault();
  if (e.type === 'cut') {
    ops.snapshot();
    b.spans = M.deleteRange(b.spans, s.start.off, s.end.off);
    ops.refreshText(s.id);
    ops.setSelection(s.id, s.start.off);
    changed();
  }
}

// HTML for the clipboard, built from elements (never from strings of user text).
export function spansToHtml(spans) {
  const root = document.createElement('div');
  const TAG = { b: 'strong', i: 'em', u: 'u', s: 's', code: 'code', sup: 'sup', sub: 'sub' };
  for (const s of spans) {
    if (M.isAtom(s)) continue;
    let node = document.createTextNode(s.t);
    for (const m of s.m || []) { const e = document.createElement(TAG[m]); e.appendChild(node); node = e; }
    if (s.href) { const a = document.createElement('a'); a.setAttribute('href', s.href); a.appendChild(node); node = a; }
    root.appendChild(node);
  }
  return root.innerHTML;
}

export function attach() {
  const h = S.host;
  h.addEventListener('beforeinput', onBeforeInput);
  h.addEventListener('input', onInput);
  h.addEventListener('keydown', onKeydown);
  h.addEventListener('paste', onPaste);
  h.addEventListener('copy', onCopy);
  h.addEventListener('cut', onCopy);
  // A click on a link places the caret; Ctrl+click opens it.
  h.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.eb-text a');
    if (!a) return;
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && /^https:/i.test(a.getAttribute('href') || '')) window.open(a.getAttribute('href'));
  });
  // The block that last had the caret, for the menus.
  h.addEventListener('focusin', (e) => { const r = e.target.closest && e.target.closest('.eb'); if (r) S.lastId = r.dataset.id; });
  void COMMANDS;
}
