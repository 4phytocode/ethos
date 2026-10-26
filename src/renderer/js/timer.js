// The Timer page: countdowns, each with its own alarm and Windows banner.
//
// The list is per-machine, like Settings, so it lives in localStorage (every
// read and write in try/catch). The moment a timer runs out belongs to the main
// process (src/main/timers.js): the page arms a timer with the time it ends and
// is told when it rings, so a timer still goes off while the window is hidden.
// The page only draws the countdown.
//
// A timer is idle, running (endsAt), paused (left, in ms) or done.

import { show, onEnter, current } from './views.js';
import { notify } from './notifications.js';
import { startAlarm, stopAlarm } from './sound.js';
import { icon } from './icons.js';

const KEY = 'ethos.timers';
const MAX_TIMERS = 50;
const MAX_LABEL = 40;
const MAX_SECS = 99 * 3600 + 59 * 60 + 59;
const TICK_MS = 250;
const ID = /^[a-z0-9]{1,32}$/;
const STATUSES = ['idle', 'running', 'paused', 'done'];

let timers = [];
let editing = null;          // id of the timer in the form, or null for a new one
const ringing = new Set();   // ids whose alarm is sounding
const toasts = new Map();    // id -> the "Time's up" toast
let ticker = null;
let els = null;

// ─── Storage ───

function clean(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, label, ms, alarm, notify: banner, status, endsAt, left } = raw;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof label !== 'string' || label.length > MAX_LABEL) return null;
  if (!Number.isInteger(ms) || ms < 1000 || ms > MAX_SECS * 1000) return null;
  if (typeof alarm !== 'boolean' || typeof banner !== 'boolean') return null;
  if (!STATUSES.includes(status)) return null;
  const t = { id, label, ms, alarm, notify: banner, status };
  if (status === 'running') {
    if (!Number.isFinite(endsAt)) return null;
    t.endsAt = endsAt;
  }
  if (status === 'paused') {
    if (!Number.isFinite(left) || left < 0 || left > ms) return null;
    t.left = left;
  }
  return t;
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || !Array.isArray(raw.timers)) return [];
    const seen = new Set();
    return raw.timers.map(clean).filter(t => t && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_TIMERS);
  } catch {
    return [];
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, timers })); } catch { /* not fatal */ }
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function find(id) { return timers.find(t => t.id === id) || null; }

// ─── Time ───

function remaining(t, now = Date.now()) {
  if (t.status === 'running') return Math.max(0, t.endsAt - now);
  if (t.status === 'paused') return t.left;
  if (t.status === 'done') return 0;
  return t.ms;
}

// Whole seconds, rounded up, so a fresh timer shows its full length and the
// last second reads 00:01 rather than 00:00. Timers of an hour or more show
// hours, so a timer's readout never changes width as it runs.
function clock(ms, total) {
  const secs = Math.ceil(ms / 1000);
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
  const mmss = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return total >= 3600000 ? h + ':' + mmss : mmss;
}

function lengthText(ms) {
  const secs = Math.round(ms / 1000);
  const h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60, s = secs % 60;
  const parts = [];
  if (h) parts.push(h + ' h');
  if (m) parts.push(m + ' min');
  if (s) parts.push(s + ' s');
  return parts.join(' ');
}

const STATE_TEXT = { idle: 'Ready', running: 'Running', paused: 'Paused', done: "Time's up" };

// The status row and the sidebar badge both read this.
export function timerSummary() {
  const running = timers.filter(t => t.status === 'running').length;
  const done = timers.filter(t => t.status === 'done').length;
  const parts = [];
  if (running) parts.push(running + ' running');
  if (done) parts.push(done + ' finished');
  if (!parts.length) return timers.length + ' timer' + (timers.length === 1 ? '' : 's');
  return parts.join(' · ');
}

// ─── Main process ───

function arm(t) {
  return window.ethos.timers.arm(t.id, { endsAt: t.endsAt, label: t.label, notify: t.notify });
}

function disarm(t) {
  window.ethos.timers.disarm(t.id).catch(err => console.error('timer disarm failed:', err.message));
}

// ─── Actions ───

function changed() {
  save();
  render();
  document.dispatchEvent(new Event('ethos:timers'));
}

async function start(t) {
  const wasPaused = t.status === 'paused';
  t.endsAt = Date.now() + (wasPaused ? t.left : t.ms);
  t.status = 'running';
  delete t.left;
  changed();
  try {
    await arm(t);
  } catch (err) {
    // Not armed means it would never ring, so it does not run either.
    t.status = wasPaused ? 'paused' : 'idle';
    if (wasPaused) t.left = Math.max(0, t.endsAt - Date.now());
    delete t.endsAt;
    changed();
    notify.error('Could not start the timer', err.message);
  }
}

function pause(t) {
  t.left = Math.max(0, t.endsAt - Date.now());
  delete t.endsAt;
  t.status = 'paused';
  disarm(t);
  changed();
}

// Back to its full length. Stops its alarm and clears its toast.
function reset(t) {
  if (t.status === 'running') disarm(t);
  t.status = 'idle';
  delete t.endsAt;
  delete t.left;
  silence(t.id);
  changed();
}

function remove(t) {
  if (t.status === 'running') disarm(t);
  silence(t.id);
  timers = timers.filter(x => x !== t);
  if (editing === t.id) closeForm();
  changed();
}

function silence(id) {
  ringing.delete(id);
  if (!ringing.size) stopAlarm();
  const toast = toasts.get(id);
  if (toast) { notify.dismiss(toast); toasts.delete(id); }
}

async function setNotify(t, on) {
  t.notify = on;
  changed();
  // The banner is raised by main, so a running timer is armed again with it.
  if (t.status === 'running') {
    try { await arm(t); } catch (err) { notify.error('Could not change the timer', err.message); }
  }
}

function setAlarm(t, on) {
  t.alarm = on;
  if (!on) {
    ringing.delete(t.id);
    if (!ringing.size) stopAlarm();
  }
  changed();
}

// Main says a timer ran out.
function ring(id) {
  const t = find(id);
  // Paused or reset just before the message arrived: it no longer runs.
  if (!t || t.status !== 'running') return;
  t.status = 'done';
  delete t.endsAt;
  // Marked as ringing before the redraw, so the card offers Stop, not Dismiss.
  if (t.alarm) ringing.add(id);
  changed();
  if (t.alarm) startAlarm(() => { ringing.clear(); render(); });
  const name = t.label || lengthText(t.ms) + ' timer';
  toasts.set(id, notify.show({
    title: "Time's up",
    message: name,
    type: 'success',
    duration: t.alarm ? 0 : 8000,
    action: { label: t.alarm ? 'Stop alarm' : 'Open timers', onClick: () => {
      toasts.delete(id);
      if (t.alarm) reset(t); else show('timer-page');
    } },
  }));
}

// ─── Ticking ───
// Runs only while a timer is running. Each tick rewrites the running timers'
// readouts and the sidebar badge, nothing else; the cards are built once per
// change.

function tick() {
  const now = Date.now();
  const running = timers.filter(t => t.status === 'running');
  if (current() === 'timer-page') {
    for (const t of running) {
      const card = els.list.querySelector('[data-id="' + t.id + '"]');
      if (card) paintTime(card, t, now);
    }
  }
  if (running.length) {
    const next = running.reduce((a, b) => (a.endsAt <= b.endsAt ? a : b));
    els.badge.textContent = clock(remaining(next, now), next.ms);
    els.badge.hidden = false;
  } else {
    els.badge.hidden = true;
  }
}

function syncTicker() {
  const any = timers.some(t => t.status === 'running');
  if (any && !ticker) ticker = setInterval(tick, TICK_MS);
  if (!any && ticker) { clearInterval(ticker); ticker = null; }
  tick();
}

// ─── Drawing ───

function paintTime(card, t, now = Date.now()) {
  const left = remaining(t, now);
  card.querySelector('.tm-time').textContent = clock(left, t.ms);
  const done = t.ms ? 100 - (left / t.ms) * 100 : 0;
  card.querySelector('.tm-progress').style.setProperty('--p', done.toFixed(2) + '%');
}

function button(className, iconName, text, onClick, label) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  if (iconName) btn.appendChild(icon(iconName, 16));
  if (text) {
    const span = document.createElement('span');
    span.textContent = text;
    btn.appendChild(span);
  }
  if (label) { btn.setAttribute('aria-label', label); btn.title = label; }
  btn.addEventListener('click', onClick);
  return btn;
}

function toggle(iconName, label, on, onChange) {
  const btn = button('tm-toggle tm-toggle-icon', iconName, '', () => onChange(!on), label);
  btn.setAttribute('aria-pressed', String(on));
  return btn;
}

function card(t) {
  const li = document.createElement('li');
  li.className = 'win tm-card tm-' + t.status + (ringing.has(t.id) ? ' tm-ringing' : '');
  li.dataset.id = t.id;

  const bar = document.createElement('div');
  bar.className = 'win-title';
  bar.appendChild(icon('hourglass', 16));
  const name = document.createElement('span');
  name.className = 'win-title-text';
  name.textContent = t.label || lengthText(t.ms) + ' timer';
  bar.appendChild(name);
  const close = button('win-btn', 'close', '', () => remove(t), 'Delete timer');
  bar.appendChild(close);
  li.appendChild(bar);

  const body = document.createElement('div');
  body.className = 'tm-body';

  const face = document.createElement('div');
  face.className = 'tm-face';
  const time = document.createElement('span');
  time.className = 'tm-time';
  face.appendChild(time);
  const state = document.createElement('span');
  state.className = 'tm-state';
  state.textContent = STATE_TEXT[t.status] + (t.status === 'idle' ? '' : ' · ' + lengthText(t.ms));
  face.appendChild(state);
  body.appendChild(face);

  const progress = document.createElement('div');
  progress.className = 'progress tm-progress';
  progress.appendChild(document.createElement('i'));
  body.appendChild(progress);

  const controls = document.createElement('div');
  controls.className = 'tm-controls';
  if (t.status === 'running') controls.appendChild(button('tm-go', 'pause', 'Pause', () => pause(t)));
  else if (t.status === 'done') controls.appendChild(button('tm-go', 'close', ringing.has(t.id) ? 'Stop' : 'Dismiss', () => reset(t)));
  else controls.appendChild(button('tm-go', 'play', t.status === 'paused' ? 'Resume' : 'Start', () => start(t)));
  const resetBtn = button('tm-reset', 'reload', '', () => reset(t), 'Reset');
  resetBtn.disabled = t.status === 'idle';
  controls.appendChild(resetBtn);
  const edit = button('tm-edit', 'edit', '', () => openForm(t), 'Edit');
  edit.disabled = t.status === 'running';
  controls.appendChild(edit);
  const grow = document.createElement('span');
  grow.className = 'tm-grow';
  controls.appendChild(grow);
  controls.appendChild(toggle(t.alarm ? 'volume' : 'volume-x', t.alarm ? 'Alarm on' : 'Alarm off', t.alarm, on => setAlarm(t, on)));
  controls.appendChild(toggle('notification', t.notify ? 'Windows notification on' : 'Windows notification off', t.notify, on => setNotify(t, on)));
  body.appendChild(controls);

  li.appendChild(body);
  paintTime(li, t);
  return li;
}

function render() {
  els.list.replaceChildren(...timers.map(card));
  els.empty.hidden = timers.length > 0;
  syncTicker();
}

// ─── The form ───

function setPressed(btn, on) { btn.setAttribute('aria-pressed', String(on)); }
function pressed(btn) { return btn.getAttribute('aria-pressed') === 'true'; }

function fillLength(ms) {
  const secs = Math.round(ms / 1000);
  els.h.value = String(Math.floor(secs / 3600));
  els.m.value = String(Math.floor(secs / 60) % 60);
  els.s.value = String(secs % 60);
}

function openForm(t) {
  editing = t.id;
  els.name.value = t.label;
  fillLength(t.ms);
  setPressed(els.alarm, t.alarm);
  setPressed(els.notify, t.notify);
  els.formLabel.textContent = 'Edit timer';
  els.submit.textContent = 'Save';
  els.cancel.hidden = false;
  els.error.textContent = '';
  els.name.focus();
}

function closeForm() {
  editing = null;
  els.name.value = '';
  els.formLabel.textContent = 'New timer';
  els.submit.textContent = 'Add timer';
  els.cancel.hidden = true;
  els.error.textContent = '';
}

// Whole numbers only; an empty box counts as 0.
function field(input, max) {
  const raw = input.value.trim();
  if (raw === '') return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : NaN;
}

function submit(e) {
  e.preventDefault();
  const h = field(els.h, 99), m = field(els.m, 59), s = field(els.s, 59);
  if ([h, m, s].some(Number.isNaN)) { els.error.textContent = 'Use whole numbers: up to 99 hours, 59 minutes, 59 seconds.'; return; }
  const secs = h * 3600 + m * 60 + s;
  if (secs < 1) { els.error.textContent = 'Give the timer a length.'; return; }
  const label = els.name.value.trim().slice(0, MAX_LABEL);
  const t = editing && find(editing);
  if (t) {
    if (t.status === 'running') disarm(t);
    silence(t.id);
    Object.assign(t, { label, ms: secs * 1000, alarm: pressed(els.alarm), notify: pressed(els.notify), status: 'idle' });
    delete t.endsAt;
    delete t.left;
  } else {
    if (timers.length >= MAX_TIMERS) { els.error.textContent = 'You can keep up to ' + MAX_TIMERS + ' timers.'; return; }
    timers.push({ id: newId(), label, ms: secs * 1000, alarm: pressed(els.alarm), notify: pressed(els.notify), status: 'idle' });
  }
  closeForm();
  changed();
}

// ─── Start-up ───

// Timers that were running when Ethos closed: those still to come are armed
// again, those that ran out meanwhile are shown as finished, without an alarm.
async function resume() {
  const now = Date.now();
  const missed = [];
  for (const t of timers) {
    if (t.status !== 'running') continue;
    if (t.endsAt <= now) {
      t.status = 'done';
      delete t.endsAt;
      missed.push(t.label || lengthText(t.ms) + ' timer');
      continue;
    }
    try {
      await arm(t);
    } catch {
      t.status = 'paused';
      t.left = Math.min(t.ms, Math.max(0, t.endsAt - Date.now()));
      delete t.endsAt;
    }
  }
  changed();
  if (missed.length) {
    notify.show({
      title: missed.length === 1 ? 'A timer finished' : missed.length + ' timers finished',
      message: missed.join(', ') + ' ran out while Ethos was closed.',
      type: 'info',
      duration: 9000,
      action: { label: 'Open timers', onClick: () => show('timer-page') },
    });
  }
}

export function initTimer() {
  const $ = (id) => document.getElementById(id);
  els = {
    list: $('tm-list'), empty: $('tm-empty'), badge: $('sb-timer-badge'),
    form: $('tm-form'), formLabel: $('tm-form-label'), name: $('tm-name'),
    h: $('tm-h'), m: $('tm-m'), s: $('tm-s'),
    alarm: $('tm-alarm'), notify: $('tm-notify'),
    error: $('tm-error'), cancel: $('tm-cancel'), submit: $('tm-submit'),
  };
  if (!els.list || !window.ethos || !window.ethos.timers) return;

  els.form.addEventListener('submit', submit);
  els.cancel.addEventListener('click', closeForm);
  for (const btn of [els.alarm, els.notify]) {
    btn.addEventListener('click', () => setPressed(btn, !pressed(btn)));
  }
  els.form.querySelectorAll('.tm-preset').forEach((btn) => {
    btn.addEventListener('click', () => { fillLength(Number(btn.dataset.secs) * 1000); els.error.textContent = ''; });
  });
  for (const input of [els.name, els.h, els.m, els.s]) {
    input.addEventListener('input', () => { els.error.textContent = ''; });
  }

  window.ethos.onTimerDone(({ id }) => ring(id));
  // The readouts are only rewritten while the page is open; opening it brings
  // them up to date at once.
  onEnter('timer-page', tick);

  timers = load();
  render();
  resume();
}
