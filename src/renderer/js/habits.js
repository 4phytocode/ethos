// The habit tracker: a contribution grid over the last weeks, and today's
// habits as tick boxes.
//
// A day in the grid is dark when every habit that existed on that day was done.
// Partly done is a middle shade and nothing done is empty, which is the same
// three-level language the journal streak uses, drawn with the same CSS.
//
// The grid is derived from the habits already in the cache. Nothing about it is
// stored, so it cannot drift out of step with the ticks.

import * as state from './state.js';
import { tickButton, todayISO } from './todo.js';
import { notify } from './notifications.js';

const WEEKS = 20;
const CELEBRATED_KEY = 'ethos.habitGoalCelebrated';

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const shiftDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

let els = null;
// Seeded on first render so opening the app on a day already completed does not
// fire the toast. Only crossing the line does.
let knownAllDone = null;

export function initHabits() {
  els = {
    grid: document.getElementById('hb-grid'),
    months: document.getElementById('hb-months'),
    stats: document.getElementById('hb-stats'),
    list: document.getElementById('hb-list'),
    empty: document.getElementById('hb-empty'),
    addBtn: document.getElementById('hb-add-btn'),
    form: document.getElementById('hb-add'),
    name: document.getElementById('hb-name'),
    cancel: document.getElementById('hb-cancel'),
    home: document.getElementById('home-habits-list'),
    homeStat: document.getElementById('home-habits-stat'),
    homeAdd: document.getElementById('home-habits-add'),
    homeName: document.getElementById('home-habits-name'),
  };
  if (!els.list) return;

  els.addBtn.addEventListener('click', () => {
    els.form.hidden = !els.form.hidden;
    if (!els.form.hidden) els.name.focus();
  });
  els.cancel.addEventListener('click', closeForm);
  els.form.addEventListener('submit', (e) => { e.preventDefault(); add(); });
  els.name.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeForm(); });
  if (els.homeAdd) els.homeAdd.addEventListener('submit', (e) => { e.preventDefault(); addFromHome(); });

  state.subscribe(render);
  render();
}

function closeForm() {
  els.form.hidden = true;
  els.name.value = '';
}

async function add() {
  const name = els.name.value.trim();
  if (!name) { els.name.focus(); return; }
  try {
    await state.createHabit({ name });
    els.name.value = '';
    els.name.focus();
    notify.success('Habit added', name);
  } catch (err) {
    notify.error('Could not add that habit', err.message);
  }
}

// The quick-add field in the homepage habits segment.
async function addFromHome() {
  const name = els.homeName.value.trim();
  if (!name) return;
  try {
    await state.createHabit({ name });
    els.homeName.value = '';
  } catch (err) {
    notify.error('Could not add that habit', err.message);
  }
}

async function toggle(id, done) {
  try { await state.toggleHabit(id, todayISO(), done); }
  catch (err) { notify.error('Could not update that habit', err.message); }
}

async function remove(id) {
  const h = state.habit(id);
  try {
    await state.removeHabit(id);
    if (h) notify.info('Habit deleted', h.name);
  } catch (err) {
    notify.error('Could not delete that habit', err.message);
  }
}

// ─── Derivation ───

// The first day a habit counts toward the grid: when it was created, or the
// earliest day it was ticked if that is sooner (a day filled in after the fact).
function startOf(h) {
  const created = isoOf(new Date(h.createdAt));
  return h.doneDates.length && h.doneDates[0] < created ? h.doneDates[0] : created;
}

function dayTally(iso, habits) {
  const existing = habits.filter(h => iso >= startOf(h));
  const done = existing.filter(h => h.doneDates.includes(iso));
  return { existing: existing.length, done: done.length };
}

function levelOf({ existing, done }) {
  if (existing === 0 || done === 0) return 0;
  return done === existing ? 2 : 1;
}

// Consecutive days, ending today or yesterday, on which every habit was done.
// Ending yesterday keeps the run alive through a morning that is not finished.
function fullDayStreak(habits) {
  const today = new Date();
  const isFull = (d) => { const t = dayTally(isoOf(d), habits); return t.existing > 0 && t.done === t.existing; };
  let cursor = isFull(today) ? today : shiftDays(today, -1);
  let n = 0;
  while (isFull(cursor)) { n += 1; cursor = shiftDays(cursor, -1); }
  return n;
}

// Consecutive days, ending today or yesterday, that one habit was done.
function habitStreak(h) {
  const set = new Set(h.doneDates);
  const today = new Date();
  let cursor = set.has(isoOf(today)) ? today : shiftDays(today, -1);
  let n = 0;
  while (set.has(isoOf(cursor))) { n += 1; cursor = shiftDays(cursor, -1); }
  return n;
}

// ─── Rendering ───

function render() {
  if (!els || !els.list) return;
  const habits = state.habits();
  renderList(habits);
  renderGrid(habits);
  renderHome(habits);
  maybeCelebrate(habits);
}

function renderList(habits) {
  const today = todayISO();
  els.list.innerHTML = '';
  els.empty.hidden = habits.length > 0;

  for (const h of habits) {
    const done = h.doneDates.includes(today);
    const li = document.createElement('li');
    li.className = 'hb-item' + (done ? ' done' : '');
    li.dataset.habitId = h.id;

    li.appendChild(tickButton(done, (done ? 'Mark not done: ' : 'Mark done: ') + h.name,
      (next) => toggle(h.id, next)));

    const name = document.createElement('span');
    name.className = 'hb-item-name';
    name.textContent = h.name;
    li.appendChild(name);

    const streak = habitStreak(h);
    if (streak > 0) {
      const s = document.createElement('span');
      s.className = 'hb-streak';
      s.textContent = streak + (streak === 1 ? ' day' : ' days');
      li.appendChild(s);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hb-remove';
    del.title = 'Delete habit';
    del.setAttribute('aria-label', 'Delete habit: ' + h.name);
    del.textContent = '×';
    del.addEventListener('click', () => remove(h.id));
    li.appendChild(del);

    els.list.appendChild(li);
  }
}

function renderGrid(habits) {
  const today = new Date();
  // Columns are weeks, each Sunday to Saturday, ending with the week that
  // contains today: the shape of a contribution graph.
  const endOfWeek = shiftDays(today, 6 - today.getDay());
  const start = shiftDays(endOfWeek, -(WEEKS * 7 - 1));

  els.grid.innerHTML = '';
  els.months.innerHTML = '';

  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w += 1) {
    const col = document.createElement('div');
    col.className = 'jr-col';

    const first = shiftDays(start, w * 7);
    const label = document.createElement('span');
    label.className = 'jr-month';
    if (first.getMonth() !== lastMonth) {
      label.textContent = monthFormat.format(first);
      lastMonth = first.getMonth();
    }
    els.months.appendChild(label);

    for (let d = 0; d < 7; d += 1) {
      const day = shiftDays(start, w * 7 + d);
      const cell = document.createElement('i');
      cell.className = 'jr-cell';
      if (day > today) {
        cell.dataset.level = 'future';
      } else {
        const tally = dayTally(isoOf(day), habits);
        cell.dataset.level = String(levelOf(tally));
        cell.title = longDate.format(day) + ' — ' +
          (tally.existing === 0 ? 'no habits yet' : tally.done + ' of ' + tally.existing + ' done');
      }
      col.appendChild(cell);
    }
    els.grid.appendChild(col);
  }

  const todayTally = dayTally(todayISO(), habits);
  const streak = fullDayStreak(habits);
  els.stats.textContent = habits.length === 0
    ? 'No habits yet'
    : todayTally.done + ' of ' + todayTally.existing + ' done today' +
      (streak > 0 ? ' · ' + streak + ' in a row' : '');
  els.grid.setAttribute('aria-label', els.stats.textContent);
}

// The habits segment under the to-do card on the homepage: today's tick boxes.
function renderHome(habits) {
  if (!els.home) return;
  const today = todayISO();
  els.home.innerHTML = '';
  for (const h of habits) {
    const done = h.doneDates.includes(today);
    const li = document.createElement('li');
    li.className = 'home-habit' + (done ? ' done' : '');
    li.appendChild(tickButton(done, (done ? 'Mark not done: ' : 'Mark done: ') + h.name,
      (next) => toggle(h.id, next)));
    const name = document.createElement('span');
    name.className = 'home-habit-name';
    name.textContent = h.name;
    li.appendChild(name);
    const streak = habitStreak(h);
    if (streak > 0) {
      const s = document.createElement('span');
      s.className = 'home-habit-streak';
      s.textContent = streak + 'd';
      s.title = streak + (streak === 1 ? ' day' : ' days') + ' in a row';
      li.appendChild(s);
    }
    els.home.appendChild(li);
  }
  if (habits.length === 0) { els.homeStat.textContent = 'No habits yet. Add one below.'; return; }
  const t = dayTally(today, habits);
  els.homeStat.textContent = t.done === t.existing
    ? 'All ' + t.existing + ' done today'
    : t.done + ' of ' + t.existing + ' done today';
}

// ─── The daily goal ───

function maybeCelebrate(habits) {
  const t = dayTally(todayISO(), habits);
  const allDone = t.existing > 0 && t.done === t.existing;

  if (knownAllDone === null) { knownAllDone = allDone; return; }
  const crossed = allDone && !knownAllDone;
  knownAllDone = allDone;
  if (!crossed) return;

  // Once per calendar day, so un-ticking and re-ticking does not re-congratulate.
  const today = todayISO();
  let last = null;
  try { last = localStorage.getItem(CELEBRATED_KEY); } catch { /* ignore */ }
  if (last === today) return;
  try { localStorage.setItem(CELEBRATED_KEY, today); } catch { /* ignore */ }

  const streak = fullDayStreak(habits);
  notify.success('All habits done for today!',
    streak > 1 ? streak + ' days in a row.' : 'First day of a new run.');
}
