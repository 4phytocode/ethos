// The to-do page (the day plan), the card on the homepage, and the reminder toast.
//
// The page follows a daily-list habit: each task is written as one specific
// action with its time typed in ("Draft essay intro 45m at 2pm", read by
// todo-parse.js), and the plan says when the day's work will be finished.
// Two lists: "To do" (planned, timed) and "To remember" (kept in mind, never
// timed). Items drag within and between them.
//
// The finish times shown here are not worked out in the page. Main owns the
// plan (it has to, to deliver reminders with the window closed) and stamps each
// pending task with `dueAt`; this file only displays it. Dates are local
// 'YYYY-MM-DD' strings, never timestamps, so a task stays on the day the user
// put it on.

import * as state from './state.js';
import { show } from './views.js';
import { notify } from './notifications.js';
import { parseEntry, formatEntry } from './todo-parse.js';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const headingFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const todayISO = () => isoOf(new Date());

function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(new Date(y, m - 1, d + days));
}
function localDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatMinutes(n) {
  if (n < 60) return n + ' min';
  const h = Math.floor(n / 60), m = n % 60;
  return m === 0 ? h + ' h' : h + ' h ' + m + ' min';
}

const clock = (ms) => timeFormat.format(new Date(ms));

// ─── Tick box ───
// Built from elements, not markup, so nothing a user typed is ever parsed.
export function tickButton(pressed, label, onToggle) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tick';
  b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  b.setAttribute('aria-label', label);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  svg.appendChild(path);
  b.appendChild(svg);
  b.addEventListener('click', (e) => { e.stopPropagation(); onToggle(pressed ? false : true); });
  return b;
}

function iconButton(label, pathD, onClick, disabled) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'td-tool';
  b.title = label;
  b.setAttribute('aria-label', label);
  if (disabled) b.disabled = true;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  b.appendChild(svg);
  b.addEventListener('click', onClick);
  return b;
}

// ─── Page ───

let els = null;
let shownDate = null;
let dragId = null;

const minuteLabel = (m) => timeFormat.format(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));
const minuteOfDay = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

// Where a to-do sits on the day, in minutes from midnight, for the schedule.
// Today's planned tasks use the plan's finish time; a task pinned to a time
// uses that on any day. Returns null for anything with no place on the clock.
export function plannedSpan(t) {
  if (t.kind !== 'task') return null;
  if (t.dueAt !== null && t.minutes !== null && t.date === isoOf(new Date(t.dueAt))) {
    const e = minuteOfDay(t.dueAt);
    return { s: Math.max(0, e - t.minutes), e: Math.max(e, 1) };
  }
  if (t.startMinute !== null) {
    return { s: t.startMinute, e: Math.min(24 * 60, t.startMinute + (t.minutes || 30)) };
  }
  return null;
}

// Opens the page on a given day (the schedule's to-do blocks use this).
export function openTodoDay(iso) {
  show('todo-page');
  if (els) goTo(iso);
}

export function initTodo() {
  els = {
    date: document.getElementById('td-date'),
    prev: document.getElementById('td-prev'),
    next: document.getElementById('td-next'),
    today: document.getElementById('td-today'),
    heading: document.getElementById('td-heading'),
    form: document.getElementById('td-add'),
    title: document.getElementById('td-title'),
    preview: document.getElementById('td-preview'),
    summary: document.getElementById('td-summary'),
    list: document.getElementById('td-list'),
    remForm: document.getElementById('td-rem-add'),
    remTitle: document.getElementById('td-rem-title'),
    remList: document.getElementById('td-rem-list'),
    blockers: document.getElementById('td-blockers'),
    cardList: document.getElementById('todo-card-list'),
    cardEmpty: document.getElementById('todo-card-empty'),
    cardOpen: document.getElementById('todo-card-open'),
  };
  if (!els.list) return;

  shownDate = todayISO();
  els.date.value = shownDate;

  els.prev.addEventListener('click', () => goTo(shiftISO(shownDate, -1)));
  els.next.addEventListener('click', () => goTo(shiftISO(shownDate, 1)));
  els.today.addEventListener('click', () => goTo(todayISO()));
  els.date.addEventListener('change', () => {
    // An empty or half-typed date must not blank the page.
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(els.date.value)) goTo(els.date.value);
    else els.date.value = shownDate;
  });

  els.form.addEventListener('submit', (e) => { e.preventDefault(); add(); });
  els.title.addEventListener('input', renderPreview);
  els.remForm.addEventListener('submit', (e) => { e.preventDefault(); addRemember(); });
  els.cardOpen.addEventListener('click', () => show('todo-page'));
  for (const list of [els.list, els.remList]) wireDrop(list);

  // Blockers needs a browser extension, which does not exist yet. The button is
  // here so the feature has a place; it does nothing but say so.
  els.blockers.addEventListener('click', () => {
    notify.info('Blockers is coming', 'EthosBlock, a browser extension, will block the sites you choose during a work session.');
  });

  state.subscribe(render);
  // Overdue state and the "now" the plan is measured against drift with the
  // clock, so redraw every half minute even when nothing has changed.
  setInterval(render, 30000);
  render();
}

function goTo(iso) {
  shownDate = iso;
  els.date.value = iso;
  render();
}

// When the plan currently ends today: the latest finish among pending tasks.
function planEnd() {
  const ends = state.todosOn(todayISO())
    .filter(t => t.kind === 'task' && !t.done && t.dueAt !== null).map(t => t.dueAt);
  return Math.max(Date.now(), ...ends);
}

// Live reading of what has been typed: how long, when, and when it would end.
// The real plan is worked out in main; this is the same rule, approximated
// (it does not step around pinned tasks), and marked "about".
function renderPreview() {
  const { title, minutes, startMinute } = parseEntry(els.title.value);
  const p = els.preview;
  p.textContent = '';
  if (!els.title.value.trim()) return;
  const bit = (label, value) => {
    const s = document.createElement('span');
    s.className = 'td-preview-bit';
    const b = document.createElement('b');
    b.textContent = value;
    s.append(label, b);
    p.appendChild(s);
  };
  if (!title) { p.append('Add what you will do, as well as the time.'); return; }
  if (minutes !== null) bit('Takes ', formatMinutes(minutes));
  if (startMinute !== null) bit('Starts ', minuteLabel(startMinute));
  const isToday = shownDate === todayISO();
  if (minutes !== null && startMinute !== null) bit('Done ', minuteLabel(Math.min(startMinute + minutes, 1439)));
  else if (minutes !== null && isToday) bit('Done about ', clock(planEnd() + minutes * 60000));
  if (minutes === null) {
    const hint = document.createElement('span');
    hint.className = 'td-preview-hint';
    hint.textContent = 'Tip: add a time like 30m or 1h, and at 3pm to pin it.';
    p.appendChild(hint);
  }
}

async function add() {
  const { title, minutes, startMinute } = parseEntry(els.title.value);
  if (!title) { els.title.focus(); return; }
  try {
    const todo = await state.createTodo({ title, date: shownDate, minutes, startMinute, kind: 'task' });
    els.title.value = '';
    renderPreview();
    els.title.focus();
    const planned = state.todo(todo.id);
    const span = planned && plannedSpan(planned);
    const where = span ? ' On your schedule ' + minuteLabel(span.s) + '–' + minuteLabel(span.e) + '.' : '';
    notify.show({
      title: 'Added to ' + (shownDate === todayISO() ? "today's plan" : 'that day'),
      message: (planned && planned.dueAt ? 'You should finish it by ' + clock(planned.dueAt) + '.' : title) + where,
      type: 'success',
      action: span ? { label: 'Show schedule', onClick: () => show('schedule-page') } : undefined,
    });
  } catch (err) {
    notify.error('Could not add that task', err.message);
  }
}

async function addRemember() {
  const title = els.remTitle.value.trim();
  if (!title) return;
  try {
    await state.createTodo({ title, date: shownDate, kind: 'remember' });
    els.remTitle.value = '';
  } catch (err) {
    notify.error('Could not add that', err.message);
  }
}

async function toggle(id, done) {
  try { await state.updateTodo(id, { done }); }
  catch (err) { notify.error('Could not update that task', err.message); }
}

async function move(id, delta) {
  try { await state.moveTodo(id, delta); }
  catch (err) { notify.error('Could not move that task', err.message); }
}

async function remove(id) {
  const t = state.todo(id);
  try {
    await state.removeTodo(id);
    if (t) notify.info('Deleted', t.title);
  } catch (err) {
    notify.error('Could not delete that', err.message);
  }
}

// ─── Drag and drop ───
// Rows drag within a list to reorder and across to the other list. While
// dragging, a line shows where the row will land. Keyboard: Alt+Up/Down.

function dropIndex(list, y) {
  const rows = [...list.querySelectorAll('.td-item')].filter(r => r.dataset.todoId !== dragId);
  const i = rows.findIndex(r => { const b = r.getBoundingClientRect(); return y < b.top + b.height / 2; });
  return { rows, index: i === -1 ? rows.length : i };
}

function clearMarks() {
  document.querySelectorAll('.td-drop-line').forEach(n => n.remove());
  document.querySelectorAll('.td-list.drop-target').forEach(n => n.classList.remove('drop-target'));
}

function wireDrop(list) {
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearMarks();
    list.classList.add('drop-target');
    const { rows, index } = dropIndex(list, e.clientY);
    const line = document.createElement('li');
    line.className = 'td-drop-line';
    line.setAttribute('aria-hidden', 'true');
    if (rows[index]) list.insertBefore(line, rows[index]);
    else list.appendChild(line);
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clearMarks(); });
  list.addEventListener('drop', async (e) => {
    if (!dragId) return;
    e.preventDefault();
    const { index } = dropIndex(list, e.clientY);
    const id = dragId;
    dragId = null;
    clearMarks();
    try { await state.placeTodo(id, { kind: list.dataset.kind, index }); }
    catch (err) { notify.error('Could not move that', err.message); }
  });
}

function makeDraggable(row, t) {
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    dragId = t.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', t.title);
    requestAnimationFrame(() => row.classList.add('dragging'));
  });
  row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); clearMarks(); });
  row.addEventListener('keydown', (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    move(t.id, e.key === 'ArrowUp' ? -1 : 1);
  });
}

// ─── Rendering ───

function render() {
  if (!els || !els.list) return;
  // A redraw mid-edit would throw the typed text away.
  if (document.activeElement && document.activeElement.classList.contains('td-inline')) return;
  renderPage();
  renderCard();
}

function renderPage() {
  const isToday = shownDate === todayISO();
  els.heading.textContent = '';
  const label = document.createElement('span');
  label.textContent = headingFormat.format(localDate(shownDate));
  if (isToday) label.className = 'is-today';
  els.heading.appendChild(label);
  if (isToday) els.heading.appendChild(document.createTextNode(' · today'));

  const items = state.todosOn(shownDate);
  const tasks = items.filter(t => t.kind === 'task');
  const rems = items.filter(t => t.kind === 'remember');
  renderSummary(tasks, isToday);

  fill(els.list, tasks, 'Nothing planned yet. Write your first task above.');
  fill(els.remList, rems, 'Nothing to remember yet.');
}

function fill(list, items, emptyText) {
  list.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'td-empty';
    empty.textContent = emptyText;
    list.appendChild(empty);
    return;
  }
  for (const t of items) list.appendChild(renderItem(t));
}

function renderSummary(items, isToday) {
  const pending = items.filter(t => !t.done);
  els.summary.textContent = '';
  if (items.length === 0) return;
  if (pending.length === 0) { els.summary.textContent = 'Every task is done for this day.'; return; }

  const timed = pending.filter(t => t.minutes !== null);
  const total = timed.reduce((n, t) => n + t.minutes, 0);
  const bold = (text) => { const s = document.createElement('strong'); s.textContent = text; return s; };

  els.summary.appendChild(bold(pending.length + (pending.length === 1 ? ' task' : ' tasks')));
  els.summary.appendChild(document.createTextNode(' left'));
  if (total > 0) {
    els.summary.appendChild(document.createTextNode(' · '));
    els.summary.appendChild(bold(formatMinutes(total)));
    els.summary.appendChild(document.createTextNode(' of work'));
  }
  const last = isToday ? timed.map(t => t.dueAt).filter(Boolean).sort((a, b) => b - a)[0] : null;
  if (last) {
    els.summary.appendChild(document.createTextNode(' · you should be finished by '));
    els.summary.appendChild(bold(clock(last)));
  } else if (!isToday && total > 0) {
    els.summary.appendChild(document.createTextNode(' · finish times are worked out on the day'));
  }
  const unestimated = pending.length - timed.length;
  if (unestimated > 0) {
    els.summary.appendChild(document.createTextNode(
      ' · ' + unestimated + (unestimated === 1 ? ' has' : ' have') + ' no time yet'));
  }
}

// The line under a task's title: "45 min · 2:00 PM – 2:45 PM", clickable to edit.
function timeText(t) {
  const parts = [];
  if (t.minutes !== null) parts.push(formatMinutes(t.minutes));
  const span = plannedSpan(t);
  if (span && !t.done) {
    const overdue = t.dueAt !== null && t.dueAt < Date.now();
    parts.push((t.startMinute !== null ? '' : (overdue ? 'was due ' : '')) +
      minuteLabel(span.s) + ' – ' + minuteLabel(span.e));
  }
  return parts.length ? parts.join(' · ') : '+ add a time';
}

function inlineEdit(host, value, placeholder, onCommit) {
  const input = document.createElement('input');
  input.className = 'td-inline';
  input.value = value;
  input.placeholder = placeholder;
  input.maxLength = 200;
  host.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    input.blur();
    if (commit) await onCommit(input.value);
    render();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function saveTime(t, text) {
  const { minutes, startMinute } = parseEntry(text);
  if (text.trim() && minutes === null && startMinute === null) {
    notify.info("Couldn't read that time", 'Try 30m, 1h 15m, at 3pm, or 2-3pm.');
    return;
  }
  try { await state.updateTodo(t.id, { minutes, startMinute }); }
  catch (err) { notify.error('Could not change the time', err.message); }
}

async function saveTitle(t, text) {
  const title = text.trim();
  if (!title || title === t.title) return;
  try { await state.updateTodo(t.id, { title }); }
  catch (err) { notify.error('Could not rename that', err.message); }
}

function renderItem(t) {
  const row = document.createElement('li');
  const overdue = !t.done && t.dueAt !== null && t.dueAt < Date.now();
  row.className = 'td-item' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '') +
    (t.kind === 'remember' ? ' remember' : '');
  row.dataset.todoId = t.id;
  row.tabIndex = 0;
  makeDraggable(row, t);

  const grip = document.createElement('span');
  grip.className = 'td-grip';
  grip.setAttribute('aria-hidden', 'true');
  row.appendChild(grip);

  row.appendChild(tickButton(t.done, (t.done ? 'Mark not done: ' : 'Mark done: ') + t.title,
    (done) => toggle(t.id, done)));

  const body = document.createElement('div');
  body.className = 'td-item-body';
  const title = document.createElement('div');
  title.className = 'td-item-title';
  title.textContent = t.title;
  title.title = 'Double-click to rename';
  title.addEventListener('dblclick', () => inlineEdit(title, t.title, 'Task', (v) => saveTitle(t, v)));
  body.appendChild(title);

  if (t.kind === 'task') {
    const meta = document.createElement('button');
    meta.type = 'button';
    meta.className = 'td-item-meta' + (t.minutes === null && t.startMinute === null ? ' empty' : '');
    meta.textContent = timeText(t);
    meta.title = 'Change the time';
    meta.addEventListener('click', () =>
      inlineEdit(meta, formatEntry(t.minutes, t.startMinute), 'e.g. 45m at 2pm', (v) => saveTime(t, v)));
    body.appendChild(meta);
  }
  row.appendChild(body);

  const tools = document.createElement('div');
  tools.className = 'td-item-tools';
  tools.appendChild(iconButton('Delete', 'M18 6L6 18M6 6l12 12', () => remove(t.id)));
  row.appendChild(tools);
  return row;
}

// The homepage card: today's tasks, and the all-clear when none are left.
function renderCard() {
  if (!els.cardList) return;
  const all = state.todosOn(todayISO());
  const items = all.filter(t => t.kind === 'task');
  const rems = all.filter(t => t.kind === 'remember' && !t.done);
  els.cardList.innerHTML = '';

  for (const t of items) {
    const li = document.createElement('li');
    li.className = 'todo-card-item' + (t.done ? ' done' : '');
    li.appendChild(tickButton(t.done, (t.done ? 'Mark not done: ' : 'Mark done: ') + t.title,
      (done) => toggle(t.id, done)));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t.title;
    li.appendChild(name);
    if (!t.done && t.dueAt !== null) {
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = 'by ' + clock(t.dueAt);
      li.appendChild(when);
    } else if (!t.done && t.minutes !== null) {
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = formatMinutes(t.minutes);
      li.appendChild(when);
    }
    els.cardList.appendChild(li);
  }

  if (rems.length) {
    const li = document.createElement('li');
    li.className = 'todo-card-remember';
    li.textContent = 'Remember: ' + rems.map(t => t.title).join(' · ');
    els.cardList.appendChild(li);
  }
  els.cardEmpty.hidden = items.some(t => !t.done);
}

// ─── Reminders ───

// Main decides when a task's time is up. The toast here is the product's own
// voice and always shows; main adds a system notification on top only when
// this window is not in front.
export function initReminders() {
  if (!window.ethos || typeof window.ethos.onReminder !== 'function') return;
  window.ethos.onReminder((todo) => {
    notify.show({
      title: "Time's up",
      message: todo.title,
      type: 'warn',
      duration: 0,
      action: { label: 'Mark done', onClick: () => toggle(todo.id, true) },
    });
  });
}
