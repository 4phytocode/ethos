// Validation and migration for everything that comes off disk or in over IPC.
//
// Hand-written on purpose: the checks are small, they add no dependencies to a
// product that will ship paid builds, and a validator we own cannot be replaced
// by a compromised package. Every value that crosses a boundary goes through
// here, so a corrupt vault file or a malformed IPC call fails at one known
// place instead of turning into `undefined` three layers deeper.

const SCHEMA_VERSION = 8;
const TODO_KINDS = ['task', 'remember'];

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
const MAX_FOLDER_NAME = 60;
const MAX_MOOD_TEXT = 280;
const MAX_PAGE_LINKS = 200;
const MOOD_FEELINGS = ['good', 'bad', 'note'];
// How far ahead of an event its reminder may fire: up to a week.
const MAX_REMIND_MINUTES = 7 * MINUTES_IN_DAY;

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

// Optional palette colour: null means "use the default".
function optColor(v, field) {
  return v === null || v === undefined ? null : color(v, field);
}

// Minutes before an event's start that its reminder fires; null = no reminder.
function optRemind(v, field) {
  return v === null || v === undefined ? null : int(v, field, 0, MAX_REMIND_MINUTES);
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
    color: optColor(raw.color, 'event.color'),
    remindMinutes: optRemind(raw.remindMinutes, 'event.remindMinutes'),
    notified: raw.notified === true,
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
// `kind` is 'task' (something to do, can carry an estimate and a start time)
// or 'remember' (something to keep in mind today: no time, never planned).
// `startMinute` pins a task to a time of day (minutes from midnight); without
// one the task simply follows the one before it.
function todoKind(v, field) {
  if (v === undefined || v === null) return 'task';
  if (!TODO_KINDS.includes(v)) fail(field + ' must be task or remember');
  return v;
}

function optMinuteOfDay(v, field) {
  return v === null || v === undefined ? null : int(v, field, 0, MINUTES_IN_DAY - 1);
}

function parseTodo(raw) {
  if (!isPlainObject(raw)) fail('todo must be an object');
  const kind = todoKind(raw.kind, 'todo.kind');
  // A thing to remember has no time; drop any rather than reject the record.
  const minutes = kind === 'remember' || raw.minutes === null || raw.minutes === undefined
    ? null : int(raw.minutes, 'todo.minutes', 1, MINUTES_IN_DAY);
  const startMinute = kind === 'remember' ? null : optMinuteOfDay(raw.startMinute, 'todo.startMinute');
  const dueAt = raw.dueAt === null || raw.dueAt === undefined
    ? null : timestamp(raw.dueAt, 'todo.dueAt');
  const title = str(raw.title, 'todo.title', MAX_TITLE);
  if (!title) fail('todo.title cannot be empty');
  return {
    id: id(raw.id, 'todo.id', 'k'),
    title,
    kind,
    date: isoDate(raw.date, 'todo.date'),
    minutes,
    startMinute,
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
    kind: todoKind(raw.kind, 'kind'),
    date: isoDate(raw.date, 'date'),
    minutes: raw.minutes === null || raw.minutes === undefined
      ? null : int(raw.minutes, 'minutes', 1, MINUTES_IN_DAY),
    startMinute: optMinuteOfDay(raw.startMinute, 'startMinute'),
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
  if ('startMinute' in raw) patch.startMinute = optMinuteOfDay(raw.startMinute, 'patch.startMinute');
  if ('kind' in raw) patch.kind = todoKind(raw.kind, 'patch.kind');
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

// Where a dragged item lands: a list (kind) and a position in that day's list.
function parseTodoPlace(raw) {
  if (!isPlainObject(raw)) fail('place must be an object');
  return { kind: todoKind(raw.kind, 'kind'), index: int(raw.index, 'index', 0, 10000) };
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

// ─── Moods ───
// One check-in per local day from the homepage "How are you feeling?" card.
// `feeling` is good, bad, or note (the user only wrote something down).
function parseMood(raw) {
  if (!isPlainObject(raw)) fail('mood must be an object');
  if (!MOOD_FEELINGS.includes(raw.feeling)) fail('mood.feeling is not a known feeling');
  return {
    id: id(raw.id, 'mood.id', 'm'),
    date: isoDate(raw.date, 'mood.date'),
    feeling: raw.feeling,
    text: str(raw.text === undefined ? '' : raw.text, 'mood.text', MAX_MOOD_TEXT),
    createdAt: timestamp(raw.createdAt, 'mood.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'mood.updatedAt'),
  };
}

function parseMoodInput(raw) {
  if (!isPlainObject(raw)) fail('mood input must be an object');
  if (!MOOD_FEELINGS.includes(raw.feeling)) fail('feeling must be good, bad or note');
  const text = str(raw.text === undefined ? '' : raw.text, 'text', MAX_MOOD_TEXT);
  if (raw.feeling === 'note' && !text) fail('write something down first');
  return { date: isoDate(raw.date, 'date'), feeling: raw.feeling, text };
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
  out.color = optColor(raw.color, 'color');
  out.remindMinutes = optRemind(raw.remindMinutes, 'remindMinutes');
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
  if ('color' in raw) patch.color = optColor(raw.color, 'patch.color');
  if ('remindMinutes' in raw) patch.remindMinutes = optRemind(raw.remindMinutes, 'patch.remindMinutes');
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

// ─── Notes section: folders and pages ───
// Separate from journal notes. A page is a document (one file each, like a
// journal note); folders are small records (one file for all of them). A page
// with folderId null is unfiled. `temporary` marks a scratch page; nothing
// expires it yet (see todo.md).

function parseFolder(raw) {
  if (!isPlainObject(raw)) fail('folder must be an object');
  const name = str(raw.name, 'folder.name', MAX_FOLDER_NAME);
  if (!name) fail('folder.name cannot be empty');
  return {
    id: id(raw.id, 'folder.id', 'f'),
    name,
    createdAt: timestamp(raw.createdAt, 'folder.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'folder.updatedAt'),
  };
}

function parseFolderInput(raw) {
  if (!isPlainObject(raw)) fail('folder input must be an object');
  const name = str(raw.name === undefined ? '' : raw.name, 'name', MAX_FOLDER_NAME);
  if (!name) fail('name cannot be empty');
  return { name };
}

function optFolderId(v, field) {
  return v === null || v === undefined ? null : id(v, field, 'f');
}

// The pages a page links to, by id. Outgoing only: backlinks are derived, never
// stored, so the two directions cannot disagree. Duplicates collapse.
function pageLinks(v, field) {
  if (!Array.isArray(v)) fail(field + ' must be an array');
  if (v.length > MAX_PAGE_LINKS) fail(field + ' has more than ' + MAX_PAGE_LINKS + ' links');
  return [...new Set(v.map((x, i) => id(x, field + '[' + i + ']', 'p')))];
}

function parsePage(raw) {
  if (!isPlainObject(raw)) fail('page must be an object');
  const pageId = id(raw.id, 'page.id', 'p');
  return {
    id: pageId,
    title: str(raw.title, 'page.title', MAX_TITLE),
    content: str(raw.content, 'page.content', MAX_CONTENT, { trim: false }),
    folderId: optFolderId(raw.folderId, 'page.folderId'),
    temporary: raw.temporary === true,
    // Absent on a v6 page, which reads as "links to nothing". A page never
    // links to itself.
    links: pageLinks(raw.links === undefined ? [] : raw.links, 'page.links').filter(l => l !== pageId),
    // Absent on a v7 page: no tables, not pinned.
    tables: pageTables(raw.tables === undefined ? [] : raw.tables, 'page.tables'),
    pinned: raw.pinned === true,
    createdAt: timestamp(raw.createdAt, 'page.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'page.updatedAt'),
  };
}

function parsePageInput(raw) {
  if (raw === undefined) raw = {};
  if (!isPlainObject(raw)) fail('page input must be an object');
  return {
    folderId: optFolderId(raw.folderId, 'folderId'),
    temporary: raw.temporary === true,
  };
}

function parsePagePatch(raw) {
  if (!isPlainObject(raw)) fail('patch must be an object');
  const patch = {};
  if ('title' in raw) patch.title = str(raw.title, 'patch.title', MAX_TITLE);
  if ('content' in raw) patch.content = str(raw.content, 'patch.content', MAX_CONTENT, { trim: false });
  if ('folderId' in raw) patch.folderId = optFolderId(raw.folderId, 'patch.folderId');
  if ('links' in raw) patch.links = pageLinks(raw.links, 'patch.links');
  if ('tables' in raw) patch.tables = pageTables(raw.tables, 'patch.tables');
  if ('pinned' in raw) {
    if (typeof raw.pinned !== 'boolean') fail('patch.pinned must be true or false');
    patch.pinned = raw.pinned;
  }
  if ('temporary' in raw) {
    if (typeof raw.temporary !== 'boolean') fail('patch.temporary must be true or false');
    patch.temporary = raw.temporary;
  }
  if (Object.keys(patch).length === 0) fail('patch is empty');
  return patch;
}

// ─── Tables inside a Notes page ───
// A page may carry tables. The page's text holds a marker line where each one
// sits (`{{table:<id>}}`, see notes.js); the table itself lives here. Table,
// column and row ids are short keys inside one page, not vault ids: nothing is
// ever looked up or named on disk by them.
//
// Structure is checked strictly. A cell whose value does not fit its column's
// type is dropped rather than failing the page, because a column can change
// type after cells were filled, and a single stale cell must not cost the page.

const TABLE_COL_TYPES = ['text', 'number', 'percent', 'progress', 'check', 'select', 'date'];
const MAX_TABLES_PER_PAGE = 20;
const MAX_TABLE_COLS = 20;
const MAX_TABLE_ROWS = 500;
const MAX_TABLE_TITLE = 100;
const MAX_COL_NAME = 40;
const MAX_CELL_TEXT = 2000;
const MAX_SELECT_OPTIONS = 20;
const MAX_OPTION = 40;

function key(v, field) {
  if (typeof v !== 'string' || !/^[a-z0-9]{1,24}$/.test(v)) fail(field + ' is not a valid key');
  return v;
}

function cellValue(col, v) {
  if (v === null || v === undefined) return undefined;
  switch (col.type) {
    case 'text': return typeof v === 'string' && v.length <= MAX_CELL_TEXT ? v : undefined;
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'percent':
    case 'progress': return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : undefined;
    case 'check': return v === true ? true : undefined;
    case 'select': return typeof v === 'string' && col.options.includes(v) ? v : undefined;
    case 'date': try { return isoDate(v, 'cell'); } catch { return undefined; }
    default: return undefined;
  }
}

function parseTable(raw, field) {
  if (!isPlainObject(raw)) fail(field + ' must be an object');
  if (!Array.isArray(raw.columns) || raw.columns.length < 1) fail(field + '.columns must be a non-empty array');
  if (raw.columns.length > MAX_TABLE_COLS) fail(field + ' has more than ' + MAX_TABLE_COLS + ' columns');
  if (!Array.isArray(raw.rows)) fail(field + '.rows must be an array');
  if (raw.rows.length > MAX_TABLE_ROWS) fail(field + ' has more than ' + MAX_TABLE_ROWS + ' rows');
  const columns = raw.columns.map((c, i) => {
    const f = field + '.columns[' + i + ']';
    if (!isPlainObject(c)) fail(f + ' must be an object');
    if (!TABLE_COL_TYPES.includes(c.type)) fail(f + '.type is not a known column type');
    const options = c.options === undefined ? [] : c.options;
    if (!Array.isArray(options) || options.length > MAX_SELECT_OPTIONS) fail(f + '.options must be a short array');
    return {
      id: key(c.id, f + '.id'),
      name: str(c.name === undefined ? '' : c.name, f + '.name', MAX_COL_NAME),
      type: c.type,
      options: [...new Set(options.map((o, j) => str(o, f + '.options[' + j + ']', MAX_OPTION)).filter(Boolean))],
    };
  });
  if (new Set(columns.map(c => c.id)).size !== columns.length) fail(field + ' has duplicate column ids');
  const rows = raw.rows.map((r, i) => {
    const f = field + '.rows[' + i + ']';
    if (!isPlainObject(r) || !isPlainObject(r.cells)) fail(f + ' must be an object with cells');
    const cells = {};
    for (const col of columns) {
      const v = cellValue(col, r.cells[col.id]);
      if (v !== undefined) cells[col.id] = v;
    }
    return { id: key(r.id, f + '.id'), cells };
  });
  if (new Set(rows.map(r => r.id)).size !== rows.length) fail(field + ' has duplicate row ids');
  return {
    id: key(raw.id, field + '.id'),
    title: str(raw.title === undefined ? '' : raw.title, field + '.title', MAX_TABLE_TITLE),
    columns,
    rows,
  };
}

function pageTables(v, field) {
  if (!Array.isArray(v)) fail(field + ' must be an array');
  if (v.length > MAX_TABLES_PER_PAGE) fail(field + ' has more than ' + MAX_TABLES_PER_PAGE + ' tables');
  const tables = v.map((t, i) => parseTable(t, field + '[' + i + ']'));
  if (new Set(tables.map(t => t.id)).size !== tables.length) fail(field + ' has duplicate table ids');
  return tables;
}

// ─── Goals ───
// One goal per horizon, shown on the homepage. Setting a horizon's goal again
// replaces it; setting it to empty text clears it.

const GOAL_HORIZONS = ['week', 'month', 'year'];
const MAX_GOAL_TEXT = 200;

function parseGoal(raw) {
  if (!isPlainObject(raw)) fail('goal must be an object');
  if (!GOAL_HORIZONS.includes(raw.horizon)) fail('goal.horizon must be week, month or year');
  const text = str(raw.text, 'goal.text', MAX_GOAL_TEXT);
  if (!text) fail('goal.text cannot be empty');
  return {
    id: id(raw.id, 'goal.id', 'g'),
    horizon: raw.horizon,
    text,
    done: raw.done === true,
    createdAt: timestamp(raw.createdAt, 'goal.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'goal.updatedAt'),
  };
}

function parseGoalInput(raw) {
  if (!isPlainObject(raw)) fail('goal input must be an object');
  if (!GOAL_HORIZONS.includes(raw.horizon)) fail('horizon must be week, month or year');
  const out = { horizon: raw.horizon };
  if ('text' in raw) out.text = str(raw.text, 'text', MAX_GOAL_TEXT);
  if ('done' in raw) {
    if (typeof raw.done !== 'boolean') fail('done must be true or false');
    out.done = raw.done;
  }
  if (!('text' in out) && !('done' in out)) fail('goal input is empty');
  return out;
}

// ─── Day notes ───
// A note on one calendar day, filed under a section ("Studies") with a list of
// subjects for that day. Several per day. Made for revision timetables.

const MAX_SECTION = 40;
const MAX_SUBJECTS = 20;
const MAX_SUBJECT = 40;
const MAX_DAYNOTE_TEXT = 2000;

function subjects(v, field) {
  if (!Array.isArray(v)) fail(field + ' must be an array');
  if (v.length > MAX_SUBJECTS) fail(field + ' has more than ' + MAX_SUBJECTS + ' subjects');
  const out = [];
  const seen = new Set();
  for (const [i, s] of v.entries()) {
    const name = str(s, field + '[' + i + ']', MAX_SUBJECT);
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
  }
  return out;
}

function parseDayNote(raw) {
  if (!isPlainObject(raw)) fail('daynote must be an object');
  return {
    id: id(raw.id, 'daynote.id', 'd'),
    date: isoDate(raw.date, 'daynote.date'),
    section: str(raw.section, 'daynote.section', MAX_SECTION) || 'General',
    subjects: subjects(raw.subjects === undefined ? [] : raw.subjects, 'daynote.subjects'),
    text: str(raw.text === undefined ? '' : raw.text, 'daynote.text', MAX_DAYNOTE_TEXT, { trim: false }),
    done: raw.done === true,
    createdAt: timestamp(raw.createdAt, 'daynote.createdAt'),
    updatedAt: timestamp(raw.updatedAt, 'daynote.updatedAt'),
  };
}

function parseDayNoteInput(raw) {
  if (!isPlainObject(raw)) fail('daynote input must be an object');
  return {
    date: isoDate(raw.date, 'date'),
    section: str(raw.section === undefined ? '' : raw.section, 'section', MAX_SECTION) || 'General',
    subjects: subjects(raw.subjects === undefined ? [] : raw.subjects, 'subjects'),
    text: str(raw.text === undefined ? '' : raw.text, 'text', MAX_DAYNOTE_TEXT, { trim: false }),
  };
}

function parseDayNotePatch(raw) {
  if (!isPlainObject(raw)) fail('patch must be an object');
  const patch = {};
  if ('date' in raw) patch.date = isoDate(raw.date, 'patch.date');
  if ('section' in raw) patch.section = str(raw.section, 'patch.section', MAX_SECTION) || 'General';
  if ('subjects' in raw) patch.subjects = subjects(raw.subjects, 'patch.subjects');
  if ('text' in raw) patch.text = str(raw.text, 'patch.text', MAX_DAYNOTE_TEXT, { trim: false });
  if ('done' in raw) {
    if (typeof raw.done !== 'boolean') fail('patch.done must be true or false');
    patch.done = raw.done;
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
  // 4 added event colour and reminders (parseEvent defaults them, so old
  // events read as "no colour, no reminder"), plus the Notes section: folders
  // in folders.json and pages in pages/, both absent in an older vault.
  4: (state) => state,
  // 5 added the mood log, moods.json, absent in an older vault.
  5: (state) => state,
  // 6 added to-do `kind` and `startMinute`; parseTodo defaults them, so an
  // older to-do reads as an unpinned task.
  6: (state) => state,
  // 7 added page `links` (the graph view); parsePage defaults it, so an older
  // page reads as linking to nothing.
  7: (state) => state,
  // 8 added goals (goals.json) and day notes (daynotes.json), both absent in an
  // older vault, plus page `tables` and `pinned`, which parsePage defaults.
  8: (state) => state,
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
  SCHEMA_VERSION, TAG_COLORS, MINUTES_IN_DAY, MAX_DONE_DATES, ValidationError,
  parseTag, parseNote, parseNotePatch, parseTagInput, migrate,
  parseEvent, parseEventInput, parseEventPatch,
  parseTodo, parseTodoInput, parseTodoPatch, parseTodoPlace,
  parseHabit, parseHabitInput, parseHabitToggle,
  parseMood, parseMoodInput,
  parseFolder, parseFolderInput, parsePage, parsePageInput, parsePagePatch,
  parseGoal, parseGoalInput, parseDayNote, parseDayNoteInput, parseDayNotePatch,
  TABLE_COL_TYPES,
};
