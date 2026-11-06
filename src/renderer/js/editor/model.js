// The rich-text model: pure functions over spans and blocks, no DOM.
//
// A span is { t, m?, c?, bg?, href?, fn? }: text with marks (b i u s code sup
// sub), a text colour, a highlight, a link, or (fn) a footnote, which has no
// text and counts as one character. A block is { id, type, indent, ... } as in
// schema.js. Offsets are in characters of the flattened block, where a footnote
// is the single character U+FFFC.

export const TEXT_TYPES = ['p', 'h1', 'h2', 'h3', 'caption', 'quote', 'bullet', 'number', 'todo', 'toggle'];
export const isText = (type) => TEXT_TYPES.includes(type);
export const MAX_INDENT = 6;
export const ATOM = '￼';

// Same shape as schema.js key(): [a-z0-9]{1,24}.
export function newKey() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, '0') + Date.now().toString(36).slice(-4);
}

export const isAtom = (s) => s.fn !== undefined;
export const lengthOf = (spans) => spans.reduce((n, s) => n + (isAtom(s) ? 1 : s.t.length), 0);
export const flat = (spans) => spans.map(s => (isAtom(s) ? ATOM : s.t)).join('');
// Text without footnotes, for display in places that cannot show them.
export const textOf = (spans) => spans.map(s => (isAtom(s) ? '' : s.t)).join('');

const keyOf = (s) => JSON.stringify([s.m || null, s.c || null, s.bg || null, s.href || null]);

// Drops empty spans, joins neighbours with the same look, sorts marks.
export function normalize(spans) {
  const out = [];
  for (const s of spans) {
    if (!isAtom(s) && s.t === '') continue;
    const c = { ...s };
    if (c.m) { c.m = ['b', 'i', 'u', 's', 'code', 'sup', 'sub'].filter(x => c.m.includes(x)); if (!c.m.length) delete c.m; }
    for (const k of ['c', 'bg', 'href']) if (c[k] === null || c[k] === undefined) delete c[k];
    const last = out[out.length - 1];
    if (last && !isAtom(last) && !isAtom(c) && keyOf(last) === keyOf(c)) last.t += c.t;
    else out.push(c);
  }
  return out;
}

// Splits at an offset: [before, after].
export function splitAt(spans, off) {
  const left = [];
  const right = [];
  let pos = 0;
  for (const s of spans) {
    const len = isAtom(s) ? 1 : s.t.length;
    if (pos + len <= off) left.push(s);
    else if (pos >= off) right.push(s);
    else {
      left.push({ ...s, t: s.t.slice(0, off - pos) });
      right.push({ ...s, t: s.t.slice(off - pos) });
    }
    pos += len;
  }
  return [normalize(left), normalize(right)];
}

export function slice(spans, from, to) {
  const [, rest] = splitAt(spans, from);
  return splitAt(rest, to - from)[0];
}

export function deleteRange(spans, from, to) {
  if (from >= to) return spans;
  return normalize([...splitAt(spans, from)[0], ...splitAt(spans, to)[1]]);
}

// The look a typed character takes: that of the character before the caret.
// A link is not carried on, so typing at its end leaves the link.
export function marksAt(spans, off) {
  let pos = 0;
  let found = null;
  for (const s of spans) {
    const len = isAtom(s) ? 1 : s.t.length;
    if (!isAtom(s) && (off > pos && off <= pos + len)) { found = s; break; }
    pos += len;
  }
  if (!found && off === 0) found = spans.find(s => !isAtom(s)) || null;
  if (!found) return {};
  const out = {};
  if (found.m) out.m = [...found.m];
  if (found.c) out.c = found.c;
  if (found.bg) out.bg = found.bg;
  return out;
}

// Is the character before `off` in a link that stops there?
export function endsLink(spans, off) {
  let pos = 0;
  for (const s of spans) {
    const len = isAtom(s) ? 1 : s.t.length;
    if (!isAtom(s) && s.href && pos + len === off) return true;
    pos += len;
  }
  return false;
}

export function insertText(spans, off, text, look = {}) {
  const [l, r] = splitAt(spans, off);
  const mid = { t: text };
  if (look.m && look.m.length) mid.m = [...look.m];
  if (look.c) mid.c = look.c;
  if (look.bg) mid.bg = look.bg;
  return normalize([...l, mid, ...r]);
}

export function insertAtom(spans, off, atom) {
  const [l, r] = splitAt(spans, off);
  return normalize([...l, atom, ...r]);
}

// Applies fn to the spans inside [from, to) only.
function mapRange(spans, from, to, fn) {
  const [pre, rest] = splitAt(spans, from);
  const [mid, post] = splitAt(rest, to - from);
  return normalize([...pre, ...mid.map(s => (isAtom(s) ? s : fn(s))), ...post]);
}

export function hasMark(spans, from, to, mark) {
  const mid = slice(spans, from, to).filter(s => !isAtom(s));
  return mid.length > 0 && mid.every(s => (s.m || []).includes(mark));
}

// All of it marked: take the mark off. Otherwise put it on. Superscript and
// subscript replace each other.
export function toggleMark(spans, from, to, mark) {
  if (from >= to) return spans;
  const off = hasMark(spans, from, to, mark);
  return mapRange(spans, from, to, (s) => {
    let m = new Set(s.m || []);
    if (off) m.delete(mark);
    else {
      m.add(mark);
      if (mark === 'sup') m.delete('sub');
      if (mark === 'sub') m.delete('sup');
    }
    const c = { ...s };
    if (m.size) c.m = [...m]; else delete c.m;
    return c;
  });
}

// key is c, bg or href; value null removes it.
export function setAttr(spans, from, to, key, value) {
  if (from >= to) return spans;
  return mapRange(spans, from, to, (s) => {
    const c = { ...s };
    if (value === null || value === undefined) delete c[key]; else c[key] = value;
    return c;
  });
}

export function clearFormatting(spans, from, to) {
  if (from >= to) return spans;
  return mapRange(spans, from, to, (s) => {
    const c = { ...s };
    delete c.m; delete c.c; delete c.bg;
    return c;
  });
}

export function attrAt(spans, from, to, key) {
  const mid = slice(spans, from, to).filter(s => !isAtom(s));
  if (!mid.length) return null;
  const v = mid[0][key] || null;
  return mid.every(s => (s[key] || null) === v) ? v : null;
}

export function newBlock(type = 'p', extra = {}) {
  const b = { id: newKey(), type, indent: 0, ...extra };
  if (isText(type)) {
    if (!b.align) b.align = 'left';
    if (!b.spans) b.spans = [];
    if (type === 'todo' && b.checked === undefined) b.checked = false;
    if (type === 'toggle' && b.open === undefined) b.open = true;
  }
  return b;
}

// The blocks that belong to a toggle: the ones after it that sit deeper.
export function toggleRange(blocks, index) {
  const base = blocks[index].indent;
  let j = index + 1;
  while (j < blocks.length && blocks[j].indent > base) j += 1;
  return [index + 1, j];
}

// The list number of a numbered block: how many numbered blocks of its level
// came before it without anything shallower in between.
export function numberOf(blocks, index) {
  const ind = blocks[index].indent;
  let n = 1;
  for (let i = index - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.indent > ind) continue;
    if (b.indent === ind && b.type === 'number') n += 1;
    else break;
  }
  return n;
}

const roman = (n) => {
  const t = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
  return out;
};

export function numberLabel(n, indent) {
  const level = indent % 3;
  if (level === 0) return n + '.';
  if (level === 1) return String.fromCharCode(96 + ((n - 1) % 26) + 1) + '.';
  return roman(n) + '.';
}

export const BULLETS = ['•', '◦', '▪'];

// Ids of blocks hidden because a toggle above them is closed.
export function hiddenIds(blocks) {
  const hidden = new Set();
  let until = null;
  for (const b of blocks) {
    if (until !== null && b.indent > until) { hidden.add(b.id); continue; }
    until = null;
    if (b.type === 'toggle' && !b.open) until = b.indent;
  }
  return hidden;
}

// Footnote texts in document order, for numbering.
export function footnotes(blocks) {
  const out = [];
  for (const b of blocks) {
    if (!isText(b.type)) continue;
    b.spans.forEach((s, si) => { if (isAtom(s)) out.push({ blockId: b.id, spanIndex: si, text: s.fn }); });
  }
  return out;
}

// Plain text of a block, for copy, search and conversion.
export function blockText(b, tables = []) {
  if (isText(b.type)) return textOf(b.spans);
  if (b.type === 'code') return b.text;
  if (b.type === 'image') return textOf(b.caption || []);
  if (b.type === 'bookmark') return (b.title + ' ' + b.url).trim();
  if (b.type === 'table') {
    const t = tables.find(x => x.id === b.table);
    return t ? t.title : '';
  }
  return '';
}

// Spans from plain text, one span; newlines stay as \n.
export const spansFrom = (text) => (text ? [{ t: text }] : []);
