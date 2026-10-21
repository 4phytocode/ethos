// The Notes section: folders, pages inside them, loose pages, and temporary
// scratch pages. First pass, to be reworked (see todo.md).
//
// Two surfaces read the same cache: the tree in the sidebar, and the notes
// view, which is either the overview or one open page. Pages are separate from
// journal notes, with their own model, files and IPC calls.

import * as state from './state.js';
import { show, onLeave, current, showCtx } from './views.js';
import { notify } from './notifications.js';

const TYPING_SAVE_MS = 400;
const OPEN_KEY = 'ethos.notes.openFolders';

let openPageId = null;
let saveTimer = 0;
let openFolders = loadOpen();
let renaming = null;          // folder id whose name is being edited in the tree

let tree, home, doc, fTitle, fBody, fMove, fTemp, fUpdated, fCrumb, homeList;
let linksOut, linksIn, backRow, linkAdd, picker, pickerInput, pickerList;
let pickerActive = 0;         // highlighted row in the link picker

// The page open in the editor, if any. The graph marks it.
export function currentPageId() { return openPageId; }

function loadOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveOpen() {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openFolders])); } catch { /* not fatal */ }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const pageName = (p) => p.title || 'Untitled';

function icon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const paths = {
    caret: 'M9 6l6 6-6 6',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    page: 'M7 3h7l5 5v13H7z M14 3v5h5',
    temp: 'M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    plus: 'M12 5v14M5 12h14',
    more: 'M6 12h.01M12 12h.01M18 12h.01',
  };
  for (const d of paths[kind].split(' M').map((d, i) => (i ? 'M' : '') + d)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// ─── Actions ───

async function newPage(opts = {}) {
  await commit();
  try {
    const page = await state.createPage(opts);
    if (opts.folderId) { openFolders.add(opts.folderId); saveOpen(); }
    openPage(page.id, true);
  } catch (err) {
    notify.error('Could not create the note', err.message);
  }
}

async function newFolder() {
  try {
    const folder = await state.createFolder({ name: 'New folder' });
    openFolders.add(folder.id);
    saveOpen();
    renaming = folder.id;
    renderTree();
  } catch (err) {
    notify.error('Could not create the folder', err.message);
  }
}

async function renameFolder(id, name) {
  renaming = null;
  const folder = state.folder(id);
  if (!folder || !name.trim() || name.trim() === folder.name) { renderTree(); return; }
  try { await state.renameFolder(id, { name }); } catch (err) {
    notify.error('Could not rename the folder', err.message);
    renderTree();
  }
}

async function deleteFolder(id) {
  const folder = state.folder(id);
  if (!folder) return;
  try {
    await state.removeFolder(id);
    notify.info('Folder deleted', folder.name + ' — its notes were kept.');
  } catch (err) {
    notify.error('Could not delete the folder', err.message);
  }
}

async function deletePage(id) {
  const page = state.page(id);
  if (!page) return;
  if (openPageId === id) { clearTimeout(saveTimer); openPageId = null; }
  try {
    await state.removePage(id);
    notify.info('Note deleted', pageName(page));
    if (current() === 'notes-page') renderView();
  } catch (err) {
    notify.error('Could not delete the note', err.message);
  }
}

// Writes what is in the editor fields. Called on a debounce while typing, on
// the way out of the page, and (as commitNotes) before the window closes.
export { commit as commitNotes };
async function commit() {
  clearTimeout(saveTimer);
  const page = openPageId && state.page(openPageId);
  if (!page) return;
  const patch = {};
  if (fTitle.value !== page.title) patch.title = fTitle.value;
  if (fBody.value !== page.content) patch.content = fBody.value;
  if (!Object.keys(patch).length) return;
  try { await state.updatePage(page.id, patch); } catch (err) {
    notify.error('Could not save the note', err.message);
  }
}

function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commit, TYPING_SAVE_MS);
}

export function openPage(id, focusTitle = false) {
  if (openPageId && openPageId !== id) commit();
  if (openPageId !== id) closePicker();
  openPageId = id;
  const page = state.page(id);
  if (!page) return;
  fTitle.value = page.title;
  fBody.value = page.content;
  if (current() !== 'notes-page') show('notes-page');
  renderView();
  doc.classList.remove('nt-enter');
  void doc.offsetWidth;
  doc.classList.add('nt-enter');
  (focusTitle ? fTitle : fBody).focus();
}

export function openHome() {
  commit();
  openPageId = null;
  if (current() !== 'notes-page') show('notes-page');
  renderView();
}

// ─── Sidebar tree ───

function pageRow(page, depth) {
  const row = el('div', 'sb-row sb-page');
  row.style.setProperty('--depth', depth);
  if (page.id === openPageId && current() === 'notes-page') row.classList.add('active');
  const main = el('button', 'sb-row-main');
  main.type = 'button';
  main.append(icon(page.temporary ? 'temp' : 'page'), el('span', 'sb-row-label', pageName(page)));
  main.addEventListener('click', () => openPage(page.id));
  main.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCtx(e, [
      { label: page.temporary ? 'Keep (not temporary)' : 'Make temporary',
        onClick: () => state.updatePage(page.id, { temporary: !page.temporary }).catch(err => notify.error('Could not update the note', err.message)) },
      { label: 'Delete', onClick: () => deletePage(page.id) },
    ]);
  });
  row.append(main);
  return row;
}

function folderRow(folder) {
  const open = openFolders.has(folder.id);
  const wrap = el('div', 'sb-folder' + (open ? ' open' : ''));
  const row = el('div', 'sb-row');
  row.style.setProperty('--depth', 0);

  if (renaming === folder.id) {
    const input = el('input', 'sb-rename');
    input.value = folder.name;
    input.maxLength = 60;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { renaming = null; renderTree(); }
    });
    input.addEventListener('blur', () => { if (renaming === folder.id) renameFolder(folder.id, input.value); });
    row.append(icon('folder'), input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  } else {
    const main = el('button', 'sb-row-main');
    main.type = 'button';
    main.setAttribute('aria-expanded', String(open));
    const caret = el('span', 'sb-caret');
    caret.append(icon('caret'));
    main.append(caret, icon('folder'), el('span', 'sb-row-label', folder.name));
    main.addEventListener('click', () => {
      if (openFolders.has(folder.id)) openFolders.delete(folder.id); else openFolders.add(folder.id);
      saveOpen();
      wrap.classList.toggle('open');
      main.setAttribute('aria-expanded', String(wrap.classList.contains('open')));
    });
    main.addEventListener('dblclick', () => { renaming = folder.id; renderTree(); });

    const add = el('button', 'sb-row-tool');
    add.type = 'button';
    add.title = 'New note in ' + folder.name;
    add.setAttribute('aria-label', add.title);
    add.append(icon('plus'));
    add.addEventListener('click', () => newPage({ folderId: folder.id }));

    const more = el('button', 'sb-row-tool');
    more.type = 'button';
    more.title = 'Folder options';
    more.setAttribute('aria-label', 'Folder options');
    more.append(icon('more'));
    const menu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e, [
        { label: 'Rename', onClick: () => { renaming = folder.id; renderTree(); } },
        { label: 'Delete folder (keeps notes)', onClick: () => deleteFolder(folder.id) },
      ]);
    };
    more.addEventListener('click', menu);
    main.addEventListener('contextmenu', menu);
    row.append(main, add, more);
  }

  // The children animate open on grid-template-rows, which can transition
  // from 0fr to 1fr where height:auto cannot.
  const kids = el('div', 'sb-kids');
  const inner = el('div', 'sb-kids-inner');
  const pages = state.pages().filter(p => p.folderId === folder.id);
  for (const p of pages) inner.append(pageRow(p, 1));
  if (!pages.length) {
    const empty = el('div', 'sb-row sb-empty', 'Empty');
    empty.style.setProperty('--depth', 1);
    inner.append(empty);
  }
  kids.append(inner);
  wrap.append(row, kids);
  return wrap;
}

function renderTree() {
  if (!tree) return;
  tree.replaceChildren();
  for (const f of state.folders()) tree.append(folderRow(f));
  for (const p of state.pages().filter(p => !p.folderId && !p.temporary)) tree.append(pageRow(p, 0));

  const temp = state.pages().filter(p => p.temporary);
  if (temp.length) {
    tree.append(el('div', 'sb-sub', 'Temporary'));
    for (const p of temp) tree.append(pageRow(p, 0));
  }
  if (!state.folders().length && !state.pages().length) {
    tree.append(el('div', 'sb-row sb-empty', 'No notes yet'));
  }
}

// ─── The notes view ───

function renderView() {
  const page = openPageId && state.page(openPageId);
  if (!page) openPageId = null;
  home.hidden = !!page;
  doc.hidden = !page;
  if (page) renderDoc(page); else renderHome();
  renderTree();
}

function renderDoc(page) {
  const folder = page.folderId && state.folder(page.folderId);
  fCrumb.textContent = folder ? folder.name : (page.temporary ? 'Temporary' : 'Notes');

  fMove.replaceChildren();
  const none = el('option', null, 'No folder');
  none.value = '';
  fMove.append(none);
  for (const f of state.folders()) {
    const o = el('option', null, f.name);
    o.value = f.id;
    fMove.append(o);
  }
  fMove.value = page.folderId || '';

  fTemp.setAttribute('aria-pressed', String(page.temporary));
  fTemp.textContent = page.temporary ? 'Temporary' : 'Mark temporary';
  fTemp.title = page.temporary ? 'Temporary note. Click to keep it.' : 'Click to mark as temporary.';
  fUpdated.textContent = 'Edited ' + new Date(page.updatedAt).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  renderLinks(page);
}

// ─── Links between notes ───
// Outgoing links are stored on the page by id; "Linked from" is worked out from
// every other page's links, so it can never disagree with them.

function linkChip(target, onRemove) {
  const chip = el('span', 'nt-link-chip');
  const open = el('button', 'nt-link-open', pageName(target));
  open.type = 'button';
  open.title = 'Open ' + pageName(target);
  open.addEventListener('click', () => openPage(target.id));
  chip.append(open);
  if (onRemove) {
    const x = el('button', 'nt-link-x', '×');
    x.type = 'button';
    x.title = 'Remove link to ' + pageName(target);
    x.setAttribute('aria-label', x.title);
    x.addEventListener('click', onRemove);
    chip.append(x);
  }
  return chip;
}

// The chips last drawn, as "out:<id>" / "in:<id>" for one page. Every snapshot
// redraws them (an autosave while typing included), and only a chip that is new
// should pop in; the rest are marked settled so they hold still.
let drawnChips = { pageId: null, keys: new Set() };

function renderLinks(page) {
  const before = drawnChips.pageId === page.id ? drawnChips.keys : new Set();
  const keys = new Set();
  const place = (parent, key, chip) => {
    keys.add(key);
    if (before.has(key)) chip.classList.add('settled');
    parent.append(chip);
  };

  linksOut.replaceChildren();
  for (const id of page.links) {
    const target = state.page(id);
    if (target) place(linksOut, 'out:' + id, linkChip(target, () => setLinks(page.id, page.links.filter(l => l !== id))));
  }
  if (!page.links.length) linksOut.append(el('span', 'nt-links-none', 'None yet'));

  const from = state.pages().filter(p => p.links.includes(page.id));
  backRow.hidden = !from.length;
  linksIn.replaceChildren();
  for (const p of from) place(linksIn, 'in:' + p.id, linkChip(p, null));
  drawnChips = { pageId: page.id, keys };
  if (!picker.hidden) renderPicker();
}

async function setLinks(pageId, links) {
  try { await state.updatePage(pageId, { links }); } catch (err) {
    notify.error('Could not update the links', err.message);
  }
}

// Pages this one could link to: not itself, not already linked.
function candidates() {
  const page = openPageId && state.page(openPageId);
  if (!page) return [];
  const q = pickerInput.value.trim().toLowerCase();
  return state.pages()
    .filter(p => p.id !== page.id && !page.links.includes(p.id))
    .filter(p => !q || pageName(p).toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
}

function renderPicker() {
  const list = candidates();
  pickerActive = Math.min(pickerActive, Math.max(0, list.length - 1));
  pickerList.replaceChildren();
  list.forEach((p, i) => {
    const li = el('li', 'nt-pick' + (i === pickerActive ? ' active' : ''));
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === pickerActive));
    li.append(el('span', 'nt-pick-title', pageName(p)));
    const folder = p.folderId && state.folder(p.folderId);
    li.append(el('span', 'nt-pick-meta', folder ? folder.name : p.temporary ? 'Temporary' : ''));
    // mousedown, not click: the input's blur would close the picker first.
    li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(p.id); });
    pickerList.append(li);
  });
  if (!list.length) {
    const none = el('li', 'nt-pick-none',
      state.pages().length < 2 ? 'Make another note to link to.' : 'No other notes match.');
    pickerList.append(none);
  }
}

function openPicker() {
  picker.hidden = false;
  linkAdd.setAttribute('aria-expanded', 'true');
  pickerInput.value = '';
  pickerActive = 0;
  renderPicker();
  pickerInput.focus();
}

function closePicker() {
  if (picker.hidden) return;
  picker.hidden = true;
  linkAdd.setAttribute('aria-expanded', 'false');
}

function pick(targetId) {
  const page = openPageId && state.page(openPageId);
  closePicker();
  linkAdd.focus();
  if (!page || page.links.includes(targetId)) return;
  setLinks(page.id, [...page.links, targetId]);
}

function renderHome() {
  homeList.replaceChildren();
  const recent = [...state.pages()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  if (!recent.length) {
    homeList.append(el('p', 'nt-none', 'Nothing here yet. Start a note, or a temporary one for scratch.'));
    return;
  }
  for (const p of recent) {
    const b = el('button', 'nt-card');
    b.type = 'button';
    const folder = p.folderId && state.folder(p.folderId);
    b.append(el('span', 'nt-card-title', pageName(p)),
      el('span', 'nt-card-body', p.content.slice(0, 140) || ' '),
      el('span', 'nt-card-meta', (folder ? folder.name : p.temporary ? 'Temporary' : 'No folder')));
    b.addEventListener('click', () => openPage(p.id));
    homeList.append(b);
  }
}

// ─── Init ───

export function initNotes() {
  tree = document.getElementById('sb-tree');
  home = document.getElementById('nt-home');
  doc = document.getElementById('nt-doc');
  homeList = document.getElementById('nt-recent');
  fTitle = document.getElementById('nt-title');
  fBody = document.getElementById('nt-body');
  fMove = document.getElementById('nt-move');
  fTemp = document.getElementById('nt-temp');
  fUpdated = document.getElementById('nt-updated');
  fCrumb = document.getElementById('nt-crumb');
  linksOut = document.getElementById('nt-links-out');
  linksIn = document.getElementById('nt-links-in');
  backRow = document.getElementById('nt-backlinks');
  linkAdd = document.getElementById('nt-link-add');
  picker = document.getElementById('nt-picker');
  pickerInput = document.getElementById('nt-picker-input');
  pickerList = document.getElementById('nt-picker-list');

  // Keep focus in the open picker, so its blur cannot close it just before this
  // click would toggle it, and reopen it.
  linkAdd.addEventListener('mousedown', (e) => { if (!picker.hidden) e.preventDefault(); });
  linkAdd.addEventListener('click', () => { if (picker.hidden) openPicker(); else closePicker(); });
  pickerInput.addEventListener('input', () => { pickerActive = 0; renderPicker(); });
  pickerInput.addEventListener('keydown', (e) => {
    const list = candidates();
    if (e.key === 'ArrowDown') { e.preventDefault(); pickerActive = Math.min(pickerActive + 1, list.length - 1); renderPicker(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pickerActive = Math.max(pickerActive - 1, 0); renderPicker(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (list[pickerActive]) pick(list[pickerActive].id); }
    else if (e.key === 'Escape') { e.preventDefault(); closePicker(); linkAdd.focus(); }
  });
  pickerInput.addEventListener('blur', () => setTimeout(closePicker, 0));

  document.getElementById('sb-new-page').addEventListener('click', () => newPage({}));
  document.getElementById('sb-new-folder').addEventListener('click', newFolder);
  document.getElementById('sb-notes-open').addEventListener('click', openHome);
  document.getElementById('nt-new-page').addEventListener('click', () => newPage({}));
  document.getElementById('nt-new-temp').addEventListener('click', () => newPage({ temporary: true }));
  document.getElementById('nt-new-folder').addEventListener('click', newFolder);
  document.getElementById('nt-crumb').addEventListener('click', openHome);

  fTitle.addEventListener('input', queueSave);
  fBody.addEventListener('input', queueSave);
  fTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fBody.focus(); } });
  fMove.addEventListener('change', async () => {
    if (!openPageId) return;
    const folderId = fMove.value || null;
    try {
      await state.updatePage(openPageId, { folderId });
      if (folderId) { openFolders.add(folderId); saveOpen(); }
    } catch (err) { notify.error('Could not move the note', err.message); }
  });
  fTemp.addEventListener('click', async () => {
    const page = openPageId && state.page(openPageId);
    if (!page) return;
    try { await state.updatePage(page.id, { temporary: !page.temporary }); } catch (err) {
      notify.error('Could not update the note', err.message);
    }
  });
  document.getElementById('nt-delete').addEventListener('click', () => { if (openPageId) deletePage(openPageId); });

  // Leave hooks run before the view switch lands, so redraw the tree after it
  // to drop the open page's highlight.
  onLeave('notes-page', () => { commit(); setTimeout(renderTree, 0); });

  // Redraw from every snapshot, but never rewrite the fields being typed into.
  state.subscribe(() => {
    if (current() === 'notes-page') {
      const page = openPageId && state.page(openPageId);
      if (page) renderDoc(page); else renderView();
    }
    renderTree();
  });

  renderTree();
}
