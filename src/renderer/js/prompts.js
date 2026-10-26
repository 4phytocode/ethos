// Journal page aids: journalling prompts, the empty-page nudge, and the paper
// (plain / lines / grid) switch.
//
// The nudge appears once per opened page, after the page has sat empty (or
// nearly) with no typing for NUDGE_MS. journals.js calls startPrompts() when a
// page opens and stopPrompts() when it closes.
//
// Paper is a per-machine preference kept per note in localStorage; a note
// with no choice uses the last paper picked anywhere.

import { GRATITUDE, DEEP } from './prompts-data.js';

// How long a page sits empty before the nudge appears. The test harness sets
// ethos.test.nudgeMs to shorten it; nothing else does.
const NUDGE_MS = 30 * 1000;
function nudgeMs() {
  try {
    const v = Number(localStorage.getItem('ethos.test.nudgeMs'));
    if (Number.isInteger(v) && v > 0) return v;
  } catch { /* storage unavailable: use the default */ }
  return NUDGE_MS;
}
// "Almost fully empty": fewer characters than this still counts as empty.
const NEARLY_EMPTY = 12;
const PAPER_KEY = 'ethos.paper';
const PAPERS = ['plain', 'lines', 'grid'];

let els = null;
let timer = null;
let noteId = null;
let kind = 'gratitude';
let current = '';
const lastShown = { gratitude: -1, deep: -1 };

export function initPrompts() {
  els = {
    textarea: document.getElementById('jp-textarea'),
    btn: document.getElementById('jp-prompts-btn'),
    nudge: document.getElementById('jp-nudge'),
    panel: document.getElementById('jp-prompts'),
    text: document.getElementById('jp-prompt-text'),
    kinds: [...document.querySelectorAll('.jp-prompt-kinds button')],
    use: document.getElementById('jp-prompt-use'),
    next: document.getElementById('jp-prompt-next'),
    no: document.getElementById('jp-prompt-no'),
    paper: [...document.querySelectorAll('#jp-paper button')],
  };
  if (!els.textarea) return;

  els.btn.addEventListener('click', () => (els.panel.hidden ? openPanel() : closePanel()));
  els.nudge.addEventListener('click', openPanel);
  els.kinds.forEach(b => b.addEventListener('click', () => { kind = b.dataset.kind; draw(); }));
  els.next.addEventListener('click', draw);
  els.use.addEventListener('click', usePrompt);
  els.no.addEventListener('click', closePanel);
  els.textarea.addEventListener('input', () => { els.nudge.hidden = true; arm(); });
  els.paper.forEach(b => b.addEventListener('click', () => setPaper(b.dataset.paper)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.panel.hidden) closePanel(); });
}

export function startPrompts(id) {
  noteId = id;
  closePanel();
  els.nudge.hidden = true;
  applyPaper();
  arm();
}

export function stopPrompts() {
  clearTimeout(timer);
  timer = null;
  noteId = null;
  closePanel();
  els.nudge.hidden = true;
}

// (Re)starts the idle clock. The nudge is offered only while the page is
// still (nearly) empty when it runs out.
function arm() {
  clearTimeout(timer);
  timer = null;
  if (!noteId || els.textarea.value.trim().length >= NEARLY_EMPTY) return;
  timer = setTimeout(() => {
    timer = null;
    if (noteId && els.panel.hidden && els.textarea.value.trim().length < NEARLY_EMPTY) els.nudge.hidden = false;
  }, nudgeMs());
}

function openPanel() {
  els.nudge.hidden = true;
  clearTimeout(timer);
  els.panel.hidden = false;
  els.btn.setAttribute('aria-expanded', 'true');
  draw();
}

function closePanel() {
  if (!els) return;
  els.panel.hidden = true;
  els.btn.setAttribute('aria-expanded', 'false');
}

function draw() {
  const list = kind === 'deep' ? DEEP : GRATITUDE;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastShown[kind]) i = (i + 1) % list.length;
  lastShown[kind] = i;
  current = list[i];
  els.text.textContent = current;
  els.kinds.forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
}

// Puts the prompt at the top of the page as its own line and leaves the
// cursor under it. Fires `input` so journals.js saves it like typing.
function usePrompt() {
  const ta = els.textarea;
  const body = ta.value.replace(/^\s+/, '');
  ta.value = current + '\n\n' + body;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  closePanel();
  ta.focus();
  const at = current.length + 2;
  ta.setSelectionRange(at, at);
}

// ─── Paper ───

function readPaper() {
  try { return JSON.parse(localStorage.getItem(PAPER_KEY) || 'null') || {}; } catch { return {}; }
}

function applyPaper() {
  const prefs = readPaper();
  const byNote = prefs.notes && prefs.notes[noteId];
  const mode = PAPERS.includes(byNote) ? byNote : (PAPERS.includes(prefs.last) ? prefs.last : 'plain');
  els.textarea.dataset.paper = mode;
  els.paper.forEach(b => b.classList.toggle('on', b.dataset.paper === mode));
}

function setPaper(mode) {
  if (!PAPERS.includes(mode)) return;
  const prefs = readPaper();
  prefs.notes = prefs.notes || {};
  if (noteId) prefs.notes[noteId] = mode;
  prefs.last = mode;
  try { localStorage.setItem(PAPER_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  applyPaper();
}
