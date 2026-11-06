// Footnotes. A footnote is a span with no text and a note (`fn`) in a block; the
// page shows it as a small number, numbered 1..n in reading order, and lists the
// notes under the last block. The text lives on the span, so copying a block
// copies its notes.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';

let listEl = null;
let signature = '';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// Offset of a span inside its block.
function offsetOfSpan(b, si) {
  let off = 0;
  for (let i = 0; i < si; i++) off += M.isAtom(b.spans[i]) ? 1 : b.spans[i].t.length;
  return off;
}

export function insertFootnote() {
  const s = ops.selection();
  if (!s) return;
  const b = ops.block(s.id);
  ops.snapshot();
  const at = s.end.off;
  b.spans = M.insertAtom(b.spans, at, { t: '', fn: '' });
  ops.refreshText(s.id);
  ops.setSelection(s.id, at + 1);
  changed();
  // Straight into the note's text.
  const notes = M.footnotes(S.blocks);
  const idx = notes.findIndex(n => n.blockId === s.id && offsetOfSpan(b, n.spanIndex) === at);
  const input = listEl && listEl.querySelectorAll('.fnl-text')[idx];
  if (input) { input.focus(); input.scrollIntoView({ block: 'nearest' }); }
}

function removeAt(blockId, si) {
  const b = ops.block(blockId);
  if (!b) return;
  ops.snapshot();
  b.spans = M.normalize(b.spans.filter((_, i) => i !== si));
  ops.refreshText(blockId);
  changed();
}

function renderList() {
  if (!listEl) return;
  const notes = M.footnotes(S.blocks);
  const sig = notes.map(n => n.blockId + ':' + n.spanIndex).join('|');
  // Numbers and tooltips are kept up to date without rebuilding the rows, so a
  // note being typed in keeps its focus.
  S.host.querySelectorAll('.fn').forEach((f) => { f.title = f.dataset.fn || 'Footnote'; });
  listEl.hidden = notes.length === 0;
  if (sig === signature) return;
  signature = sig;
  listEl.replaceChildren();
  if (!notes.length) return;
  listEl.appendChild(el('h2', 'fnl-head', 'Footnotes'));
  const ol = el('ol', 'fnl-list');
  notes.forEach((n, i) => {
    const li = el('li', 'fnl-row');
    li.dataset.n = String(i + 1);
    const input = el('input', 'fnl-text');
    input.type = 'text';
    input.maxLength = 1000;
    input.value = n.text;
    input.placeholder = 'Footnote text';
    input.setAttribute('aria-label', 'Footnote ' + (i + 1));
    const live = () => { const b = ops.block(n.blockId); return b && b.spans[n.spanIndex] && M.isAtom(b.spans[n.spanIndex]) ? b : null; };
    input.addEventListener('beforeinput', () => { const now = Date.now(); if (now - S.lastTypeAt > 800) ops.snapshot(); S.lastTypeAt = now; });
    input.addEventListener('input', () => {
      const b = live();
      if (!b) return;
      b.spans[n.spanIndex].fn = input.value;
      const marker = ops.textEl(n.blockId).querySelectorAll('.fn')[b.spans.slice(0, n.spanIndex).filter(M.isAtom).length];
      if (marker) { marker.dataset.fn = input.value; marker.title = input.value || 'Footnote'; }
      changed();
    });
    const back = el('button', 'fnl-btn', '↩');
    back.type = 'button';
    back.title = 'Back to the text';
    back.setAttribute('aria-label', 'Back to footnote ' + (i + 1) + ' in the text');
    back.addEventListener('click', () => { const b = live(); if (b) ops.setSelection(n.blockId, offsetOfSpan(b, n.spanIndex) + 1); });
    const del = el('button', 'fnl-btn', '×');
    del.type = 'button';
    del.title = 'Delete this footnote';
    del.setAttribute('aria-label', 'Delete footnote ' + (i + 1));
    del.addEventListener('click', () => removeAt(n.blockId, n.spanIndex));
    li.append(el('span', 'fnl-num', String(i + 1)), input, back, del);
    ol.appendChild(li);
  });
  listEl.appendChild(ol);
}

export function mount(container) {
  listEl = el('section', 'fnl');
  listEl.hidden = true;
  listEl.setAttribute('aria-label', 'Footnotes');
  container.appendChild(listEl);
  signature = '';
  S.after.push(renderList);
  // A click on a marker goes to its note.
  S.host.addEventListener('click', (e) => {
    const f = e.target.closest && e.target.closest('.fn');
    if (!f) return;
    const n = Number(f.dataset.n);
    const row = listEl.querySelectorAll('.fnl-text')[n - 1];
    if (row) { row.focus(); row.scrollIntoView({ block: 'nearest' }); }
  });
}

export function reset() { signature = ''; renderList(); }
