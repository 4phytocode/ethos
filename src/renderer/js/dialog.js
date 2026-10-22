// A modal confirmation in the retro window style (styles/retro.css, .dlg).
//
//   const ok = await confirmDialog({ title, message, okLabel, danger });
//
// Resolves true for OK, false for Cancel, Esc or the close box. Enter is OK and
// Tab moves between the two buttons, so the dialog cannot leave the keyboard.
// Text is set with textContent, never as markup.

import { icon } from './icons.js';

export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;

    const scrim = document.createElement('div');
    scrim.className = 'dlg-scrim';

    const win = document.createElement('div');
    win.className = 'win dlg';
    win.setAttribute('role', 'alertdialog');
    win.setAttribute('aria-modal', 'true');

    const bar = document.createElement('div');
    bar.className = 'win-title';
    bar.appendChild(icon('zap', 16));
    const titleText = document.createElement('span');
    titleText.className = 'win-title-text';
    titleText.id = 'dlg-title';
    titleText.textContent = title;
    bar.appendChild(titleText);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'win-btn';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    bar.appendChild(close);
    win.setAttribute('aria-labelledby', 'dlg-title');

    const body = document.createElement('div');
    body.className = 'win-body dlg-body';
    const text = document.createElement('p');
    text.style.margin = '0';
    text.textContent = message;
    body.appendChild(text);

    const row = document.createElement('div');
    row.className = 'dlg-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'danger' : 'primary';
    ok.textContent = okLabel;
    row.append(cancel, ok);
    body.appendChild(row);

    win.append(bar, body);
    scrim.appendChild(win);
    document.body.appendChild(scrim);

    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      scrim.remove();
      if (previous && previous.focus) previous.focus();
      resolve(result);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); done(document.activeElement !== cancel); }
      else if (e.key === 'Tab') {
        // Only two buttons (and the close box), so Tab just swaps them.
        e.preventDefault();
        (document.activeElement === ok ? cancel : ok).focus();
      }
    }

    cancel.addEventListener('click', () => done(false));
    close.addEventListener('click', () => done(false));
    ok.addEventListener('click', () => done(true));
    document.addEventListener('keydown', onKey, true);
    ok.focus();
  });
}
