// Validation and migration for everything that comes off disk or in over IPC.
//
// Hand-written on purpose: the checks are small, they add no dependencies to a
// product that will ship paid builds, and a validator we own cannot be replaced
// by a compromised package. Every value that crosses a boundary goes through
// here, so a corrupt vault file or a malformed IPC call fails at one known
// place instead of turning into `undefined` three layers deeper.

const SCHEMA_VERSION = 3;

const TAG_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316',
];

const MAX_TITLE = 200;
const MAX_TAG_NAME = 24;
const MAX_CONTENT = 2 * 1024 * 1024;   // 2MB of text per note
const MAX_TAGS_PER_NOTE = 32;
const MAX_EVENT_NOTE = 2000;
const MINUTES_IN_DAY = 24 * 60;
const MAX_HABIT_NAME = 60;
const MAX_DONE_DATES = 4000;

class ValidationError extends Error {}

function fail(what) { throw new ValidationError(what); }

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── Field helpers ───

function str(v, field, max, { trim = true } = {}) {
  if (typeof v !== 'string') fail(field + ' must be a string');
  const out = trim ? v.trim() : v;
  if (out.length > max) fail(field + ' is longer than ' + max + ' characters');
  return out;
}

function id(v, field, prefix) {
  if (typeof v !== 'string') fail(field + ' must be a string');
  // Our own ids only: prefix plus a uuid. Rejecting anything else keeps ids
  // safe to use as filenames later on.
  if (!new RegExp('^' + prefix + '_[0-9a-f-]{36}$').test(v)) fail(field + ' is not a valid id');
  return v;
}

function timestamp(v, field) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) fail(field + ' must be a timestamp');
  return v;
}

function int(v, field, min, max) {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(field + ' must be a whole number');
  if (v < min || v > max) fail(field + ' must be between ' + min + ' and ' + max);
  return v;
}

// A calendar date, not an instant: 'YYYY-MM-DD' in the user's own local
// calendar. Storing a timestamp instead would make an event drift across a
// day boundary when the machine's timezone changes, which for a planner is a
// correctness bug rather than a rounding detail.
function isoDate(v, field) {
  if (typeof v !== 'string') fail(field + ' must be a string');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v)) fail(field + ' must look like YYYY-MM-DD');
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12) fail(field + ' has a month outside 1-12');
  // Round-trip through UTC to reject 2025-02-30 and friends.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    fail(field + ' is not a real date');
  }
  return v;
}

function color(v, field) {
  if (typeof v !== 'string') fail(field + ' must be a string');
  // Restricted to the palette: a tag colour is written straight into a style
  // property, so it must never be able to carry arbitrary CSS.
  if (!TAG_COLORS.includes(v)) fail(field + ' is not one of the allowed tag colours');
  return v;
}

// ─── Entities ───

function parseTag(raw) {
  if (!isPlainObject(raw)) fail('tag must be an object');
  const name = str(raw.name, 'tag.name', MAX_TAG_NAME);
  if (!name) fail('tag.name cannot be empty');
  return {
    id: id(raw.id, 'tag.id', 't'),
    name,
    color: color(raw.color, 'tag.color'),
    createdAt: timestamp(raw.createdAt, 'tag.createdAt'),
  };
}

function parseNote(raw) {
  if (!isPlainObject(raw)) fail('note must be an object');
  if (!Array.isArray(raw.tagIds)) fail('note.tagIds must be an array');
  if (raw.tagIds.length > MAX_TAGS_PER_NOTE) fail('note has too many tags');
  return {
    id: id(raw.id, 'note.id', 'n'),
    title: str(raw.title, 'note.title', MAX_TITLE) || 'Untitled',
    content: str(raw.content, 'note.content', MAX_CONTENT, { trim: false }),
    tagIds: raw.tagIds.map((t, i) => id(t, 'note.tagIds[' + i + ']', 't')),
    createdAt: timestamp(raw.createdAt, 'note.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'note.updatedAt'),
  };
}

// A scheduled event. `startMinute` null means all-day; a timed event may also
// have a duration. Minutes-from-midnight rather than a time string so sorting
// and overlap checks are plain arithmetic.
function parseEvent(raw) {
  if (!isPlainObject(raw)) fail('event must be an object');
  if (!Array.isArray(raw.tagIds)) fail('event.tagIds must be an array');
  if (raw.tagIds.length > MAX_TAGS_PER_NOTE) fail('event has too many tags');

  const startMinute = raw.startMinute === null || raw.startMinute === undefined
    ? null : int(raw.startMinute, 'event.startMinute', 0, MINUTES_IN_DAY - 1);
  const durationMinutes = raw.durationMinutes === null || raw.durationMinutes === undefined
    ? null : int(raw.durationMinutes, 'event.durationMinutes', 1, MINUTES_IN_DAY);
  // A duration without a start has nothing to measure from.
  if (startMinute === null && durationMinutes !== null) {
    fail('an all-day event cannot have a duration');
  }

  const title = str(raw.title, 'event.title', MAX_TITLE) || 'Untitled';
  return {
    id: id(raw.id, 'event.id', 'e'),
    title,
    date: isoDate(raw.date, 'event.date'),
    startMinute,
    durationMinutes,
    note: str(raw.note === undefined ? '' : raw.note, 'event.note', MAX_EVENT_NOTE, { trim: false }),
    done: raw.done === true,
    tagIds: raw.tagIds.map((t, i) => id(t, 'event.tagIds[' + i + ']', 't')),
    createdAt: timestamp(raw.createdAt, 'event.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'event.updatedAt'),
  };
}

// ─── To-dos ───
// A task for one calendar day. `minutes` is the user's estimate of how long it
// takes (null = no estimate). `dueAt` is the time the plan says it will be
// finished, as an epoch-ms instant, set by the store when it works the plan out;
// it is never supplied by the renderer. `notified` records that its reminder
// has already fired, so a restart cannot fire it twice.
function parseTodo(raw) {
  if (!isPlainObject(raw)) fail('todo must be an object');
  const minutes = raw.minutes === null || raw.minutes === undefined
    ? null : int(raw.minutes, 'todo.minutes', 1, MINUTES_IN_DAY);
  const dueAt = raw.dueAt === null || raw.dueAt === undefined
    ? null : timestamp(raw.dueAt, 'todo.dueAt');
  const title = str(raw.title, 'todo.title', MAX_TITLE);
  if (!title) fail('todo.title cannot be empty');
  return {
    id: id(raw.id, 'todo.id', 'k'),
    title,
    date: isoDate(raw.date, 'todo.date'),
    minutes,
    done: raw.done === true,
    dueAt,
    notified: raw.notified === true,
    createdAt: timestamp(raw.createdAt, 'todo.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'todo.updatedAt'),
  };
}

function parseTodoInput(raw) {
  if (!isPlainObject(raw)) fail('todo input must be an object');
  const title = str(raw.title === undefined ? '' : raw.title, 'title', MAX_TITLE);
  if (!title) fail('title cannot be empty');
  return {
    title,
    date: isoDate(raw.date, 'date'),
    minutes: raw.minutes === null || raw.minutes === undefined
      ? null : int(raw.minutes, 'minutes', 1, MINUTES_IN_DAY),
  };
}

function parseTodoPatch(raw) {
  if (!isPlainObject(raw)) fail('patch must be an object');
  const patch = {};
  if ('title' in raw) {
    patch.title = str(raw.title, 'patch.title', MAX_TITLE);
    if (!patch.title) fail('patch.title cannot be empty');
  }
  if ('date' in raw) patch.date = isoDate(raw.date, 'patch.date');
  if ('minutes' in raw) {
    patch.minutes = raw.minutes === null
      ? null : int(raw.minutes, 'patch.minutes', 1, MINUTES_IN_DAY);
  }
  if ('done' in raw) {
    if (typeof raw.done !== 'boolean') fail('patch.done must be true or false');
    patch.done = raw.done;
  }
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

// ─── Habits ───
// `doneDates` is every calendar day the habit was ticked off, as sorted,
// de-duplicated 'YYYY-MM-DD' strings.
function parseHabit(raw) {
  if (!isPlainObject(raw)) fail('habit must be an object');
  if (!Array.isArray(raw.doneDates)) fail('habit.doneDates must be an array');
  if (raw.doneDates.length > MAX_DONE_DATES) fail('habit has too many completed days');
  const name = str(raw.name, 'habit.name', MAX_HABIT_NAME);
  if (!name) fail('habit.name cannot be empty');
  const dates = [...new Set(raw.doneDates.map((d, i) => isoDate(d, 'habit.doneDates[' + i + ']')))].sort();
  return {
    id: id(raw.id, 'habit.id', 'h'),
    name,
    doneDates: dates,
    createdAt: timestamp(raw.createdAt, 'habit.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'habit.updatedAt'),
  };
}

function parseHabitInput(raw) {
  if (!isPlainObject(raw)) fail('habit input must be an object');
  const name = str(raw.name === undefined ? '' : raw.name, 'name', MAX_HABIT_NAME);
  if (!name) fail('name cannot be empty');
  return { name };
}

function parseHabitToggle(raw) {
  if (!isPlainObject(raw)) fail('toggle must be an object');
  if (typeof raw.done !== 'boolean') fail('done must be true or false');
  return { date: isoDate(raw.date, 'date'), done: raw.done };
}

// ─── IPC payloads ───
// Separate from the entity parsers: a caller supplies only the editable fields,
// never ids or timestamps, so those cannot be spoofed from the renderer.

function parseNotePatch(raw) {
  if (!isPlainObject(raw)) fail('patch must be an object');
  const patch = {};
  if ('title' in raw) patch.title = str(raw.title, 'patch.title', MAX_TITLE) || 'Untitled';
  if ('content' in raw) patch.content = str(raw.content, 'patch.content', MAX_CONTENT, { trim: false });
  if ('tagIds' in raw) {
    if (!Array.isArray(raw.tagIds)) fail('patch.tagIds must be an array');
    if (raw.tagIds.length > MAX_TAGS_PER_NOTE) fail('patch has too many tags');
    patch.tagIds = raw.tagIds.map((t, i) => id(t, 'patch.tagIds[' + i + ']', 't'));
  }
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

// What the renderer may supply when creating an event: the date is required,
// everything else optional.
function parseEventInput(raw) {
  if (!isPlainObject(raw)) fail('event input must be an object');
  const out = { date: isoDate(raw.date, 'date'), title: str(raw.title === undefined ? '' : raw.title, 'title', MAX_TITLE) };
  if (!out.title) out.title = 'Untitled';
  out.startMinute = raw.startMinute === null || raw.startMinute === undefined
    ? null : int(raw.startMinute, 'startMinute', 0, MINUTES_IN_DAY - 1);
  out.durationMinutes = raw.durationMinutes === null || raw.durationMinutes === undefined
    ? null : int(raw.durationMinutes, 'durationMinutes', 1, MINUTES_IN_DAY);
  if (out.startMinute === null && out.durationMinutes !== null) {
    fail('an all-day event cannot have a duration');
  }
  out.note = str(raw.note === undefined ? '' : raw.note, 'note', MAX_EVENT_NOTE, { trim: false });
  return out;
}

function parseEventPatch(raw) {
  if (!isPlainObject(raw)) fail('patch must be an object');
  const patch = {};
  if ('title' in raw) patch.title = str(raw.title, 'patch.title', MAX_TITLE) || 'Untitled';
  if ('date' in raw) patch.date = isoDate(raw.date, 'patch.date');
  if ('note' in raw) patch.note = str(raw.note, 'patch.note', MAX_EVENT_NOTE, { trim: false });
  if ('done' in raw) {
    if (typeof raw.done !== 'boolean') fail('patch.done must be true or false');
    patch.done = raw.done;
  }
  if ('startMinute' in raw) {
    patch.startMinute = raw.startMinute === null
      ? null : int(raw.startMinute, 'patch.startMinute', 0, MINUTES_IN_DAY - 1);
  }
  if ('durationMinutes' in raw) {
    patch.durationMinutes = raw.durationMinutes === null
      ? null : int(raw.durationMinutes, 'patch.durationMinutes', 1, MINUTES_IN_DAY);
  }
  if ('tagIds' in raw) {
    if (!Array.isArray(raw.tagIds)) fail('patch.tagIds must be an array');
    if (raw.tagIds.length > MAX_TAGS_PER_NOTE) fail('patch has too many tags');
    patch.tagIds = raw.tagIds.map((t, i) => id(t, 'patch.tagIds[' + i + ']', 't'));
  }
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

function parseTagInput(raw) {
  if (!isPlainObject(raw)) fail('tag input must be an object');
  const name = str(raw.name, 'name', MAX_TAG_NAME);
  if (!name) fail('name cannot be empty');
  return { name, color: color(raw.color, 'color') };
}

// ─── Migrations ───
// One entry per version bump, applied in order. Vault files outlive any single
// build, so this exists from version 1 even though it has nothing to do yet.

const MIGRATIONS = {
  // 2 added the schedule. Events live in their own file, which simply does not
  // exist in a version 1 vault and loads as an empty list, so there is nothing
  // to rewrite — but the version still moves, because a version 1 build must
  // refuse a vault that has events in it rather than silently ignore them.
  2: (state) => state,
  // 3 added to-dos and habits, each in its own file, which are simply absent in
  // an older vault and load as empty lists.
  3: (state) => state,
};

function migrate(state) {
  let from = Number.isInteger(state.schemaVersion) ? state.schemaVersion : 0;
  if (from > SCHEMA_VERSION) {
    throw new ValidationError(
      'vault was written by a newer version of Ethos (schema ' + from + ')'
    );
  }
  let out = state;
  while (from < SCHEMA_VERSION) {
    from += 1;
    const step = MIGRATIONS[from];
    if (step) out = step(out);
  }
  return { ...out, schemaVersion: SCHEMA_VERSION };
}

module.exports = {
  SCHEMA_VERSION, TAG_COLORS, MINUTES_IN_DAY, ValidationError,
  parseTag, parseNote, parseNotePatch, parseTagInput, migrate,
  parseEvent, parseEventInput, parseEventPatch,
  parseTodo, parseTodoInput, parseTodoPatch,
  parseHabit, parseHabitInput, parseHabitToggle,
};
