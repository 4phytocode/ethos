// The homepage clock: tick marks, three hands, and the exact time in the
// middle with the weekday under it.
//
// Hand angles are kept as a running total rather than reset into 0-360 each
// tick. At the top of a minute the second hand goes from 354 to 360, not back
// to 0, so the CSS transition carries it forward instead of unwinding a whole
// turn backwards.

const TICKS = 12;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric', minute: '2-digit', second: '2-digit',
});
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

let els = null;
let timer = null;
// Running totals, in degrees, so they only ever increase.
const turned = { hour: null, minute: null, second: null };

export function initClock() {
  els = {
    ticks: document.getElementById('clock-ticks'),
    hour: document.getElementById('hand-hour'),
    minute: document.getElementById('hand-minute'),
    second: document.getElementById('hand-second'),
    time: document.getElementById('clock-time'),
    day: document.getElementById('clock-day'),
  };
  if (!els.ticks) return;

  drawTicks();
  tick();
  schedule();

  // A background window does not need a running clock; catch up on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); timer = null; }
    else { tick(); schedule(); }
  });
}

function drawTicks() {
  const ns = 'http://www.w3.org/2000/svg';
  els.ticks.innerHTML = '';
  for (let i = 0; i < TICKS; i += 1) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('class', 'clock-tick');
    line.setAttribute('x1', '100');
    line.setAttribute('y1', '14');
    line.setAttribute('x2', '100');
    line.setAttribute('y2', '24');
    line.setAttribute('transform', 'rotate(' + (i * (360 / TICKS)) + ' 100 100)');
    els.ticks.appendChild(line);
  }
}

// Advances `from` to the next occurrence of `to` without ever going backwards.
function forward(from, to) {
  if (from === null) return to;
  const delta = ((to - (from % 360)) + 360) % 360;
  return from + delta;
}

function tick() {
  const now = new Date();
  const s = now.getSeconds();
  const m = now.getMinutes();
  const h = now.getHours() % 12;

  // The hour and minute hands creep rather than jump, the way a real face does.
  turned.second = forward(turned.second, s * 6);
  turned.minute = forward(turned.minute, m * 6 + s * 0.1);
  turned.hour = forward(turned.hour, h * 30 + m * 0.5);

  els.second.style.transform = 'rotate(' + turned.second + 'deg)';
  els.minute.style.transform = 'rotate(' + turned.minute + 'deg)';
  els.hour.style.transform = 'rotate(' + turned.hour + 'deg)';

  els.time.textContent = timeFormat.format(now);
  els.day.textContent = dayFormat.format(now);
}

// Fires on the second boundary rather than every 1000ms, so the readout never
// sits a fraction of a second behind the real time.
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { tick(); schedule(); }, 1000 - (Date.now() % 1000));
}
