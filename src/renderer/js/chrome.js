// Window chrome for every view (PLAN-retro-demo.md, phase 5).
//
// Each view gets a title bar with its window name, a sidebar toggle, and, away
// from Home, a close box that goes Home. Each view also gets a status row at its
// foot, filled from the state cache: counts that the view already shows, never
// new data. Built here so the view markup does not change.

import * as state from './state.js';
import { show } from './views.js';
import { todayISO } from './journal-streak.js';
import { icon } from './icons.js';
import { timerSummary } from './timer.js';

// The window name in each title bar. The journal title is not shown here yet.
const TITLES = {
  'home': 'HOME',
  'schedule-page': 'SCHEDULE.EXE',
  'todo-page': 'TODO.EXE',
  'habit-page': 'HABITS.EXE',
  'journals': 'JOURNAL.EXE',
  'journal-page': 'JOURNAL.EXE',
  'mood-page': 'MOOD.EXE',
  'notes-page': 'NOTES.EXE',
  'graph-page': 'GRAPH.EXE',
  'timer-page': 'TIMER.EXE',
  'settings-page': 'SETTINGS.EXE',
};

// Views that show a status row, and what it says.
const STATUS = {
  'schedule-page': () => plural(state.eventsOn(todayISO()).length, 'event') + ' today',
  'todo-page': () => {
    const today = state.todosOn(todayISO());
    const open = today.filter(t => t.kind === 'task' && !t.done).length;
    const done = today.filter(t => t.done).length;
    return open + ' left · ' + done + ' done today';
  },
  'habit-page': () => {
    const day = todayISO();
    const habits = state.habits();
    const done = habits.filter(h => h.doneDates.includes(day)).length;
    return done + ' of ' + habits.length + ' done today';
  },
  'journals': () => plural(state.notes().length, 'journal'),
  'notes-page': () => plural(state.pages().length, 'note') + ' · ' + plural(state.folders().length, 'folder'),
  'graph-page': () => {
    const pages = state.pages();
    const links = pages.reduce((n, p) => n + p.links.length, 0);
    return plural(pages.length, 'page') + ' · ' + plural(links, 'link');
  },
  'mood-page': () => plural(state.moods().length, 'check-in'),
  'timer-page': () => timerSummary(),
  'settings-page': () => 'Settings are kept on this computer',
};

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(name, label, onClick) {
  const btn = el('button', 'win-btn');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(icon(name, 16));
  btn.addEventListener('click', onClick);
  return btn;
}

function titleBar(viewId, name) {
  const bar = el('header', 'win-title view-titlebar');
  bar.appendChild(icon('folder', 16));
  bar.appendChild(el('span', 'win-title-text', name));
  bar.appendChild(iconButton('chevron-right', 'Hide sidebar', () => document.getElementById('sb-hide').click()));
  if (viewId !== 'home') {
    bar.appendChild(iconButton('close', 'Go to Home', () => show('home')));
  }
  return bar;
}

function renderStatus() {
  for (const [viewId, text] of Object.entries(STATUS)) {
    const row = document.querySelector('#' + viewId + ' .view-status');
    if (row) row.textContent = text();
  }
}

export function initChrome() {
  document.querySelectorAll('.view').forEach((view) => {
    const name = TITLES[view.id];
    if (!name) return;
    view.prepend(titleBar(view.id, name));
    if (STATUS[view.id]) {
      const row = el('footer', 'win-status view-status');
      view.appendChild(row);
    }
  });
  state.subscribe(renderStatus);
  // Timers are not in the vault, so their page says when they change.
  document.addEventListener('ethos:timers', renderStatus);
  renderStatus();
}
