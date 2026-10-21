// The to-do page, the card on the homepage, and the reminder toast.
//
// The finish times shown here are not worked out in the page. Main owns the
// plan (it has to, to deliver reminders with the window closed) and stamps each
// pending task with `dueAt`; this file only displays it. Dates are local
// 'YYYY-MM-DD' strings, never timestamps, so a task stays on the day the user
// put it on.

import * as state from './state.js';
import { show } from './views.js';
import { notify } from './notifications.js';

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

export function initTodo() {
  els = {
    date: document.getElementById('td-date'),
    prev: document.getElementById('td-prev'),
    next: document.getElementById('td-next'),
    today: document.getElementById('td-today'),
    heading: document.getElementById('td-heading'),
    form: document.getElementById('td-add'),
    title: document.getElementById('td-title'),
    minutes: document.getElementById('td-minutes'),
    summary: document.getElementById('td-summary'),
    list: document.getElementById('td-list'),
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
  els.cardOpen.addEventListener('click', () => show('todo-page'));

  // Blockers needs a browser extension, which does not exist yet. The button is
  // here so the feature has a place; it does nothing but say so.
  els.blockers.addEventListener('click', () => {
    notify.info('Blockers is coming', 'EthosBlock, a browser extension, will block the sites you choose during a work session.');
  });

  state.subscribe(render);
  // Overdue state and the "now" the plan is measured against drift with the
  // clock, so redraw once a minute even when nothing has changed.
  setInterval(render, 30000);
  render();
}

function goTo(iso) {
  shownDate = iso;
  els.date.value = iso;
  render();
}

async function add() {
  const title = els.title.value.trim();
  if (!title) { els.title.focus(); return; }
  const raw = els.minutes.value.trim();
  const minutes = raw === '' ? null : Number(raw);

  try {
    const todo = await state.createTodo({ title, date: shownDate, minutes });
    els.title.value = '';
    els.minutes.value = '';
    els.title.focus();
    // Say when the plan now ends: that is the whole point of the estimate.
    const planned = state.todo(todo.id);
    if (planned && planned.dueAt) {
      notify.success('Task added', 'At this pace, you will finish it by ' + clock(planned.dueAt) + '.');
    } else {
      notify.success('Task added', title);
    }
  } catch (err) {
    notify.error('Could not add that task', err.message);
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
    if (t) notify.info('Task deleted', t.title);
  } catch (err) {
    notify.error('Could not delete that task', err.message);
  }
}

// ─── Rendering ───

function render() {
  if (!els || !els.list) return;
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
  renderSummary(items, isToday);

  els.list.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'td-empty';
    empty.textContent = 'Nothing planned for this day. Add a task above.';
    els.list.appendChild(empty);
    return;
  }
  items.forEach((t, i) => els.list.appendChild(renderItem(t, i, items.length)));
}

function renderSummary(items, isToday) {
  const pending = items.filter(t => !t.done);
  els.summary.textContent = '';
  if (items.length === 0) return;
  if (pending.length === 0) { els.summary.textContent = 'All done for this day.'; return; }

  const timed = pending.filter(t => t.minutes !== null);
  const total = timed.reduce((n, t) => n + t.minutes, 0);
  const bold = (text) => { const s = document.createElement('strong'); s.textContent = text; return s; };

  els.summary.appendChild(bold(pending.length + (pending.length === 1 ? ' task' : ' tasks')));
  els.summary.appendChild(document.createTextNode(' left'));
  if (total > 0) {
    els.summary.appendChild(document.createTextNode(' · '));
    els.summary.appendChild(bold(formatMinutes(total)));
    els.summary.appendChild(document.createTextNode(' planned'));
  }
  const last = isToday
    ? timed.map(t => t.dueAt).filter(Boolean).sort((a, b) => b - a)[0]
    : null;
  if (last) {
    els.summary.appendChild(document.createTextNode(' · all done by '));
    els.summary.appendChild(bold(clock(last)));
  } else if (!isToday && total > 0) {
    els.summary.appendChild(document.createTextNode(' · finish times are worked out on the day'));
  }
  const unestimated = pending.length - timed.length;
  if (unestimated > 0) {
    els.summary.appendChild(document.createTextNode(
      ' · ' + unestimated + (unestimated === 1 ? ' has' : ' have') + ' no estimate'));
  }
}

function renderItem(t, index, count) {
  const row = document.createElement('li');
  const overdue = !t.done && t.dueAt !== null && t.dueAt < Date.now();
  row.className = 'td-item' + (t.done ? ' done' : '') + (overdue ? ' overdue' : '');
  row.dataset.todoId = t.id;

  row.appendChild(tickButton(t.done, (t.done ? 'Mark not done: ' : 'Mark done: ') + t.title,
    (done) => toggle(t.id, done)));

  const body = document.createElement('div');
  body.className = 'td-item-body';
  const title = document.createElement('div');
  title.className = 'td-item-title';
  title.textContent = t.title;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'td-item-meta';
  if (t.minutes !== null) meta.appendChild(document.createTextNode('~' + formatMinutes(t.minutes)));
  if (!t.done && t.dueAt !== null) {
    if (meta.childNodes.length) meta.appendChild(document.createTextNode(' · '));
    const finish = document.createElement('span');
    finish.className = 'td-finish';
    finish.textContent = (overdue ? 'was due ' : 'done by ') + clock(t.dueAt);
    meta.appendChild(finish);
  }
  if (meta.childNodes.length) body.appendChild(meta);
  row.appendChild(body);

  const tools = document.createElement('div');
  tools.className = 'td-item-tools';
  tools.appendChild(iconButton('Move up', 'M6 15l6-6 6 6', () => move(t.id, -1), index === 0));
  tools.appendChild(iconButton('Move down', 'M6 9l6 6 6-6', () => move(t.id, 1), index === count - 1));
  tools.appendChild(iconButton('Delete', 'M18 6L6 18M6 6l12 12', () => remove(t.id)));
  row.appendChild(tools);
  return row;
}

// The homepage card: today's tasks, and the all-clear when none are left.
function renderCard() {
  if (!els.cardList) return;
  const items = state.todosOn(todayISO());
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
