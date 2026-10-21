// The renderer's cache of main-process state, plus the only place that calls
// across the bridge.
//
// Nothing here is authoritative. Every mutation goes to the main process and
// comes back as a fresh snapshot which replaces the cache wholesale, so the two
// cannot drift. Subscribers are told after each replacement and redraw from it.

const listeners = new Set();

let cache = { notes: [], tags: [], events: [], todos: [], habits: [] };
let tagColors = [];

export function notes() { return cache.notes; }
export function tags() { return cache.tags; }
export function events() { return cache.events; }
export function todos() { return cache.todos; }
export function habits() { return cache.habits; }
export function tagColorPalette() { return tagColors; }

export function note(noteId) { return cache.notes.find(n => n.id === noteId) || null; }
export function tag(tagId) { return cache.tags.find(t => t.id === tagId) || null; }
export function event(eventId) { return cache.events.find(e => e.id === eventId) || null; }

export function todo(todoId) { return cache.todos.find(t => t.id === todoId) || null; }
export function habit(habitId) { return cache.habits.find(h => h.id === habitId) || null; }

// A day's tasks, in the order the user arranged them.
export function todosOn(date) { return cache.todos.filter(t => t.date === date); }

// Main already returns events in chronological order, so this preserves it.
export function eventsOn(date) { return cache.events.filter(e => e.date === date); }

// Tags a note actually has, resolved from ids. An id with no tag behind it is
// dropped rather than drawn as a blank pill.
export function tagsOf(noteObj) {
  if (!noteObj) return [];
  return noteObj.tagIds.map(id => tag(id)).filter(Boolean);
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function apply(res) {
  if (res.notes) {
    cache = {
      notes: res.notes, tags: res.tags, events: res.events || [],
      todos: res.todos || [], habits: res.habits || [],
    };
  }
  for (const fn of listeners) fn(cache);
  return res;
}

// ─── Calls ───

export async function load() {
  const res = await window.ethos.loadState();
  tagColors = res.tagColors || [];
  return apply(res);
}

export const flush = () => window.ethos.flush();

export async function createNote() { return (await apply(await window.ethos.notes.create())).note; }
export async function updateNote(id, patch) { return (await apply(await window.ethos.notes.update(id, patch))).note; }
export async function removeNote(id) { await apply(await window.ethos.notes.remove(id)); }
export async function createTag(input) { return (await apply(await window.ethos.tags.create(input))).tag; }
export async function removeTag(id) { await apply(await window.ethos.tags.remove(id)); }

export async function createEvent(input) { return (await apply(await window.ethos.events.create(input))).event; }
export async function updateEvent(id, patch) { return (await apply(await window.ethos.events.update(id, patch))).event; }
export async function removeEvent(id) { await apply(await window.ethos.events.remove(id)); }

export async function createTodo(input) { return (await apply(await window.ethos.todos.create(input))).todo; }
export async function updateTodo(id, patch) { return (await apply(await window.ethos.todos.update(id, patch))).todo; }
export async function removeTodo(id) { await apply(await window.ethos.todos.remove(id)); }
export async function moveTodo(id, delta) { await apply(await window.ethos.todos.move(id, delta)); }

export async function createHabit(input) { return (await apply(await window.ethos.habits.create(input))).habit; }
export async function removeHabit(id) { await apply(await window.ethos.habits.remove(id)); }
export async function toggleHabit(id, date, done) {
  return (await apply(await window.ethos.habits.toggle(id, { date, done }))).habit;
}
