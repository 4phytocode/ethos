// "Currently doing": the small card at the foot of the sidebar, beside Settings.
// A pixel coffee cup with steam, the time on the timer that rings next, and
// below it the task you are probably on. The task is small until you hover or
// focus the card, then it opens upwards with the whole title and more.
//
// It reads the state cache and the timers and writes nothing, except through
// its right-click "Mark task done".

import * as state from './state.js';
import { show, showCtx } from './views.js';
import { todayISO } from './journal-streak.js';
import { plannedSpan } from './todo.js';
import { nextTimer, onTimerTick } from './timer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// A 16 by 16 pixel grid drawn at 2x: cup, handle, saucer, and three wisps of steam.
const CUP = [
  [3, 7, 8, 1], [3, 8, 1, 6], [10, 8, 1, 6], [3, 13, 8, 1],          // the cup's rim and walls
  [4, 8, 6, 1],                                                      // the coffee (accent)
  [11, 9, 2, 1], [12, 10, 1, 2], [11, 12, 2, 1],                     // handle
  [2, 14, 10, 1],                                                    // saucer
];
const COFFEE = 4;     // index into CUP of the accent-coloured rect

function buildCup() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.classList.add('now-cup-svg');
  CUP.forEach(([x, y, w, h], i) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', i === COFFEE ? 'var(--accent)' : 'currentColor');
    svg.appendChild(r);
  });
  // Steam: each wisp is a small zigzag that rises and fades, one after the other.
  [5, 7, 9].forEach((x, i) => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'now-steam s' + (i + 1));
    for (const [dx, y] of [[0, 5], [1, 3], [0, 1]]) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x + dx); r.setAttribute('y', y); r.setAttribute('width', '1'); r.setAttribute('height', '2');
      r.setAttribute('fill', 'currentColor');
      g.appendChild(r);
    }
    svg.appendChild(g);
  });
  return svg;
}

const minuteLabel = (m) => {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return (h % 12 === 0 ? 12 : h % 12) + ':' + String(mm).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
};

// What you are most likely doing now: the task whose slot you are in, else an
// event that is on, else the first task still to do today. Null when none.
export function currentTask(now = new Date()) {
  const min = now.getHours() * 60 + now.getMinutes();
  const today = todayISO();
  const tasks = state.todosOn(today).filter(t => t.kind === 'task' && !t.done);
  for (const t of tasks) {
    const span = plannedSpan(t);
    if (span && span.s <= min && min < span.e) return { kind: 'todo', id: t.id, title: t.title, detail: firstLine(t.description), until: minuteLabel(span.e) };
  }
  for (const e of state.eventsOn(today)) {
    if (e.done || e.startMinute === null) continue;
    const end = e.startMinute + (e.durationMinutes || 30);
    if (e.startMinute <= min && min < end) return { kind: 'event', id: e.id, title: e.title, detail: firstLine(e.note), until: minuteLabel(end) };
  }
  if (tasks.length) {
    const t = tasks[0];
    const span = plannedSpan(t);
    return { kind: 'todo', id: t.id, title: t.title, detail: firstLine(t.description), until: span ? minuteLabel(span.e) : '' };
  }
  return null;
}

const firstLine = (s) => String(s || '').split('\n')[0].trim();

let els = null;
let last = '';

function paint() {
  if (!els) return;
  const timer = nextTimer();
  const task = currentTask();
  const key = JSON.stringify([timer, task]);
  if (key === last) return;
  last = key;
  els.time.textContent = timer ? timer.text : '--:--';
  els.time.classList.toggle('dim', !timer || timer.paused);
  els.pause.hidden = !(timer && timer.paused);
  els.task.textContent = task ? task.title : 'No task';
  els.task.classList.toggle('none', !task);
  els.more.replaceChildren();
  if (task) {
    if (task.detail) els.more.append(Object.assign(document.createElement('span'), { className: 'now-detail', textContent: task.detail }));
    if (task.until) els.more.append(Object.assign(document.createElement('span'), { className: 'now-until', textContent: 'until ' + task.until }));
  }
  els.card.title = '';
  els.card.setAttribute('aria-label', 'Currently doing: ' + (task ? task.title : 'no task') + (timer ? ', timer ' + timer.text : ''));
}

function open() {
  const task = currentTask();
  const timer = nextTimer();
  if (timer || !task) show('timer-page');
  else if (task.kind === 'event') show('schedule-page');
  else show('todo-page');
}

export function initNowCard() {
  const card = document.getElementById('sb-now');
  if (!card) return;
  const cup = card.querySelector('.now-cup');
  cup.appendChild(buildCup());
  els = {
    card, time: document.getElementById('now-time'), pause: document.getElementById('now-pause'),
    task: document.getElementById('now-task'), more: document.getElementById('now-more'),
  };
  card.addEventListener('click', open);
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const task = currentTask();
    showCtx(e, [
      { label: 'Mark task done', disabled: !task || task.kind !== 'todo', onClick: () => { if (task) state.updateTodo(task.id, { done: true }); } },
      { label: 'Open timers', onClick: () => show('timer-page') },
    ]);
  });
  state.subscribe(paint);
  document.addEventListener('ethos:timers', paint);
  onTimerTick(paint);
  // The task depends on the clock, so look again on every minute boundary.
  const minute = () => { paint(); setTimeout(minute, 60000 - (Date.now() % 60000) + 50); };
  setTimeout(minute, 60000 - (Date.now() % 60000) + 50);
  paint();
}
