// The authoritative application state, owned by the main process.
//
// The renderer holds only a cache for drawing. Every mutation happens here,
// is validated before it lands, and returns a fresh snapshot — so the renderer
// cannot drift out of sync with what is actually on disk, which is the class of
// bug that comes from two copies of the truth.
//
// Tags are referenced by id, never copied into a note. Renaming or recolouring
// a tag therefore updates every note using it, and a rename cannot silently
// fork into a second tag. Notes carry `tagIds` as an array even though the UI
// currently shows one tag per note, so making tagging many-to-many later is a
// UI change and not a second migration.

const crypto = require('crypto');
const {
  parseNotePatch, parseTagInput, parseNote, parseTag,
  parseEvent, parseEventInput, parseEventPatch,
  parseTodo, parseTodoInput, parseTodoPatch, parseTodoPlace,
  parseHabit, parseHabitInput, parseHabitToggle,
  parseMood, parseMoodInput,
  parseFolder, parseFolderInput, parsePage, parsePageInput, parsePagePatch,
  parseGoal, parseGoalInput, parseDayNote, parseDayNoteInput, parseDayNotePatch,
  MAX_DONE_DATES, ValidationError,
} = require('./schema');
const { compareEvents } = require('./vault');

const SAVE_DEBOUNCE_MS = 500;

function newId(prefix) { return prefix + '_' + crypto.randomUUID(); }

// A local calendar day as 'YYYY-MM-DD'. Tasks belong to the user's own day, not
// to a UTC day, so this reads the local fields.
function localISO(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// When an event starts, as an epoch-ms instant in the local timezone. Null for
// an all-day event. Computed, never stored: the record keeps a calendar date.
function eventStart(e) {
  if (e.startMinute === null) return null;
  const [y, m, d] = e.date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, e.startMinute).getTime();
}

// When an event's reminder fires, or null if it has none.
function eventTrigger(e) {
  const start = eventStart(e);
  if (start === null || e.remindMinutes === null) return null;
  return start - e.remindMinutes * 60000;
}

// A reminder is still worth delivering until the event is over. One whose
// event has already ended (the app was closed through it) is dropped rather
// than announced late.
function eventEnd(e) {
  return eventStart(e) + (e.durationMinutes || 30) * 60000;
}

class Store {
  constructor(vault) {
    this.vault = vault;
    this.notes = [];
    this.tags = [];
    this.events = [];
    this.todos = [];
    this.habits = [];
    this.folders = [];
    this.pages = [];
    this.moods = [];
    this.goals = [];
    this.daynotes = [];

    // Which notes still need writing, and whether tags.json, events.json,
    // todos.json or habits.json do.
    // Saves are debounced so typing does not hit the disk on every keystroke.
    this.dirtyNotes = new Set();
    this.dirtyTags = false;
    this.dirtyEvents = false;
    this.dirtyTodos = false;
    this.dirtyHabits = false;
    this.dirtyFolders = false;
    this.dirtyMoods = false;
    this.dirtyGoals = false;
    this.dirtyDayNotes = false;
    this.dirtyPages = new Set();
    this.timer = null;
    // The tail of the write queue, and how many passes are queued or running.
    this.flushing = Promise.resolve();
    this.passes = 0;
  }

  async load() {
    const state = await this.vault.load();
    this.notes = state.notes;
    this.tags = state.tags;
    this.events = state.events;
    this.todos = state.todos;
    this.habits = state.habits;
    this.folders = state.folders || [];
    this.pages = state.pages || [];
    this.moods = state.moods || [];
    this.goals = state.goals || [];
    this.daynotes = state.daynotes || [];
    return this.snapshot();
  }

  // What the renderer gets: plain data, copied, so it cannot mutate our state
  // by holding a reference to it.
  snapshot() {
    return {
      notes: this.notes.map(n => ({ ...n, tagIds: [...n.tagIds] })),
      tags: this.tags.map(t => ({ ...t })),
      events: this.events.map(e => ({ ...e, tagIds: [...e.tagIds] })),
      todos: this.todos.map(t => ({ ...t })),
      habits: this.habits.map(h => ({ ...h, doneDates: [...h.doneDates] })),
      folders: this.folders.map(f => ({ ...f })),
      pages: this.pages.map(p => ({ ...p, links: [...p.links], tables: structuredClone(p.tables) })),
      moods: this.moods.map(m => ({ ...m })),
      goals: this.goals.map(g => ({ ...g })),
      daynotes: this.daynotes.map(d => ({ ...d, subjects: [...d.subjects] })),
    };
  }

  // ─── Scheduling ───

  #touchNote(id) { this.dirtyNotes.add(id); this.#schedule(); }
  #touchTags() { this.dirtyTags = true; this.#schedule(); }
  #touchEvents() { this.dirtyEvents = true; this.#schedule(); }
  #touchTodos() { this.dirtyTodos = true; this.#schedule(); }
  #touchHabits() { this.dirtyHabits = true; this.#schedule(); }
  #touchMoods() { this.dirtyMoods = true; this.#schedule(); }
  #touchGoals() { this.dirtyGoals = true; this.#schedule(); }
  #touchDayNotes() { this.dirtyDayNotes = true; this.#schedule(); }
  #touchFolders() { this.dirtyFolders = true; this.#schedule(); }
  #touchPage(id) { this.dirtyPages.add(id); this.#schedule(); }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
  }

  // Writes everything pending. Safe to call at any time.
  //
  // Each call queues one pass behind the passes already running, rather than
  // joining the one in flight. A pass takes the dirty flags when it starts, so
  // an edit made while a write is under way is never dropped: it is still
  // dirty, and the next pass writes it. The promise returned settles only when
  // every queued pass has finished, which is what quit waits on.
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.passes += 1;
    this.flushing = this.flushing.catch(() => {}).then(() => this.#writePass());
    return this.flushing;
  }

  // One pass. Never rejects: each failed write is put back on the dirty list,
  // so the next pass retries it.
  async #writePass() {
    try {
      const notes = [...this.dirtyNotes];
      const tags = this.dirtyTags;
      const events = this.dirtyEvents;
      const todos = this.dirtyTodos;
      const habits = this.dirtyHabits;
      const folders = this.dirtyFolders;
      const moods = this.dirtyMoods;
      const goals = this.dirtyGoals;
      const daynotes = this.dirtyDayNotes;
      const pages = [...this.dirtyPages];
      this.dirtyNotes.clear();
      this.dirtyTags = false;
      this.dirtyEvents = false;
      this.dirtyTodos = false;
      this.dirtyHabits = false;
      this.dirtyFolders = false;
      this.dirtyMoods = false;
      this.dirtyGoals = false;
      this.dirtyDayNotes = false;
      this.dirtyPages.clear();
      if (notes.length === 0 && !tags && !events && !todos && !habits &&
          !folders && !moods && !goals && !daynotes && pages.length === 0) return;

      for (const id of notes) {
        const note = this.notes.find(n => n.id === id);
        try {
          if (note) await this.vault.saveNote(note);
          else await this.vault.deleteNote(id);
        } catch (err) {
          // Keep it dirty so the next flush, or quit, tries again.
          this.dirtyNotes.add(id);
          console.error('store: failed to save note ' + id + ':', err.message);
        }
      }
      if (tags) {
        try { await this.vault.saveTags(this.tags); } catch (err) {
          this.dirtyTags = true;
          console.error('store: failed to save tags:', err.message);
        }
      }
      if (events) {
        try { await this.vault.saveEvents(this.events); } catch (err) {
          this.dirtyEvents = true;
          console.error('store: failed to save events:', err.message);
        }
      }
      if (todos) {
        try { await this.vault.saveTodos(this.todos); } catch (err) {
          this.dirtyTodos = true;
          console.error('store: failed to save todos:', err.message);
        }
      }
      if (habits) {
        try { await this.vault.saveHabits(this.habits); } catch (err) {
          this.dirtyHabits = true;
          console.error('store: failed to save habits:', err.message);
        }
      }
      if (goals) {
        try { await this.vault.saveGoals(this.goals); } catch (err) {
          this.dirtyGoals = true;
          console.error('store: failed to save goals:', err.message);
        }
      }
      if (daynotes) {
        try { await this.vault.saveDayNotes(this.daynotes); } catch (err) {
          this.dirtyDayNotes = true;
          console.error('store: failed to save day notes:', err.message);
        }
      }
      if (moods) {
        try { await this.vault.saveMoods(this.moods); } catch (err) {
          this.dirtyMoods = true;
          console.error('store: failed to save moods:', err.message);
        }
      }
      if (folders) {
        try { await this.vault.saveFolders(this.folders); } catch (err) {
          this.dirtyFolders = true;
          console.error('store: failed to save folders:', err.message);
        }
      }
      for (const id of pages) {
        const page = this.pages.find(p => p.id === id);
        try {
          if (page) await this.vault.savePage(page);
          else await this.vault.deletePage(id);
        } catch (err) {
          this.dirtyPages.add(id);
          console.error('store: failed to save page ' + id + ':', err.message);
        }
      }
    } finally {
      this.passes -= 1;
    }
  }

  // True while anything is unsaved, including a write already under way (its
  // flags were cleared when it started, so the flags alone would say "clean").
  get hasPendingWrites() {
    return this.passes > 0 || this.dirtyNotes.size > 0 || this.dirtyTags || this.dirtyEvents ||
      this.dirtyTodos || this.dirtyHabits || this.dirtyFolders || this.dirtyMoods ||
      this.dirtyGoals || this.dirtyDayNotes || this.dirtyPages.size > 0;
  }

  // Drops the pending debounce without writing. For shutdown paths that have
  // already flushed, and for tests, so a timer cannot fire after the vault
  // directory is gone.
  dispose() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  // ─── Notes ───

  createNote() {
    const now = Date.now();
    const note = parseNote({
      id: newId('n'), title: 'Untitled', content: '',
      tagIds: [], createdAt: now, updatedAt: now,
    });
    this.notes.push(note);
    this.#touchNote(note.id);
    return note;
  }

  updateNote(noteId, rawPatch) {
    const note = this.notes.find(n => n.id === noteId);
    if (!note) throw new ValidationError('no such note');
    const patch = parseNotePatch(rawPatch);

    if (patch.tagIds) {
      // Drop references to tags that no longer exist, and collapse duplicates,
      // so a stale renderer cache cannot leave a dangling id in the vault.
      const known = new Set(this.tags.map(t => t.id));
      patch.tagIds = [...new Set(patch.tagIds)].filter(id => known.has(id));
    }

    const next = { ...note, ...patch, updatedAt: Date.now() };
    // Nothing changed except the clock: skip the write entirely.
    if (note.title === next.title && note.content === next.content &&
        String(note.tagIds) === String(next.tagIds)) return note;

    Object.assign(note, next);
    this.#touchNote(note.id);
    return note;
  }

  deleteNote(noteId) {
    const i = this.notes.findIndex(n => n.id === noteId);
    if (i === -1) return false;
    this.notes.splice(i, 1);
    this.#touchNote(noteId);     // flush() turns an absent note into a delete
    return true;
  }

  // ─── Events ───

  createEvent(rawInput) {
    const input = parseEventInput(rawInput);
    const now = Date.now();
    const event = parseEvent({
      id: newId('e'),
      title: input.title,
      date: input.date,
      startMinute: input.startMinute,
      durationMinutes: input.durationMinutes,
      note: input.note,
      done: false,
      tagIds: [],
      color: input.color,
      remindMinutes: input.remindMinutes,
      notified: false,
      createdAt: now,
      updatedAt: now,
    });
    this.events.push(event);
    this.events.sort(compareEvents);
    this.#touchEvents();
    return event;
  }

  updateEvent(eventId, rawPatch) {
    const event = this.events.find(e => e.id === eventId);
    if (!event) throw new ValidationError('no such event');
    const patch = parseEventPatch(rawPatch);

    if (patch.tagIds) {
      const known = new Set(this.tags.map(t => t.id));
      patch.tagIds = [...new Set(patch.tagIds)].filter(id => known.has(id));
    }

    // Validate the whole merged record rather than the patch alone: clearing a
    // start time has to be rejected while a duration is still set, and that
    // depends on both halves.
    const merged = parseEvent({ ...event, ...patch, updatedAt: Date.now() });

    const unchanged = event.title === merged.title && event.date === merged.date &&
      event.startMinute === merged.startMinute && event.durationMinutes === merged.durationMinutes &&
      event.note === merged.note && event.done === merged.done &&
      event.color === merged.color && event.remindMinutes === merged.remindMinutes &&
      String(event.tagIds) === String(merged.tagIds);
    if (unchanged) return event;

    // A new time is a new reminder: one that already fired may fire again.
    if (eventTrigger(event) !== eventTrigger(merged)) merged.notified = false;

    Object.assign(event, merged);
    this.events.sort(compareEvents);
    this.#touchEvents();
    return event;
  }

  deleteEvent(eventId) {
    const i = this.events.findIndex(e => e.id === eventId);
    if (i === -1) return false;
    this.events.splice(i, 1);
    this.#touchEvents();
    return true;
  }

  // Events whose reminder time has arrived, that have not ended, and whose
  // reminder has not fired yet.
  dueEventReminders(now = Date.now()) {
    return this.events.filter(e => {
      if (e.done || e.notified) return false;
      const at = eventTrigger(e);
      return at !== null && at <= now && now < eventEnd(e);
    });
  }

  markEventNotified(eventId) {
    const event = this.events.find(e => e.id === eventId);
    if (!event || event.notified) return;
    event.notified = true;
    this.#touchEvents();
  }

  // ─── To-dos ───
  //
  // Every method that can change the plan takes `now` (epoch ms) so the clock
  // can be injected. The plan only exists for *today*: tasks run one after
  // another in list order starting from now, and each pending task with an
  // estimate gets a `dueAt` — when the plan says it will be finished. Tasks on
  // another day carry no `dueAt` until that day arrives.

  createTodo(rawInput, now = Date.now()) {
    const input = parseTodoInput(rawInput);
    const todo = parseTodo({
      id: newId('k'), title: input.title, kind: input.kind, date: input.date,
      minutes: input.minutes, startMinute: input.startMinute,
      done: false, dueAt: null, notified: false, createdAt: now, updatedAt: now,
    });
    this.todos.push(todo);
    this.#rechain(now);
    this.#touchTodos();
    return todo;
  }

  updateTodo(todoId, rawPatch, now = Date.now()) {
    const todo = this.todos.find(t => t.id === todoId);
    if (!todo) throw new ValidationError('no such to-do');
    const patch = parseTodoPatch(rawPatch);
    const merged = parseTodo({ ...todo, ...patch, updatedAt: now });

    const unchanged = todo.title === merged.title && todo.date === merged.date &&
      todo.minutes === merged.minutes && todo.done === merged.done &&
      todo.kind === merged.kind && todo.startMinute === merged.startMinute;
    if (unchanged) return todo;

    // A different estimate or a different day is a different plan, so a
    // reminder that already fired for the old one must be allowed to fire again.
    if (todo.minutes !== merged.minutes || todo.date !== merged.date ||
        todo.startMinute !== merged.startMinute || todo.kind !== merged.kind) {
      merged.notified = false;
      merged.dueAt = null;
    }
    Object.assign(todo, merged);
    this.#rechain(now);
    this.#touchTodos();
    return todo;
  }

  deleteTodo(todoId, now = Date.now()) {
    const i = this.todos.findIndex(t => t.id === todoId);
    if (i === -1) return false;
    this.todos.splice(i, 1);
    this.#rechain(now);
    this.#touchTodos();
    return true;
  }

  // Moves a task earlier (-1) or later (+1) among the tasks of its own day.
  moveTodo(todoId, delta, now = Date.now()) {
    if (delta !== -1 && delta !== 1) throw new ValidationError('delta must be -1 or 1');
    const todo = this.todos.find(t => t.id === todoId);
    if (!todo) throw new ValidationError('no such to-do');
    const sameDay = this.todos.filter(t => t.date === todo.date && t.kind === todo.kind);
    const at = sameDay.indexOf(todo);
    const other = sameDay[at + delta];
    if (!other) return todo;
    const a = this.todos.indexOf(todo);
    const b = this.todos.indexOf(other);
    [this.todos[a], this.todos[b]] = [this.todos[b], this.todos[a]];
    // Reordering changes who finishes when, so every pending task re-plans.
    for (const t of this.todos) {
      if (t.date === todo.date && !t.done) { t.notified = false; t.dueAt = null; }
    }
    this.#rechain(now);
    this.#touchTodos();
    return todo;
  }

  // Drag and drop: puts a to-do at `index` in its day's list of `kind`,
  // switching lists if needed. Moving into "remember" drops its times.
  placeTodo(todoId, rawPlace, now = Date.now()) {
    const todo = this.todos.find(t => t.id === todoId);
    if (!todo) throw new ValidationError('no such to-do');
    const { kind, index } = parseTodoPlace(rawPlace);
    this.todos.splice(this.todos.indexOf(todo), 1);
    if (kind !== todo.kind) {
      Object.assign(todo, parseTodo({ ...todo, kind, updatedAt: now }));
    }
    const peers = this.todos.filter(t => t.date === todo.date && t.kind === kind);
    const before = peers[index];
    if (before) this.todos.splice(this.todos.indexOf(before), 0, todo);
    else if (peers.length) this.todos.splice(this.todos.indexOf(peers[peers.length - 1]) + 1, 0, todo);
    else this.todos.push(todo);
    todo.updatedAt = now;
    for (const t of this.todos) {
      if (t.date === todo.date && !t.done) { t.notified = false; t.dueAt = null; }
    }
    this.#rechain(now);
    this.#touchTodos();
    return todo;
  }

  // Works out when each of today's pending tasks will be finished.
  //
  // The plan starts at `now` and runs the tasks end to end in list order, so
  // finishing one early pulls everything after it forward. A task whose
  // reminder has already fired keeps its time rather than being pushed out
  // again: otherwise adding an unrelated task would quietly grant a task that
  // is already overdue a whole new estimate.
  //
  // A task pinned to a time (`startMinute`) runs from that time, and the
  // unpinned tasks flow around it: one that would overlap a pinned block is
  // pushed to just after it. "Remember" items are never planned.
  #rechain(now) {
    const today = localISO(now);
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const pinnedStart = (t) => midnight.getTime() + t.startMinute * 60000;
    const setDue = (t, dueAt) => { if (dueAt !== t.dueAt) t.notified = false; t.dueAt = dueAt; };

    const mine = this.todos.filter(t => t.date === today && !t.done && t.kind === 'task');
    // Pinned blocks first: their times do not depend on anything else.
    const blocks = [];
    for (const t of mine) {
      if (t.startMinute === null) continue;
      if (t.minutes === null) { t.dueAt = null; continue; }
      if (!(t.notified && t.dueAt !== null)) setDue(t, pinnedStart(t) + t.minutes * 60000);
      blocks.push([t.dueAt - t.minutes * 60000, t.dueAt]);
    }
    let cursor = now;
    for (const t of mine) {
      if (t.startMinute !== null) continue;
      if (t.minutes === null) { t.dueAt = null; continue; }
      if (t.notified && t.dueAt !== null) { cursor = Math.max(cursor, t.dueAt); continue; }
      const len = t.minutes * 60000;
      let start = cursor;
      for (let moved = true; moved;) {
        moved = false;
        for (const [s, e] of blocks) {
          if (s < start + len && e > start) { start = e; moved = true; }
        }
      }
      setDue(t, start + len);
      cursor = start + len;
    }
    this.#touchTodos();
  }

  // Called on a timer and at start-up: a task planned for a day that has since
  // arrived has no finish time yet, and this gives it one.
  ensurePlan(now = Date.now()) {
    const today = localISO(now);
    const stale = this.todos.some(t =>
      t.date === today && !t.done && t.minutes !== null && t.dueAt === null);
    if (stale) this.#rechain(now);
  }

  // Tasks whose planned finish has arrived and whose reminder has not fired.
  dueReminders(now = Date.now()) {
    const today = localISO(now);
    return this.todos.filter(t =>
      t.date === today && !t.done && t.dueAt !== null && t.dueAt <= now && !t.notified);
  }

  markNotified(todoId) {
    const todo = this.todos.find(t => t.id === todoId);
    if (!todo || todo.notified) return;
    todo.notified = true;
    this.#touchTodos();
  }

  // Is there still a reminder to deliver today? Decides whether the app has a
  // reason to keep running once its window is closed.
  hasUpcomingReminders(now = Date.now()) {
    const today = localISO(now);
    if (this.todos.some(t =>
      t.date === today && !t.done && t.dueAt !== null && !t.notified)) return true;
    // An event reminder still to come today also keeps the app alive.
    return this.events.some(e => {
      if (e.done || e.notified) return false;
      const at = eventTrigger(e);
      return at !== null && now < eventEnd(e) && localISO(at) <= today;
    });
  }

  // ─── Notes section: folders and pages ───

  createFolder(rawInput, now = Date.now()) {
    const input = parseFolderInput(rawInput);
    const folder = parseFolder({ id: newId('f'), name: input.name, createdAt: now, updatedAt: now });
    this.folders.push(folder);
    this.#touchFolders();
    return folder;
  }

  renameFolder(folderId, rawInput, now = Date.now()) {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) throw new ValidationError('no such folder');
    const { name } = parseFolderInput(rawInput);
    if (name === folder.name) return folder;
    folder.name = name;
    folder.updatedAt = now;
    this.#touchFolders();
    return folder;
  }

  // Deleting a folder never deletes its pages: they become unfiled.
  deleteFolder(folderId, now = Date.now()) {
    const i = this.folders.findIndex(f => f.id === folderId);
    if (i === -1) return false;
    this.folders.splice(i, 1);
    this.#touchFolders();
    for (const page of this.pages) {
      if (page.folderId === folderId) {
        page.folderId = null;
        page.updatedAt = now;
        this.#touchPage(page.id);
      }
    }
    return true;
  }

  #knownFolder(folderId) {
    if (folderId !== null && !this.folders.some(f => f.id === folderId)) {
      throw new ValidationError('no such folder');
    }
  }

  createPage(rawInput, now = Date.now()) {
    const input = parsePageInput(rawInput);
    this.#knownFolder(input.folderId);
    const page = parsePage({
      id: newId('p'), title: '', content: '', folderId: input.folderId,
      temporary: input.temporary, links: [], createdAt: now, updatedAt: now,
    });
    this.pages.push(page);
    this.#touchPage(page.id);
    return page;
  }

  updatePage(pageId, rawPatch, now = Date.now()) {
    const page = this.pages.find(p => p.id === pageId);
    if (!page) throw new ValidationError('no such page');
    const patch = parsePagePatch(rawPatch);
    if ('folderId' in patch) this.#knownFolder(patch.folderId);
    if (patch.links) {
      // Like tag ids on a note: a stale renderer cache must not leave a link to
      // a page that is gone. parsePage below drops a link to itself.
      const known = new Set(this.pages.map(p => p.id));
      patch.links = patch.links.filter(l => known.has(l));
    }
    const merged = parsePage({ ...page, ...patch, updatedAt: now });
    const sameBody = page.title === merged.title && page.content === merged.content &&
        page.folderId === merged.folderId && page.temporary === merged.temporary &&
        String(page.links) === String(merged.links) &&
        JSON.stringify(page.tables) === JSON.stringify(merged.tables);
    if (sameBody && page.pinned === merged.pinned) return page;
    // Pinning is not an edit: it must not move the note up "Recent".
    if (sameBody) merged.updatedAt = page.updatedAt;
    Object.assign(page, merged);
    this.#touchPage(page.id);
    return page;
  }

  deletePage(pageId, now = Date.now()) {
    const i = this.pages.findIndex(p => p.id === pageId);
    if (i === -1) return false;
    this.pages.splice(i, 1);
    this.#touchPage(pageId);
    // Drop every link that pointed at it, so no page keeps a dangling edge.
    for (const page of this.pages) {
      if (page.links.includes(pageId)) {
        page.links = page.links.filter(l => l !== pageId);
        page.updatedAt = now;
        this.#touchPage(page.id);
      }
    }
    return true;
  }

  // ─── Habits ───

  createHabit(rawInput, now = Date.now()) {
    const input = parseHabitInput(rawInput);
    const habit = parseHabit({
      id: newId('h'), name: input.name, doneDates: [], createdAt: now, updatedAt: now,
    });
    this.habits.push(habit);
    this.#touchHabits();
    return habit;
  }

  deleteHabit(habitId) {
    const i = this.habits.findIndex(h => h.id === habitId);
    if (i === -1) return false;
    this.habits.splice(i, 1);
    this.#touchHabits();
    return true;
  }

  // Ticks a habit on or off for one day. A habit cannot be ticked for a day
  // that has not happened yet: that would make the grid claim work not done.
  toggleHabit(habitId, rawToggle, now = Date.now()) {
    const habit = this.habits.find(h => h.id === habitId);
    if (!habit) throw new ValidationError('no such habit');
    const { date, done } = parseHabitToggle(rawToggle);
    if (date > localISO(now)) throw new ValidationError('that day has not happened yet');

    const has = habit.doneDates.includes(date);
    if (done === has) return habit;
    // parseHabit refuses a habit over the cap on load, and the whole habit is
    // dropped with it, so refuse the tick that would cross the line here.
    if (done && habit.doneDates.length >= MAX_DONE_DATES) {
      throw new ValidationError('habit has too many completed days');
    }
    habit.doneDates = done
      ? [...habit.doneDates, date].sort()
      : habit.doneDates.filter(d => d !== date);
    habit.updatedAt = now;
    this.#touchHabits();
    return habit;
  }

  // ─── Moods ───

  // One check-in per day: logging again the same day replaces it. A future day
  // cannot be logged, for the same reason a habit cannot.
  setMood(rawInput, now = Date.now()) {
    const input = parseMoodInput(rawInput);
    if (input.date > localISO(now)) throw new ValidationError('that day has not happened yet');
    const existing = this.moods.find(m => m.date === input.date);
    if (existing) {
      existing.feeling = input.feeling;
      existing.text = input.text;
      existing.updatedAt = now;
      this.#touchMoods();
      return existing;
    }
    const mood = parseMood({ id: newId('m'), ...input, createdAt: now, updatedAt: now });
    this.moods.push(mood);
    this.moods.sort((a, b) => (a.date < b.date ? -1 : 1));
    this.#touchMoods();
    return mood;
  }

  // ─── Goals ───

  // One goal per horizon. Empty text clears that horizon; a new text replaces
  // the old goal and starts it afresh (not done, new createdAt), because a new
  // goal is a new commitment rather than an edit of the last one.
  setGoal(rawInput, now = Date.now()) {
    const input = parseGoalInput(rawInput);
    const i = this.goals.findIndex(g => g.horizon === input.horizon);
    const existing = i === -1 ? null : this.goals[i];
    if ('text' in input && !input.text) {
      if (existing) { this.goals.splice(i, 1); this.#touchGoals(); }
      return null;
    }
    if (!existing) {
      if (!input.text) throw new ValidationError('no goal set for that horizon');
      const goal = parseGoal({ id: newId('g'), horizon: input.horizon, text: input.text,
        done: input.done === true, createdAt: now, updatedAt: now });
      this.goals.push(goal);
      this.#touchGoals();
      return goal;
    }
    if ('text' in input && input.text !== existing.text) {
      existing.text = input.text;
      existing.done = false;
      existing.createdAt = now;
    }
    if ('done' in input) existing.done = input.done;
    existing.updatedAt = now;
    this.#touchGoals();
    return existing;
  }

  // ─── Day notes ───

  #sortDayNotes() {
    this.daynotes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  }

  createDayNote(rawInput, now = Date.now()) {
    const input = parseDayNoteInput(rawInput);
    const note = parseDayNote({ id: newId('d'), ...input, done: false, createdAt: now, updatedAt: now });
    this.daynotes.push(note);
    this.#sortDayNotes();
    this.#touchDayNotes();
    return note;
  }

  updateDayNote(noteId, rawPatch, now = Date.now()) {
    const note = this.daynotes.find(d => d.id === noteId);
    if (!note) throw new ValidationError('no such day note');
    const patch = parseDayNotePatch(rawPatch);
    Object.assign(note, patch, { updatedAt: now });
    if ('date' in patch) this.#sortDayNotes();
    this.#touchDayNotes();
    return note;
  }

  deleteDayNote(noteId) {
    const i = this.daynotes.findIndex(d => d.id === noteId);
    if (i === -1) return false;
    this.daynotes.splice(i, 1);
    this.#touchDayNotes();
    return true;
  }

  // ─── Tags ───

  createTag(rawInput) {
    const input = parseTagInput(rawInput);
    // One tag per name, compared case-insensitively. Re-saving an existing name
    // recolours it rather than creating a near-duplicate.
    const existing = this.tags.find(t => t.name.toLowerCase() === input.name.toLowerCase());
    if (existing) {
      if (existing.color !== input.color) { existing.color = input.color; this.#touchTags(); }
      return existing;
    }
    const tag = parseTag({
      id: newId('t'), name: input.name, color: input.color, createdAt: Date.now(),
    });
    this.tags.push(tag);
    this.#touchTags();
    return tag;
  }

  deleteTag(tagId) {
    const i = this.tags.findIndex(t => t.id === tagId);
    if (i === -1) return false;
    this.tags.splice(i, 1);
    this.#touchTags();
    // Drop the reference everywhere it was used, notes and events alike.
    for (const note of this.notes) {
      if (note.tagIds.includes(tagId)) {
        note.tagIds = note.tagIds.filter(id => id !== tagId);
        note.updatedAt = Date.now();
        this.#touchNote(note.id);
      }
    }
    for (const event of this.events) {
      if (event.tagIds.includes(tagId)) {
        event.tagIds = event.tagIds.filter(id => id !== tagId);
        event.updatedAt = Date.now();
        this.#touchEvents();
      }
    }
    return true;
  }
}

module.exports = { Store, newId, localISO, eventStart, eventTrigger };
