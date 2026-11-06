// The block editor for a Notes page. notes.js owns the page (which note is open,
// saving, links, the tree); this owns what is inside it: blocks of text, lists,
// code, images, tables, and everything you can do to them.
//
//   initEditor({ host, doc, before, onChange, notify })   once, at start
//   openPage(page) / closePage()                          when a note opens or closes
//   getBlocks() / getTables()                             what to save
//
// The model is S.blocks (state.js). See ops.js for how it is changed and
// model.js for its shape, which is the shape schema.js validates.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import * as caret from './caret.js';
import * as keys from './keys.js';
import * as handles from './handles.js';
import * as insertMenu from './insert-menu.js';
import * as toolbar from './toolbar.js';
import * as find from './find.js';
import * as footnotes from './footnotes.js';
import * as code from './code.js';
import * as image from './image.js';
import { buildSide, applyAttrs } from './dom.js';
import { buildTable } from '../notes-table.js';
import { showCtx } from '../views.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ─── The block types that are not text ───

function buildDivider(b) {
  const root = el('div', 'eb eb-divider');
  root.dataset.id = b.id;
  root.dataset.type = 'divider';
  root.tabIndex = -1;
  root.appendChild(buildSide());
  const rule = el('div', 'eb-rule');
  rule.setAttribute('role', 'separator');
  root.appendChild(rule);
  root.addEventListener('click', (e) => { if (!e.target.closest('.eb-side')) handles.selectBlock(b.id); });
  applyAttrs(root, b);
  return root;
}

function buildTableBlock(b) {
  const root = el('div', 'eb eb-table');
  root.dataset.id = b.id;
  root.dataset.type = 'table';
  root.appendChild(buildSide());
  const island = el('div', 'tbl-island');
  const t = S.tables.find(x => x.id === b.table);
  if (t) {
    island.appendChild(buildTable(t, {
      onChange: (_t, immediate) => changed(immediate),
      onDelete: () => ops.removeTableById(t.id),
      before: () => ops.snapshot(),
      extraMenu: () => [{ separator: true }, { heading: 'Insert' }, ...insertMenu.insertItems(b.id)],
      undo: () => ops.undo(),
      duplicate: () => { const c = ops.duplicateBlocks([b.id]); if (c.length) { const t2 = ops.blockEl(c[0].id); if (t2) t2.scrollIntoView({ block: 'nearest' }); } },
    }));
  } else island.appendChild(el('p', 'nt-none', 'This table is missing.'));
  root.appendChild(island);
  applyAttrs(root, b);
  return root;
}

// ─── Links: a small popover on hover ───

function initLinkPopover(host) {
  let pop = null;
  let timer = 0;
  const hide = () => { clearTimeout(timer); if (pop) { pop.remove(); pop = null; } };
  host.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('.eb-text a');
    if (!a) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      hide();
      const href = a.getAttribute('href') || '';
      pop = el('div', 'ed-linkpop menu');
      pop.addEventListener('mouseleave', hide);
      const url = el('span', 'lp-url', href);
      url.title = href;
      const mk = (label, fn, disabled) => { const b = el('button', 'lp-btn', label); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('mousedown', (ev) => ev.preventDefault()); b.addEventListener('click', () => { hide(); fn(); }); return b; };
      const selectIt = () => {
        const t = a.closest('.eb-text');
        const id = t.closest('.eb').dataset.id;
        const from = ops.textEl(id) ? null : null;
        void from;
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(a);
        sel.removeAllRanges();
        sel.addRange(r);
      };
      pop.append(url,
        mk('Open', () => window.open(href), !/^https:/i.test(href)),
        mk('Edit', () => { selectIt(); import('./commands.js').then(c => c.linkDialog()); }),
        mk('Remove', () => { selectIt(); import('./commands.js').then(c => c.removeLink()); }));
      if (!/^https:/i.test(href)) pop.title = 'Ethos opens https links only';
      document.body.appendChild(pop);
      const r = a.getBoundingClientRect();
      const box = pop.getBoundingClientRect();
      pop.style.left = Math.max(4, Math.min(r.left, window.innerWidth - box.width - 4)) + 'px';
      pop.style.top = (r.bottom + 4 + box.height > window.innerHeight ? r.top - box.height - 4 : r.bottom + 4) + 'px';
    }, 400);
  });
  host.addEventListener('mouseout', (e) => {
    const a = e.target.closest && e.target.closest('.eb-text a');
    if (!a) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (pop && !pop.matches(':hover')) hide(); }, 250);
  });
  host.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', hide, true);
}

// ─── Start-up ───

// host: the element that holds the blocks. doc: the note's whole page (it holds
// the toolbar, the caret and the footnotes). before: what the toolbar goes above.
export function initEditor({ host, doc, before, onChange, notify }) {
  S.host = host;
  S.hooks.change = onChange;
  S.hooks.notify = (title, message, type = 'info') => notify(title, message, type);
  S.builders.divider = buildDivider;
  S.builders.table = buildTableBlock;
  code.register();
  image.register();
  keys.attach();
  handles.attach();
  insertMenu.attach();
  caret.mount(doc, host);
  footnotes.mount(doc);
  toolbar.mount(doc, before);
  find.mount(doc, before);
  initLinkPopover(host);
  S.hooks.footnote = footnotes.insertFootnote;
  S.hooks.toggleOverwrite = keys.toggleOverwrite;
  // Anything that changes the page refreshes find's highlights.
  const prev = S.hooks.change;
  S.hooks.change = (immediate) => { prev(immediate); find.refreshIfOpen(); };
  // The first text block carries the id nt-body (a stable handle for tests and links).
  S.after.push(() => {
    const old = document.getElementById('nt-body');
    const first = host.querySelector('.eb-text');
    if (old && old !== first) old.removeAttribute('id');
    if (first) first.id = 'nt-body';
  });

  // Ctrl+F and Ctrl+H find in the open note, from anywhere on the page.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (doc.hidden || document.body.dataset.view !== 'notes-page' || !S.page) return;
    const k = e.key.toLowerCase();
    if (k === 'f' || k === 'h') { e.preventDefault(); find.open(k === 'h'); }
  });

  // The tick of a task and the arrow of a toggle.
  host.addEventListener('click', (e) => {
    const tick = e.target.closest && e.target.closest('.eb-tick');
    const arrow = e.target.closest && e.target.closest('.eb-arrow');
    if (!tick && !arrow) return;
    const id = (tick || arrow).closest('.eb').dataset.id;
    const b = ops.block(id);
    if (!b) return;
    if (tick) ops.setChecked(id, !b.checked); else ops.setOpen(id, !b.open);
  });

  // Images dropped onto the page.
  host.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  host.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer ? e.dataTransfer.files : [])].filter(f => /^image\//.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    const root = e.target.closest && e.target.closest('.eb');
    image.importImages(files, root ? root.dataset.id : null);
  });
}

// ─── A page in and out ───

export function openPage(page) {
  S.page = page;
  S.blocks = JSON.parse(JSON.stringify(page.blocks));
  S.tables = JSON.parse(JSON.stringify(page.tables));
  S.history = [];
  S.future = [];
  S.selected.clear();
  S.pending = null;
  S.dirty = false;
  S.lastId = null;
  for (const e of S.els.values()) e.remove();
  S.els.clear();
  S.host.replaceChildren();
  find.close();
  insertMenu.resetSlash();
  ops.emptyBlocksFix();
  ops.syncDOM();
  footnotes.reset();
}

export function closePage() {
  S.page = null;
  S.blocks = [];
  S.tables = [];
  for (const e of S.els.values()) e.remove();
  S.els.clear();
  S.host.replaceChildren();
  find.close();
  insertMenu.resetSlash();
}

export const isOpen = () => !!S.page;
export const isDirty = () => S.dirty;
export const clearDirty = () => { S.dirty = false; };
export const markDirty = () => { S.dirty = true; };

// What to save: plain copies, so later edits cannot reach what was handed over.
export function getBlocks() { return JSON.parse(JSON.stringify(S.blocks)); }
export function getTables() { return JSON.parse(JSON.stringify(S.tables)); }

export function focusStart() {
  const first = S.blocks.find(b => M.isText(b.type));
  if (first) ops.focusBlock(first.id);
}

// The editor's table menu helper for notes-table.js (it cannot import this file).
export function showMenu(event, items) { showCtx(event, items); }

export { S as editorState };
