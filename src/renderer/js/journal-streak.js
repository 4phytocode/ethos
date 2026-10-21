// The journalling streak: a GitHub-style contribution grid over the last N
// weeks, standing in for the banner image the layout used to carry.
//
// This is derived state, computed from the notes already in the cache. Nothing
// about it is stored, so it cannot drift out of step with the journal itself
// and it needed no schema change.
//
// Styled after Kokonut UI's activity grid, but written in our own CSS: that
// library ships as remote React/Tailwind, and the page's CSP is
// `default-src 'none'` with no remote origins allowed.

import * as state from './state.js';
import { notify } from './notifications.js';

// Weeks shown in the strip. 20 keeps it compact enough to read as a header
// rather than a feature in its own right.
const WEEKS = 20;

// What counts as having journalled on a day: a note created that day whose
// content is not empty. Raising this to, say, 200 would make the goal "write
// something substantial" instead of "write anything".
const MIN_CHARS = 1;

const CELEBRATED_KEY = 'ethos.journalGoalCelebrated';

let els = null;
// Seeded on the first render so that opening the app on a day already
// journalled does not fire the toast; only crossing the line does.
let knownAchieved = null;

const pad = (n) => String(n).padStart(2, '0');

function isoOf(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function todayISO() { return isoOf(new Date()); }

function shiftDays(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

// ─── Derivation ───

// Map of 'YYYY-MM-DD' -> how many journals were written that day.
export function journalledDays(notes) {
  const counts = new Map();
  for (const n of notes) {
    if (!n.content || n.content.trim().length < MIN_CHARS) continue;
    const day = isoOf(new Date(n.createdAt));
    counts.set(day, (counts.get(day) || 0) + 1);
  }
  return counts;
}

// Consecutive days ending today, or ending yesterday if today is not done yet
// — so the streak does not read as broken simply because it is still morning.
function currentStreak(counts) {
  const today = new Date();
  let cursor = counts.has(isoOf(today)) ? today : shiftDays(today, -1);
  let streak = 0;
  while (counts.has(isoOf(cursor))) {
    streak += 1;
    cursor = shiftDays(cursor, -1);
  }
  return streak;
}

function level(count) {
  if (!count) return 0;
  return count === 1 ? 1 : 2;
}

// ─── Render ───

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

export function initStreak() {
  els = {
    root: document.getElementById('jr-streak'),
    grid: document.getElementById('jr-streak-grid'),
    months: document.getElementById('jr-streak-months'),
    stats: document.getElementById('jr-streak-stats'),
  };
  state.subscribe(renderStreak);
  renderStreak();
}

export function renderStreak() {
  if (!els) return;
  const counts = journalledDays(state.notes());

  // The grid runs in columns of weeks, each column Sunday..Saturday, ending
  // with the week containing today — the same shape as a contribution graph.
  const today = new Date();
  const endOfWeek = shiftDays(today, 6 - today.getDay());
  const start = shiftDays(endOfWeek, -(WEEKS * 7 - 1));

  els.grid.innerHTML = '';
  els.months.innerHTML = '';

  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w += 1) {
    const col = document.createElement('div');
    col.className = 'jr-col';

    const first = shiftDays(start, w * 7);
    // A month label sits above the first column that falls in a new month.
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
        // Days that have not happened yet are drawn flat, not as misses.
        cell.dataset.level = 'future';
        cell.setAttribute('title', '');
      } else {
        const iso = isoOf(day);
        const n = counts.get(iso) || 0;
        cell.dataset.level = String(level(n));
        cell.title = longDate.format(day) + ' — ' +
          (n === 0 ? 'nothing written' : n === 1 ? '1 journal' : n + ' journals');
      }
      col.appendChild(cell);
    }
    els.grid.appendChild(col);
  }

  const total = counts.size;
  const streak = currentStreak(counts);
  els.stats.textContent = total + (total === 1 ? ' day' : ' days') +
    (streak > 0 ? ' · ' + streak + ' in a row' : '');
  els.grid.setAttribute('aria-label',
    'Journalling activity: ' + total + ' days written, current streak ' + streak + ' days.');

  maybeCelebrate(counts);
}

// ─── The daily goal ───

function maybeCelebrate(counts) {
  const today = todayISO();
  const achieved = counts.has(today);

  // First render of the session only records where things stand.
  if (knownAchieved === null) { knownAchieved = achieved; return; }

  const crossed = achieved && !knownAchieved;
  knownAchieved = achieved;
  if (!crossed) return;

  // Once per calendar day, so deleting and rewriting a journal does not
  // re-congratulate the user.
  let last = null;
  try { last = localStorage.getItem(CELEBRATED_KEY); } catch { /* ignore */ }
  if (last === today) return;
  try { localStorage.setItem(CELEBRATED_KEY, today); } catch { /* ignore */ }

  const streak = currentStreak(counts);
  notify.success(
    "You've hit your daily journal goal!",
    streak > 1 ? streak + ' days in a row.' : 'First day of a new streak.'
  );
}
