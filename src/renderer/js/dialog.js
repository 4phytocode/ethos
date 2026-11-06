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

// A small form in the same window style. Resolves to { key: value } for OK, or
// null for Cancel, Esc or the close box.
//
//   const v = await formDialog({
//     title: 'New tag', okLabel: 'Create',
//     fields: [{ key: 'name', label: 'Name', maxLength: 24 },
//              { key: 'color', label: 'Colour', kind: 'colors', colors: [...], value: colors[0] }],
//     validate: (v) => (v.name.trim() ? '' : 'Give it a name.'),
//   });
//
// OK is disabled while validate() returns a message, which is shown under the
// fields. Enter in a text field is OK; Tab stays inside the window.
export function formDialog({ title, okLabel = 'OK', cancelLabel = 'Cancel', fields, validate = () => '' }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const scrim = document.createElement('div');
    scrim.className = 'dlg-scrim';
    const win = document.createElement('div');
    win.className = 'win dlg';
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');

    const bar = document.createElement('div');
    bar.className = 'win-title';
    bar.appendChild(icon('zap', 16));
    const titleText = document.createElement('span');
    titleText.className = 'win-title-text';
    titleText.id = 'dlg-form-title';
    titleText.textContent = title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'win-btn';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    bar.append(titleText, close);
    win.setAttribute('aria-labelledby', 'dlg-form-title');

    const body = document.createElement('div');
    body.className = 'win-body dlg-body';
    const values = {};
    const inputs = [];
    for (const f of fields) {
      const label = document.createElement('label');
      label.className = 'dlg-field';
      const name = document.createElement('span');
      name.textContent = f.label;
      label.appendChild(name);
      values[f.key] = f.value === undefined ? '' : f.value;
      if (f.kind === 'colors') {
        const row = document.createElement('div');
        row.className = 'dlg-colors';
        row.setAttribute('role', 'radiogroup');
        for (const c of f.colors) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'dlg-swatch';
          b.style.background = c;
          b.setAttribute('role', 'radio');
          b.setAttribute('aria-label', 'Colour ' + c);
          b.setAttribute('aria-checked', String(values[f.key] === c));
          b.addEventListener('click', () => {
            values[f.key] = c;
            row.querySelectorAll('.dlg-swatch').forEach(s => s.setAttribute('aria-checked', String(s === b)));
            refresh();
          });
          row.appendChild(b);
        }
        label.appendChild(row);
        inputs.push(row.firstChild);
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = values[f.key];
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.maxLength) input.maxLength = f.maxLength;
        input.addEventListener('input', () => { values[f.key] = input.value; refresh(); });
        label.appendChild(input);
        inputs.push(input);
      }
      body.appendChild(label);
    }
    const error = document.createElement('p');
    error.className = 'dlg-error';
    error.setAttribute('role', 'status');
    body.appendChild(error);

    const row = document.createElement('div');
    row.className = 'dlg-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'primary';
    ok.textContent = okLabel;
    row.append(cancel, ok);
    body.appendChild(row);
    win.append(bar, body);
    scrim.appendChild(win);
    document.body.appendChild(scrim);

    function refresh() {
      const msg = validate({ ...values });
      error.textContent = msg;
      ok.disabled = !!msg;
    }
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
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); return; }
      if (e.key === 'Enter' && document.activeElement !== cancel && document.activeElement !== close &&
          !(document.activeElement && document.activeElement.classList.contains('dlg-swatch'))) {
        e.preventDefault();
        if (!ok.disabled) done({ ...values });
        return;
      }
      if (e.key === 'Tab') {
        const order = [...win.querySelectorAll('input, button:not(:disabled)')];
        const at = order.indexOf(document.activeElement);
        e.preventDefault();
        order[(at + (e.shiftKey ? order.length - 1 : 1)) % order.length].focus();
      }
    }
    cancel.addEventListener('click', () => done(null));
    close.addEventListener('click', () => done(null));
    ok.addEventListener('click', () => { if (!ok.disabled) done({ ...values }); });
    document.addEventListener('keydown', onKey, true);
    refresh();
    (inputs[0] || ok).focus();
    if (inputs[0] && inputs[0].select) inputs[0].select();
  });
}
