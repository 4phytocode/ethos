// Drawing a block, and reading its text back out of the page.
//
// Spans become nested elements in a fixed order (link, bold, italic, underline,
// strike, code, sup, sub, colour); reading walks the same elements back to
// spans from tag names and data attributes only, never from computed style or
// markup the browser may have added. Offsets count a line break and a footnote
// as one character each.

import { isText, normalize, lengthOf, flat, BULLETS } from './model.js';

const MARK_TAG = { b: 'strong', i: 'em', u: 'u', s: 's', code: 'code', sup: 'sup', sub: 'sub' };
// Innermost first, so wrapping builds the tree from the inside out.
const WRAP_ORDER = ['sub', 'sup', 'code', 's', 'u', 'i', 'b'];
export const PLACEHOLDER = {
  p: 'Type, or right-click to insert', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', caption: 'Caption',
  quote: 'Quote', bullet: 'List', number: 'List', todo: 'To-do', toggle: 'Toggle',
};
const HEADING_LEVEL = { h1: 1, h2: 2, h3: 3 };

function textFragment(text) {
  const frag = document.createDocumentFragment();
  text.split('\n').forEach((part, i) => {
    if (i > 0) frag.appendChild(document.createElement('br'));
    if (part) frag.appendChild(document.createTextNode(part));
  });
  return frag;
}

export function footnoteEl(text) {
  const sup = document.createElement('sup');
  sup.className = 'fn';
  sup.contentEditable = 'false';
  sup.dataset.fn = text;
  sup.textContent = '​';
  return sup;
}

export function renderSpan(s) {
  if (s.fn !== undefined) return footnoteEl(s.fn);
  let node = textFragment(s.t);
  if (s.c || s.bg) {
    const e = document.createElement('span');
    e.className = 'ec';
    if (s.c) { e.dataset.c = s.c; e.style.color = s.c; }
    if (s.bg) { e.dataset.bg = s.bg; e.style.backgroundColor = s.bg + '59'; }
    e.appendChild(node);
    node = e;
  }
  const marks = s.m || [];
  for (const m of WRAP_ORDER) {
    if (!marks.includes(m)) continue;
    const e = document.createElement(MARK_TAG[m]);
    e.appendChild(node);
    node = e;
  }
  if (s.href) {
    const a = document.createElement('a');
    a.setAttribute('href', s.href);
    a.setAttribute('rel', 'noopener noreferrer');
    a.appendChild(node);
    node = a;
  }
  return node;
}

// The children of a text block. A block that ends in a line break gets a hidden
// tail <br>, because a browser will not show the empty last line otherwise.
export function renderSpans(spans) {
  const frag = document.createDocumentFragment();
  for (const s of spans) frag.appendChild(renderSpan(s));
  const f = flat(spans);
  if (f.endsWith('\n')) {
    const tail = document.createElement('br');
    tail.dataset.tail = '1';
    frag.appendChild(tail);
  }
  return frag;
}

const isFn = (n) => n.nodeType === 1 && n.classList.contains('fn');
const isBr = (n) => n.nodeType === 1 && n.tagName === 'BR';
const isTail = (n) => isBr(n) && n.dataset.tail === '1';

// ─── Reading ───

const HTTP = /^https?:\/\//i;

function walk(node, look, out) {
  if (node.nodeType === 3) {
    if (node.nodeValue) out.push({ t: node.nodeValue, ...copyLook(look) });
    return;
  }
  if (node.nodeType !== 1) return;
  if (isFn(node)) { out.push({ t: '', fn: node.dataset.fn || '' }); return; }
  if (isBr(node)) { if (!isTail(node)) out.push({ t: '\n', ...copyLook(look) }); return; }
  const next = copyLook(look);
  switch (node.tagName) {
    case 'STRONG': case 'B': add(next, 'b'); break;
    case 'EM': case 'I': add(next, 'i'); break;
    case 'U': add(next, 'u'); break;
    case 'S': case 'STRIKE': case 'DEL': add(next, 's'); break;
    case 'CODE': add(next, 'code'); break;
    case 'SUP': add(next, 'sup'); break;
    case 'SUB': add(next, 'sub'); break;
    case 'A': { const h = node.getAttribute('href'); if (h && HTTP.test(h)) next.href = h; break; }
    default: break;
  }
  if (node.dataset && node.dataset.c) next.c = node.dataset.c;
  if (node.dataset && node.dataset.bg) next.bg = node.dataset.bg;
  for (const c of node.childNodes) walk(c, next, out);
}
function copyLook(l) { return { ...l, m: l.m ? [...l.m] : undefined }; }
function add(look, m) { look.m = look.m || []; if (!look.m.includes(m)) look.m.push(m); }

export function readSpans(textEl) {
  // A browser leaves a lone <br> in an emptied line; that is not a line break.
  if (textEl.childNodes.length === 1 && isBr(textEl.firstChild) && !isTail(textEl.firstChild)) textEl.firstChild.remove();
  const out = [];
  for (const c of textEl.childNodes) walk(c, {}, out);
  return normalize(out.map(s => { const c = { ...s }; if (!c.m) delete c.m; return c; }));
}

// ─── Offsets ───

export function lenOf(node) {
  if (node.nodeType === 3) return node.nodeValue.length;
  if (isFn(node)) return 1;
  if (isBr(node)) return isTail(node) ? 0 : 1;
  let n = 0;
  for (const c of node.childNodes) n += lenOf(c);
  return n;
}

export function offsetOf(root, target, targetOffset) {
  let count = 0;
  let done = false;
  (function visit(n) {
    if (done) return;
    if (n === target) {
      if (n.nodeType === 3) count += targetOffset;
      else for (let i = 0; i < targetOffset && i < n.childNodes.length; i++) count += lenOf(n.childNodes[i]);
      done = true;
      return;
    }
    if (n.nodeType === 3 || isFn(n) || isBr(n)) { count += lenOf(n); return; }
    for (const c of n.childNodes) { visit(c); if (done) return; }
  })(root);
  return count;
}

export function positionAt(root, off) {
  let count = 0;
  let result = null;
  const index = (n) => Array.prototype.indexOf.call(n.parentNode.childNodes, n);
  (function visit(n) {
    if (result) return;
    if (n.nodeType === 3) {
      const len = n.nodeValue.length;
      if (off <= count + len) { result = { node: n, offset: off - count }; return; }
      count += len;
      return;
    }
    if (n.nodeType !== 1) return;
    if (isFn(n) || isBr(n)) {
      const len = lenOf(n);
      if (off <= count) { result = { node: n.parentNode, offset: index(n) }; return; }
      count += len;
      if (len && off === count) result = { node: n.parentNode, offset: index(n) + 1 };
      return;
    }
    for (const c of n.childNodes) { visit(c); if (result) return; }
  })(root);
  return result || { node: root, offset: root.childNodes.length };
}

// ─── Blocks ───

function mk(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function buildSide() {
  const side = mk('div', 'eb-side');
  const plus = mk('button', 'eb-plus', '+');
  plus.type = 'button';
  plus.tabIndex = -1;
  plus.setAttribute('aria-label', 'Add a block below');
  plus.title = 'Add a block below';
  const grip = mk('button', 'eb-grip', '⋮⋮');
  grip.type = 'button';
  grip.tabIndex = -1;
  grip.draggable = false;
  grip.setAttribute('aria-label', 'Block options. Drag to move.');
  grip.title = 'Drag to move, click for options';
  side.append(plus, grip);
  return side;
}

// Indent, alignment and ticked state, which change without a rebuild.
export function applyAttrs(root, b) {
  root.dataset.indent = String(b.indent || 0);
  root.style.setProperty('--ind', String(b.indent || 0));
  if (b.align) root.dataset.align = b.align;
  if (b.type === 'todo') {
    root.classList.toggle('checked', !!b.checked);
    const t = root.querySelector('.eb-tick');
    if (t) { t.setAttribute('aria-pressed', String(!!b.checked)); t.classList.toggle('on', !!b.checked); }
  }
  if (b.type === 'toggle') {
    root.classList.toggle('open', !!b.open);
    const a = root.querySelector('.eb-arrow');
    if (a) a.setAttribute('aria-expanded', String(!!b.open));
  }
}

export function buildTextBlock(b) {
  const root = mk('div', 'eb eb-' + b.type);
  root.dataset.id = b.id;
  root.dataset.type = b.type;
  if (HEADING_LEVEL[b.type]) { root.setAttribute('role', 'heading'); root.setAttribute('aria-level', String(HEADING_LEVEL[b.type])); }
  root.appendChild(buildSide());
  const row = mk('div', 'eb-row');
  if (b.type === 'bullet' || b.type === 'number') {
    const m = mk('span', 'eb-mark', b.type === 'bullet' ? BULLETS[(b.indent || 0) % 3] : '1.');
    m.contentEditable = 'false';
    m.setAttribute('aria-hidden', 'true');
    row.appendChild(m);
  } else if (b.type === 'todo') {
    const t = mk('button', 'eb-tick');
    t.type = 'button';
    t.tabIndex = -1;
    t.setAttribute('role', 'checkbox');
    t.setAttribute('aria-label', 'Done');
    row.appendChild(t);
  } else if (b.type === 'toggle') {
    const a = mk('button', 'eb-arrow');
    a.type = 'button';
    a.tabIndex = -1;
    a.setAttribute('aria-label', 'Show or hide what is inside');
    row.appendChild(a);
  }
  const text = mk('div', 'eb-text');
  text.contentEditable = 'true';
  text.spellcheck = true;
  text.setAttribute('role', 'textbox');
  text.setAttribute('aria-multiline', 'true');
  text.dataset.placeholder = PLACEHOLDER[b.type] || '';
  text.setAttribute('data-typing-sound', '');
  text.appendChild(renderSpans(b.spans));
  row.appendChild(text);
  root.appendChild(row);
  applyAttrs(root, b);
  return root;
}

export { isText, lengthOf };
