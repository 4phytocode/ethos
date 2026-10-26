// Typing sounds (PLAN-retro-demo.md, 7.5): a keyboard click as you write in the
// journal and the Notes pages. Off by default; turned on in Settings > Sound.
// Also the Timer page's alarm, which plays whatever the typing setting is: each
// timer has its own alarm switch.
//
// The clicks are synthesised with the Web Audio API, so no audio file ships and
// the page's CSP needs no media-src. Preferences live in localStorage, under
// every read and write in try/catch.

const KEY = 'ethos.sound';
const TYPING_SELECTOR = '[data-typing-sound]';
const MIN_GAP_MS = 20;        // never more than one click per 20ms
const REPEAT_MS = 50;         // key repeats closer than this stay silent

let prefs = { typing: false, volume: 0.5, offered: false };
let ctx = null;
let master = null;
let noise = null;
let lastAt = 0;
let lastKeyAt = 0;
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.typing === 'boolean') prefs.typing = raw.typing;
    if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) prefs.volume = raw.volume;
    if (typeof raw.offered === 'boolean') prefs.offered = raw.offered;
  } catch { /* defaults */ }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* not fatal */ }
}

function emit() {
  for (const fn of listeners) fn({ ...prefs });
}

export function typingSoundOn() { return prefs.typing; }
export function soundVolume() { return prefs.volume; }
export function onSoundChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setTypingSound(on) {
  prefs.typing = !!on;
  save();
  if (master) master.gain.value = prefs.volume * 0.25;
  emit();
}

export function setVolume(v) {
  prefs.volume = Math.min(1, Math.max(0, Number(v) || 0));
  save();
  if (master) master.gain.value = prefs.volume * 0.25;
  emit();
}

// Made on the first sound. Electron does not hold audio back for a user
// gesture, so an alarm can start the context from a hidden window.
function ensureContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = prefs.volume * 0.25;
    master.connect(ctx.destination);
    // One short burst of white noise, reused for every click.
    const len = Math.floor(ctx.sampleRate * 0.04);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// A bandpassed burst of noise: the click of a key.
function click(freq, q, decay, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;   // never a loop
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const env = ctx.createGain();
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0.0001, now);
  env.gain.linearRampToValueAtTime(gain, now + 0.001);
  env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
  src.connect(filter).connect(env).connect(master);
  src.start(now);
  src.stop(now + decay + 0.01);
}

// The low "thock" of the space bar and Enter.
function thock() {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 160;
  const env = ctx.createGain();
  const now = ctx.currentTime;
  env.gain.setValueAtTime(0.3, now);
  env.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
  osc.connect(env).connect(master);
  osc.start(now);
  osc.stop(now + 0.04);
}

function onKeydown(e) {
  if (!prefs.typing) return;
  if (!e.target || !e.target.matches || !e.target.matches(TYPING_SELECTOR)) return;
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape'].includes(e.key)) return;
  if (document.hidden) return;

  const now = performance.now();
  if (e.repeat && now - lastKeyAt < REPEAT_MS) return;
  lastKeyAt = now;
  if (now - lastAt < MIN_GAP_MS) return;
  lastAt = now;

  ensureContext();
  if (e.key === ' ' || e.key === 'Enter') {
    thock();
    click(2000 + Math.random() * 400, 1.2, 0.04, 0.5);
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    click(3200, 2, 0.02, 0.6);
  } else {
    click(1800 + Math.random() * 800, 1.5, 0.035, 0.8);
  }
}

// ─── Alarm ───
// A 98-style beeper: four short square-wave beeps, then a rest, until it is
// stopped or a minute has passed. It follows the Settings volume, but never
// drops below a fifth of full, so a timer with its alarm on is never silent.

const ALARM_PERIOD_MS = 1400;
const ALARM_MAX_MS = 60000;
let alarmTimer = null;
let alarmStop = null;

function beepRun() {
  const out = ctx.createGain();
  out.gain.value = Math.max(0.2, prefs.volume) * 0.18;
  out.connect(ctx.destination);
  const start = ctx.currentTime;
  for (let i = 0; i < 4; i += 1) {
    const at = start + i * 0.16;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1760;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.005);
    env.gain.setValueAtTime(1, at + 0.085);
    env.gain.linearRampToValueAtTime(0, at + 0.09);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + 0.1);
  }
  setTimeout(() => out.disconnect(), 800);
}

export function alarmPlaying() { return alarmTimer !== null; }

// Starts the alarm, or keeps the one already playing. `onEnd` runs when it
// stops by itself after a minute.
export function startAlarm(onEnd) {
  if (alarmTimer) return;
  ensureContext();
  beepRun();
  alarmTimer = setInterval(beepRun, ALARM_PERIOD_MS);
  alarmStop = setTimeout(() => { stopAlarm(); if (onEnd) onEnd(); }, ALARM_MAX_MS);
}

export function stopAlarm() {
  if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
  if (alarmStop) { clearTimeout(alarmStop); alarmStop = null; }
}

// The first time a typing field is focused, offer the sound once, as a toast.
function onFocusin(e, notify) {
  if (prefs.offered || prefs.typing) return;
  if (!e.target || !e.target.matches || !e.target.matches(TYPING_SELECTOR)) return;
  prefs.offered = true;
  save();
  notify.show({
    title: 'Typing sounds',
    message: 'Want a keyboard click as you write? You can change it in Settings.',
    type: 'info',
    duration: 9000,
    action: { label: 'Turn on', onClick: () => setTypingSound(true) },
  });
}

// Wires the keyboard listeners once. `notify` is the toast module, passed in so
// this file does not import it.
export function initSound(notify) {
  load();
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('focusin', (e) => onFocusin(e, notify));
}

// Settings > Sound: an On / Off choice and a volume slider. Both read and write
// through this module, so the settings page and the editors cannot disagree.
export function initSoundSettings() {
  const group = document.getElementById('set-sound-typing');
  const volume = document.getElementById('set-sound-volume');
  if (!group || !volume) return;

  function render() {
    const choices = [[true, 'On'], [false, 'Off']].map(([on, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'set-seg' + (prefs.typing === on ? ' on' : '');
      btn.textContent = label;
      btn.setAttribute('aria-pressed', String(prefs.typing === on));
      btn.addEventListener('click', () => setTypingSound(on));
      return btn;
    });
    group.replaceChildren(...choices);
    volume.value = String(Math.round(prefs.volume * 100));
  }

  volume.addEventListener('input', () => setVolume(Number(volume.value) / 100));
  onSoundChange(render);
  render();
}
