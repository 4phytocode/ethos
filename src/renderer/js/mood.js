// The daily check-in on the homepage ("How are you feeling?") and the Mood log
// page that lists one row per day.
//
// One mood per local day, stored in main (moods.json). Logging again the same
// day replaces it. A day with nothing logged is not stored at all: the log
// derives "Not logged" rows from the gaps, so there is nothing to backfill.

import * as state from './state.js';
import { todayISO } from './todo.js';
import { onEnter } from './views.js';
import { notify } from './notifications.js';

const PAGE_DAYS = 30;
const LABELS = { good: 'Good', bad: 'Bad', note: 'Wrote it down' };

const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

let els = null;
let picked = null;      // feeling chosen in the card but not yet saved
let editing = false;    // "Change" pressed on an already logged day
let shownDays = PAGE_DAYS;

export function initMood() {
  els = {
    ask: document.getElementById('mood-ask'),
    form: document.getElementById('mood-form'),
    text: document.getElementById('mood-text'),
    logged: document.getElementById('mood-logged'),
    line: document.getElementById('mood-logged-line'),
    change: document.getElementById('mood-change'),
    choices: [...document.querySelectorAll('.mood-choice')],
    list: document.getElementById('mood-list'),
    sub: document.getElementById('mood-page-sub'),
    more: document.getElementById('mood-more'),
  };
  if (!els.ask) return;

  for (const b of els.choices) b.addEventListener('click', () => pick(b.dataset.feeling));
  els.form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); }
  });
  els.change.addEventListener('click', () => {
    const m = state.moodOn(todayISO());
    editing = true;
    picked = m ? m.feeling : null;
    els.text.value = m ? m.text : '';
    renderCard();
  });
  els.more.addEventListener('click', () => { shownDays += PAGE_DAYS; renderLog(); });
  onEnter('mood-page', () => { shownDays = PAGE_DAYS; renderLog(); });

  state.subscribe(() => { renderCard(); renderLog(); });
  renderCard();
}

function pick(feeling) {
  picked = feeling;
  renderCard();
  els.text.placeholder = feeling === 'note' ? 'Write a sentence or two.' : 'A sentence or two, if you like.';
  els.text.focus();
}

async function save() {
  if (!picked) return;
  const text = els.text.value.trim();
  if (picked === 'note' && !text) { els.text.focus(); return; }
  try {
    await state.setMood({ date: todayISO(), feeling: picked, text });
    picked = null;
    editing = false;
    els.text.value = '';
    renderCard();
  } catch (err) {
    notify.error('Could not save how you feel', err.message);
  }
}

function renderCard() {
  if (!els || !els.ask) return;
  const m = state.moodOn(todayISO());
  const showLogged = !!m && !editing;
  els.ask.hidden = showLogged;
  els.logged.hidden = !showLogged;
  els.form.hidden = !picked;
  for (const b of els.choices) b.classList.toggle('on', b.dataset.feeling === picked);
  if (showLogged) {
    els.line.textContent = '';
    const b = document.createElement('b');
    b.textContent = LABELS[m.feeling];
    els.line.appendChild(b);
    if (m.text) els.line.appendChild(document.createTextNode(' — ' + m.text));
  }
}

// Newest first, today included, one row per day whether logged or not.
function renderLog() {
  if (!els || !els.list) return;
  const byDate = new Map(state.moods().map(m => [m.date, m]));
  const today = new Date();
  els.list.innerHTML = '';
  let logged = 0;
  for (let i = 0; i < shownDays; i += 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const m = byDate.get(isoOf(day));
    if (m) logged += 1;

    const li = document.createElement('li');
    li.className = 'mood-row' + (m ? '' : ' empty');
    const date = document.createElement('span');
    date.className = 'mood-row-date';
    date.textContent = i === 0 ? 'Today' : longDate.format(day);
    const feel = document.createElement('span');
    feel.className = 'mood-row-feel';
    if (m) { feel.dataset.feeling = m.feeling; feel.textContent = m.feeling === 'note' ? 'Note' : LABELS[m.feeling]; }
    const text = document.createElement('span');
    text.className = 'mood-row-text';
    text.textContent = m ? m.text : 'Not logged';
    li.append(date, feel, text);
    els.list.appendChild(li);
  }
  els.sub.textContent = logged + ' of the last ' + shownDays + ' days logged.';
}
