// The toolbar above a note and the small bubble over selected text. Both run
// commands from commands.js; their buttons do not take focus (mousedown is
// cancelled), so the selection they act on stays where it is.

import { S } from './state.js';
import * as ops from './ops.js';
import * as M from './model.js';
import { COMMANDS, runCommand, setColor, setHighlight, colorOf } from './commands.js';
import { showCtx } from '../views.js';
import { icon } from '../icons.js';
import { tagColorPalette } from '../state.js';
import { COLOR_NAMES } from './handles.js';
import { insertTable, insertCode } from './insert-menu.js';
import { TEMPLATES } from '../notes-table.js';

let bar = null;
let bubble = null;
let ovr = null;
let styleBtn = null;
const buttons = [];        // { el, id }

const STYLES = [['p', 'Body'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['caption', 'Caption'], ['quote', 'Quote']];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function below(button) { const r = button.getBoundingClientRect(); return { x: r.left, y: r.bottom + 2 }; }

function paletteMenu(button, key) {
  const set = key === 'c' ? setColor : setHighlight;
  const now = colorOf(key);
  showCtx(below(button), [
    { label: 'None', checked: !now, onClick: () => set(null) },
    ...tagColorPalette().map((c, i) => ({ label: COLOR_NAMES[i] || c, color: c, checked: now === c, onClick: () => set(c) })),
  ]);
}

function styleMenu(button) {
  const ids = ops.targetBlocks();
  const cur = ids.length ? ops.block(ids[0]).type : 'p';
  showCtx(below(button), STYLES.map(([t, label]) => ({
    label, checked: cur === t,
    onClick: () => { const run = { p: 'body', h1: 'h1', h2: 'h2', h3: 'h3', caption: 'caption', quote: 'quote' }[t]; if (cur !== t) runCommand(run); else if (t !== 'p') runCommand('body'); },
  })));
}

function make(id, label, title, onClick, opts = {}) {
  const b = el('button', 'tb-btn' + (opts.cls ? ' ' + opts.cls : ''));
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title.replace(/\s*\(.*\)$/, ''));
  if (opts.icon) b.appendChild(icon(opts.icon, 16)); else b.textContent = label;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  // The shared menu closes on any click that reaches the document, so a button that opens one stops it here.
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(b); });
  if (opts.toggle !== false) b.setAttribute('aria-pressed', 'false');
  buttons.push({ el: b, id, opts });
  return b;
}

function cmd(id, label, opts = {}) {
  const c = COMMANDS[id];
  return make(id, label, c.label + (c.hint ? ' (' + c.hint + ')' : ''), () => c.run(), opts);
}

const sep = () => el('span', 'tb-sep');

export function mount(container, before) {
  bar = el('div', 'ed-toolbar');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formatting');

  styleBtn = make('style', 'Body', 'Text style', styleMenu, { toggle: false, cls: 'tb-style' });
  styleBtn.setAttribute('aria-haspopup', 'menu');
  const imageBtn = make('image', '', 'Insert an image', () => S.hooks.pickImage && S.hooks.pickImage(), { icon: 'image', toggle: false });
  const tableBtn = make('table', 'Table', 'Insert a table', (b) => showCtx(below(b), TEMPLATES.map(t => ({ label: t.label, onClick: () => insertTable(t.id) }))), { toggle: false });
  const codeBtn = make('codeblock', '</>', 'Insert a code block', () => insertCode(), { toggle: false, cls: 'tb-mono' });
  const noteBtn = make('footnote', 'fn', 'Insert a footnote (Ctrl+Alt+F)', () => S.hooks.footnote && S.hooks.footnote(), { toggle: false });
  const colorBtn = make('color', 'A', 'Text colour', (b) => paletteMenu(b, 'c'), { toggle: false, cls: 'tb-color' });
  const hiBtn = make('highlight', 'A', 'Highlight', (b) => paletteMenu(b, 'bg'), { toggle: false, cls: 'tb-hi' });
  ovr = el('span', 'tb-ovr', 'OVR');
  ovr.title = 'Insert mode: typing replaces the next character. Press Insert to switch back.';
  ovr.hidden = true;

  bar.append(
    cmd('undo', '', { icon: 'undo', toggle: false }), cmd('redo', '', { icon: 'redo', toggle: false }), sep(),
    styleBtn, sep(),
    cmd('bold', 'B', { cls: 'tb-b' }), cmd('italic', 'I', { cls: 'tb-i' }), cmd('underline', 'U', { cls: 'tb-u' }), cmd('strike', 'S', { cls: 'tb-s' }),
    cmd('code', '<>', { cls: 'tb-mono' }), cmd('sup', 'x²'), cmd('sub', 'x₂'), sep(),
    colorBtn, hiBtn, sep(),
    cmd('alignLeft', '⇤'), cmd('alignCenter', '↔'), cmd('alignRight', '⇥'), cmd('alignJustify', '☰'), sep(),
    cmd('bullet', '•'), cmd('number', '1.'), cmd('todo', '☐'), cmd('outdent', '←', { toggle: false }), cmd('indent', '→', { toggle: false }), sep(),
    cmd('link', '', { icon: 'link', toggle: false }), imageBtn, tableBtn, codeBtn, noteBtn, sep(),
    cmd('find', '', { icon: 'search', toggle: false }), ovr,
  );
  container.insertBefore(bar, before);

  // The bubble over selected text.
  bubble = el('div', 'ed-bubble menu');
  bubble.hidden = true;
  bubble.setAttribute('role', 'toolbar');
  bubble.addEventListener('mousedown', (e) => e.preventDefault());
  const bub = (id, label, cls) => {
    const c = COMMANDS[id];
    const b = el('button', 'tb-btn ' + (cls || ''), label);
    b.type = 'button';
    b.title = c.label + (c.hint ? ' (' + c.hint + ')' : '');
    b.setAttribute('aria-label', c.label);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', (e) => { e.stopPropagation(); c.run(); });
    buttons.push({ el: b, id, opts: {} });
    return b;
  };
  const bc = el('button', 'tb-btn tb-color', 'A');
  bc.type = 'button'; bc.title = 'Text colour'; bc.setAttribute('aria-label', 'Text colour');
  bc.addEventListener('click', (e) => { e.stopPropagation(); paletteMenu(bc, 'c'); });
  const bh = el('button', 'tb-btn tb-hi', 'A');
  bh.type = 'button'; bh.title = 'Highlight'; bh.setAttribute('aria-label', 'Highlight');
  bh.addEventListener('click', (e) => { e.stopPropagation(); paletteMenu(bh, 'bg'); });
  const turn = el('button', 'tb-btn', 'Turn into ▾');
  turn.type = 'button';
  turn.addEventListener('click', (e) => { e.stopPropagation(); styleMenu(turn); });
  bubble.append(bub('bold', 'B', 'tb-b'), bub('italic', 'I', 'tb-i'), bub('underline', 'U', 'tb-u'), bub('strike', 'S', 'tb-s'), bub('code', '<>', 'tb-mono'), bub('link', 'Link'), bc, bh, turn);
  document.body.appendChild(bubble);

  S.hooks.refreshUI = refresh;
  document.addEventListener('selectionchange', refresh);
  window.addEventListener('scroll', refresh, true);
  window.addEventListener('resize', refresh);
  refresh();
}

let raf = 0;
export function refresh() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; paint(); });
}

function paint() {
  if (!bar) return;
  const live = document.getElementById('nt-doc') && !document.getElementById('nt-doc').hidden;
  for (const { el: b, id } of buttons) {
    const c = COMMANDS[id];
    if (!c) continue;
    if (c.active) { const on = !!live && !!c.active(); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); }
    if (c.enabled) b.disabled = !c.enabled();
  }
  const ids = ops.targetBlocks();
  const cur = ids.length ? ops.block(ids[0]) : null;
  const names = { p: 'Body', h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', caption: 'Caption', quote: 'Quote', bullet: 'List', number: 'List', todo: 'Tasks', toggle: 'Toggle', code: 'Code' };
  styleBtn.textContent = (cur && names[cur.type]) || 'Body';
  ovr.hidden = !S.overwrite;
  const sel = ops.selection();
  const range = window.getSelection();
  if (live && sel && !sel.collapsed && range.rangeCount) {
    const r = range.getRangeAt(0).getBoundingClientRect();
    if (r.width || r.height) {
      bubble.hidden = false;
      const box = bubble.getBoundingClientRect();
      const left = Math.max(4, Math.min(r.left + r.width / 2 - box.width / 2, window.innerWidth - box.width - 4));
      const top = r.top - box.height - 8 < 4 ? r.bottom + 8 : r.top - box.height - 8;
      bubble.style.left = left + 'px';
      bubble.style.top = top + 'px';
      return;
    }
  }
  bubble.hidden = true;
}

export function unmountBubble() { if (bubble) bubble.hidden = true; }
void M;
