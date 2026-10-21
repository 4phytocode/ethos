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
  parseTodo, parseTodoInput, parseTodoPatch,
  parseHabit, parseHabitInput, parseHabitToggle,
  ValidationError,
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

class Store {
  constructor(vault) {
    this.vault = vault;
    this.notes = [];
    this.tags = [];
    this.events = [];
    this.todos = [];
    this.habits = [];

    // Which notes still need writing, and whether tags.json, events.json,
    // todos.json or habits.json do.
    // Saves are debounced so typing does not hit the disk on every keystroke.
    this.dirtyNotes = new Set();
    this.dirtyTags = false;
    this.dirtyEvents = false;
    this.dirtyTodos = false;
    this.dirtyHabits = false;
    this.timer = null;
    this.flushing = null;
  }

  async load() {
    const state = await this.vault.load();
    this.notes = state.notes;
    this.tags = state.tags;
    this.events = state.events;
    this.todos = state.todos;
    this.habits = state.habits;
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
    };
  }

  // ─── Scheduling ───

  #touchNote(id) { this.dirtyNotes.add(id); this.#schedule(); }
  #touchTags() { this.dirtyTags = true; this.#schedule(); }
  #touchEvents() { this.dirtyEvents = true; this.#schedule(); }
  #touchTodos() { this.dirtyTodos = true; this.#schedule(); }
  #touchHabits() { this.dirtyHabits = true; this.#schedule(); }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, SAVE_DEBOUNCE_MS);
  }

  // Writes everything pending. Safe to call at any time; concurrent callers
  // share one in-flight pass so two flushes cannot interleave their writes.
  async flush() {
    if (this.flushing) return this.flushing;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }

    const notes = [...this.dirtyNotes];
    const tags = this.dirtyTags;
    const events = this.dirtyEvents;
    const todos = this.dirtyTodos;
    const habits = this.dirtyHabits;
    this.dirtyNotes.clear();
    this.dirtyTags = false;
    this.dirtyEvents = false;
    this.dirtyTodos = false;
    this.dirtyHabits = false;
    if (notes.length === 0 && !tags && !events && !todos && !habits) return;

    this.flushing = (async () => {
      try {
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
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  get hasPendingWrites() {
    return this.dirtyNotes.size > 0 || this.dirtyTags || this.dirtyEvents ||
      this.dirtyTodos || this.dirtyHabits;
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
    if (!note) throw new Error('no such note');
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
    if (!event) throw new Error('no such event');
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
      String(event.tagIds) === String(merged.tagIds);
    if (unchanged) return event;

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
      id: newId('k'), title: input.title, date: input.date, minutes: input.minutes,
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
      todo.minutes === merged.minutes && todo.done === merged.done;
    if (unchanged) return todo;

    // A different estimate or a different day is a different plan, so a
    // reminder that already fired for the old one must be allowed to fire again.
    if (todo.minutes !== merged.minutes || todo.date !== merged.date) {
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
    const sameDay = this.todos.filter(t => t.date === todo.date);
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

  // Works out when each of today's pending tasks will be finished.
  //
  // The plan starts at `now` and runs the tasks end to end in list order, so
  // finishing one early pulls everything after it forward. A task whose
  // reminder has already fired keeps its time rather than being pushed out
  // again: otherwise adding an unrelated task would quietly grant a task that
  // is already overdue a whole new estimate.
  #rechain(now) {
    const today = localISO(now);
    let cursor = now;
    for (const t of this.todos) {
      if (t.date !== today || t.done) continue;
      if (t.minutes === null) { t.dueAt = null; continue; }
      if (t.notified && t.dueAt !== null) { cursor = Math.max(cursor, t.dueAt); continue; }
      const dueAt = cursor + t.minutes * 60000;
      if (dueAt !== t.dueAt) t.notified = false;
      t.dueAt = dueAt;
      cursor = dueAt;
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
    return this.todos.some(t =>
      t.date === today && !t.done && t.dueAt !== null && !t.notified);
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
    habit.doneDates = done
      ? [...habit.doneDates, date].sort()
      : habit.doneDates.filter(d => d !== date);
    habit.updatedAt = now;
    this.#touchHabits();
    return habit;
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

module.exports = { Store, newId, localISO };
