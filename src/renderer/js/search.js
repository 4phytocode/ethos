// Global search: Tab (or the magnifier in the sidebar) opens a window that
// searches notes, folders, the schedule, to-dos, journals, habits and timers.
//
// Tab inside the window changes what is searched (Shift+Tab goes back), which is
// how it "asks what you want to search for". Everything is read from the state
// cache and the timer list, so nothing here holds data of its own.

import * as state from './state.js';
import { show } from './views.js';
import { icon } from './icons.js';
import { rank, matchRange } from './search-rank.js';
import { canTakeKey, PLAIN_KEY } from './keys.js';
import { openPage, revealFolder } from './notes.js';
import { openScheduleDay } from './schedule.js';
import { revealTodo } from './todo.js';
import { openJournalNote } from './journals.js';
import { timerList } from './timer.js';
import { openDayNote } from './daynotes.js';

const TAB_KEY = 'ethos.keys.tabSearch';
const SCOPES = [
  ['all', 'Everything'], ['note', 'Notes'], ['folder', 'Folders'], ['schedule', 'Schedule'],
  ['todo', "To-do's"], ['journal', 'Journal'], ['habit', 'Habits'], ['timer', 'Timers'],
];
const GROUP_LABEL = { note: 'Notes', folder: 'Folders', event: 'Schedule', daynote: 'Schedule', todo: "To-do's", journal: 'Journal', habit: 'Habits', timer: 'Timers' };
const GROUP_ICON = { note: 'notes', folder: 'folder', event: 'calendar', daynote: 'calendar', todo: 'checkbox', journal: 'book-open', habit: 'chart-bar', timer: 'hourglass' };
const SCOPE_OF = { note: 'note', folder: 'folder', event: 'schedule', daynote: 'schedule', todo: 'todo', journal: 'journal', habit: 'habit', timer: 'timer' };
const PER_GROUP = 8;
const PER_SCOPE = 50;

let open = null;     // the live window's pieces, or null

export function tabSearchOn() {
  try { return localStorage.getItem(TAB_KEY) !== 'off'; } catch { return true; }
}
function setTabSearch(on) { try { localStorage.setItem(TAB_KEY, on ? 'on' : 'off'); } catch { /* not fatal */ } }

// ─── What can be searched ───

const dateLabel = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function collect() {
  const items = [];
  const folderName = (id) => (id ? state.folderPath(id) : 'Notes');
  for (const p of state.pages()) {
    items.push({ type: 'note', id: p.id, title: p.title || 'Untitled', body: p.content, sub: folderName(p.folderId), when: p.updatedAt });
  }
  for (const f of state.folders()) {
    const tags = state.tagsOf(f);
    items.push({ type: 'folder', id: f.id, title: f.name, extra: tags.map(t => t.name).join(' '), color: f.color,
      sub: (f.parentId ? state.folderPath(f.parentId) + ' › ' : '') + state.noteCountDeep(f.id) + ' notes' + (tags.length ? ' · ' + tags.map(t => t.name).join(', ') : ''),
      when: f.updatedAt });
  }
  for (const e of state.events()) {
    items.push({ type: 'event', id: e.id, date: e.date, title: e.title, body: e.note, sub: dateLabel(e.date), when: e.updatedAt });
  }
  for (const d of state.dayNotes()) {
    items.push({ type: 'daynote', id: d.id, date: d.date, title: d.subjects.join(', ') || d.section, body: d.text, extra: d.section,
      sub: d.section + ' · ' + dateLabel(d.date), when: d.updatedAt });
  }
  for (const t of state.todos()) {
    items.push({ type: 'todo', id: t.id, date: t.date, title: t.title, body: t.description, sub: dateLabel(t.date) + (t.done ? ' · done' : ''), when: t.updatedAt });
  }
  for (const n of state.notes()) {
    items.push({ type: 'journal', id: n.id, title: n.title || 'Untitled', body: n.content, sub: new Date(n.createdAt).toLocaleDateString(), when: n.updatedAt });
  }
  for (const h of state.habits()) {
    items.push({ type: 'habit', id: h.id, title: h.name, sub: 'Habit', when: h.updatedAt });
  }
  for (const t of timerList()) {
    items.push({ type: 'timer', id: t.id, title: t.label || 'Timer', sub: t.length, when: 0 });
  }
  return items;
}

function results(scope, query) {
  const all = collect().filter(i => scope === 'all' || SCOPE_OF[i.type] === scope);
  if (scope !== 'all') return rank(all, query, PER_SCOPE);
  // Everything: the best few of each kind, in a fixed order.
  const out = [];
  for (const type of ['note', 'folder', 'event', 'daynote', 'todo', 'journal', 'habit', 'timer']) {
    out.push(...rank(all.filter(i => i.type === type), query, PER_GROUP));
  }
  return out;
}

// ─── Opening a result ───

function go(item, query) {
  close();
  switch (item.type) {
    case 'note': openPage(item.id); break;
    case 'folder': revealFolder(item.id); break;
    case 'event': openScheduleDay(item.date, { eventId: item.id }); break;
    case 'daynote': openScheduleDay(item.date); setTimeout(() => openDayNote(item.id), 60); break;
    case 'todo': {
      const t = state.todo(item.id);
      const inBody = t && t.description && query && t.description.toLowerCase().includes(query.trim().toLowerCase()) &&
        !t.title.toLowerCase().includes(query.trim().toLowerCase());
      revealTodo(item.id, { expand: !!inBody });
      break;
    }
    case 'journal': openJournalNote(item.id); break;
    case 'habit':
      show('habit-page');
      requestAnimationFrame(() => flash(document.querySelector('[data-habit-id="' + item.id + '"]')));
      break;
    case 'timer':
      show('timer-page');
      requestAnimationFrame(() => flash(document.querySelector('#tm-list [data-id="' + item.id + '"]')));
      break;
    default: break;
  }
}

export function flash(node) {
  if (!node) return;
  node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1400);
}

// ─── The window ───

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function boldTitle(node, title, query) {
  const r = matchRange(title, query);
  if (!r) { node.textContent = title; return; }
  node.append(document.createTextNode(title.slice(0, r[0])), el('b', null, title.slice(r[0], r[1])), document.createTextNode(title.slice(r[1])));
}

function paint() {
  const s = open;
  const list = results(s.scope, s.input.value);
  s.items = list;
  s.active = Math.min(s.active, Math.max(0, list.length - 1));
  s.list.replaceChildren();
  if (!list.length) {
    s.list.appendChild(el('li', 'fs-empty', s.input.value.trim() ? 'Nothing found.' : 'Nothing here yet.'));
    s.input.removeAttribute('aria-activedescendant');
    return;
  }
  let lastGroup = null;
  list.forEach((item, i) => {
    if (s.scope === 'all' && GROUP_LABEL[item.type] !== lastGroup) {
      lastGroup = GROUP_LABEL[item.type];
      s.list.appendChild(el('li', 'fs-group', lastGroup));
    }
    const li = el('li', 'fs-row' + (i === s.active ? ' active' : ''));
    li.id = 'fs-opt-' + i;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === s.active));
    const lead = el('span', 'fs-ico');
    lead.appendChild(icon(GROUP_ICON[item.type], 16));
    if (item.color) lead.style.color = item.color;
    const text = el('span', 'fs-text');
    const title = el('span', 'fs-title');
    boldTitle(title, item.title, s.input.value);
    text.append(title, el('span', 'fs-sub', item.sub || ''));
    li.append(lead, text);
    li.addEventListener('pointerdown', (e) => e.preventDefault());
    li.addEventListener('click', () => go(item, s.input.value));
    li.addEventListener('pointermove', () => { if (s.active !== i) { s.active = i; mark(); } });
    s.list.appendChild(li);
  });
  s.input.setAttribute('aria-activedescendant', 'fs-opt-' + s.active);
}

function mark() {
  const s = open;
  s.list.querySelectorAll('.fs-row').forEach((li, i) => {
    li.classList.toggle('active', i === s.active);
    li.setAttribute('aria-selected', String(i === s.active));
  });
  const cur = s.list.querySelector('.fs-row.active');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  s.input.setAttribute('aria-activedescendant', 'fs-opt-' + s.active);
}

function setScope(scope) {
  const s = open;
  s.scope = scope;
  s.active = 0;
  s.chips.forEach(c => { c.setAttribute('aria-pressed', String(c.dataset.scope === scope)); });
  const label = (SCOPES.find(x => x[0] === scope) || SCOPES[0])[1];
  s.input.placeholder = scope === 'all' ? 'Search notes, folders, schedule…' : 'Search ' + label.toLowerCase() + '…';
  paint();
}

export function openSearch(scope = 'all') {
  if (open) { open.input.focus(); return; }
  const previous = document.activeElement;
  const scrim = el('div', 'fs-scrim');
  const win = el('div', 'win fs-win');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-label', 'Search');

  const bar = el('div', 'win-title');
  bar.append(icon('search', 16), el('span', 'win-title-text', 'FIND.EXE'));
  const closeBtn = el('button', 'win-btn', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close search');
  bar.appendChild(closeBtn);

  const body = el('div', 'win-body fs-body');
  const chipRow = el('div', 'fs-chips');
  chipRow.setAttribute('role', 'group');
  chipRow.setAttribute('aria-label', 'What to search');
  const chips = SCOPES.map(([id, label], i) => {
    const b = el('button', 'fs-chip', label);
    b.type = 'button';
    b.dataset.scope = id;
    b.tabIndex = -1;
    b.title = label + ' (Alt+' + (i + 1) + ')';
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => { setScope(id); open.input.focus(); });
    chipRow.appendChild(b);
    return b;
  });
  const input = el('input', 'fs-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'fs-list');
  const list = el('ul', 'fs-list');
  list.id = 'fs-list';
  list.setAttribute('role', 'listbox');
  const hint = el('div', 'fs-hint', 'Tab: change what to search · ↑↓ choose · Enter open · Esc close');
  body.append(chipRow, input, list, hint);
  win.append(bar, body);
  scrim.appendChild(win);
  document.body.appendChild(scrim);

  open = { scrim, input, list, chips, items: [], active: 0, scope: 'all', previous };
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  closeBtn.addEventListener('click', close);
  input.addEventListener('input', () => { open.active = 0; paint(); });
  document.addEventListener('keydown', onKey, true);
  setScope(SCOPES.some(s => s[0] === scope) ? scope : 'all');
  input.focus();
}

function close() {
  if (!open) return;
  const { scrim, previous } = open;
  open = null;
  document.removeEventListener('keydown', onKey, true);
  scrim.remove();
  if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
}
export { close as closeSearch };

function onKey(e) {
  if (!open) return;
  const s = open;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape') { stop(); close(); return; }
  if (e.key === 'Tab') {
    stop();
    const at = SCOPES.findIndex(x => x[0] === s.scope);
    setScope(SCOPES[(at + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length][0]);
    return;
  }
  if (e.altKey && /^[1-8]$/.test(e.key)) { stop(); setScope(SCOPES[Number(e.key) - 1][0]); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop();
    if (!s.items.length) return;
    s.active = (s.active + (e.key === 'ArrowDown' ? 1 : s.items.length - 1)) % s.items.length;
    mark();
    return;
  }
  if (e.key === 'Enter') {
    stop();
    const item = s.items[s.active];
    if (item) go(item, s.input.value);
  }
}

// ─── Wiring ───

export function initSearch() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.shiftKey || !PLAIN_KEY(e) || open) return;
    if (!tabSearchOn() || !canTakeKey()) return;
    e.preventDefault();
    openSearch('all');
  }, true);
  const btn = document.getElementById('sb-search');
  if (btn) {
    btn.addEventListener('click', () => openSearch('all'));
  }
  // Settings > Keyboard
  const group = document.getElementById('set-tab-search');
  if (group) {
    const render = () => {
      group.replaceChildren(...[[true, 'On'], [false, 'Off']].map(([on, label]) => {
        const b = el('button', 'set-seg' + (tabSearchOn() === on ? ' on' : ''), label);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(tabSearchOn() === on));
        b.addEventListener('click', () => { setTabSearch(on); render(); });
        return b;
      }));
    };
    render();
  }
}
