// The drawn caret. The browser's own caret is hidden in the editor
// (caret-color: transparent) and this one is drawn in its place, so it can glide
// to where you type, and so the Insert key can turn it into a block like the
// cursor in a terminal. In Insert (overwrite) mode it covers the next character
// and inverts it, and typing replaces that character.
//
// It is measured from the selection's own range, so it is right for any font,
// size and wrapping, and it never touches the text.

import { S } from './state.js';

let el = null;
let host = null;
let frame = 0;
let lastY = null;
let widthCache = { font: '', w: 8 };

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function lineHeightOf(node) {
  const cs = getComputedStyle(node);
  return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.7 || 24;
}

// The width of "0" in the block's font: what a block caret is at the end of a line.
function zeroWidth(node) {
  const cs = getComputedStyle(node);
  if (widthCache.font !== cs.font) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = cs.font;
    widthCache = { font: cs.font, w: ctx.measureText('0').width || 8 };
  }
  return widthCache.w;
}

// { left, top, height, width } in viewport pixels for the caret in a text block;
// null when the selection is not a bare caret in the editor.
export function caretRect() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed || !sel.anchorNode) return null;
  const node = sel.anchorNode;
  const own = node.nodeType === 3 ? node.parentElement : node;
  const t = own && own.closest ? own.closest('.eb-text') : null;
  if (!t || !host.contains(t)) return null;
  const range = sel.getRangeAt(0);
  const lh = lineHeightOf(t);
  let rect = range.getClientRects()[0];
  let left;
  let top;
  let height;
  if (rect && (rect.width > 0 || rect.height > 0)) {
    left = rect.left; top = rect.top; height = rect.height;
  } else if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
    const r2 = document.createRange();
    r2.setStart(range.startContainer, range.startOffset - 1);
    r2.setEnd(range.startContainer, range.startOffset);
    rect = r2.getClientRects()[0];
    if (rect) { left = rect.right; top = rect.top; height = rect.height; }
  }
  if (left === undefined) {
    const box = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const pl = parseFloat(cs.paddingLeft) || 0;
    left = box.left + (cs.textAlign === 'center' ? box.width / 2 : cs.textAlign === 'right' ? box.width - 2 : pl);
    top = box.top + (parseFloat(cs.paddingTop) || 0);
    height = lh;
  }
  // The width of what sits under a block caret.
  let width = zeroWidth(t);
  if (S.overwrite && range.startContainer.nodeType === 3 && range.startOffset < range.startContainer.nodeValue.length) {
    const r3 = document.createRange();
    r3.setStart(range.startContainer, range.startOffset);
    r3.setEnd(range.startContainer, range.startOffset + 1);
    const cr = r3.getClientRects()[0];
    if (cr && cr.width > 0) width = cr.width;
  }
  return { left, top, height: height || lh, width, node: t };
}

function codeCaret() {
  const a = document.activeElement;
  if (!a || !a.classList || !a.classList.contains('code-in') || !host.contains(a)) return null;
  return S.codeCaret ? S.codeCaret(a) : null;
}

function active() {
  if (!document.hasFocus()) return false;
  const a = document.activeElement;
  return !!a && host.contains(a) && (a.classList.contains('eb-text') || a.classList.contains('code-in'));
}

export function update() {
  if (!el) return;
  frame = 0;
  const sel = window.getSelection();
  const ok = active() && (!sel || sel.isCollapsed || document.activeElement.classList.contains('code-in'));
  const info = ok ? (codeCaret() || caretRect()) : null;
  if (!info) { el.hidden = true; return; }
  const parent = el.offsetParent || el.parentElement;
  const box = parent.getBoundingClientRect();
  const x = info.left - box.left + parent.scrollLeft;
  const y = info.top - box.top + parent.scrollTop;
  // A long jump (another line far away) does not slide; a nearby move glides.
  const far = lastY !== null && Math.abs(y - lastY) > info.height * 2.2;
  el.classList.toggle('nojump', far || reduced());
  lastY = y;
  el.hidden = false;
  el.classList.toggle('block', S.overwrite);
  el.style.height = info.height + 'px';
  el.style.width = S.overwrite ? Math.max(4, info.width) + 'px' : '';
  el.style.transform = 'translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px)';
  // Solid while moving, then blinking.
  el.classList.remove('blink');
  void el.offsetWidth;
  el.classList.add('blink');
}

export function refresh() {
  if (!frame) frame = requestAnimationFrame(update);
}

// A small press as each character lands.
export function press() {
  if (!el || reduced()) return;
  el.classList.add('press');
  setTimeout(() => el && el.classList.remove('press'), 50);
}

export function mount(container, hostEl) {
  host = hostEl;
  el = document.createElement('div');
  el.className = 'ed-caret';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  container.appendChild(el);
  lastY = null;
  document.addEventListener('selectionchange', refresh);
  host.addEventListener('input', () => { press(); refresh(); });
  host.addEventListener('focusin', refresh);
  host.addEventListener('focusout', () => setTimeout(refresh, 0));
  window.addEventListener('resize', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('blur', refresh);
  container.addEventListener('scroll', refresh, true);
  document.addEventListener('scroll', refresh, true);
}

export function unmount() {
  document.removeEventListener('selectionchange', refresh);
  window.removeEventListener('resize', refresh);
  window.removeEventListener('focus', refresh);
  window.removeEventListener('blur', refresh);
  document.removeEventListener('scroll', refresh, true);
  if (el) el.remove();
  el = null;
}
