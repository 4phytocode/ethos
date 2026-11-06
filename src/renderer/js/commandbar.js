// The command bar: "/" opens a small prompt at the bottom right (when you are not
// typing somewhere else; inside a note "/" stays the block menu). Today it has
// one command, shut-down, which plays the intro backwards and then closes Ethos.
// More are meant to join the COMMANDS list later.

import * as state from './state.js';
import { icon } from './icons.js';
import { canTakeKey, PLAIN_KEY } from './keys.js';
import { playOutro, clearOutro } from './outro.js';
import { commitPending } from './journals.js';
import { commitNotes } from './notes.js';
import { commitDayNote } from './daynotes.js';
import { confirmDialog } from './dialog.js';

const COMMANDS = [
  { id: 'shutdown', names: ['shut-down', 'shutdown', 'quit', 'exit'], hint: 'Save everything and close Ethos', run: () => shutDown() },
];

let bar = null;   // { root, input, list, error, matches, active }

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function queryOf(input) { return input.value.replace(/^\//, '').trim().toLowerCase(); }

function matching(q) {
  return COMMANDS.filter(c => !q || c.names.some(n => n.startsWith(q)));
}

function paint() {
  const b = bar;
  b.matches = matching(queryOf(b.input));
  b.active = Math.min(b.active, Math.max(0, b.matches.length - 1));
  b.list.replaceChildren();
  b.matches.forEach((c, i) => {
    const row = el('li', 'cmd-row' + (i === b.active ? ' active' : ''));
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(i === b.active));
    row.append(el('span', 'cmd-name', c.names[0]), el('span', 'cmd-hint', c.hint));
    row.addEventListener('pointerdown', (e) => e.preventDefault());
    row.addEventListener('click', () => run(c));
    b.list.appendChild(row);
  });
}

function openBar() {
  if (bar) { bar.input.focus(); return; }
  const previous = document.activeElement;
  const root = el('div', 'win cmdbar');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Command bar');
  const title = el('div', 'win-title');
  title.append(icon('zap', 16), el('span', 'win-title-text', 'CMD'));
  const x = el('button', 'win-btn', '×');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close command bar');
  title.appendChild(x);

  const body = el('div', 'win-body cmd-body');
  const line = el('label', 'cmd-line');
  line.append(el('span', 'cmd-prompt', 'C:\\ETHOS>'));
  const input = el('input', 'cmd-input');
  input.type = 'text';
  input.value = '/';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Command');
  line.appendChild(input);
  const list = el('ul', 'cmd-list');
  list.setAttribute('role', 'listbox');
  const error = el('p', 'cmd-error');
  error.setAttribute('role', 'status');
  body.append(line, list, error);
  root.append(title, body);
  document.body.appendChild(root);

  bar = { root, input, list, error, matches: [], active: 0, previous };
  x.addEventListener('click', closeBar);
  input.addEventListener('input', () => {
    if (!input.value.startsWith('/')) input.value = '/' + input.value.replace(/^\/*/, '');
    bar.error.textContent = '';
    bar.active = 0;
    paint();
  });
  input.addEventListener('keydown', onInputKey);
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onDocKey, true);
  paint();
  input.focus();
  input.setSelectionRange(1, 1);
}

function closeBar() {
  if (!bar) return;
  const { root, previous } = bar;
  bar = null;
  document.removeEventListener('pointerdown', onOutside, true);
  document.removeEventListener('keydown', onDocKey, true);
  root.remove();
  if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
}

// Esc closes the bar wherever focus has gone (a click on the page, say).
function onDocKey(e) { if (bar && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBar(); } }

function onOutside(e) { if (bar && !bar.root.contains(e.target)) closeBar(); }

function onInputKey(e) {
  const b = bar;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeBar(); return; }
  if (e.key === 'Backspace' && b.input.value === '/') { e.preventDefault(); closeBar(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!b.matches.length) return;
    b.active = (b.active + (e.key === 'ArrowDown' ? 1 : b.matches.length - 1)) % b.matches.length;
    paint();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const c = b.matches[b.active];
    if (c) { b.input.value = '/' + c.names[0]; b.error.textContent = ''; paint(); }
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const c = b.matches[b.active];
    if (c) run(c);
    else b.error.textContent = "'" + b.input.value.replace(/^\//, '').trim() + "' is not a command.";
  }
}

function run(command) {
  closeBar();
  command.run();
}

// ─── shut-down ───

// The page's last word is the test hook: with it set, nothing quits.
const noQuit = () => { try { return localStorage.getItem('ethos.test.noQuit') === '1'; } catch { return false; } };
let shuttingDown = false;

async function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    // What is still being typed goes to main first, the way closing the window does it.
    await Promise.allSettled([commitPending(), commitNotes(), commitDayNote()]);
    const res = await playOutro(state.flush());
    if (!res.ok) {
      const again = await confirmDialog({
        title: 'Could not save',
        message: 'Some changes could not be saved. Quitting now would lose them.',
        okLabel: 'Try again', cancelLabel: 'Cancel',
      });
      shuttingDown = false;
      if (again) shutDown();
      return;
    }
    if (noQuit()) {
      window.__shutdownCalls = (window.__shutdownCalls || 0) + 1;
      clearOutro();
      shuttingDown = false;
      return;
    }
    await window.ethos.app.shutdown();
  } catch (err) {
    console.error('shut-down failed:', err.message);
    clearOutro();
    shuttingDown = false;
  }
}

export function initCommandBar() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || !PLAIN_KEY(e) || bar) return;
    if (!canTakeKey()) return;
    e.preventDefault();
    openBar();
  });
}
