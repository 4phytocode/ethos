// The journals list and the single-note editor.
//
// The list has two axes the user controls. `mode` picks how notes are grouped
// (recent, calendar, by tag, all) and `display` picks how each one is drawn
// (cards or bullets). They are independent on purpose: every grouping renders
// through the same two item renderers, so adding a grouping later costs one
// function rather than two.
//
// Both, plus the sort direction, are remembered in localStorage — a per-viewer
// convenience, not state the app depends on, so every access is wrapped.

import * as state from './state.js';
import { show, showCtx, onLeave } from './views.js';
import { setNote, closePanels } from './tags.js';
import { notify } from './notifications.js';
import { confirmDialog } from './dialog.js';
import { initPrompts, startPrompts, stopPrompts } from './prompts.js';
import { initStreak, journalledDays, todayISO } from './journal-streak.js';

const TYPING_SAVE_MS = 400;
const RECENT_LIMIT = 12;
const PREVIEW_CHARS = 260;
const PREFS_KEY = 'ethos.journalView';

let els = null;
let currentNoteId = null;
let typingTimer = null;

// View state
let mode = 'recent';            // recent | calendar | tag | all
let display = 'cards';          // cards | bullets
let sortDir = 'desc';           // desc = newest first
let query = '';
let activeTagIds = new Set();
let calAnchor = null;           // Date, first of the month being shown

const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const monthFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long' });
const dayNameFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

export function initJournals() {
  els = {
    grid: document.getElementById('pages-grid'),
    title: document.getElementById('jp-title'),
    textarea: document.getElementById('jp-textarea'),
    search: document.getElementById('jr-search'),
    searchBtn: document.getElementById('jr-search-btn'),
    filterBtn: document.getElementById('jr-filter-btn'),
    filterBar: document.getElementById('jr-filterbar'),
    sortBtn: document.getElementById('jr-sort-btn'),
    displayBtn: document.getElementById('jr-display-btn'),
    calNav: document.getElementById('jr-cal-nav'),
    calTitle: document.getElementById('jr-cal-title'),
    calPrev: document.getElementById('jr-cal-prev'),
    calNext: document.getElementById('jr-cal-next'),
    tabs: [...document.querySelectorAll('.jr-tab')],
  };

  restorePrefs();
  calAnchor = startOfMonth(new Date());

  document.getElementById('new-page-btn').addEventListener('click', newNote);
  document.getElementById('back-from-journals').addEventListener('click', () => show('home'));
  document.getElementById('back-from-journal').addEventListener('click', async () => {
    await persist();
    show('journals');
  });

  els.tabs.forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

  els.searchBtn.addEventListener('click', () => {
    els.search.hidden = !els.search.hidden;
    els.searchBtn.classList.toggle('on', !els.search.hidden);
    if (els.search.hidden) { query = ''; els.search.value = ''; renderList(); }
    else els.search.focus();
  });
  els.search.addEventListener('input', () => { query = els.search.value.trim().toLowerCase(); renderList(); });
  els.search.addEventListener('keydown', (e) => { if (e.key === 'Escape') els.searchBtn.click(); });

  els.filterBtn.addEventListener('click', () => {
    els.filterBar.hidden = !els.filterBar.hidden;
    els.filterBtn.classList.toggle('on', !els.filterBar.hidden);
    if (els.filterBar.hidden) { activeTagIds.clear(); renderList(); }
    else renderFilterBar();
  });

  els.sortBtn.addEventListener('click', () => {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    els.sortBtn.title = sortDir === 'desc' ? 'Newest first' : 'Oldest first';
    els.sortBtn.classList.toggle('on', sortDir === 'asc');
    savePrefs();
    renderList();
  });

  els.displayBtn.addEventListener('click', () => {
    display = display === 'cards' ? 'bullets' : 'cards';
    syncDisplayBtn();
    savePrefs();
    renderList();
  });

  els.calPrev.addEventListener('click', () => { calAnchor = addMonths(calAnchor, -1); renderList(); });
  els.calNext.addEventListener('click', () => { calAnchor = addMonths(calAnchor, 1); renderList(); });

  els.title.addEventListener('input', scheduleSave);
  els.textarea.addEventListener('input', scheduleSave);
  onLeave('journal-page', () => { stopPrompts(); persist(); });
  initPrompts();

  initStreak();
  syncTabs();
  syncDisplayBtn();
  els.sortBtn.title = sortDir === 'desc' ? 'Newest first' : 'Oldest first';
  els.sortBtn.classList.toggle('on', sortDir === 'asc');

  state.subscribe(renderList);
  renderList();
}

// ─── Preferences ───

function restorePrefs() {
  let raw = null;
  try { raw = localStorage.getItem(PREFS_KEY); } catch { /* ignore */ }
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (['recent', 'calendar', 'tag', 'all'].includes(p.mode)) mode = p.mode;
    if (['cards', 'bullets'].includes(p.display)) display = p.display;
    if (['asc', 'desc'].includes(p.sortDir)) sortDir = p.sortDir;
  } catch { /* a malformed preference is not worth failing over */ }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, display, sortDir })); } catch { /* ignore */ }
}

function setMode(next) {
  mode = next;
  savePrefs();
  syncTabs();
  renderList();
}

function syncTabs() {
  els.tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
}

function syncDisplayBtn() {
  const cards = display === 'cards';
  els.displayBtn.title = cards ? 'Switch to list view' : 'Switch to card view';
  els.displayBtn.innerHTML = '';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '17');
  svg.setAttribute('height', '17');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // The icon shows what you would switch to, not what you are in.
  const shapes = cards
    ? [['path', { d: 'M4 6h16M4 12h16M4 18h16' }]]
    : [['rect', { x: 3, y: 3, width: 8, height: 8, rx: 1.5 }],
       ['rect', { x: 13, y: 3, width: 8, height: 8, rx: 1.5 }],
       ['rect', { x: 3, y: 13, width: 8, height: 8, rx: 1.5 }],
       ['rect', { x: 13, y: 13, width: 8, height: 8, rx: 1.5 }]];
  for (const [tag, attrs] of shapes) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.appendChild(el);
  }
  els.displayBtn.appendChild(svg);
}

// ─── Selecting what to show ───

function visibleNotes() {
  let list = state.notes();

  // Drop filters for tags that no longer exist, or the list would match nothing
  // with no pill left to turn the filter off.
  const live = new Set(state.tags().map(t => t.id));
  for (const id of activeTagIds) if (!live.has(id)) activeTagIds.delete(id);
  if (activeTagIds.size) {
    list = list.filter(n => n.tagIds.some(id => activeTagIds.has(id)));
  }
  if (query) {
    list = list.filter(n =>
      n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query));
  }

  // state.notes() is oldest-first from the vault; copy before sorting.
  list = [...list].sort((a, b) => sortDir === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
  return list;
}

// ─── Rendering ───

function renderList() {
  if (!els) return;
  // A rename in progress would be wiped by the rebuild; redraw once it ends.
  const active = document.activeElement;
  if (active && active.classList.contains('rename-input') && els.grid.contains(active)) {
    active.addEventListener('blur', () => setTimeout(renderList), { once: true });
    return;
  }

  els.calNav.hidden = mode !== 'calendar';
  els.grid.className = 'pages-grid' + (display === 'bullets' ? ' as-bullets' : '');
  els.grid.innerHTML = '';
  if (!els.filterBar.hidden) renderFilterBar();

  const notes = visibleNotes();

  if (mode === 'calendar') { renderCalendar(notes); return; }

  if (notes.length === 0) { els.grid.appendChild(emptyState()); return; }

  if (mode === 'tag') { renderByTag(notes); return; }

  const shown = mode === 'recent' ? notes.slice(0, RECENT_LIMIT) : notes;
  const wrap = itemContainer();
  for (const n of shown) wrap.appendChild(renderItem(n));
  els.grid.appendChild(wrap);

  if (mode === 'recent' && notes.length > RECENT_LIMIT) {
    const more = document.createElement('p');
    more.className = 'jr-more';
    more.textContent = notes.length - RECENT_LIMIT + ' more in All.';
    els.grid.appendChild(more);
  }
}

function emptyState() {
  const p = document.createElement('p');
  p.className = 'pages-empty';
  if (query || activeTagIds.size) p.textContent = 'Nothing matches that.';
  else p.textContent = 'No journals yet. Start one with + New Journal.';
  return p;
}

// Cards flow in a wrapping row; bullets stack in a column.
function itemContainer() {
  const wrap = document.createElement('div');
  wrap.className = display === 'bullets' ? 'jr-bullets' : 'jr-cards';
  return wrap;
}

function renderItem(note) {
  return display === 'bullets' ? renderBullet(note) : renderCard(note);
}

function preview(content) {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= PREVIEW_CHARS) return text;
  return text.slice(0, PREVIEW_CHARS).trimEnd() + '…';
}

function tagPills(note, className) {
  const wrap = document.createElement('div');
  wrap.className = className;
  for (const t of state.tagsOf(note)) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = t.name;
    pill.style.background = t.color;
    wrap.appendChild(pill);
  }
  return wrap;
}

function attachRowBehaviour(el, note) {
  el.dataset.noteId = note.id;
  el.addEventListener('click', () => openNote(note.id));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCtx(e, [
      { label: 'Rename', onClick: () => startRename(note.id) },
      { label: 'Delete', onClick: () => remove(note.id) },
    ]);
  });
}

function renderCard(note) {
  const card = document.createElement('div');
  card.className = 'page-card';

  const name = document.createElement('p');
  name.className = 'name';
  name.textContent = note.title;
  card.appendChild(name);

  const body = document.createElement('p');
  body.className = 'jr-preview';
  body.textContent = preview(note.content);
  card.appendChild(body);

  const foot = document.createElement('div');
  foot.className = 'jr-card-foot';
  const when = document.createElement('span');
  when.className = 'jr-date';
  when.textContent = dateFormat.format(new Date(note.createdAt));
  foot.appendChild(when);
  foot.appendChild(tagPills(note, 'jr-card-tags'));
  card.appendChild(foot);

  attachRowBehaviour(card, note);
  return card;
}

// Dot, then the title on the left; tags and date pushed to the right.
function renderBullet(note) {
  const row = document.createElement('div');
  row.className = 'jr-bullet';

  const dot = document.createElement('span');
  dot.className = 'jr-dot';
  dot.setAttribute('aria-hidden', 'true');
  row.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'jr-bullet-name';
  name.textContent = note.title;
  row.appendChild(name);

  const right = document.createElement('span');
  right.className = 'jr-bullet-right';
  right.appendChild(tagPills(note, 'jr-bullet-tags'));
  const when = document.createElement('span');
  when.className = 'jr-date';
  when.textContent = dateFormat.format(new Date(note.createdAt));
  right.appendChild(when);
  row.appendChild(right);

  attachRowBehaviour(row, note);
  return row;
}

// ─── Groupings ───

function renderByTag(notes) {
  const groups = new Map();      // tagId -> notes
  const untagged = [];

  for (const n of notes) {
    if (n.tagIds.length === 0) { untagged.push(n); continue; }
    // A note with several tags appears under each of them.
    for (const id of n.tagIds) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(n);
    }
  }

  for (const tag of state.tags()) {
    const list = groups.get(tag.id);
    if (!list || !list.length) continue;
    els.grid.appendChild(groupHeading(tag.name, list.length, tag.color));
    const wrap = itemContainer();
    for (const n of list) wrap.appendChild(renderItem(n));
    els.grid.appendChild(wrap);
  }

  if (untagged.length) {
    els.grid.appendChild(groupHeading('Untagged', untagged.length, null));
    const wrap = itemContainer();
    for (const n of untagged) wrap.appendChild(renderItem(n));
    els.grid.appendChild(wrap);
  }
}

function groupHeading(text, count, color) {
  const h = document.createElement('div');
  h.className = 'jr-group';
  if (color) {
    const swatch = document.createElement('span');
    swatch.className = 'jr-group-dot';
    swatch.style.background = color;
    h.appendChild(swatch);
  }
  const label = document.createElement('span');
  label.className = 'jr-group-name';
  label.textContent = text;
  h.appendChild(label);
  const n = document.createElement('span');
  n.className = 'jr-group-count';
  n.textContent = String(count);
  h.appendChild(n);
  return h;
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

function renderCalendar(notes) {
  els.calTitle.textContent = monthFormat.format(calAnchor);

  const byDay = new Map();
  for (const n of notes) {
    const day = isoOf(new Date(n.createdAt));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(n);
  }
  // Which days count as journalled, from the whole set rather than the
  // filtered one, so a search does not make the month look empty.
  const journalled = journalledDays(state.notes());

  const cal = document.createElement('div');
  cal.className = 'jr-cal';

  // Weekday headings, starting Sunday to match the streak grid.
  for (let i = 0; i < 7; i += 1) {
    const head = document.createElement('div');
    head.className = 'jr-cal-dayname';
    head.textContent = dayNameFormat.format(new Date(2024, 0, 7 + i));
    cal.appendChild(head);
  }

  const first = startOfMonth(calAnchor);
  const daysInMonth = new Date(calAnchor.getFullYear(), calAnchor.getMonth() + 1, 0).getDate();
  for (let i = 0; i < first.getDay(); i += 1) {
    const blank = document.createElement('div');
    blank.className = 'jr-cal-cell empty';
    cal.appendChild(blank);
  }

  const today = todayISO();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(calAnchor.getFullYear(), calAnchor.getMonth(), day);
    const iso = isoOf(date);
    const list = byDay.get(iso) || [];

    const cell = document.createElement('div');
    cell.className = 'jr-cal-cell';
    if (journalled.has(iso)) cell.classList.add('journalled');
    if (iso === today) cell.classList.add('is-today');

    const num = document.createElement('span');
    num.className = 'jr-cal-num';
    num.textContent = String(day);
    cell.appendChild(num);

    for (const n of list.slice(0, 3)) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'jr-cal-chip';
      chip.textContent = n.title;
      chip.title = n.title;
      const tag = state.tagsOf(n)[0];
      if (tag) chip.style.borderLeftColor = tag.color;
      chip.addEventListener('click', (e) => { e.stopPropagation(); openNote(n.id); });
      cell.appendChild(chip);
    }
    if (list.length > 3) {
      const more = document.createElement('span');
      more.className = 'jr-cal-more';
      more.textContent = '+' + (list.length - 3) + ' more';
      cell.appendChild(more);
    }
    cal.appendChild(cell);
  }

  els.grid.appendChild(cal);
}

// ─── Filter bar ───

function renderFilterBar() {
  els.filterBar.innerHTML = '';
  if (state.tags().length === 0) {
    const none = document.createElement('span');
    none.className = 'tag-pick-empty';
    none.textContent = 'No tags yet.';
    els.filterBar.appendChild(none);
    return;
  }
  for (const t of state.tags()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'jr-filter-pill' + (activeTagIds.has(t.id) ? ' on' : '');
    b.textContent = t.name;
    b.style.background = t.color;
    b.addEventListener('click', () => {
      if (activeTagIds.has(t.id)) activeTagIds.delete(t.id);
      else activeTagIds.add(t.id);
      renderList();
    });
    els.filterBar.appendChild(b);
  }
}

// ─── Notes ───

async function newNote() {
  try {
    const note = await state.createNote();
    openNote(note.id);
  } catch (err) {
    notify.error('Could not create a journal', err.message);
  }
}

async function remove(noteId) {
  const note = state.note(noteId);
  const title = note ? note.title : 'Journal';
  // Deleting a journal cannot be undone, so it asks first.
  const sure = await confirmDialog({
    title: 'Delete journal', message: 'Delete "' + title + '"? This cannot be undone.',
    okLabel: 'Delete', danger: true,
  });
  if (!sure) return;
  try {
    if (currentNoteId === noteId) currentNoteId = null;
    await state.removeNote(noteId);
    notify.info('Journal deleted', title);
  } catch (err) {
    notify.error('Could not delete that journal', err.message);
  }
}

// Found by id on the element, not by matching the displayed title — two
// journals can share a name.
function startRename(noteId) {
  const row = els.grid.querySelector('[data-note-id="' + noteId + '"]');
  if (!row) return;
  const nameEl = row.querySelector('.name, .jr-bullet-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.className = 'rename-input';
  const note = state.note(noteId);
  input.value = note ? note.title : '';
  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    try {
      await state.updateNote(noteId, { title: input.value.trim() || 'Untitled' });
    } catch (err) {
      notify.error('Could not rename that journal', err.message);
      renderList();
    }
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { done = true; renderList(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ─── Editor ───

async function openNote(noteId) {
  await persist();
  const note = state.note(noteId);
  if (!note) return;
  currentNoteId = noteId;
  els.title.value = note.title;
  els.textarea.value = note.content;
  setNote(noteId);
  closePanels();
  show('journal-page');
  startPrompts(noteId);
}

function scheduleSave() {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { typingTimer = null; persist(); }, TYPING_SAVE_MS);
}

async function persist() {
  if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
  if (!currentNoteId) return;
  const note = state.note(currentNoteId);
  if (!note) { currentNoteId = null; return; }

  const title = els.title.value.trim() || 'Untitled';
  const content = els.textarea.value;
  if (note.title === title && note.content === content) return;

  try {
    await state.updateNote(currentNoteId, { title, content });
  } catch (err) {
    notify.error('Could not save this journal', err.message);
  }
}

export async function commitPending() {
  await persist();
  await state.flush();
}
