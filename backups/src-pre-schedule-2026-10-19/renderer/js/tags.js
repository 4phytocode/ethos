// The tag row on a note: the create panel and the reuse picker.
//
// A note holds tag *ids*. Renaming or recolouring a tag therefore shows up on
// every note using it, and the pills here are always drawn from the live tag
// list rather than from a copy stored on the note.

import * as state from './state.js';
import { notify } from './notifications.js';

let els = null;
let selectedColor = null;
let currentNoteId = null;

export function initTags() {
  els = {
    row: document.getElementById('jp-tag-row'),
    createBtn: document.getElementById('create-tag-btn'),
    useBtn: document.getElementById('use-tag-btn'),
    panel: document.getElementById('tag-panel'),
    pickPanel: document.getElementById('tag-pick-panel'),
    colors: document.getElementById('tag-colors'),
    pickList: document.getElementById('tag-pick-list'),
    nameInput: document.getElementById('tag-name-input'),
    save: document.getElementById('tag-save'),
    cancel: document.getElementById('tag-cancel'),
  };

  buildSwatches();

  els.createBtn.addEventListener('click', () => {
    const opening = !els.panel.classList.contains('open');
    if (opening) {
      els.nameInput.value = '';
      markColor(state.tagColorPalette()[0]);
    }
    openPanel(opening ? 'create' : null);
    if (opening) els.nameInput.focus();
  });

  els.useBtn.addEventListener('click', () => {
    const opening = !els.pickPanel.classList.contains('open');
    if (opening) renderPicker();
    openPanel(opening ? 'pick' : null);
  });

  els.cancel.addEventListener('click', () => openPanel(null));
  els.save.addEventListener('click', saveNewTag);
  els.nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNewTag(); });

  // Redraw whenever main-process state changes, so a tag renamed elsewhere
  // updates the pill here too.
  state.subscribe(() => { renderRow(); if (els.pickPanel.classList.contains('open')) renderPicker(); });
}

// Which note the row is editing.
export function setNote(noteId) {
  currentNoteId = noteId;
  openPanel(null);
  renderRow();
}

export function closePanels() { openPanel(null); }

// Only one panel is ever open: both sit in the flow and would otherwise stack.
function openPanel(which) {
  els.panel.classList.toggle('open', which === 'create');
  els.pickPanel.classList.toggle('open', which === 'pick');
}

function buildSwatches() {
  els.colors.innerHTML = '';
  const palette = state.tagColorPalette();
  palette.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag-color-opt';
    // Compared by data-color, never by style.background: the browser rewrites
    // an inline colour to rgb(), so comparing against the hex never matches.
    b.dataset.color = c;
    b.style.background = c;
    b.setAttribute('aria-label', 'Tag colour ' + c);
    b.addEventListener('click', () => markColor(c));
    els.colors.appendChild(b);
  });
  markColor(palette[0]);
}

function markColor(color) {
  if (!color) return;
  selectedColor = color;
  els.colors.querySelectorAll('.tag-color-opt')
    .forEach(x => x.classList.toggle('sel', x.dataset.color === color));
}

function renderRow() {
  els.row.querySelectorAll('.jp-tag-pill').forEach(el => el.remove());
  const noteObj = state.note(currentNoteId);
  for (const t of state.tagsOf(noteObj)) {
    const pill = document.createElement('span');
    pill.className = 'jp-tag-pill';
    pill.textContent = t.name;
    pill.style.background = t.color;
    els.row.insertBefore(pill, els.createBtn);
  }
  // The reuse button only means anything once a tag exists.
  els.useBtn.hidden = state.tags().length === 0;
}

function renderPicker() {
  const noteObj = state.note(currentNoteId);
  const current = new Set(noteObj ? noteObj.tagIds : []);
  els.pickList.innerHTML = '';

  if (state.tags().length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tag-pick-empty';
    empty.textContent = 'No tags yet.';
    els.pickList.appendChild(empty);
    return;
  }

  for (const t of state.tags()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag-pick-opt' + (current.has(t.id) ? ' sel' : '');
    b.textContent = t.name;
    b.style.background = t.color;
    b.addEventListener('click', () => assign(t.id));
    els.pickList.appendChild(b);
  }
}

async function assign(tagId) {
  if (!currentNoteId) return;
  try {
    // One tag per note for now, but stored as a list so many-to-many is a UI
    // change later and not another migration.
    await state.updateNote(currentNoteId, { tagIds: [tagId] });
    openPanel(null);
  } catch (err) {
    notify.error('Could not apply that tag', err.message);
  }
}

async function saveNewTag() {
  const name = els.nameInput.value.trim();
  if (!name) return;
  try {
    const tag = await state.createTag({ name, color: selectedColor });
    if (currentNoteId) await state.updateNote(currentNoteId, { tagIds: [tag.id] });
    openPanel(null);
  } catch (err) {
    notify.error('Could not save that tag', err.message);
  }
}
