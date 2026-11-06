// Floating timers: a timer can be popped out of the Timer page into a small
// window that stays over every view. Drag it by its title bar (it follows the
// pointer on a spring), minimise it to the bar, dock it back, or close it (the
// timer keeps running). Ctrl+Shift+T hides and shows them all.
//
// A floating window is just another view of the timer: its place lives on the
// timer record (timer.js, `float`), and every action goes through timerApi, so
// this file holds no state of its own beyond the DOM.

import { show } from './views.js';
import { icon } from './icons.js';
import { notify } from './notifications.js';
import { Spring } from './spring.js';
import { timerApi, onTimerTick } from './timer.js';
import { flash } from './search.js';

const HIDDEN_KEY = 'ethos.timers.floatsHidden';
const MAX_OPEN = 6;
const KEEP = 40;               // pixels of the title bar that must stay on screen
const WIDTH = 250;

let layer = null;
const nodes = new Map();       // timer id -> { el, spring, parts }
let z = 1;

function hidden() { try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; } }
function setHidden(v) { try { localStorage.setItem(HIDDEN_KEY, v ? '1' : '0'); } catch { /* not fatal */ } }

const sidebarWidth = () => (parseFloat(getComputedStyle(document.body).getPropertyValue('--sb-w')) || 0);

function clampPos(x, y) {
  const maxX = window.innerWidth - sidebarWidth() - KEEP;
  return {
    x: Math.round(Math.min(maxX, Math.max(KEEP - WIDTH, x))),
    y: Math.round(Math.min(window.innerHeight - 30, Math.max(0, y))),
  };
}

function nameOf(t) { return t.label || timerApi.lengthText(t.ms) + ' timer'; }

function build(t) {
  const el = document.createElement('div');
  el.className = 'win tmf';
  el.dataset.id = t.id;
  el.style.width = WIDTH + 'px';

  const bar = document.createElement('div');
  bar.className = 'win-title tmf-bar';
  const title = document.createElement('span');
  title.className = 'win-title-text';
  const mk = (cls, label, glyph) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'win-btn ' + cls;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.textContent = glyph;
    return b;
  };
  const minBtn = mk('tmf-min', 'Minimise', '_');
  const dockBtn = mk('tmf-dock', 'Back to the Timer page', '▣');
  const closeBtn = mk('tmf-close', 'Close this window (the timer keeps running)', '×');
  bar.append(icon('hourglass', 16), title, minBtn, dockBtn, closeBtn);

  const body = document.createElement('div');
  body.className = 'win-body tmf-body';
  const time = document.createElement('div');
  time.className = 'tmf-time';
  time.setAttribute('role', 'timer');
  const prog = document.createElement('div');
  prog.className = 'tmf-track';
  const fill = document.createElement('div');
  fill.className = 'tmf-fill';
  prog.appendChild(fill);
  const actions = document.createElement('div');
  actions.className = 'tmf-actions';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'tmf-go';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tmf-reset';
  reset.textContent = 'Reset';
  actions.append(go, reset);
  body.append(time, prog, actions);
  el.append(bar, body);

  const parts = { title, time, fill, go, reset, minBtn };
  const live = () => timerApi.find(t.id);

  minBtn.addEventListener('click', () => setMin(live(), !(live().float || {}).min));
  bar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setMin(live(), !(live().float || {}).min); });
  closeBtn.addEventListener('click', () => { const x = live(); if (x) { x.float.open = false; timerApi.changed(); } });
  dockBtn.addEventListener('click', () => {
    const x = live();
    if (!x) return;
    x.float.open = false;
    timerApi.changed();
    show('timer-page');
    requestAnimationFrame(() => flash(document.querySelector('#tm-list [data-id="' + x.id + '"]')));
  });
  go.addEventListener('click', () => {
    const x = live();
    if (!x) return;
    if (x.status === 'running') timerApi.pause(x);
    else if (x.status === 'done') timerApi.reset(x);
    else timerApi.start(x);
  });
  reset.addEventListener('click', () => { const x = live(); if (x) timerApi.reset(x); });
  el.addEventListener('pointerdown', () => { el.style.zIndex = String(++z); });

  const spring = new Spring(el, (s) => { el.style.left = s.cur.x + 'px'; el.style.top = s.cur.y + 'px'; });
  drag(bar, el, spring, live);
  return { el, spring, parts };
}

// Listeners go on window: pointer capture alone is not reliable under synthetic input.
function drag(bar, el, spring, live) {
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const t = live();
    if (!t) return;
    e.preventDefault();
    const dx = e.clientX - (spring.tgt ? spring.tgt.x : t.float.x);
    const dy = e.clientY - (spring.tgt ? spring.tgt.y : t.float.y);
    el.classList.add('dragging');
    const move = (m) => spring.to(clampPos(m.clientX - dx, m.clientY - dy));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      const x = live();
      if (x && spring.tgt) { x.float.x = spring.tgt.x; x.float.y = spring.tgt.y; timerApi.persist(); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}

function setMin(t, on) {
  if (!t) return;
  t.float.min = on;
  timerApi.changed();
}

// Brings one window's text and state up to date with its timer.
function update(t, n, now = Date.now()) {
  const left = timerApi.remaining(t, now);
  const text = timerApi.clock(left, t.ms);
  const min = !!t.float.min;
  n.el.classList.toggle('min', min);
  n.el.classList.toggle('tmf-ringing', timerApi.isRinging(t.id));
  n.el.className = n.el.className.replace(/\btm-(idle|running|paused|done)\b/g, '').trim() + ' tm-' + t.status;
  n.parts.title.textContent = min ? nameOf(t) + '  ' + text : nameOf(t);
  n.parts.minBtn.textContent = min ? '□' : '_';
  n.parts.minBtn.setAttribute('aria-label', min ? 'Restore' : 'Minimise');
  n.parts.time.textContent = text;
  const frac = t.ms ? 1 - left / t.ms : 0;
  n.parts.fill.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  n.parts.go.textContent = t.status === 'running' ? 'Pause' : t.status === 'done' ? (timerApi.isRinging(t.id) ? 'Stop alarm' : 'Dismiss')
    : t.status === 'paused' ? 'Resume' : 'Start';
  n.parts.reset.disabled = t.status === 'idle';
}

export function renderFloats() {
  if (!layer) return;
  const want = hidden() ? [] : timerApi.list().filter(t => t.float && t.float.open);
  const ids = new Set(want.map(t => t.id));
  for (const [id, n] of nodes) if (!ids.has(id)) { n.spring.stop(); n.el.remove(); nodes.delete(id); }
  want.forEach((t, i) => {
    let n = nodes.get(t.id);
    if (!n) {
      n = build(t);
      nodes.set(t.id, n);
      layer.appendChild(n.el);
      const p = clampPos(t.float.x, t.float.y);
      n.spring.to(p);
      n.spring.paint();   // in place at once, not on the next frame
    }
    update(t, n);
  });
}

function popOut(id) {
  const t = timerApi.find(id);
  if (!t) return;
  if (t.float && t.float.open && !hidden()) { renderFloats(); return; }
  const open = timerApi.list().filter(x => x.float && x.float.open).length;
  if (open >= MAX_OPEN) { notify.info('Six floating timers at most', 'Close one first.'); return; }
  setHidden(false);
  const spot = clampPos(window.innerWidth - sidebarWidth() - WIDTH - 40, 90 + open * 34);
  t.float = { open: true, x: t.float ? t.float.x : spot.x, y: t.float ? t.float.y : spot.y, min: false };
  timerApi.changed();
}

function toggleHidden() {
  const any = timerApi.list().some(t => t.float && t.float.open);
  if (!any) { notify.info('No floating timers', 'Use "Pop out" on a timer to float it.'); return; }
  setHidden(!hidden());
  renderFloats();
}

export function floatsHidden() { return hidden(); }
export { toggleHidden as toggleFloatingTimers };

export function initTimerFloat() {
  layer = document.getElementById('tm-floats');
  if (!layer) return;
  document.addEventListener('ethos:timers', renderFloats);
  document.addEventListener('ethos:timer-popout', (e) => popOut(e.detail.id));
  onTimerTick(() => { if (nodes.size) for (const t of timerApi.list()) { const n = nodes.get(t.id); if (n) update(t, n); } });
  window.addEventListener('resize', () => {
    for (const [id, n] of nodes) {
      const t = timerApi.find(id);
      if (t) n.spring.to(clampPos(t.float.x, t.float.y));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      toggleHidden();
    }
  });
  renderFloats();
}
