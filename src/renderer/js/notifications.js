// Ethos in-app notifications — a toast stack rendered by the app itself, not
// the OS.
//
// Previously this file was read off disk by the main process and handed to
// webContents.executeJavaScript on every load. That made the renderer's code a
// function of a file's contents at runtime, which is an execution path we do
// not want in a product that ships paid builds. It is now an ordinary module
// imported by the page, and its CSS lives in styles/notifications.css.
//
//   notify.show({ title, message, type, duration, action })
//   notify.show('Title', 'Message', { type: 'success' })
//   notify.info / .success / .warn / .error  (title, message, opts)
//   notify.dismiss(id)        remove one toast
//   notify.clear()            remove everything, queue included
//
//   type      'info' | 'success' | 'warn' | 'error'   (default 'info')
//   duration  ms before it self-dismisses; 0 keeps it until dismissed
//   action    { label, onClick }  renders one compact inline button

const ACCENT = {
  info: '#3b82f6',
  success: '#22c55e',
  warn: '#f59e0b',
  error: '#ef4444',
};
const DEFAULT_TYPE = 'info';
const DEFAULT_DURATION = 4000;
const MAX_VISIBLE = 4;
const ANIM_MS = 220;

const live = new Map();   // id -> record
const queue = [];
let nextId = 1;
let stack = null;

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement('div');
  stack.className = 'ethos-notif-stack';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

// Built as elements rather than an innerHTML string: nothing user-supplied is
// ever parsed as markup.
function closeIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.2');
  svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M18 6L6 18M6 6l12 12');
  svg.appendChild(path);
  return svg;
}

function build(opts) {
  const type = ACCENT[opts.type] ? opts.type : DEFAULT_TYPE;
  const color = ACCENT[type];

  const el = document.createElement('div');
  el.className = 'ethos-notif';
  el.dataset.type = type;

  const accent = document.createElement('span');
  accent.className = 'ethos-notif-accent';
  accent.style.background = color;
  el.appendChild(accent);

  const body = document.createElement('div');
  body.className = 'ethos-notif-body';

  const title = document.createElement('p');
  title.className = 'ethos-notif-title';
  title.textContent = opts.title || '';
  body.appendChild(title);

  if (opts.message) {
    const msg = document.createElement('p');
    msg.className = 'ethos-notif-msg';
    msg.textContent = opts.message;
    body.appendChild(msg);
  }

  if (opts.action && opts.action.label) {
    const act = document.createElement('button');
    act.className = 'ethos-notif-action';
    act.type = 'button';
    act.textContent = opts.action.label;
    act.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof opts.action.onClick === 'function') opts.action.onClick();
      dismiss(el.dataset.id);
    });
    body.appendChild(act);
  }
  el.appendChild(body);

  const close = document.createElement('button');
  close.className = 'ethos-notif-close';
  close.type = 'button';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.appendChild(closeIcon());
  close.addEventListener('click', (e) => { e.stopPropagation(); dismiss(el.dataset.id); });
  el.appendChild(close);

  return { el, color };
}

function present(opts) {
  const id = String(opts.id);
  const { el, color } = build(opts);
  el.dataset.id = id;

  const duration = Number.isFinite(opts.duration) ? opts.duration : DEFAULT_DURATION;
  const rec = { el, duration, remaining: duration, startedAt: 0, timer: null };

  if (duration > 0) {
    const bar = document.createElement('span');
    bar.className = 'ethos-notif-timer';
    bar.style.background = color;
    // The animation lives in the stylesheet; JS only supplies its length.
    bar.style.setProperty('--notif-duration', duration + 'ms');
    el.appendChild(bar);

    const pause = () => {
      if (rec.timer == null) return;
      clearTimeout(rec.timer);
      rec.timer = null;
      rec.remaining = Math.max(0, rec.remaining - (Date.now() - rec.startedAt));
    };
    const resume = () => {
      if (rec.timer != null) return;
      rec.startedAt = Date.now();
      rec.timer = setTimeout(() => dismiss(id), rec.remaining);
    };
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', resume);
    rec.resume = resume;
  }

  live.set(id, rec);
  ensureStack().appendChild(el);
  // The 'in' class is what takes the toast from opacity 0 to visible. A frame
  // callback gives the smoothest transition, but Chromium suspends those for a
  // hidden or occluded window, which would leave the toast invisible until the
  // window came back. The timer is a fallback for that case; whichever lands
  // first wins and adding the class twice is harmless.
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => el.classList.add('in'), 32);
  if (rec.resume) rec.resume();
  return id;
}

function pump() {
  while (queue.length && live.size < MAX_VISIBLE) present(queue.shift());
}

function show(a, b, c) {
  let opts;
  if (typeof a === 'string') opts = Object.assign({}, c, { title: a, message: b });
  else opts = Object.assign({}, a);

  opts.id = nextId++;
  if (live.size >= MAX_VISIBLE) queue.push(opts);
  else present(opts);
  return String(opts.id);
}

function dismiss(id) {
  id = String(id);
  const rec = live.get(id);
  if (!rec) return false;
  if (rec.timer != null) clearTimeout(rec.timer);
  live.delete(id);
  rec.el.classList.remove('in');
  rec.el.classList.add('out');
  setTimeout(() => { rec.el.remove(); pump(); }, ANIM_MS);
  return true;
}

function clear() {
  queue.length = 0;
  [...live.keys()].forEach(dismiss);
}

const byType = (type) => (title, message, opts) =>
  show(Object.assign({}, opts, { title, message, type }));

export const notify = {
  show,
  dismiss,
  clear,
  info: byType('info'),
  success: byType('success'),
  warn: byType('warn'),
  error: byType('error'),
  get count() { return live.size; },
  get queued() { return queue.length; },
};
