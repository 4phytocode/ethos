// Settings, and the appearance system behind it.
//
// Appearance is per-machine: it lives in localStorage, not the vault, because
// it describes this install rather than the user's data. When accounts arrive
// it is the kind of thing that may want to follow a user, and moving it then
// means adding a channel, not reshaping anything.
//
// The font applies to the whole app through one custom property, --font-ui, so
// every surface that inherits (buttons, inputs, the journal editor) follows
// without its own rule.

import { currentTheme, setTheme, onThemeChange } from './theme.js';
import { notify } from './notifications.js';

const PREFS_KEY = 'ethos.appearance';
const DEFAULT_FONT = 'plex-mono';

// Every entry has to be either installed on the machine or shipped by us.
// Nothing here is fetched: the CSP allows `font-src 'self'` only, so a Google
// Fonts entry would silently fall back and the setting would be a lie.
export const FONTS = [
  // Shipped in renderer/fonts (see styles/fonts.css), so it needs no probe.
  { id: 'plex-mono', label: 'IBM Plex Mono', note: 'Calm, even-spaced and precise',
    stack: "'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace", probe: null },
  { id: 'system', label: 'System UI', note: 'Matches the rest of your desktop',
    stack: "system-ui, 'Segoe UI', Roboto, sans-serif", probe: null },
];

const PREVIEW = 'The quick brown fox jumps over the lazy dog — 0123456789';

let els = null;
let fontId = DEFAULT_FONT;

// ─── Preference storage ───

function load() {
  let raw = null;
  try { raw = localStorage.getItem(PREFS_KEY); } catch { /* ignore */ }
  if (!raw) return;
  try {
    const p = JSON.parse(raw);
    if (FONTS.some(f => f.id === p.font)) fontId = p.font;
  } catch { /* a malformed preference is not worth failing over */ }
}

function save() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ font: fontId })); } catch { /* ignore */ }
}

// ─── Applying ───

export function applyFont(id) {
  const font = FONTS.find(f => f.id === id) || FONTS[0];
  document.documentElement.style.setProperty('--font-ui', font.stack);
  document.documentElement.dataset.font = font.id;   // lets CSS tune per family
  return font;
}

// Runs before first paint so the app never flashes the default family.
export function initAppearance() {
  load();
  applyFont(fontId);
}

// ─── Availability ───
// A font stack silently falls back when the face is missing, so the UI would
// otherwise claim a choice it cannot honour. Measuring a string in the
// candidate against a deliberately absent family tells us whether it rendered.
function isInstalled(family) {
  if (!family) return true;                 // generic stacks always resolve
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const sample = 'mmmmmmmmmmlli0O';
  const baseline = (fam) => { ctx.font = '72px ' + fam; return ctx.measureText(sample).width; };
  const missing = baseline("'__ethos_absent__'");
  return baseline("'" + family + "', '__ethos_absent__'") !== missing;
}

// ─── UI ───

export function initSettings() {
  els = {
    theme: document.getElementById('set-theme'),
    fonts: document.getElementById('set-fonts'),
    preview: document.getElementById('set-preview-text'),
    previewTitle: document.getElementById('set-preview-title'),
  };
  if (!els.fonts) return;

  renderTheme();
  renderFonts();
  onThemeChange(renderTheme);
}

function renderTheme() {
  if (!els || !els.theme) return;
  els.theme.innerHTML = '';
  for (const [mode, label] of [['light', 'Light'], ['dark', 'Dark']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'set-seg' + (currentTheme() === mode ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => setTheme(mode));
    els.theme.appendChild(b);
  }
}

function renderFonts() {
  els.fonts.innerHTML = '';
  for (const font of FONTS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'set-font' + (font.id === fontId ? ' on' : '');
    card.dataset.font = font.id;
    card.style.fontFamily = font.stack;

    const name = document.createElement('span');
    name.className = 'set-font-name';
    name.textContent = font.label;
    card.appendChild(name);

    const sample = document.createElement('span');
    sample.className = 'set-font-sample';
    sample.textContent = 'Aa Bb Cc 123';
    card.appendChild(sample);

    const note = document.createElement('span');
    note.className = 'set-font-note';
    note.textContent = font.note;
    card.appendChild(note);

    card.addEventListener('click', () => choose(font.id));
    els.fonts.appendChild(card);

    flagAvailability(card, font);
  }
  updatePreview();
}

// Marks a card whose face is not actually present, rather than letting the
// stack fall back and pretend the setting took effect.
function flagAvailability(card, font) {
  const ok = isInstalled(font.probe);
  if (ok) return;
  card.classList.add('missing');
  const warn = document.createElement('span');
  warn.className = 'set-font-missing';
  warn.textContent = 'Not installed — falls back';
  card.appendChild(warn);
}

function choose(id) {
  const changed = id !== fontId;
  fontId = id;
  const font = applyFont(id);
  save();
  els.fonts.querySelectorAll('.set-font')
    .forEach(c => c.classList.toggle('on', c.dataset.font === id));
  updatePreview();
  // Picking the face that is already in use is not a change worth a toast.
  if (changed) notify.success('Font changed', font.label + ' is now used everywhere.');
}

function updatePreview() {
  if (!els.preview) return;
  const font = FONTS.find(f => f.id === fontId) || FONTS[0];
  els.previewTitle.textContent = font.label;
  els.preview.textContent = PREVIEW;
}
