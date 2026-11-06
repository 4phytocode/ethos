// Code blocks: a textarea laid exactly over a highlighted <pre>. The textarea
// takes the typing and shows nothing (transparent text); the <pre> shows the
// same text in colour. They share font, size, padding and wrapping, so every
// character lines up, and the drawn caret (caret.js) is measured on the <pre>.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { buildSide, applyAttrs } from './dom.js';
import { tokenize, CODE_LANGS, LANG_NAMES } from './highlight.js';
import { refresh as refreshCaret } from './caret.js';

const THROTTLE_BIG = 300;
const BIG = 20000;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function paint(pre, text, lang) {
  pre.replaceChildren();
  for (const tok of tokenize(text, lang)) {
    if (tok.k === 'plain') pre.appendChild(document.createTextNode(tok.t));
    else pre.appendChild(el('span', 'tk-' + tok.k, tok.t));
  }
  // A final newline needs a character after it, or the last empty line is not drawn.
  pre.appendChild(document.createTextNode('\n'));
}

function fit(ta, scroller, b) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  if (!b.wrap) {
    ta.style.width = '0';
    ta.style.width = Math.max(ta.scrollWidth, scroller.clientWidth) + 'px';
  } else ta.style.width = '100%';
}

// The caret's place in the highlighted layer, for the drawn caret.
function caretOf(ta) {
  const root = ta.closest('.eb');
  const pre = root && root.querySelector('.code-hl');
  if (!pre || ta.selectionStart !== ta.selectionEnd) return null;
  const off = ta.selectionStart;
  let count = 0;
  let pos = null;
  const walk = (n) => {
    if (pos) return;
    if (n.nodeType === 3) {
      if (off <= count + n.nodeValue.length) { pos = { node: n, offset: off - count }; return; }
      count += n.nodeValue.length;
      return;
    }
    for (const c of n.childNodes) { walk(c); if (pos) return; }
  };
  walk(pre);
  const cs = getComputedStyle(pre);
  const lh = parseFloat(cs.lineHeight) || 20;
  let left;
  let top;
  let width = 8;
  if (pos) {
    const r = document.createRange();
    r.setStart(pos.node, pos.offset);
    r.collapse(true);
    const rects = r.getClientRects();
    if (rects[0] && (rects[0].width > 0 || rects[0].height > 0)) { left = rects[0].left; top = rects[0].top; }
    if (S.overwrite && pos.offset < pos.node.nodeValue.length) {
      const r2 = document.createRange();
      r2.setStart(pos.node, pos.offset);
      r2.setEnd(pos.node, pos.offset + 1);
      const cr = r2.getClientRects()[0];
      if (cr && cr.width > 0) width = cr.width;
    }
  }
  if (left === undefined) {
    // An empty line has no rectangle: work it out from the line number.
    const before = ta.value.slice(0, off).split('\n');
    const box = pre.getBoundingClientRect();
    left = box.left + (parseFloat(cs.paddingLeft) || 0) + (before[before.length - 1].length) * (parseFloat(cs.fontSize) * 0.6);
    top = box.top + (parseFloat(cs.paddingTop) || 0) + (before.length - 1) * lh;
  }
  return { left, top, height: lh, width };
}

export function build(b) {
  const root = el('div', 'eb eb-code');
  root.dataset.id = b.id;
  root.dataset.type = 'code';
  root.appendChild(buildSide());

  const card = el('div', 'code-card');
  const head = el('div', 'code-head');
  const lang = el('select', 'code-lang');
  lang.setAttribute('aria-label', 'Language');
  for (const l of CODE_LANGS) { const o = el('option', null, LANG_NAMES[l]); o.value = l; lang.appendChild(o); }
  lang.value = b.lang;
  const wrapBtn = el('button', 'code-btn', 'Wrap');
  wrapBtn.type = 'button';
  wrapBtn.setAttribute('aria-pressed', String(!!b.wrap));
  wrapBtn.title = 'Wrap long lines';
  const copy = el('button', 'code-btn', 'Copy');
  copy.type = 'button';
  copy.title = 'Copy the code';
  head.append(lang, el('span', 'code-grow'), wrapBtn, copy);

  const scroller = el('div', 'code-scroll');
  const stack = el('div', 'code-stack');
  const pre = el('pre', 'code-hl');
  pre.setAttribute('aria-hidden', 'true');
  const ta = el('textarea', 'code-in');
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Code');
  ta.setAttribute('data-typing-sound', '');
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocapitalize', 'off');
  ta.value = b.text;
  stack.append(pre, ta);
  scroller.appendChild(stack);
  card.append(head, scroller);
  root.appendChild(card);

  const cur = () => ops.block(b.id) || b;
  let timer = 0;
  let lastPaint = 0;
  const redraw = () => {
    const blk = cur();
    paint(pre, ta.value, blk.lang);
    scroller.classList.toggle('wrap', !!blk.wrap);
    fit(ta, scroller, blk);
    refreshCaret();
  };
  const schedule = () => {
    cancelAnimationFrame(timer);
    const wait = ta.value.length > BIG ? Math.max(0, THROTTLE_BIG - (performance.now() - lastPaint)) : 0;
    const go = () => { lastPaint = performance.now(); redraw(); };
    if (wait) timer = setTimeout(go, wait); else timer = requestAnimationFrame(go);
  };

  lang.addEventListener('change', () => { ops.snapshot(); cur().lang = lang.value; redraw(); changed(); });
  wrapBtn.addEventListener('click', () => {
    ops.snapshot();
    const blk = cur();
    blk.wrap = !blk.wrap;
    wrapBtn.setAttribute('aria-pressed', String(blk.wrap));
    redraw();
    changed();
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(ta.value); S.hooks.notify('Copied', 'The code is on the clipboard.'); } catch { S.hooks.notify('Could not copy', 'Select the code and press Ctrl+C.'); }
  });

  ta.addEventListener('beforeinput', () => {
    const now = Date.now();
    if (now - S.lastTypeAt > 800) ops.snapshot();
    S.lastTypeAt = now;
  });
  ta.addEventListener('input', () => { cur().text = ta.value; changed(); schedule(); });
  for (const ev of ['keyup', 'click', 'select', 'focus']) ta.addEventListener(ev, refreshCaret);
  ta.addEventListener('scroll', refreshCaret);
  ta.addEventListener('focus', () => { S.lastId = b.id; });

  const insert = (text, selectMode = 'end') => {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, selectMode);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const lineStart = (pos) => ta.value.lastIndexOf('\n', pos - 1) + 1;

  ta.addEventListener('keydown', (e) => {
    const v = ta.value;
    const s = ta.selectionStart;
    const en = ta.selectionEnd;
    if (e.key === 'Insert' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); S.hooks.toggleOverwrite(); return; }
    // Insert mode: the next character is replaced.
    if (S.overwrite && s === en && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && v[s] !== undefined && v[s] !== '\n') ta.setSelectionRange(s, s + 1);
    if (e.key === 'Tab') {
      e.preventDefault();
      if (s === en && !e.shiftKey) { insert('  '); return; }
      // Indent or outdent every line the selection touches.
      const a = lineStart(s);
      const block = v.slice(a, en);
      const lines = block.split('\n');
      const out = lines.map(l => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
      ta.setRangeText(out, a, en, 'select');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault();
      const line = v.slice(lineStart(s), s);
      const indent = /^\s*/.exec(line)[0];
      const opener = /[{[(:]\s*$/.test(line);
      insert('\n' + indent + (opener ? '  ' : ''));
      return;
    }
    if ((e.key === '}' || e.key === ']' || e.key === ')') && s === en) {
      const line = v.slice(lineStart(s), s);
      if (/^ {2,}$/.test(line)) { e.preventDefault(); ta.setRangeText(line.slice(2) + e.key, lineStart(s), s, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); return; }
    }
    // Leave the block: Esc, Ctrl+Enter, Down on the last line, Up on the first.
    const onLast = !v.slice(en).includes('\n');
    const onFirst = !v.slice(0, s).includes('\n');
    const i = ops.indexOf(b.id);
    if (e.key === 'Escape' || (e.key === 'Enter' && e.ctrlKey) || (e.key === 'ArrowDown' && onLast && s === en && !e.shiftKey)) {
      e.preventDefault();
      const next = S.blocks[i + 1];
      if (next) ops.focusBlock(next.id); else ops.insertBlock(i + 1, M.newBlock('p'));
      return;
    }
    if (e.key === 'ArrowUp' && onFirst && s === en && !e.shiftKey && i > 0) { e.preventDefault(); ops.focusBlock(S.blocks[i - 1].id, true); return; }
    if (e.key === 'Backspace' && v === '' && !e.ctrlKey) { e.preventDefault(); ops.removeBlocks([b.id]); }
  });
  ta.addEventListener('paste', (e) => {
    // Code is pasted as exactly the text on the clipboard.
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text === undefined || text === null) return;
    e.preventDefault();
    insert(text);
  });

  paint(pre, b.text, b.lang);
  scroller.classList.toggle('wrap', !!b.wrap);
  applyAttrs(root, b);
  requestAnimationFrame(() => fit(ta, scroller, cur()));
  return root;
}

export function register() {
  S.builders.code = build;
  S.codeCaret = caretOf;
}
