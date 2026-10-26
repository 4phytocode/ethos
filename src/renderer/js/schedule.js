// The schedule: day, week and month views over the event model in main.
//
// Events are drawn, not typed in. Drag on the grid to draw one, drag an event
// to move it, drag its lower edge to stretch it. While a gesture is running a
// single "ink" element follows the pointer on a spring: it trails, overshoots a
// little and settles, and its speed leans and squashes it, so it reads as
// liquid rather than a box jumping between slots. The record changes once, on
// release, through the usual validated IPC call.
//
// Event dates are local 'YYYY-MM-DD' strings and times are minutes from
// midnight (CONTEXT.md §5). All date arithmetic goes through the helpers below,
// which use the local Date constructor, so month and year rollover and DST are
// handled without a timezone ever entering a record.

import * as state from './state.js';
import { dnChip, renderDayRail, addDayNote, closeDayNote, initDayNotes } from './daynotes.js';
import { show, onEnter, onLeave, current } from './views.js';
import { notify } from './notifications.js';
import { plannedSpan, openTodoDay } from './todo.js';
import { Spring } from './spring.js';

const HOUR_PX = 52;
const SNAP = 15;
const DAY_MIN = 24 * 60;
const DEFAULT_MINUTES = 60;
const DEFAULT_REMIND = 10;
const DRAG_THRESHOLD = 4;
const TYPING_SAVE_MS = 400;
const MODE_KEY = 'ethos.schedule.mode';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const REMIND_CHOICES = [
  [null, 'No reminder'], [0, 'At start'], [5, '5 min before'], [10, '10 min before'],
  [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before'],
];

// ─── Dates ───

const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7));     // weeks start on Monday
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const dow = (d) => (d.getDay() + 6) % 7;
const todayISO = () => iso(new Date());
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nowMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

export function clock(minute) {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return (h % 12 || 12) + (m ? ':' + pad(m) : '') + (h < 12 ? ' AM' : ' PM');
}
const hhmm = (minute) => pad(Math.floor(minute / 60) % 24) + ':' + pad(minute % 60);
const fromHHMM = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snapDown = (m) => Math.floor(m / SNAP) * SNAP;
const snapUp = (m) => Math.ceil(m / SNAP) * SNAP;
const snapNear = (m) => Math.round(m / SNAP) * SNAP;
const endOf = (ev) => Math.min(DAY_MIN, ev.startMinute + (ev.durationMinutes || 30));

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// ─── The ink spring ───
// The Spring class lives in spring.js; the ink is its default paint.

// ─── View state ───

let mode = 'week';
let cursor = midnight(new Date());
let miniCursor = monthStart(cursor);
let selectedId = null;
let born = null;        // an event just drawn: gets the bloom animation once
let landed = null;      // an event just moved or stretched: gets the settle
let swap = null;        // 'next' | 'prev': slide direction for the next render
let gesture = null;
let pendingRender = false;
let scrolledOnce = false;
// Read from scroll events only: a hidden view reports scrollTop 0, and
// trusting that on a redraw would throw the user back to midnight.
let lastScroll = 0;

let stage, titleEl, segEl, pillEl, miniEl, agendaEl;
let scrollEl = null, colsEl = null, layerEl = null, daysShown = [];

function loadMode() {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'day' || m === 'week' || m === 'month') return m;
  } catch { /* storage unavailable: use the default */ }
  return 'week';
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* not fatal */ }
  swap = null;
  scheduleRender();
}

function visibleDays() {
  if (mode === 'day') return [cursor];
  if (mode === 'week') { const a = weekStart(cursor); return [...Array(7)].map((_, i) => addDays(a, i)); }
  const a = weekStart(monthStart(cursor));
  return [...Array(42)].map((_, i) => addDays(a, i));
}

function navigate(delta) {
  if (mode === 'day') cursor = addDays(cursor, delta);
  else if (mode === 'week') cursor = addDays(cursor, delta * 7);
  else cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  miniCursor = monthStart(cursor);
  swap = delta > 0 ? 'next' : 'prev';
  closeEditor();
  scheduleRender();
}

function goTo(date) {
  cursor = midnight(date);
  miniCursor = monthStart(cursor);
  swap = null;
  scheduleRender();
}

// ─── Rendering ───
// Coalesced to one frame. It also means a mutation's return value is in hand
// before the redraw runs, so "the event just drawn" can be marked for it.

let frame = 0;
const afterRender = [];

function scheduleRender(fn) {
  if (fn) afterRender.push(fn);
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    render();
    for (const f of afterRender.splice(0)) f();
  });
}

function render() {
  if (!stage) return;
  // Redrawing mid-gesture would pull the grid out from under the pointer.
  if (gesture) { pendingRender = true; return; }
  pendingRender = false;

  titleEl.textContent = titleText();
  renderSeg();
  renderMini();
  renderAgenda();
  renderDayRail(iso(cursor));

  const node = mode === 'month' ? buildMonth() : buildWeek();
  if (swap) node.classList.add('sc-in-' + swap);
  swap = null;
  stage.replaceChildren(node);

  if (scrollEl) {
    if (scrolledOnce) scrollEl.scrollTop = lastScroll;
    else if (stage.offsetParent) scrollToNow();
  }
  born = null;
  landed = null;
  if (ed.id) placeEditor();
}

function scrollToNow() {
  if (!scrollEl) return;
  scrollEl.scrollTop = Math.max(0, (nowMinute() - 90) * HOUR_PX / 60);
  lastScroll = scrollEl.scrollTop;
  scrolledOnce = true;
}

function titleText() {
  const d = cursor;
  if (mode === 'day') return WEEKDAYS_LONG[dow(d)] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
  if (mode === 'month') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  const a = weekStart(d), b = addDays(a, 6);
  const mon = (x) => MONTHS[x.getMonth()].slice(0, 3);
  if (a.getFullYear() !== b.getFullYear()) {
    return mon(a) + ' ' + a.getDate() + ', ' + a.getFullYear() + ' – ' + mon(b) + ' ' + b.getDate() + ', ' + b.getFullYear();
  }
  if (a.getMonth() !== b.getMonth()) return mon(a) + ' ' + a.getDate() + ' – ' + mon(b) + ' ' + b.getDate() + ', ' + b.getFullYear();
  return mon(a) + ' ' + a.getDate() + ' – ' + b.getDate() + ', ' + b.getFullYear();
}

// The segmented control's highlight slides between options on the app spring.
function renderSeg() {
  let active = null;
  for (const b of segEl.querySelectorAll('button')) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
    if (on) active = b;
  }
  if (active && active.offsetWidth) {
    pillEl.style.width = active.offsetWidth + 'px';
    pillEl.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  }
}

// ─── Week and day ───

function buildWeek() {
  const days = visibleDays();
  daysShown = days;
  const today = todayISO();

  const wrap = el('div', 'sc-week');
  wrap.style.setProperty('--days', days.length);

  const head = el('div', 'sc-week-head');
  head.append(el('div', 'sc-gutter-cell'));
  for (const d of days) {
    const h = el('button', 'sc-dayhead');
    h.type = 'button';
    if (iso(d) === today) h.classList.add('today');
    h.append(el('span', 'sc-dow', WEEKDAYS[dow(d)]), el('span', 'sc-dnum', String(d.getDate())));
    h.title = 'Open ' + WEEKDAYS_LONG[dow(d)];
    h.addEventListener('click', () => { cursor = d; setMode('day'); scheduleRender(); });
    head.append(h);
  }

  const allday = el('div', 'sc-allday');
  allday.append(el('div', 'sc-gutter-cell sc-allday-label', 'all-day'));
  for (const d of days) {
    const cell = el('div', 'sc-allday-cell');
    cell.dataset.date = iso(d);
    for (const ev of state.eventsOn(iso(d))) if (ev.startMinute === null) cell.append(chip(ev, false));
    for (const n of state.dayNotesOn(iso(d))) cell.append(dnChip(n));
    // To-dos with no place on the clock: things to remember, untimed tasks.
    for (const t of state.todosOn(iso(d))) if (!plannedSpan(t)) cell.append(todoChip(t));
    allday.append(cell);
  }
  allday.addEventListener('pointerdown', onCellsDown);

  scrollEl = el('div', 'sc-scroll');
  const own = scrollEl;
  own.addEventListener('scroll', () => { if (own.isConnected && own.offsetParent) lastScroll = own.scrollTop; });
  const grid = el('div', 'sc-grid');
  grid.style.height = 24 * HOUR_PX + 'px';

  const gutter = el('div', 'sc-gutter');
  for (let h = 1; h < 24; h++) {
    const label = el('span', 'sc-hour', clock(h * 60));
    label.style.top = h * HOUR_PX + 'px';
    gutter.append(label);
  }

  colsEl = el('div', 'sc-cols');
  days.forEach((d, i) => {
    const col = el('div', 'sc-col');
    col.dataset.date = iso(d);
    if (iso(d) === today) col.classList.add('today');
    const timed = state.eventsOn(iso(d)).filter(ev => ev.startMinute !== null);
    const todos = state.todosOn(iso(d)).map(t => ({ todo: t, span: plannedSpan(t) }))
      .filter(x => x.span).map(x => ({ todo: x.todo, s: x.span.s, e: x.span.e }));
    for (const pos of layoutDay(timed, todos)) col.append(pos.todo ? todoBlock(pos) : block(pos));
    colsEl.append(col);
    if (iso(d) === today) {
      const now = el('div', 'sc-now');
      now.style.top = nowMinute() * HOUR_PX / 60 + 'px';
      now.style.left = (i / days.length * 100) + '%';
      now.style.width = (100 / days.length) + '%';
      colsEl.append(now);
    }
  });
  layerEl = el('div', 'sc-ink-layer');
  colsEl.append(layerEl);
  colsEl.addEventListener('pointerdown', onGridDown);

  grid.append(gutter, colsEl);
  scrollEl.append(grid);
  wrap.append(head, allday, scrollEl);
  return wrap;
}

// Side-by-side columns for overlapping events: each run of overlapping events
// is a cluster, and each event takes the first column free at its start.
// To-do blocks (`extra`, already { todo, s, e }) share the columns, so a
// planned task sits beside an event rather than under it.
function layoutDay(events, extra = []) {
  const items = events
    .map(ev => ({ ev, s: ev.startMinute, e: endOf(ev) }))
    .concat(extra)
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [], colEnds = [], clusterEnd = -1;
  const close = () => { for (const it of cluster) it.n = colEnds.length; out.push(...cluster); cluster = []; colEnds = []; };
  for (const it of items) {
    if (it.s >= clusterEnd && cluster.length) close();
    let c = colEnds.findIndex(end => end <= it.s);
    if (c === -1) { c = colEnds.length; colEnds.push(it.e); } else colEnds[c] = it.e;
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  if (cluster.length) close();
  return out;
}

function tint(node, ev) {
  if (ev.color) node.style.setProperty('--ev', ev.color);
  if (ev.done) node.classList.add('done');
  if (ev.id === selectedId) node.classList.add('selected');
  if (ev.id === born) node.classList.add('born');
  if (ev.id === landed) node.classList.add('landed');
}

function block({ ev, s, e, col, n }) {
  const b = el('div', 'sc-ev');
  b.dataset.id = ev.id;
  b.tabIndex = 0;
  tint(b, ev);
  b.style.top = s * HOUR_PX / 60 + 'px';
  b.style.height = Math.max(18, (e - s) * HOUR_PX / 60 - 2) + 'px';
  b.style.left = 'calc(' + (col / n * 100) + '% + 2px)';
  b.style.width = 'calc(' + (100 / n) + '% - 6px)';
  if (e - s < 45) b.classList.add('short');
  b.append(el('span', 'sc-ev-title', ev.title), el('span', 'sc-ev-time', clock(s) + ' – ' + clock(e)));
  const grip = el('span', 'sc-ev-grip');
  grip.setAttribute('aria-hidden', 'true');
  b.append(grip);
  b.addEventListener('keydown', (k) => { if (k.key === 'Enter') openEditor(ev.id); });
  return b;
}

// ─── To-dos on the schedule ───
// Drawn from the to-do list, never edited here: a click opens that day's list.
// They swallow pointerdown so a click does not start drawing an event.

function todoOpen(node, t) {
  node.addEventListener('pointerdown', (e) => e.stopPropagation());
  node.addEventListener('click', (e) => { e.stopPropagation(); openTodoDay(t.date); });
  node.addEventListener('keydown', (k) => { if (k.key === 'Enter') openTodoDay(t.date); });
}

function todoBlock({ todo: t, s, e, col, n }) {
  const b = el('div', 'sc-todo' + (t.done ? ' done' : ''));
  b.tabIndex = 0;
  b.title = 'From your to-do list';
  b.style.top = s * HOUR_PX / 60 + 'px';
  b.style.height = Math.max(18, (e - s) * HOUR_PX / 60 - 2) + 'px';
  b.style.left = 'calc(' + (col / n * 100) + '% + 2px)';
  b.style.width = 'calc(' + (100 / n) + '% - 6px)';
  if (e - s < 45) b.classList.add('short');
  b.append(el('span', 'sc-ev-title', t.title), el('span', 'sc-ev-time', 'To-do · ' + clock(s) + ' – ' + clock(e)));
  todoOpen(b, t);
  return b;
}

function todoChip(t) {
  const c = el('div', 'sc-chip sc-todo-chip' + (t.kind === 'remember' ? ' remember' : '') + (t.done ? ' done' : ''));
  c.tabIndex = 0;
  c.title = t.kind === 'remember' ? 'To remember' : 'To-do with no time yet';
  c.append(el('span', 'sc-chip-title', (t.kind === 'remember' ? 'Remember: ' : '') + t.title));
  todoOpen(c, t);
  return c;
}

function chip(ev, withTime) {
  const c = el('div', 'sc-chip');
  c.dataset.id = ev.id;
  c.tabIndex = 0;
  tint(c, ev);
  if (withTime && ev.startMinute !== null) c.append(el('span', 'sc-chip-time', clock(ev.startMinute)));
  c.append(el('span', 'sc-chip-title', ev.title));
  c.addEventListener('keydown', (k) => { if (k.key === 'Enter') openEditor(ev.id); });
  return c;
}

// ─── Month ───

const MONTH_CHIPS = 3;
const MONTH_NOTES = 2;

function buildMonth() {
  const days = visibleDays();
  daysShown = days;
  scrollEl = null; colsEl = null; layerEl = null;
  const today = todayISO();
  const month = cursor.getMonth();

  const wrap = el('div', 'sc-month');
  const head = el('div', 'sc-month-head');
  for (const w of WEEKDAYS) head.append(el('span', null, w));

  const grid = el('div', 'sc-month-grid');
  for (const d of days) {
    const date = iso(d);
    const cell = el('div', 'sc-mcell');
    cell.dataset.date = date;
    if (d.getMonth() !== month) cell.classList.add('out');
    if (date === today) cell.classList.add('today');

    const num = el('button', 'sc-mdate', String(d.getDate()));
    num.type = 'button';
    num.title = 'Open this day';
    num.addEventListener('click', () => { cursor = d; setMode('day'); });
    cell.append(num);

    // Day notes first: in a revision timetable they are what the month is for.
    const notes = state.dayNotesOn(date);
    for (const n of notes.slice(0, MONTH_NOTES)) cell.append(dnChip(n));
    if (notes.length > MONTH_NOTES) {
      const more = el('button', 'sc-more', '+' + (notes.length - MONTH_NOTES) + ' notes');
      more.type = 'button';
      more.addEventListener('click', () => { cursor = d; setMode('day'); });
      cell.append(more);
    }
    const evs = state.eventsOn(date);
    for (const ev of evs.slice(0, MONTH_CHIPS)) cell.append(chip(ev, true));
    const open = state.todosOn(date).filter(t => !t.done);
    if (open.length) {
      const c = el('div', 'sc-chip sc-todo-chip', open.length + (open.length === 1 ? ' to-do' : ' to-dos'));
      c.tabIndex = 0;
      todoOpen(c, { date });
      cell.append(c);
    }
    if (evs.length > MONTH_CHIPS) {
      const more = el('button', 'sc-more', '+' + (evs.length - MONTH_CHIPS) + ' more');
      more.type = 'button';
      more.addEventListener('click', () => { cursor = d; setMode('day'); });
      cell.append(more);
    }
    grid.append(cell);
  }
  grid.addEventListener('pointerdown', onCellsDown);
  wrap.append(head, grid);
  return wrap;
}

// ─── Mini month and the agenda ───

function renderMini() {
  miniEl.replaceChildren();
  const head = el('div', 'sc-mini-head');
  const prev = el('button', 'sc-mini-nav', '‹');
  const next = el('button', 'sc-mini-nav', '›');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Previous month');
  next.setAttribute('aria-label', 'Next month');
  prev.addEventListener('click', () => { miniCursor = new Date(miniCursor.getFullYear(), miniCursor.getMonth() - 1, 1); renderMini(); });
  next.addEventListener('click', () => { miniCursor = new Date(miniCursor.getFullYear(), miniCursor.getMonth() + 1, 1); renderMini(); });
  head.append(el('span', 'sc-mini-title', MONTHS[miniCursor.getMonth()] + ' ' + miniCursor.getFullYear()), prev, next);

  const grid = el('div', 'sc-mini-grid');
  for (const w of WEEKDAYS) grid.append(el('span', 'sc-mini-dow', w[0]));

  const has = new Set(state.events().map(e => e.date).concat(state.dayNotes().map(n => n.date)));
  const shown = mode === 'month' ? new Set() : new Set(visibleDays().map(iso));
  const today = todayISO();
  const sel = iso(cursor);
  const a = weekStart(miniCursor);
  for (let i = 0; i < 42; i++) {
    const d = addDays(a, i);
    const date = iso(d);
    const b = el('button', 'sc-mini-day', String(d.getDate()));
    b.type = 'button';
    if (d.getMonth() !== miniCursor.getMonth()) b.classList.add('out');
    if (shown.has(date)) b.classList.add('inrange');
    if (date === today) b.classList.add('today');
    if (date === sel) b.classList.add('sel');
    if (has.has(date)) b.classList.add('has');
    b.addEventListener('click', () => goTo(d));
    grid.append(b);
  }
  miniEl.append(head, grid);
}

function dayLabel(date) {
  const today = todayISO();
  if (date === today) return 'Today';
  if (date === iso(addDays(new Date(), 1))) return 'Tomorrow';
  const d = fromISO(date);
  return WEEKDAYS[dow(d)] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3);
}

function renderAgenda() {
  agendaEl.replaceChildren();
  const today = todayISO();
  const now = nowMinute();
  const upcoming = state.events().filter(e => !e.done && (e.date > today ||
    (e.date === today && (e.startMinute === null || endOf(e) > now)))).slice(0, 6);

  if (!upcoming.length) {
    agendaEl.append(el('li', 'sc-agenda-empty', 'Nothing coming up.'));
    return;
  }
  for (const ev of upcoming) {
    const li = el('li');
    const b = el('button', 'sc-agenda-item');
    b.type = 'button';
    const dot = el('i', 'sc-dot');
    if (ev.color) dot.style.setProperty('--ev', ev.color);
    const text = el('span', 'sc-agenda-text');
    text.append(el('span', 'sc-agenda-title', ev.title),
      el('span', 'sc-agenda-when', dayLabel(ev.date) + ' · ' + (ev.startMinute === null ? 'All day' : clock(ev.startMinute))));
    b.append(dot, text);
    b.addEventListener('click', () => {
      cursor = fromISO(ev.date);
      miniCursor = monthStart(cursor);
      scheduleRender(() => openEditor(ev.id));
    });
    li.append(b);
    agendaEl.append(li);
  }
}

// ─── Gestures on the time grid ───

function pointerAt(e) {
  const r = colsEl.getBoundingClientRect();
  const colW = r.width / daysShown.length;
  return {
    day: clamp(Math.floor((e.clientX - r.left) / colW), 0, daysShown.length - 1),
    minute: clamp((e.clientY - r.top) / HOUR_PX * 60, 0, DAY_MIN),
    colW,
  };
}

function onGridDown(e) {
  if (e.button !== 0) return;
  const evEl = e.target.closest('.sc-ev');
  if (ed.id) {
    closeEditor();
    if (!evEl) return;          // a click on empty grid only dismisses the editor
  }
  const p = pointerAt(e);
  if (evEl) {
    const ev = state.event(evEl.dataset.id);
    if (!ev) return;
    gesture = {
      kind: e.target.closest('.sc-ev-grip') ? 'resize' : 'move',
      ev, el: evEl, x0: e.clientX, y0: e.clientY, moved: false,
      offset: p.minute - ev.startMinute, day: daysShown.findIndex(d => iso(d) === ev.date),
      start: ev.startMinute, dur: endOf(ev) - ev.startMinute,
    };
  } else {
    const start = snapDown(p.minute);
    gesture = { kind: 'draw', x0: e.clientX, y0: e.clientY, moved: false,
      day: p.day, anchor: start, start, dur: SNAP };
  }
  // Window listeners rather than pointer capture alone: if capture is lost
  // (a popover, a re-render), the release still lands and the gesture ends.
  try { colsEl.setPointerCapture(e.pointerId); } catch { /* listeners below cover it */ }
  window.addEventListener('pointermove', onGridMove);
  window.addEventListener('pointerup', onGridUp);
  window.addEventListener('pointercancel', onGridUp);
  e.preventDefault();
}

function onGridMove(e) {
  const g = gesture;
  if (!g) return;
  if (!g.moved) {
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_THRESHOLD) return;
    g.moved = true;
    startInk(g);
    g.scrollRaf = requestAnimationFrame(autoScroll);
  }
  g.last = e;
  aim(g, e);
}

function aim(g, e) {
  const p = pointerAt(e);
  if (g.kind === 'draw') {
    if (p.minute >= g.anchor) {
      g.start = g.anchor;
      g.dur = Math.max(SNAP, snapUp(p.minute) - g.anchor);
    } else {
      g.start = snapDown(p.minute);
      g.dur = g.anchor + SNAP - g.start;
    }
  } else if (g.kind === 'move') {
    g.day = p.day;
    g.start = clamp(snapNear(p.minute - g.offset), 0, Math.min(DAY_MIN - SNAP, DAY_MIN - g.dur));
  } else {
    g.dur = clamp(snapUp(p.minute) - g.start, SNAP, DAY_MIN - g.start);
  }
  g.ink.to({
    x: g.day * p.colW + 2,
    y: g.start * HOUR_PX / 60,
    w: p.colW - 6,
    h: Math.max(18, g.dur * HOUR_PX / 60 - 2),
  });
  g.inkTime.textContent = clock(g.start) + ' – ' + clock(g.start + g.dur);
}

function startInk(g) {
  const ink = el('div', 'sc-ink');
  if (g.ev && g.ev.color) ink.style.setProperty('--ev', g.ev.color);
  g.inkTime = el('span', 'sc-ink-time');
  ink.append(el('span', 'sc-ink-title', g.ev ? g.ev.title : 'New event'), g.inkTime);
  layerEl.append(ink);
  if (g.el) g.el.classList.add('ghosted');
  g.ink = new Spring(ink);
}

// Dragging near the top or bottom edge scrolls the grid, faster the closer the
// pointer is, and keeps the ink under the pointer while it does.
function autoScroll() {
  const g = gesture;
  if (!g || !scrollEl) return;
  if (g.last) {
    const r = scrollEl.getBoundingClientRect();
    const y = g.last.clientY;
    let v = 0;
    if (y < r.top + 40) v = -(r.top + 40 - y) / 3;
    else if (y > r.bottom - 40) v = (y - (r.bottom - 40)) / 3;
    if (v) { scrollEl.scrollTop += clamp(v, -20, 20); aim(g, g.last); }
  }
  g.scrollRaf = requestAnimationFrame(autoScroll);
}

async function onGridUp() {
  const g = gesture;
  gesture = null;
  window.removeEventListener('pointermove', onGridMove);
  window.removeEventListener('pointerup', onGridUp);
  window.removeEventListener('pointercancel', onGridUp);
  if (!g) return;
  cancelAnimationFrame(g.scrollRaf);
  if (g.ink) g.ink.stop();

  const date = iso(daysShown[g.day]);
  try {
    if (g.kind === 'draw') {
      if (!g.moved) g.dur = DEFAULT_MINUTES;
      g.dur = Math.min(g.dur, DAY_MIN - g.start);
      const ev = await state.createEvent({
        date, title: '', startMinute: g.start, durationMinutes: g.dur, remindMinutes: DEFAULT_REMIND,
      });
      born = ev.id;
      scheduleRender(() => openEditor(ev.id, { fresh: true }));
    } else if (!g.moved) {
      openEditor(g.ev.id);
    } else if (g.kind === 'move') {
      landed = g.ev.id;
      await state.updateEvent(g.ev.id, { date, startMinute: g.start });
    } else {
      landed = g.ev.id;
      await state.updateEvent(g.ev.id, { durationMinutes: g.dur });
    }
  } catch (err) {
    notify.error('Could not save the event', err.message);
  }
  // No state change (a plain click, or a failed save) means no redraw came
  // through the subscription, so clear the ink here.
  scheduleRender();
}

// ─── Gestures on the all-day row and the month grid ───
// Chips move between days. The ink is a copy of the chip on a fixed layer,
// following the pointer on the same spring.

function onCellsDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('.sc-mdate, .sc-more')) return;
  const chipEl = e.target.closest('.sc-chip');
  const cell = e.target.closest('[data-date]');
  if (!cell) return;
  if (ed.id) {
    closeEditor();
    if (!chipEl) return;
  }
  const area = e.currentTarget;
  const r = chipEl ? chipEl.getBoundingClientRect() : null;
  gesture = {
    kind: 'cells', area, chip: chipEl, cell, x0: e.clientX, y0: e.clientY, moved: false,
    ev: chipEl ? state.event(chipEl.dataset.id) : null,
    dx: r ? e.clientX - r.left : 0, dy: r ? e.clientY - r.top : 0, w: r ? r.width : 0, drop: null,
  };
  try { area.setPointerCapture(e.pointerId); } catch { /* window listeners cover it */ }
  window.addEventListener('pointermove', onCellsMove);
  window.addEventListener('pointerup', onCellsUp);
  window.addEventListener('pointercancel', onCellsUp);
  e.preventDefault();
}

function onCellsMove(e) {
  const g = gesture;
  if (!g || !g.chip) return;
  if (!g.moved) {
    if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_THRESHOLD) return;
    g.moved = true;
    const ink = g.chip.cloneNode(true);
    ink.classList.add('sc-chip-ink');
    ink.style.width = g.w + 'px';
    document.body.append(ink);
    g.inkNode = ink;
    g.ink = new Spring(ink);
    g.chip.classList.add('ghosted');
  }
  g.ink.to({ x: e.clientX - g.dx, y: e.clientY - g.dy });
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const cell = under && under.closest('[data-date]');
  const drop = cell && g.area.contains(cell) ? cell : null;
  if (drop !== g.drop) {
    if (g.drop) g.drop.classList.remove('drop');
    if (drop) drop.classList.add('drop');
    g.drop = drop;
  }
}

async function onCellsUp() {
  const g = gesture;
  gesture = null;
  if (!g) return;
  window.removeEventListener('pointermove', onCellsMove);
  window.removeEventListener('pointerup', onCellsUp);
  window.removeEventListener('pointercancel', onCellsUp);
  if (g.ink) g.ink.stop();
  if (g.inkNode) g.inkNode.remove();
  if (g.drop) g.drop.classList.remove('drop');

  try {
    if (!g.chip) {
      const ev = await state.createEvent({ date: g.cell.dataset.date, title: '' });
      born = ev.id;
      scheduleRender(() => openEditor(ev.id, { fresh: true }));
    } else if (!g.moved) {
      openEditor(g.ev.id);
    } else if (g.drop && g.drop.dataset.date !== g.ev.date) {
      landed = g.ev.id;
      await state.updateEvent(g.ev.id, { date: g.drop.dataset.date });
    }
  } catch (err) {
    notify.error('Could not save the event', err.message);
  }
  scheduleRender();
}

// ─── The editor popover ───
// Every field saves as it changes; there is no Save button. A freshly drawn
// event that is dismissed untouched is removed again, the way an unfinished
// sketch is rubbed out.

const ed = { id: null, fresh: false, touched: false, titleTimer: 0, noteTimer: 0 };
let pop, fTitle, fDate, fAllDay, fStart, fEnd, fTimes, fColors, fRemind, fNote, fDone, fDelete;

function initEditor() {
  pop = document.getElementById('sc-pop');
  fTitle = document.getElementById('sc-pop-title');
  fDate = document.getElementById('sc-pop-date');
  fAllDay = document.getElementById('sc-pop-allday');
  fStart = document.getElementById('sc-pop-start');
  fEnd = document.getElementById('sc-pop-end');
  fTimes = document.getElementById('sc-pop-times');
  fColors = document.getElementById('sc-pop-colors');
  fRemind = document.getElementById('sc-pop-remind');
  fNote = document.getElementById('sc-pop-note');
  fDone = document.getElementById('sc-pop-done');
  fDelete = document.getElementById('sc-pop-delete');

  for (const [value, label] of REMIND_CHOICES) {
    const o = el('option', null, label);
    o.value = value === null ? '' : String(value);
    fRemind.append(o);
  }

  fTitle.addEventListener('input', () => {
    ed.touched = true;
    clearTimeout(ed.titleTimer);
    ed.titleTimer = setTimeout(commitTitle, TYPING_SAVE_MS);
  });
  fTitle.addEventListener('keydown', (k) => { if (k.key === 'Enter') { k.preventDefault(); closeEditor(); } });
  fNote.addEventListener('input', () => {
    ed.touched = true;
    clearTimeout(ed.noteTimer);
    ed.noteTimer = setTimeout(commitNote, TYPING_SAVE_MS);
  });

  fDate.addEventListener('change', () => {
    if (!fDate.value) return;
    patch({ date: fDate.value });
    goTo(fromISO(fDate.value));
  });
  fAllDay.addEventListener('change', () => {
    patch(fAllDay.checked
      ? { startMinute: null, durationMinutes: null, remindMinutes: null }
      : { startMinute: 9 * 60, durationMinutes: DEFAULT_MINUTES, remindMinutes: DEFAULT_REMIND });
  });
  fStart.addEventListener('change', () => {
    const ev = state.event(ed.id);
    if (!ev || !fStart.value) return;
    const start = fromHHMM(fStart.value);
    const dur = Math.min(ev.durationMinutes || 30, DAY_MIN - start);
    patch({ startMinute: start, durationMinutes: Math.max(1, dur) });
  });
  fEnd.addEventListener('change', () => {
    const ev = state.event(ed.id);
    if (!ev || !fEnd.value || ev.startMinute === null) return;
    let end = fromHHMM(fEnd.value);
    if (end <= ev.startMinute) end = ev.startMinute + SNAP;
    patch({ durationMinutes: Math.min(end - ev.startMinute, DAY_MIN) });
  });
  fRemind.addEventListener('change', () => {
    patch({ remindMinutes: fRemind.value === '' ? null : Number(fRemind.value) });
  });
  fDone.addEventListener('click', () => {
    const ev = state.event(ed.id);
    if (ev) patch({ done: !ev.done });
  });
  fDelete.addEventListener('click', () => deleteEvent(ed.id));

  pop.addEventListener('keydown', (k) => { if (k.key === 'Escape') { k.stopPropagation(); closeEditor(); } });

  // A press anywhere outside the popover dismisses it. The grid and cell
  // handlers run first (bubbling) and close it themselves.
  document.addEventListener('pointerdown', (e) => {
    if (ed.id && !pop.contains(e.target)) closeEditor();
  });
}

function buildColors(current) {
  fColors.replaceChildren();
  const choices = [null, ...state.tagColorPalette()];
  for (const c of choices) {
    const b = el('button', 'sc-swatch');
    b.type = 'button';
    if (c) b.style.setProperty('--ev', c);
    else b.classList.add('none');
    b.setAttribute('aria-label', c ? 'Colour ' + c : 'No colour');
    b.setAttribute('aria-pressed', String(c === current));
    b.addEventListener('click', () => {
      for (const s of fColors.children) s.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      patch({ color: c });
    });
    fColors.append(b);
  }
}

function fillEditor(ev) {
  fTitle.value = ed.fresh && ev.title === 'Untitled' ? '' : ev.title;
  fDate.value = ev.date;
  const allDay = ev.startMinute === null;
  fAllDay.checked = allDay;
  fTimes.hidden = allDay;
  fRemind.disabled = allDay;
  if (!allDay) {
    fStart.value = hhmm(ev.startMinute);
    fEnd.value = hhmm(endOf(ev) % DAY_MIN);
  }
  fRemind.value = ev.remindMinutes === null ? '' : String(ev.remindMinutes);
  if (fRemind.selectedIndex === -1) {
    const o = el('option', null, ev.remindMinutes + ' min before');
    o.value = String(ev.remindMinutes);
    fRemind.append(o);
    fRemind.value = o.value;
  }
  fNote.value = ev.note;
  fDone.setAttribute('aria-pressed', String(ev.done));
  fDone.textContent = ev.done ? 'Done' : 'Mark done';
  buildColors(ev.color);
}

function openEditor(id, { fresh = false } = {}) {
  const ev = state.event(id);
  if (!ev) return;
  if (ed.id && ed.id !== id) closeEditor();
  ed.id = id;
  ed.fresh = fresh;
  ed.touched = false;
  selectedId = id;
  fillEditor(ev);
  for (const n of stage.querySelectorAll('.selected')) n.classList.remove('selected');
  for (const n of stage.querySelectorAll('[data-id="' + CSS.escape(id) + '"]')) n.classList.add('selected');

  pop.hidden = false;
  pop.classList.remove('open');
  placeEditor();
  void pop.offsetWidth;                 // restart the entry transition
  pop.classList.add('open');
  fTitle.focus();
  if (!fresh) fTitle.select();
}

function placeEditor() {
  if (!ed.id || pop.hidden) return;
  const anchor = stage.querySelector('[data-id="' + CSS.escape(ed.id) + '"]');
  const r = anchor ? anchor.getBoundingClientRect() : stage.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  const sidebar = document.getElementById('sidebar');
  const limit = window.innerWidth - (sidebar ? sidebar.getBoundingClientRect().width : 0) - 12;
  let left = r.right + 10;
  let side = 'left';
  if (left + pw > limit) { left = r.left - pw - 10; side = 'right'; }
  left = clamp(left, 12, Math.max(12, limit - pw));
  const top = clamp(r.top, 12, Math.max(12, window.innerHeight - ph - 12));
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.transformOrigin = side + ' top';
}

function commitTitle() {
  clearTimeout(ed.titleTimer);
  const ev = state.event(ed.id);
  if (!ev) return;
  const title = fTitle.value.trim() || 'Untitled';
  if (title !== ev.title) patch({ title }, true);
}

function commitNote() {
  clearTimeout(ed.noteTimer);
  const ev = state.event(ed.id);
  if (ev && fNote.value !== ev.note) patch({ note: fNote.value }, true);
}

async function patch(p, quiet = false) {
  const id = ed.id;
  if (!id) return;
  if (!quiet) ed.touched = true;
  try {
    const ev = await state.updateEvent(id, p);
    // Refill the fields that the change can affect, but never the text the
    // user may be typing into.
    if (ed.id === id && ev) {
      const allDay = ev.startMinute === null;
      fAllDay.checked = allDay;
      fTimes.hidden = allDay;
      fRemind.disabled = allDay;
      if (!allDay) { fStart.value = hhmm(ev.startMinute); fEnd.value = hhmm(endOf(ev) % DAY_MIN); }
      fRemind.value = ev.remindMinutes === null ? '' : String(ev.remindMinutes);
      fDone.setAttribute('aria-pressed', String(ev.done));
      fDone.textContent = ev.done ? 'Done' : 'Mark done';
    }
  } catch (err) {
    notify.error('Could not save the event', err.message);
  }
}

function closeEditor() {
  if (!ed.id) return;
  const id = ed.id;
  const discard = ed.fresh && !ed.touched && !fTitle.value.trim();
  if (!discard) { commitTitle(); commitNote(); }
  clearTimeout(ed.titleTimer);
  clearTimeout(ed.noteTimer);
  ed.id = null;
  selectedId = null;
  pop.classList.remove('open');
  setTimeout(() => { if (!ed.id) pop.hidden = true; }, 160);
  if (discard) {
    state.removeEvent(id).catch(err => notify.error('Could not remove the event', err.message));
  } else {
    scheduleRender();
  }
}

async function deleteEvent(id) {
  const ev = state.event(id);
  if (!ev) return;
  if (ed.id === id) { ed.fresh = false; ed.id = null; selectedId = null; pop.classList.remove('open'); pop.hidden = true; }
  try {
    await state.removeEvent(id);
    // Deletion is the one destructive action here, so it can be taken back.
    const { title, date, startMinute, durationMinutes, note, color, remindMinutes } = ev;
    notify.show({
      title: 'Event deleted', message: title, type: 'info',
      action: { label: 'Undo', onClick: () => {
        state.createEvent({ title, date, startMinute, durationMinutes, note, color, remindMinutes })
          .catch(err => notify.error('Could not restore the event', err.message));
      } },
    });
  } catch (err) {
    notify.error('Could not delete the event', err.message);
  }
}

// ─── Keyboard ───

function onKey(e) {
  if (current() !== 'schedule-page') return;
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
  // A dialog in front (a day note, a confirm) owns the keyboard.
  if (document.querySelector('.dlg-scrim')) return;
  if (e.key === 'Escape' && ed.id) { closeEditor(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 't') goTo(new Date());
  else if (k === 'd') setMode('day');
  else if (k === 'w') setMode('week');
  else if (k === 'm') setMode('month');
  else if (e.key === 'ArrowLeft') navigate(-1);
  else if (e.key === 'ArrowRight') navigate(1);
  else if (k === 'n') quickAdd();
  else if (k === 'j') addDayNote(iso(cursor));
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) deleteEvent(selectedId);
  else return;
  e.preventDefault();
}

// A new hour-long event at the next whole hour on the day in view.
async function quickAdd() {
  const date = iso(cursor);
  const start = date === todayISO()
    ? Math.min((Math.floor(nowMinute() / 60) + 1) * 60, DAY_MIN - DEFAULT_MINUTES)
    : 9 * 60;
  try {
    const ev = await state.createEvent({ date, title: '', startMinute: start,
      durationMinutes: DEFAULT_MINUTES, remindMinutes: DEFAULT_REMIND });
    born = ev.id;
    if (mode === 'month') setMode('day');
    scheduleRender(() => openEditor(ev.id, { fresh: true }));
  } catch (err) {
    notify.error('Could not create the event', err.message);
  }
}

// ─── Init ───

export function initSchedule() {
  stage = document.getElementById('sc-stage');
  titleEl = document.getElementById('sc-title');
  segEl = document.getElementById('sc-seg');
  pillEl = document.getElementById('sc-seg-pill');
  miniEl = document.getElementById('sc-mini');
  agendaEl = document.getElementById('sc-agenda');
  mode = loadMode();

  document.getElementById('sc-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('sc-next').addEventListener('click', () => navigate(1));
  document.getElementById('sc-today').addEventListener('click', () => { goTo(new Date()); scheduleRender(scrollToNow); });
  document.getElementById('sc-add').addEventListener('click', quickAdd);
  document.getElementById('sc-note-add').addEventListener('click', () => addDayNote(iso(cursor)));
  initDayNotes();
  for (const b of segEl.querySelectorAll('button')) b.addEventListener('click', () => setMode(b.dataset.mode));

  initEditor();
  document.addEventListener('keydown', onKey);

  state.subscribe(() => scheduleRender());
  onEnter('schedule-page', () => scheduleRender(() => { if (!scrolledOnce) scrollToNow(); renderSeg(); }));
  onLeave('schedule-page', () => { closeEditor(); closeDayNote(); });
  window.addEventListener('resize', () => { if (current() === 'schedule-page') { renderSeg(); placeEditor(); } });

  // The now line moves and "Up next" empties as the day goes on.
  setInterval(() => { if (current() === 'schedule-page') scheduleRender(); }, 60000);

  if (window.ethos && typeof window.ethos.onEventReminder === 'function') {
    window.ethos.onEventReminder((ev) => {
      notify.show({
        title: ev.title,
        message: 'Starts at ' + clock(ev.startMinute),
        type: 'info',
        duration: 0,
        action: { label: 'Open', onClick: () => { goTo(fromISO(ev.date)); show('schedule-page'); } },
      });
    });
  }

  render();
}
