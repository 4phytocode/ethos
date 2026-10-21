// Light / dark theme.
//
// The bottom-left toggle and the Settings page both drive this, so the mode
// lives here and interested views subscribe rather than reading the DOM.

const listeners = new Set();
let mode = 'dark';
let sunBtn = null;
let nightBtn = null;

export function currentTheme() { return mode; }
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setTheme(next) {
  mode = next === 'light' ? 'light' : 'dark';
  const dark = mode === 'dark';
  document.body.classList.toggle('dark', dark);
  if (sunBtn) sunBtn.classList.toggle('active', !dark);
  if (nightBtn) nightBtn.classList.toggle('active', dark);
  // Remembered per viewer only. Wrapped because storage can be unavailable and
  // a failed preference must not break the toggle.
  try { localStorage.setItem('ethos.theme', mode); } catch { /* ignore */ }
  for (const fn of listeners) fn(mode);
}

export function initTheme() {
  sunBtn = document.getElementById('sun');
  nightBtn = document.getElementById('night');

  sunBtn.addEventListener('click', () => setTheme('light'));
  nightBtn.addEventListener('click', () => setTheme('dark'));

  let saved = null;
  try { saved = localStorage.getItem('ethos.theme'); } catch { /* ignore */ }
  setTheme(saved === 'light' ? 'light' : 'dark');
}
