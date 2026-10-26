// Day notes on the schedule: a note on one day, filed under a section
// ("Studies", "Work", ...) with the subjects for that day. Built for revision
// timetables: put "Studies: Maths, Chemistry" on each day and the plan reads
// straight off the calendar.
//
// The schedule draws the chips (dnChip) and calls renderDayRail for the rail;
// this module owns the editor window and the rail panel. Every field saves as
// it changes, like the event editor. A new note dismissed with nothing in it
// is deleted again.

import * as state from './state.js';
import { notify } from './notifications.js';
import { confirmDialog } from './dialog.js';

const TYPING_SAVE_MS = 400;
const SECTION_KEY = 'ethos.daynotes.section';
const PLAN_KEY = 'ethos.daynotes.plan';
const PLAN_DAYS = 14;
const DEFAULT_SECTION = 'Studies';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function dayLabel(date) {
  const d = fromISO(date);
  const today = iso(new Date());
  const tomorrow = iso(new Date(Date.now() + 86400000));
  if (date === today) return 'Today';
  if (date === tomorrow) return 'Tomorrow';
  return WEEKDAYS[(d.getDay() + 6) % 7] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
}

// A subject keeps one colour everywhere it appears, so "Maths" is the same
// colour on every day of the timetable. Always a palette colour: it is written
// into a style property.
function hueOf(name) {
  const palette = state.tagColorPalette();
  if (!palette.length) return null;
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function subjectChip(name, onRemove) {
  const c = el('span', 'dn-subject');
  const hue = hueOf(name);
  if (hue) c.style.setProperty('--sub', hue);
  c.append(el('span', null, name));
  if (onRemove) {
    const x = el('button', 'dn-subject-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + name);
    x.addEventListener('click', onRemove);
    c.append(x);
  }
  return c;
}

export function sections() {
  const seen = new Map();
  for (const n of state.dayNotes()) if (!seen.has(n.section.toLowerCase())) seen.set(n.section.toLowerCase(), n.section);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

function lastSection() {
  try { return localStorage.getItem(SECTION_KEY) || DEFAULT_SECTION; } catch { return DEFAULT_SECTION; }
}
function rememberSection(s) {
  try { localStorage.setItem(SECTION_KEY, s); } catch { /* not fatal */ }
}

// ─── Chip, for the schedule's grid ───

export function dnChip(note) {
  const c = el('div', 'sc-chip dn-chip' + (note.done ? ' done' : ''));
  c.tabIndex = 0;
  const first = note.subjects[0];
  const hue = first && hueOf(first);
  if (hue) c.style.setProperty('--ev', hue);
  const text = note.section + (note.subjects.length ? ': ' + note.subjects.join(', ') : note.text ? ': ' + note.text.split('\n')[0] : '');
  c.append(el('span', 'dn-chip-text', text));
  c.title = text;
  // The grid starts drags on pointerdown; a note is not an event.
  c.addEventListener('pointerdown', (e) => e.stopPropagation());
  c.addEventListener('click', (e) => { e.stopPropagation(); openDayNote(note.id); });
  c.addEventListener('keydown', (k) => { if (k.key === 'Enter') openDayNote(note.id); });
  return c;
}

// ─── Editor ───

const ed = { id: null, fresh: false, textTimer: 0 };
let scrim = null;

export async function addDayNote(date) {
  try {
    const note = await state.createDayNote({ date, section: lastSection() });
    openDayNote(note.id, { fresh: true });
  } catch (err) {
    notify.error('Could not add the note', err.message);
  }
}

export function openDayNote(id, { fresh = false } = {}) {
  closeDayNote();
  const note = state.dayNote(id);
  if (!note) return;
  ed.id = id;
  ed.fresh = fresh;
  const previous = document.activeElement;

  scrim = el('div', 'dlg-scrim');
  const win = el('div', 'win dlg dn-win');
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-modal', 'true');
  win.setAttribute('aria-labelledby', 'dn-win-title');

  const bar = el('div', 'win-title');
  const title = el('span', 'win-title-text', 'Day note');
  title.id = 'dn-win-title';
  const close = el('button', 'win-btn', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => closeDayNote());
  bar.append(title, close);

  const body = el('div', 'win-body dn-body');

  const dateRow = el('label', 'dn-row');
  dateRow.append(el('span', 'dn-label', 'Day'));
  const fDate = el('input', 'dn-field');
  fDate.type = 'date';
  fDate.value = note.date;
  fDate.addEventListener('change', () => { if (fDate.value) save({ date: fDate.value }); });
  dateRow.append(fDate);

  const secRow = el('label', 'dn-row');
  secRow.append(el('span', 'dn-label', 'Section'));
  const fSection = el('input', 'dn-field');
  fSection.type = 'text';
  fSection.maxLength = 40;
  fSection.value = note.section;
  fSection.setAttribute('list', 'dn-sections');
  const dl = el('datalist');
  dl.id = 'dn-sections';
  for (const s of new Set([DEFAULT_SECTION, ...sections()])) { const o = el('option'); o.value = s; dl.append(o); }
  fSection.addEventListener('change', () => {
    const v = fSection.value.trim() || 'General';
    rememberSection(v);
    save({ section: v });
  });
  secRow.append(fSection, dl);

  const subWrap = el('div', 'dn-row dn-subjects-row');
  subWrap.append(el('span', 'dn-label', 'Subjects'));
  const subBox = el('div', 'dn-subjects');
  const fSubject = el('input', 'dn-subject-input');
  fSubject.type = 'text';
  fSubject.maxLength = 40;
  fSubject.placeholder = 'Type a subject, Enter';
  fSubject.setAttribute('aria-label', 'Add a subject');
  fSubject.setAttribute('list', 'dn-known-subjects');
  const known = el('datalist');
  known.id = 'dn-known-subjects';
  const allSubjects = new Set(state.dayNotes().flatMap(n => n.subjects));
  for (const s of [...allSubjects].sort()) { const o = el('option'); o.value = s; known.append(o); }
  // The editor keeps its own list and sends the whole of it each time. Building
  // from the cache would lose a subject added before the last save came back.
  const subs = [...note.subjects];
  const drawSubjects = () => {
    subBox.replaceChildren(...subs.map((s, i) => subjectChip(s, () => {
      subs.splice(i, 1);
      drawSubjects();
      save({ subjects: [...subs] });
    })), fSubject);
  };
  fSubject.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && fSubject.value.trim()) {
      e.preventDefault();
      const v = fSubject.value.trim().slice(0, 40);
      fSubject.value = '';
      if (subs.length < 20 && !subs.some(x => x.toLowerCase() === v.toLowerCase())) subs.push(v);
      drawSubjects();
      fSubject.focus();
      save({ subjects: [...subs] });
    } else if (e.key === 'Backspace' && !fSubject.value && subs.length) {
      subs.pop();
      drawSubjects();
      fSubject.focus();
      save({ subjects: [...subs] });
    }
  });
  subWrap.append(subBox, known);

  const fText = el('textarea', 'dn-text');
  fText.rows = 4;
  fText.maxLength = 2000;
  fText.placeholder = 'Notes for the day: chapters, past papers, anything.';
  fText.value = note.text;
  fText.addEventListener('input', () => {
    clearTimeout(ed.textTimer);
    ed.textTimer = setTimeout(() => save({ text: fText.value }), TYPING_SAVE_MS);
  });

  const foot = el('div', 'dlg-buttons dn-foot');
  const fDone = el('button', null, note.done ? 'Done ✓' : 'Mark done');
  fDone.type = 'button';
  fDone.setAttribute('aria-pressed', String(note.done));
  fDone.addEventListener('click', async () => {
    const n = state.dayNote(ed.id);
    if (!n) return;
    await save({ done: !n.done });
    const m = state.dayNote(ed.id);
    if (m) { fDone.textContent = m.done ? 'Done ✓' : 'Mark done'; fDone.setAttribute('aria-pressed', String(m.done)); }
  });
  const fDelete = el('button', 'danger', 'Delete');
  fDelete.type = 'button';
  fDelete.addEventListener('click', () => removeNote(ed.id));
  const ok = el('button', 'primary', 'Close');
  ok.type = 'button';
  ok.addEventListener('click', () => closeDayNote());
  foot.append(fDone, fDelete, ok);

  body.append(dateRow, secRow, subWrap, fText, foot);
  win.append(bar, body);
  scrim.append(win);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeDayNote(); });
  win.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDayNote(); }
  });
  scrim._restore = previous;
  scrim._flush = () => {
    clearTimeout(ed.textTimer);
    const n = state.dayNote(ed.id);
    return n && fText.value !== n.text ? save({ text: fText.value }) : Promise.resolve();
  };
  document.body.append(scrim);
  drawSubjects();
  (fresh ? fSubject : fText).focus();
}

async function save(patch) {
  if (!ed.id) return;
  ed.fresh = false;
  try { await state.updateDayNote(ed.id, patch); } catch (err) {
    notify.error('Could not save the note', err.message);
  }
}

async function removeNote(id) {
  const note = state.dayNote(id);
  if (!note) return;
  closeDayNote({ keep: true });
  const sure = await confirmDialog({ title: 'Delete note', message: 'Delete this ' + note.section + ' note for ' +
    dayLabel(note.date) + '?', okLabel: 'Delete', danger: true });
  if (!sure) return;
  try {
    await state.removeDayNote(id);
    notify.info('Note deleted', note.section + ', ' + dayLabel(note.date));
  } catch (err) { notify.error('Could not delete the note', err.message); }
}

export function closeDayNote({ keep = false } = {}) {
  if (!scrim) return;
  const s = scrim;
  scrim = null;
  const id = ed.id, fresh = ed.fresh;
  ed.id = null;
  const done = s._flush();
  s.remove();
  if (s._restore && s._restore.isConnected) s._restore.focus();
  // An untouched new note is rubbed out, like an unnamed event.
  const n = state.dayNote(id);
  if (!keep && fresh && n && !n.subjects.length && !n.text.trim()) {
    done.then(() => state.removeDayNote(id)).catch(() => {});
  }
}

// ─── Rail: the selected day, and the plan ahead for one section ───

let railDay, railPlan;

function noteRow(note, withDate) {
  const b = el('button', 'dn-item' + (note.done ? ' done' : ''));
  b.type = 'button';
  const head = el('span', 'dn-item-head');
  head.append(el('span', 'dn-item-section', withDate ? dayLabel(note.date) : note.section));
  if (note.done) head.append(el('span', 'dn-item-done', 'done'));
  b.append(head);
  if (note.subjects.length) {
    const subs = el('span', 'dn-item-subjects');
    for (const s of note.subjects) subs.append(subjectChip(s, null));
    b.append(subs);
  }
  if (note.text.trim()) b.append(el('span', 'dn-item-text', note.text.trim().split('\n')[0]));
  b.addEventListener('click', () => openDayNote(note.id));
  return b;
}

function planSection() {
  try { return localStorage.getItem(PLAN_KEY) || ''; } catch { return ''; }
}

export function renderDayRail(date) {
  if (!railDay) return;
  railDay.replaceChildren();
  const head = el('div', 'dn-rail-head');
  head.append(el('h2', 'sc-rail-head', 'Notes · ' + dayLabel(date)));
  const add = el('button', 'dn-rail-add', '+ Add');
  add.type = 'button';
  add.title = 'Add a note to this day';
  add.addEventListener('click', () => addDayNote(date));
  head.append(add);
  railDay.append(head);
  const notes = state.dayNotesOn(date);
  if (!notes.length) railDay.append(el('p', 'sc-agenda-empty', 'Nothing noted for this day.'));
  for (const n of notes) railDay.append(noteRow(n, false));

  // The next two weeks of one section: the revision timetable at a glance.
  railPlan.replaceChildren();
  const all = sections();
  if (!all.length) return;
  let sec = planSection();
  if (!all.some(s => s.toLowerCase() === sec.toLowerCase())) sec = all.includes(DEFAULT_SECTION) ? DEFAULT_SECTION : all[0];
  const phead = el('div', 'dn-rail-head');
  phead.append(el('h2', 'sc-rail-head', 'Next ' + PLAN_DAYS + ' days'));
  const pick = el('select', 'dn-plan-pick');
  pick.setAttribute('aria-label', 'Section to plan');
  for (const s of all) { const o = el('option', null, s); o.value = s; pick.append(o); }
  pick.value = sec;
  pick.addEventListener('change', () => {
    try { localStorage.setItem(PLAN_KEY, pick.value); } catch { /* not fatal */ }
    renderDayRail(date);
  });
  phead.append(pick);
  railPlan.append(phead);
  const from = iso(new Date());
  const to = iso(new Date(Date.now() + (PLAN_DAYS - 1) * 86400000));
  const ahead = state.dayNotes().filter(n => n.section.toLowerCase() === sec.toLowerCase() && n.date >= from && n.date <= to);
  if (!ahead.length) railPlan.append(el('p', 'sc-agenda-empty', 'Nothing planned for ' + sec + '.'));
  for (const n of ahead) railPlan.append(noteRow(n, true));
  // How much of the plan is done so far.
  const past = ahead.length;
  if (past) {
    const doneN = ahead.filter(n => n.done).length;
    const bar = el('div', 'progress dn-plan-bar');
    bar.title = doneN + ' of ' + past + ' done';
    const fill = el('i');
    fill.style.setProperty('--p', Math.round(doneN / past * 100) + '%');
    bar.append(fill);
    railPlan.append(bar, el('p', 'dn-plan-stat', doneN + ' of ' + past + ' done'));
  }
}

export function initDayNotes() {
  railDay = document.getElementById('dn-rail-day');
  railPlan = document.getElementById('dn-rail-plan');
}

// Saves the open editor's text, for the close handshake.
export function commitDayNote() {
  return scrim ? scrim._flush() : Promise.resolve();
}
