// The Notes section: folders, pages inside them, loose pages, and temporary
// scratch pages.
//
// Two surfaces read the same cache: the tree in the sidebar, and the notes
// view, which is either the overview or one open page. Pages are separate from
// journal notes, with their own model, files and IPC calls.
//
// A page's body is a list of blocks (schema 9): text, lists, code, images, tables
// and more. The block editor (editor/index.js) owns what is inside the page; this
// file hands it a page, asks it what to save, and keeps the save timing.

import * as state from './state.js';
import { show, onLeave, current, showCtx } from './views.js';
import { notify } from './notifications.js';
import { confirmDialog, formDialog } from './dialog.js';
import * as editor from './editor/index.js';

const TYPING_SAVE_MS = 400;
const OPEN_KEY = 'ethos.notes.openFolders';
const SORT_KEY = 'ethos.notes.sort';
const DRAG_TYPE = 'application/x-ethos-page';

let openPageId = null;
let saveTimer = 0;
let openFolders = loadOpen();
let renameDraft = null;      // its typed value, kept across redraws
let renaming = null;          // folder id whose name is being edited in the tree

let tree, home, doc, fTitle, blocksEl, fMove, fTemp, fPin, fUpdated, fCrumb, homeList;
let linksOut, linksIn, backRow, linkAdd, picker, pickerInput, pickerList;
let searchEl, sortEl, pinnedWrap, pinnedList, recentHead;
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

const FOLDER_DRAG = 'application/x-ethos-folder';
let draggingFolder = null;    // id of the folder being dragged (dragover cannot read dataTransfer)
// Names for the tag palette, in the palette's own order.
const COLOR_NAMES = ['Blue', 'Red', 'Green', 'Amber', 'Violet', 'Pink', 'Teal', 'Orange'];
const MAX_DEPTH = 6;

// The page's words, without table markers. For search, cards and the counter.
const MARK_LINE = /^\{\{table:[a-z0-9]{1,24}\}\}$/gm;
const plainText = (p) => p.content.replace(MARK_LINE, '').replace(/\n{3,}/g, '\n\n').trim();

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
    pin: 'M9 4h6l-1 6 4 4H6l4-4z M12 14v7',
  };
  for (const d of paths[kind].split(' M').map((d, i) => (i ? 'M' : '') + d)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

// ─── Actions ───

async function newPage(opts = {}, title = '') {
  await commit();
  try {
    let page = await state.createPage(opts);
    if (title) page = await state.updatePage(page.id, { title });
    if (opts.folderId) { openFolders.add(opts.folderId); saveOpen(); }
    openPage(page.id, !title);
  } catch (err) {
    notify.error('Could not create the note', err.message);
  }
}

// A copy in the same place, with the same text, tables and links.
async function duplicatePage(id) {
  await commit();
  const src = state.page(id);
  if (!src) return;
  try {
    const page = await state.createPage({ folderId: src.folderId, temporary: src.temporary });
    await state.updatePage(page.id, {
      title: (pageName(src) + ' (copy)').slice(0, 200), blocks: src.blocks,
      tables: src.tables, links: src.links,
    });
    notify.success('Note duplicated', pageName(src));
    openPage(page.id);
  } catch (err) {
    notify.error('Could not duplicate the note', err.message);
  }
}

async function setPinned(id, pinned) {
  try { await state.updatePage(id, { pinned }); } catch (err) {
    notify.error('Could not pin the note', err.message);
  }
}

async function moveToFolder(id, folderId) {
  const page = state.page(id);
  if (!page || page.folderId === folderId) return;
  if (id === openPageId) await commit();
  try {
    await state.updatePage(id, { folderId });
    if (folderId) { openFolders.add(folderId); saveOpen(); }
    const f = folderId && state.folder(folderId);
    notify.info('Note moved', pageName(page) + ' → ' + (f ? f.name : 'No folder'));
  } catch (err) { notify.error('Could not move the note', err.message); }
}

async function newFolder(parentId = null) {
  try {
    const folder = await state.createFolder({ name: 'New folder', parentId });
    if (parentId) openFolders.add(parentId);
    openFolders.add(folder.id);
    saveOpen();
    renaming = folder.id; renameDraft = null;
    renderTree();
  } catch (err) {
    notify.error('Could not create the folder', err.message);
  }
}

async function renameFolder(id, name) {
  renaming = null; renameDraft = null;
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
  const parent = folder.parentId && state.folder(folder.parentId);
  const sure = await confirmDialog({
    title: 'Delete folder',
    message: 'Delete the folder "' + folder.name + '"? Its notes and subfolders move to ' + (parent ? '"' + parent.name + '"' : 'Notes') + '.',
    okLabel: 'Delete', danger: true,
  });
  if (!sure) return;
  try {
    await state.removeFolder(id);
    openFolders.delete(id);
    saveOpen();
    notify.info('Folder deleted', folder.name + ' — its notes were kept.');
  } catch (err) {
    notify.error('Could not delete the folder', err.message);
  }
}

async function patchFolder(id, patch, what) {
  try { await state.updateFolder(id, patch); } catch (err) { notify.error('Could not ' + what, err.message); }
}

// A new tag, made here and put on the folder in one go.
async function newTagFor(folder) {
  const colors = state.tagColorPalette();
  const v = await formDialog({
    title: 'New tag', okLabel: 'Create and add',
    fields: [{ key: 'name', label: 'Name', maxLength: 24 }, { key: 'color', label: 'Colour', kind: 'colors', colors, value: colors[0] }],
    validate: (x) => (x.name.trim() ? '' : 'Give the tag a name.'),
  });
  if (!v) return;
  try {
    const tag = await state.createTag({ name: v.name.trim(), color: v.color });
    const now = state.folder(folder.id);
    if (now && !now.tagIds.includes(tag.id)) await state.updateFolder(folder.id, { tagIds: [...now.tagIds, tag.id] });
  } catch (err) { notify.error('Could not add the tag', err.message); }
}

function folderMenu(folder) {
  const colors = state.tagColorPalette();
  const tags = state.tags();
  const below = state.folderDescendants(folder.id);
  const height = state.folderHeight(folder.id);
  const targets = state.foldersInOrder().filter(x => x.folder.id !== folder.id && !below.has(x.folder.id));
  const setOpen = (open) => {
    for (const id of [folder.id, ...below]) { if (open) openFolders.add(id); else openFolders.delete(id); }
    saveOpen();
    renderTree();
  };
  const tagItems = tags.map(t => ({
    label: t.name, color: t.color, checked: folder.tagIds.includes(t.id),
    onClick: () => patchFolder(folder.id, { tagIds: folder.tagIds.includes(t.id)
      ? folder.tagIds.filter(x => x !== t.id) : [...folder.tagIds, t.id] }, 'change the tags'),
  }));
  return [
    { label: 'New note here', onClick: () => newPage({ folderId: folder.id }) },
    { label: 'New subfolder', disabled: state.folderDepth(folder.id) >= MAX_DEPTH, onClick: () => newFolder(folder.id) },
    { label: 'Rename', onClick: () => { renaming = folder.id; renameDraft = null; renderTree(); } },
    { separator: true },
    { label: 'Colour', submenu: [
      { label: 'None', checked: !folder.color, onClick: () => patchFolder(folder.id, { color: null }, 'change the colour') },
      ...colors.map((c, i) => ({ label: COLOR_NAMES[i] || c, color: c, checked: folder.color === c,
        onClick: () => patchFolder(folder.id, { color: c }, 'change the colour') })),
    ] },
    { label: 'Tags', submenu: [
      ...tagItems,
      ...(tagItems.length ? [{ separator: true }] : []),
      { label: 'New tag…', disabled: folder.tagIds.length >= 8, onClick: () => newTagFor(folder) },
    ] },
    { label: 'Move to', submenu: [
      { label: 'Top level', disabled: !folder.parentId, onClick: () => patchFolder(folder.id, { parentId: null }, 'move the folder') },
      ...targets.map(x => ({
        label: '\u00a0\u00a0'.repeat(x.depth - 1) + x.folder.name,
        checked: folder.parentId === x.folder.id,
        disabled: x.depth + height > MAX_DEPTH,
        onClick: () => { openFolders.add(x.folder.id); saveOpen(); patchFolder(folder.id, { parentId: x.folder.id }, 'move the folder'); },
      })),
    ] },
    { separator: true },
    { label: 'Expand all inside', onClick: () => setOpen(true) },
    { label: 'Collapse all inside', onClick: () => setOpen(false) },
    { separator: true },
    { label: 'Delete folder', danger: true, onClick: () => deleteFolder(folder.id) },
  ];
}

async function deletePage(id) {
  const page = state.page(id);
  if (!page) return;
  // Deleting a note cannot be undone, so it asks first.
  const sure = await confirmDialog({
    title: 'Delete note', message: 'Delete "' + pageName(page) + '"? This cannot be undone.',
    okLabel: 'Delete', danger: true,
  });
  if (!sure) return;
  if (openPageId === id) { clearTimeout(saveTimer); openPageId = null; editor.closePage(); }
  try {
    await state.removePage(id);
    notify.info('Note deleted', pageName(page));
    if (current() === 'notes-page') renderView();
  } catch (err) {
    notify.error('Could not delete the note', err.message);
  }
}

// Writes what is in the editor. Called on a debounce while typing, on the way
// out of the page, and (as commitNotes) before the window closes.
export { commit as commitNotes };
async function commit() {
  clearTimeout(saveTimer);
  const page = openPageId && state.page(openPageId);
  if (!page) return;
  const patch = {};
  if (fTitle.value !== page.title) patch.title = fTitle.value;
  // The body is only written once it has been edited, so opening a page never
  // rewrites (and re-dates) it just because serialising normalised a blank line.
  const wasDirty = editor.isOpen() && editor.isDirty();
  if (wasDirty) {
    patch.blocks = editor.getBlocks();
    patch.tables = editor.getTables();
    editor.clearDirty();
  }
  if (!Object.keys(patch).length) return;
  try { await state.updatePage(page.id, patch); } catch (err) {
    if (wasDirty) editor.markDirty();
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
  const page = state.page(id);
  if (!page) return;
  const fresh = openPageId !== id || !editor.isOpen();
  openPageId = id;
  fTitle.value = page.title;
  if (fresh) editor.openPage(page);
  if (current() !== 'notes-page') show('notes-page');
  renderView();
  doc.classList.remove('nt-enter');
  void doc.offsetWidth;
  doc.classList.add('nt-enter');
  if (focusTitle) fTitle.focus();
  else editor.focusStart();
}

// Shows a folder in the tree: opens every folder above it, scrolls to it, flashes it.
export function revealFolder(id) {
  const folder = state.folder(id);
  if (!folder) return;
  if (current() !== 'notes-page') show('notes-page');
  for (const f of state.folderChain(id)) openFolders.add(f.id);
  saveOpen();
  renderTree();
  const sidebar = document.getElementById('sidebar');
  if (sidebar && document.body.classList.contains('sb-hidden')) document.getElementById('sb-show')?.click();
  requestAnimationFrame(() => {
    const row = tree.querySelector('[data-folder-id="' + id + '"]');
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1400);
  });
}

// A note can use the whole width of the window instead of a centred column.
const FULL_KEY = 'ethos.notes.fullWidth';
function setFullWidth(on) {
  document.body.classList.toggle('nt-full', on);
  try { localStorage.setItem(FULL_KEY, on ? '1' : '0'); } catch { /* not fatal */ }
}

export function openHome() {
  commit();
  openPageId = null;
  editor.closePage();
  if (current() !== 'notes-page') show('notes-page');
  renderView();
}

// ─── The page body ───
// Typing and structure changes reach here through the editor's onChange: typing
// waits for the pause, structure (a table row added, say) is written at once.

function edited(immediate) { if (immediate) commit(); else queueSave(); }

// ─── Sidebar tree ───

function pageRow(page, depth) {
  const row = el('div', 'sb-row sb-page' + (page.pinned ? ' pinned' : ''));
  row.style.setProperty('--depth', depth);
  if (page.id === openPageId && current() === 'notes-page') row.classList.add('active');
  const main = el('button', 'sb-row-main');
  main.type = 'button';
  main.append(icon(page.temporary ? 'temp' : 'page'), el('span', 'sb-row-label', pageName(page)));
  main.addEventListener('click', () => openPage(page.id));
  // Drag a note onto a folder to file it, or onto "Notes" to unfile it.
  main.draggable = true;
  main.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(DRAG_TYPE, page.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  main.addEventListener('dragend', () => row.classList.remove('dragging'));
  main.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCtx(e, pageMenu(page));
  });
  row.append(main);
  return row;
}

function pageMenu(page) {
  return [
    { label: page.pinned ? 'Unpin' : 'Pin to top', onClick: () => setPinned(page.id, !page.pinned) },
    { label: 'Duplicate', onClick: () => duplicatePage(page.id) },
    ...state.foldersInOrder().filter(x => x.folder.id !== page.folderId)
      .map(x => ({ label: 'Move to ' + state.folderPath(x.folder.id), onClick: () => moveToFolder(page.id, x.folder.id) })),
    ...(page.folderId ? [{ label: 'Remove from folder', onClick: () => moveToFolder(page.id, null) }] : []),
    { label: page.temporary ? 'Keep (not temporary)' : 'Make temporary',
      onClick: () => state.updatePage(page.id, { temporary: !page.temporary }).catch(err => notify.error('Could not update the note', err.message)) },
    { label: 'Delete', onClick: () => deletePage(page.id) },
  ];
}

// Makes `node` accept a dragged note or folder; `folderId` null is the top level.
// A folder cannot be dropped on itself, inside its own folders, or deeper than
// six levels (the main process enforces the same; this just shows no-drop).
function folderDropOk(folderId) {
  if (!draggingFolder) return true;
  if (folderId === draggingFolder) return false;
  if (folderId && state.folderDescendants(draggingFolder).has(folderId)) return false;
  const above = folderId ? state.folderDepth(folderId) : 0;
  return above + state.folderHeight(draggingFolder) <= MAX_DEPTH;
}

function dropTarget(node, folderId) {
  node.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    const isFolder = types.includes(FOLDER_DRAG);
    if (!isFolder && !types.includes(DRAG_TYPE)) return;
    if (isFolder && !folderDropOk(folderId)) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop');
  });
  node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop'); });
  node.addEventListener('drop', (e) => {
    node.classList.remove('drop');
    const fid = e.dataTransfer.getData(FOLDER_DRAG);
    if (fid) {
      e.preventDefault();
      draggingFolder = null;
      if (folderDropOk(folderId) && (state.folder(fid) || {}).parentId !== folderId) {
        if (folderId) { openFolders.add(folderId); saveOpen(); }
        patchFolder(fid, { parentId: folderId }, 'move the folder');
      }
      return;
    }
    const id = e.dataTransfer.getData(DRAG_TYPE);
    if (!id) return;
    e.preventDefault();
    moveToFolder(id, folderId);
  });
}

function folderRow(folder, depth = 0) {
  const open = openFolders.has(folder.id);
  const wrap = el('div', 'sb-folder' + (open ? ' open' : ''));
  const row = el('div', 'sb-row' + (folder.color ? ' has-color' : ''));
  row.style.setProperty('--depth', depth);
  row.dataset.folderId = folder.id;
  if (folder.color) row.style.setProperty('--folder-color', folder.color);
  const pages = state.pages().filter(p => p.folderId === folder.id);
  const subfolders = state.folderChildren(folder.id);
  const folderTags = state.tagsOf(folder);

  const glyph = () => { const g = icon('folder'); if (folder.color) g.style.color = folder.color; return g; };

  if (renaming === folder.id) {
    const input = el('input', 'sb-rename');
    input.value = renameDraft !== null ? renameDraft : folder.name;
    input.maxLength = 60;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { renaming = null; renameDraft = null; renderTree(); }
    });
    input.addEventListener('blur', () => { if (renaming === folder.id) renameFolder(folder.id, input.value); });
    row.append(glyph(), input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  } else {
    const main = el('button', 'sb-row-main');
    main.type = 'button';
    main.setAttribute('aria-expanded', String(open));
    const caret = el('span', 'sb-caret');
    caret.append(icon('caret'));
    main.append(caret, glyph(), el('span', 'sb-row-label', folder.name));
    if (folderTags.length) {
      const dots = el('span', 'sb-tags');
      for (const t of folderTags.slice(0, 3)) {
        const d = el('i', 'sb-tag-dot');
        d.style.background = t.color;
        dots.append(d);
      }
      if (folderTags.length > 3) dots.append(el('span', 'sb-tag-more', '+' + (folderTags.length - 3)));
      main.append(dots);
      main.title = folder.name + ' · ' + folderTags.map(t => t.name).join(', ');
    }
    main.append(el('span', 'sb-count', String(state.noteCountDeep(folder.id))));
    main.addEventListener('click', () => {
      if (openFolders.has(folder.id)) openFolders.delete(folder.id); else openFolders.add(folder.id);
      saveOpen();
      wrap.classList.toggle('open');
      main.setAttribute('aria-expanded', String(wrap.classList.contains('open')));
    });
    main.addEventListener('dblclick', () => { renaming = folder.id; renameDraft = null; renderTree(); });
    // Drag a folder onto another folder to nest it, or onto "Notes" for the top level.
    main.draggable = true;
    main.addEventListener('dragstart', (e) => {
      draggingFolder = folder.id;
      e.dataTransfer.setData(FOLDER_DRAG, folder.id);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    main.addEventListener('dragend', () => { draggingFolder = null; row.classList.remove('dragging'); });

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
      if (e.type === 'click') { const r = more.getBoundingClientRect(); showCtx({ x: r.left, y: r.bottom + 2 }, folderMenu(folder)); }
      else showCtx(e, folderMenu(folder));
    };
    more.addEventListener('click', menu);
    main.addEventListener('contextmenu', menu);
    row.append(main, add, more);
    dropTarget(row, folder.id);
  }

  // The children animate open on grid-template-rows, which can transition
  // from 0fr to 1fr where height:auto cannot.
  const kids = el('div', 'sb-kids');
  const inner = el('div', 'sb-kids-inner');
  for (const sub of subfolders) inner.append(folderRow(sub, depth + 1));
  for (const p of pages) inner.append(pageRow(p, depth + 1));
  if (!pages.length && !subfolders.length) {
    const empty = el('div', 'sb-row sb-empty', 'Empty');
    empty.style.setProperty('--depth', depth + 1);
    inner.append(empty);
  }
  kids.append(inner);
  wrap.append(row, kids);
  return wrap;
}

function setAllOpen(open) {
  openFolders.clear();
  if (open) for (const f of state.folders()) openFolders.add(f.id);
  saveOpen();
  renderTree();
}

function renderTree() {
  if (!tree) return;
  // Keep a half-typed folder name: the rename input survives unrelated redraws.
  const live = tree.querySelector('.sb-rename');
  if (live && renaming) {
    renameDraft = live.value;
    if (document.activeElement === live) return;   // its blur saves and redraws
  }
  tree.replaceChildren();
  const pinned = state.pages().filter(p => p.pinned);
  if (pinned.length) {
    tree.append(el('div', 'sb-sub', 'Pinned'));
    for (const p of pinned) tree.append(pageRow(p, 0));
    tree.append(el('div', 'sb-sub', 'All notes'));
  }
  for (const f of state.folderChildren(null)) tree.append(folderRow(f, 0));
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
  if (!page) { openPageId = null; editor.closePage(); }
  home.hidden = !!page;
  doc.hidden = !page;
  if (page) renderDoc(page); else renderHome();
  renderTree();
}

function renderDoc(page) {
  const folder = page.folderId && state.folder(page.folderId);
  fCrumb.textContent = folder ? 'Notes \u203a ' + state.folderPath(folder.id, ' \u203a ') : (page.temporary ? 'Temporary' : 'Notes');

  fMove.replaceChildren();
  const none = el('option', null, 'No folder');
  none.value = '';
  fMove.append(none);
  for (const x of state.foldersInOrder()) {
    const o = el('option', null, '\u00a0\u00a0'.repeat(x.depth - 1) + x.folder.name);
    o.value = x.folder.id;
    fMove.append(o);
  }
  fMove.value = page.folderId || '';

  fTemp.setAttribute('aria-pressed', String(page.temporary));
  fTemp.textContent = page.temporary ? 'Temporary' : 'Mark temporary';
  fTemp.title = page.temporary ? 'Temporary note. Click to keep it.' : 'Click to mark as temporary.';
  fPin.setAttribute('aria-pressed', String(page.pinned));
  fPin.textContent = page.pinned ? 'Pinned' : 'Pin';
  fPin.title = page.pinned ? 'Pinned to the top. Click to unpin.' : 'Pin to the top of Notes.';
  const words = (plainText(page).match(/\S+/g) || []).length;
  const tables = page.tables.length;
  fUpdated.textContent = 'Edited ' + new Date(page.updatedAt).toLocaleString(undefined,
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) +
    ' · ' + words + (words === 1 ? ' word' : ' words') +
    (words >= 200 ? ' · ' + Math.ceil(words / 220) + ' min read' : '') +
    (tables ? ' · ' + tables + (tables === 1 ? ' table' : ' tables') : '');
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

// ─── Overview: pinned, then recent or search results ───

function sortMode() {
  try { return localStorage.getItem(SORT_KEY) || 'recent'; } catch { return 'recent'; }
}

function sorted(list) {
  const mode = sortEl ? sortEl.value : 'recent';
  const out = [...list];
  if (mode === 'title') out.sort((a, b) => pageName(a).localeCompare(pageName(b)));
  else if (mode === 'created') out.sort((a, b) => b.createdAt - a.createdAt);
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

// Title matches rank above body matches; within each, the sort order holds.
function search(q) {
  const needle = q.toLowerCase();
  const inTitle = [], inBody = [];
  for (const p of sorted(state.pages())) {
    if (pageName(p).toLowerCase().includes(needle)) inTitle.push(p);
    else if (plainText(p).toLowerCase().includes(needle) ||
      p.tables.some(t => t.title.toLowerCase().includes(needle) ||
        t.rows.some(r => Object.values(r.cells).some(v => typeof v === 'string' && v.toLowerCase().includes(needle))))) inBody.push(p);
  }
  return [...inTitle, ...inBody];
}

function snippet(p, q) {
  const text = plainText(p);
  if (!q) return text.slice(0, 140);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text.slice(0, 140);
  const start = Math.max(0, i - 40);
  return (start ? '…' : '') + text.slice(start, start + 140);
}

function card(p, q = '') {
  const b = el('button', 'nt-card' + (p.pinned ? ' pinned' : ''));
  b.type = 'button';
  const folder = p.folderId && state.folder(p.folderId);
  const meta = [folder ? folder.name : p.temporary ? 'Temporary' : 'No folder'];
  if (p.tables.length) meta.push(p.tables.length + (p.tables.length === 1 ? ' table' : ' tables'));
  b.append(el('span', 'nt-card-title', pageName(p)),
    el('span', 'nt-card-body', snippet(p, q) || ' '),
    el('span', 'nt-card-meta', meta.join(' · ')));
  b.addEventListener('click', () => openPage(p.id));
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtx(e, pageMenu(p)); });
  return b;
}

function renderHome() {
  homeList.replaceChildren();
  pinnedList.replaceChildren();
  const q = searchEl.value.trim();
  if (q) {
    pinnedWrap.hidden = true;
    const hits = search(q);
    recentHead.textContent = hits.length + (hits.length === 1 ? ' match' : ' matches');
    for (const p of hits.slice(0, 60)) homeList.append(card(p, q));
    if (!hits.length) homeList.append(el('p', 'nt-none', 'No note mentions "' + q + '".'));
    return;
  }
  const pinned = sorted(state.pages().filter(p => p.pinned));
  pinnedWrap.hidden = !pinned.length;
  for (const p of pinned) pinnedList.append(card(p));
  recentHead.textContent = sortEl.value === 'title' ? 'All notes' : sortEl.value === 'created' ? 'Newest' : 'Recent';
  const list = sorted(state.pages().filter(p => !p.pinned)).slice(0, sortEl.value === 'title' ? 200 : 12);
  if (!list.length && !pinned.length) {
    homeList.append(el('p', 'nt-none', 'Nothing here yet. Start a note, or a temporary one for scratch.'));
    return;
  }
  for (const p of list) homeList.append(card(p));
}

// ─── Quick switcher (Ctrl+P) ───
// Jump to any note by typing part of its title or text. Enter on no match
// makes a note with that title.

let qs = null;

function openSwitcher() {
  if (qs) { qs.input.focus(); return; }
  const previous = document.activeElement;
  const scrim = el('div', 'dlg-scrim qs-scrim');
  const win = el('div', 'win qs');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-label', 'Jump to a note');
  const input = el('input', 'qs-input');
  input.type = 'text';
  input.placeholder = 'Jump to a note, or type a new title...';
  input.maxLength = 200;
  input.spellcheck = false;
  input.setAttribute('aria-controls', 'qs-list');
  const list = el('ul', 'qs-list');
  list.id = 'qs-list';
  list.setAttribute('role', 'listbox');
  const hint = el('p', 'qs-hint', '↑ ↓ to move · Enter to open · Esc to close');
  win.append(input, list, hint);
  scrim.append(win);
  document.body.append(scrim);
  qs = { scrim, input, list, active: 0, items: [], previous };

  const draw = () => {
    const q = input.value.trim();
    const hits = q ? search(q).slice(0, 10) : sorted(state.pages()).slice(0, 10);
    qs.items = hits.map(p => ({ label: pageName(p), meta: (p.folderId && state.folder(p.folderId) || {}).name || '', run: () => openPage(p.id) }));
    if (q && !hits.some(p => pageName(p).toLowerCase() === q.toLowerCase())) {
      qs.items.push({ label: 'Create "' + q + '"', meta: 'new note', run: () => newPage({}, q.slice(0, 200)) });
    }
    qs.active = Math.min(qs.active, Math.max(0, qs.items.length - 1));
    list.replaceChildren(...qs.items.map((it, i) => {
      const li = el('li', 'qs-item' + (i === qs.active ? ' active' : ''));
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === qs.active));
      li.append(el('span', 'qs-label', it.label), el('span', 'qs-meta', it.meta));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); closeSwitcher(false); it.run(); });
      return li;
    }));
    if (!qs.items.length) list.append(el('li', 'qs-none', 'No notes yet. Type a title to make one.'));
  };
  input.addEventListener('input', () => { qs.active = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); qs.active = Math.min(qs.active + 1, qs.items.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); qs.active = Math.max(qs.active - 1, 0); draw(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = qs.items[qs.active];
      closeSwitcher(false);
      if (it) it.run();
    } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSwitcher(true); }
  });
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeSwitcher(true); });
  draw();
  input.focus();
}

function closeSwitcher(restore) {
  if (!qs) return;
  const { scrim, previous } = qs;
  qs = null;
  scrim.remove();
  if (restore && previous && previous.isConnected) previous.focus();
}

// ─── Init ───

export function initNotes() {
  tree = document.getElementById('sb-tree');
  home = document.getElementById('nt-home');
  doc = document.getElementById('nt-doc');
  homeList = document.getElementById('nt-recent');
  fTitle = document.getElementById('nt-title');
  blocksEl = document.getElementById('nt-blocks');
  fMove = document.getElementById('nt-move');
  fTemp = document.getElementById('nt-temp');
  fPin = document.getElementById('nt-pin');
  fUpdated = document.getElementById('nt-updated');
  fCrumb = document.getElementById('nt-crumb');
  linksOut = document.getElementById('nt-links-out');
  linksIn = document.getElementById('nt-links-in');
  backRow = document.getElementById('nt-backlinks');
  linkAdd = document.getElementById('nt-link-add');
  picker = document.getElementById('nt-picker');
  pickerInput = document.getElementById('nt-picker-input');
  pickerList = document.getElementById('nt-picker-list');
  searchEl = document.getElementById('nt-search');
  sortEl = document.getElementById('nt-sort');
  pinnedWrap = document.getElementById('nt-pinned-wrap');
  pinnedList = document.getElementById('nt-pinned');
  recentHead = document.getElementById('nt-recent-head');

  sortEl.value = ['recent', 'created', 'title'].includes(sortMode()) ? sortMode() : 'recent';
  sortEl.addEventListener('change', () => {
    try { localStorage.setItem(SORT_KEY, sortEl.value); } catch { /* not fatal */ }
    renderHome();
  });
  searchEl.addEventListener('input', renderHome);
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; renderHome(); }
    if (e.key === 'Enter') { const first = homeList.querySelector('.nt-card'); if (first) first.click(); }
  });

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
  const notesHead = document.getElementById('sb-notes-open');
  notesHead.addEventListener('click', openHome);
  dropTarget(notesHead, null);
  document.getElementById('nt-new-page').addEventListener('click', () => newPage({}));
  document.getElementById('nt-new-temp').addEventListener('click', () => newPage({ temporary: true }));
  document.getElementById('nt-new-folder').addEventListener('click', newFolder);
  document.getElementById('nt-find').addEventListener('click', openSwitcher);
  document.getElementById('nt-crumb').addEventListener('click', openHome);
  try { if (localStorage.getItem(FULL_KEY) === '1') document.body.classList.add('nt-full'); } catch { /* default */ }
  editor.initEditor({
    host: blocksEl, doc, before: fTitle, onChange: edited,
    notify: (title, message, type) => (notify[type] || notify.info)(title, message),
  });
  const more = document.getElementById('nt-more');
  more.addEventListener('click', () => {
    const page = openPageId && state.page(openPageId);
    if (!page) return;
    const r = more.getBoundingClientRect();
    showCtx({ clientX: r.left, clientY: r.bottom + 2 }, [
      { label: 'Duplicate', onClick: () => duplicatePage(page.id) },
      { label: 'Copy text', onClick: async () => {
        await commit();
        try { await navigator.clipboard.writeText(plainText(state.page(page.id) || page)); notify.success('Copied', pageName(page)); }
        catch (err) { notify.error('Could not copy', err.message); }
      } },
      { label: 'Full width', checked: document.body.classList.contains('nt-full'), onClick: () => setFullWidth(!document.body.classList.contains('nt-full')) },
      { label: 'Jump to another note (Ctrl+P)', onClick: openSwitcher },
    ]);
  });

  fTitle.addEventListener('input', queueSave);
  fTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.focusStart(); }
  });
  fMove.addEventListener('change', () => { if (openPageId) moveToFolder(openPageId, fMove.value || null); });
  fTemp.addEventListener('click', async () => {
    const page = openPageId && state.page(openPageId);
    if (!page) return;
    try { await state.updatePage(page.id, { temporary: !page.temporary }); } catch (err) {
      notify.error('Could not update the note', err.message);
    }
  });
  fPin.addEventListener('click', () => {
    const page = openPageId && state.page(openPageId);
    if (page) setPinned(page.id, !page.pinned);
  });
  document.getElementById('nt-delete').addEventListener('click', () => { if (openPageId) deletePage(openPageId); });

  // Ctrl+P anywhere jumps to a note; Ctrl+N in Notes makes one.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); openSwitcher(); }
    else if (k === 'n' && current() === 'notes-page' && !document.querySelector('.dlg-scrim')) { e.preventDefault(); newPage({}); }
  });

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
