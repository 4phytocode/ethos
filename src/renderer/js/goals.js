// Homepage goals: one for this week, one for this month, one for this year.
// Any of them may be empty. They are kept in view so the day's work can be
// held up against them.
//
// The model holds the text and a done flag (goals:set). How much of the period
// is left is worked out here from the calendar and never stored.

import * as state from './state.js';
import { notify } from './notifications.js';
import { tickButton } from './todo.js';

const HORIZONS = [
  { id: 'week', label: 'This week', empty: 'Set a goal for this week' },
  { id: 'month', label: 'This month', empty: 'Set a goal for this month' },
  { id: 'year', label: 'This year', empty: 'Set a goal for this year' },
];
const DAY_MS = 86400000;

let list, stat;
let editing = null;           // the horizon whose text is being edited

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// The period a horizon covers today, as local midnights [start, end).
// Weeks start on Monday, like the schedule.
function period(horizon, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (horizon === 'week') {
    const start = new Date(y, m, d - ((now.getDay() + 6) % 7));
    return [start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)];
  }
  if (horizon === 'month') return [new Date(y, m, 1), new Date(y, m + 1, 1)];
  return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
}

// "3 days left", counting today. Days are counted on calendar dates, so DST
// cannot make one 23 hours long.
function daysLeft(horizon) {
  const now = new Date();
  const [, end] = period(horizon, now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((end - today) / DAY_MS);
}

function elapsed(horizon) {
  const now = new Date();
  const [start, end] = period(horizon, now);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

async function save(horizon, patch) {
  try { await state.setGoal({ horizon, ...patch }); } catch (err) {
    notify.error('Could not save the goal', err.message);
  }
}

function startEdit(horizon) {
  editing = horizon;
  render();
}

function row(h) {
  const goal = state.goal(h.id);
  const li = el('li', 'goal' + (goal ? '' : ' empty') + (goal && goal.done ? ' done' : ''));
  li.dataset.horizon = h.id;

  const head = el('div', 'goal-head');
  const left = daysLeft(h.id);
  head.append(el('span', 'goal-label', h.label),
    el('span', 'goal-left', left === 1 ? 'last day' : left + ' days left'));
  li.append(head);

  const body = el('div', 'goal-body');
  if (editing === h.id) {
    const input = el('input', 'goal-input');
    input.type = 'text';
    input.maxLength = 200;
    input.value = goal ? goal.text : '';
    input.placeholder = h.empty;
    input.setAttribute('aria-label', h.label + ' goal');
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      editing = null;
      const text = input.value.trim();
      if (keep && text !== (goal ? goal.text : '')) save(h.id, { text });
      else render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    body.append(input);
    requestAnimationFrame(() => { input.focus(); input.select(); });
  } else if (goal) {
    body.append(tickButton(goal.done, (goal.done ? 'Mark not reached: ' : 'Mark reached: ') + goal.text,
      (d) => {
        save(h.id, { done: d });
        if (d) notify.success('Goal reached', h.label + ': ' + goal.text);
      }));
    const text = el('button', 'goal-text', goal.text);
    text.type = 'button';
    text.title = 'Click to change';
    text.addEventListener('click', () => startEdit(h.id));
    const clear = el('button', 'goal-clear', '×');
    clear.type = 'button';
    clear.title = 'Clear this goal';
    clear.setAttribute('aria-label', 'Clear the goal for ' + h.label.toLowerCase());
    clear.addEventListener('click', () => save(h.id, { text: '' }));
    body.append(text, clear);
  } else {
    const add = el('button', 'goal-add', '+ ' + h.empty);
    add.type = 'button';
    add.addEventListener('click', () => startEdit(h.id));
    body.append(add);
  }
  li.append(body);

  // How far through the period we are: a quiet reminder that time is moving.
  const bar = el('div', 'progress goal-bar');
  bar.title = Math.round(elapsed(h.id) * 100) + '% of the ' + h.id + ' gone';
  const fill = el('i');
  fill.style.setProperty('--p', (elapsed(h.id) * 100).toFixed(1) + '%');
  bar.append(fill);
  li.append(bar);
  return li;
}

function render() {
  if (!list) return;
  list.replaceChildren(...HORIZONS.map(row));
  const set = state.goals().length;
  const reached = state.goals().filter(g => g.done).length;
  stat.textContent = set ? reached + ' of ' + set + ' reached' : 'No goals set';
}

export function initGoals() {
  list = document.getElementById('goals-list');
  stat = document.getElementById('goals-stat');
  state.subscribe(() => { if (editing === null) render(); });
  render();
}
