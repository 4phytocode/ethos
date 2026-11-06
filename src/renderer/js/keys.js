// When may a bare key such as Tab or "/" be taken for the app?
//
// Only when the user is not typing: no field, editor or dialog has focus, no
// menu or other window is open, and the launch intro is over. Otherwise Tab must
// keep moving focus and "/" must stay a character (or the in-note menu).

import { ctxOpen } from './views.js';

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], [role="alertdialog"]';

export function canTakeKey() {
  if (document.getElementById('intro') || document.getElementById('outro')) return false;
  if (document.querySelector('.dlg-scrim, .fs-scrim, .cmdbar, .qs-scrim')) return false;
  if (ctxOpen()) return false;
  const a = document.activeElement;
  if (a && a !== document.body && a.closest && a.closest(TYPING)) return false;
  return true;
}

export const PLAIN_KEY = (e) => !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat && !e.isComposing;
