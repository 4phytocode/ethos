// The vault: all of Ethos's data on disk, and the only code that touches it.
//
// Layout, under <userData>/vault:
//   meta.json          { schemaVersion }
//   tags.json          { tags: [...] }
//   events.json        { events: [...] }
//   notes/<id>.json    one file per note
//   folders.json       { folders: [...] }   Notes section folders
//   pages/<id>.json    one file per Notes page
//
// One file per note rather than a single blob: a torn or hand-edited file costs
// one note instead of the whole journal, and a per-note record is the shape a
// per-user sync would push later. JSON rather than Markdown-with-frontmatter
// because that needs a parser we would have to write and debug; exporting
// Markdown stays a pure function over the model whenever it's wanted.
//
// Events go in one file, not one file each: they are small fixed-shape records
// rather than documents, so the blast radius of a bad write is already small
// and a single file keeps a whole day's agenda one read away.

const fs = require('fs/promises');
const path = require('path');
const {
  parseNote, parseTag, parseEvent, parseTodo, parseHabit, parseMood, parseFolder, parsePage,
  migrate, SCHEMA_VERSION,
} = require('./schema');

class Vault {
  constructor(root) {
    this.root = root;
    this.notesDir = path.join(root, 'notes');
    this.metaFile = path.join(root, 'meta.json');
    this.tagsFile = path.join(root, 'tags.json');
    this.eventsFile = path.join(root, 'events.json');
    this.todosFile = path.join(root, 'todos.json');
    this.habitsFile = path.join(root, 'habits.json');
    this.foldersFile = path.join(root, 'folders.json');
    this.moodsFile = path.join(root, 'moods.json');
    this.pagesDir = path.join(root, 'pages');
    this.tmpDir = path.join(root, '.tmp');
  }

  async init() {
    await fs.mkdir(this.notesDir, { recursive: true });
    await fs.mkdir(this.pagesDir, { recursive: true });
    await fs.mkdir(this.tmpDir, { recursive: true });
    // A previous run may have died between writing a temp file and renaming it.
    await this.#clearTmp();
  }

  async #clearTmp() {
    let names = [];
    try { names = await fs.readdir(this.tmpDir); } catch { return; }
    await Promise.all(names.map(n => fs.rm(path.join(this.tmpDir, n), { force: true })));
  }

  // Write a file so that a crash leaves either the old contents or the new
  // ones, never a half-written file: write a temp file, flush it to the
  // platter, then rename over the target. rename is atomic on NTFS and POSIX.
  async #writeAtomic(file, text) {
    const tmp = path.join(this.tmpDir, path.basename(file) + '.' + process.pid + '.' + Date.now());
    let handle;
    try {
      handle = await fs.open(tmp, 'w');
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      if (handle) await handle.close();
    }
    await fs.rename(tmp, file);
  }

  async #readJson(file) {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text);
  }

  // A file we cannot parse is moved aside rather than deleted or silently
  // skipped: the user keeps whatever is in it, and we do not read it again.
  async #quarantine(file, reason) {
    const dest = file + '.corrupt-' + Date.now();
    console.error('vault: quarantining ' + path.basename(file) + ' (' + reason + ')');
    try { await fs.rename(file, dest); } catch (err) {
      console.error('vault: could not quarantine ' + file + ':', err.message);
    }
  }

  // ─── Load ───

  async load() {
    let metaRaw = null;
    try {
      metaRaw = await this.#readJson(this.metaFile);
    } catch (err) {
      if (err.code !== 'ENOENT') await this.#quarantine(this.metaFile, err.message);
    }
    const storedVersion = metaRaw && Number.isInteger(metaRaw.schemaVersion)
      ? metaRaw.schemaVersion : null;

    // Refuse a vault from a newer build before reading a byte of its data,
    // rather than parsing it under assumptions that no longer hold.
    if (storedVersion !== null) migrate({ schemaVersion: storedVersion });

    const tags = await this.#loadTags();
    const notes = await this.#loadNotes();
    const events = await this.#loadEvents();
    const todos = await this.#loadList(this.todosFile, 'todos', parseTodo);
    const habits = await this.#loadList(this.habitsFile, 'habits', parseHabit);
    const folders = await this.#loadList(this.foldersFile, 'folders', parseFolder);
    const moods = await this.#loadList(this.moodsFile, 'moods', parseMood);
    const pages = await this.#loadDocs(this.pagesDir, parsePage);

    // A vault with no meta.json is either brand new or was written before the
    // version was ever recorded. Guessing the current version for the second
    // case would skip every migration and read old data as though it were new,
    // so anything with data in it is treated as version 1 — the earliest
    // version that could have produced it.
    const hasData = notes.length > 0 || tags.length > 0 || events.length > 0 ||
      todos.length > 0 || habits.length > 0 || folders.length > 0 || pages.length > 0 || moods.length > 0;
    const from = storedVersion !== null ? storedVersion : (hasData ? 1 : SCHEMA_VERSION);

    const state = migrate({ schemaVersion: from, notes, tags, events, todos, habits, folders, pages, moods });

    // Always leave a version on disk, including for a vault we just created.
    // Without this a fresh vault carries no marker at all and the next build
    // to open it has nothing to migrate from.
    if (storedVersion !== SCHEMA_VERSION) {
      await this.#writeAtomic(this.metaFile, JSON.stringify({ schemaVersion: SCHEMA_VERSION }, null, 2));
    }

    return {
      schemaVersion: SCHEMA_VERSION,
      notes: state.notes,
      tags: state.tags,
      events: state.events,
      todos: state.todos,
      habits: state.habits,
      folders: state.folders,
      pages: state.pages,
      moods: state.moods,
    };
  }

  async #loadTags() {
    let raw;
    try {
      raw = await this.#readJson(this.tagsFile);
    } catch (err) {
      if (err.code !== 'ENOENT') await this.#quarantine(this.tagsFile, err.message);
      return [];
    }
    const list = raw && Array.isArray(raw.tags) ? raw.tags : [];
    const tags = [];
    for (const entry of list) {
      try { tags.push(parseTag(entry)); } catch (err) {
        console.error('vault: dropping invalid tag:', err.message);
      }
    }
    return tags;
  }

  async #loadEvents() {
    let raw;
    try {
      raw = await this.#readJson(this.eventsFile);
    } catch (err) {
      // Absent in a version 1 vault, which is not an error.
      if (err.code !== 'ENOENT') await this.#quarantine(this.eventsFile, err.message);
      return [];
    }
    const list = raw && Array.isArray(raw.events) ? raw.events : [];
    const events = [];
    for (const entry of list) {
      try { events.push(parseEvent(entry)); } catch (err) {
        console.error('vault: dropping invalid event:', err.message);
      }
    }
    events.sort(compareEvents);
    return events;
  }

  // Shared loader for the two collections that live in one file each. A missing
  // file is an empty list, an unparseable one is moved aside, and one bad record
  // is dropped without costing the good ones.
  async #loadList(file, key, parse) {
    let raw;
    try {
      raw = await this.#readJson(file);
    } catch (err) {
      if (err.code !== 'ENOENT') await this.#quarantine(file, err.message);
      return [];
    }
    const list = raw && Array.isArray(raw[key]) ? raw[key] : [];
    const out = [];
    for (const entry of list) {
      try { out.push(parse(entry)); } catch (err) {
        console.error('vault: dropping invalid ' + key + ' entry:', err.message);
      }
    }
    return out;
  }

  async #loadNotes() { return this.#loadDocs(this.notesDir, parseNote); }

  // One-file-per-record collections: journal notes and Notes pages.
  async #loadDocs(dir, parse) {
    let names = [];
    try { names = await fs.readdir(dir); } catch { return []; }

    const docs = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;          // skips quarantined files
      const file = path.join(dir, name);
      try {
        docs.push(parse(await this.#readJson(file)));
      } catch (err) {
        await this.#quarantine(file, err.message);
      }
    }
    docs.sort((a, b) => a.createdAt - b.createdAt);
    return docs;
  }

  // ─── Save ───

  noteFile(noteId) {
    // noteId has already been through schema.id(), so it cannot escape the
    // directory; assert it again here because this builds a path.
    if (!/^n_[0-9a-f-]{36}$/.test(noteId)) throw new Error('refusing to build a path from ' + noteId);
    return path.join(this.notesDir, noteId + '.json');
  }

  async saveNote(note) {
    await this.#writeAtomic(this.noteFile(note.id), JSON.stringify(note, null, 2));
  }

  async deleteNote(noteId) {
    await fs.rm(this.noteFile(noteId), { force: true });
  }

  pageFile(pageId) {
    // Same reason as noteFile: this builds a path, so re-assert the id.
    if (!/^p_[0-9a-f-]{36}$/.test(pageId)) throw new Error('refusing to build a path from ' + pageId);
    return path.join(this.pagesDir, pageId + '.json');
  }

  async savePage(page) {
    await this.#writeAtomic(this.pageFile(page.id), JSON.stringify(page, null, 2));
  }

  async deletePage(pageId) {
    await fs.rm(this.pageFile(pageId), { force: true });
  }

  async saveFolders(folders) {
    await this.#writeAtomic(this.foldersFile, JSON.stringify({ folders }, null, 2));
  }

  async saveTags(tags) {
    await this.#writeAtomic(this.tagsFile, JSON.stringify({ tags }, null, 2));
  }

  async saveTodos(todos) {
    await this.#writeAtomic(this.todosFile, JSON.stringify({ todos }, null, 2));
  }

  async saveHabits(habits) {
    await this.#writeAtomic(this.habitsFile, JSON.stringify({ habits }, null, 2));
  }

  async saveMoods(moods) {
    await this.#writeAtomic(this.moodsFile, JSON.stringify({ moods }, null, 2));
  }

  async saveEvents(events) {
    await this.#writeAtomic(this.eventsFile, JSON.stringify({ events }, null, 2));
  }
}

// Chronological: by date, then all-day events before timed ones, then by start
// time, then by title so the order never depends on insertion.
function compareEvents(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const am = a.startMinute === null ? -1 : a.startMinute;
  const bm = b.startMinute === null ? -1 : b.startMinute;
  if (am !== bm) return am - bm;
  return a.title.localeCompare(b.title);
}

module.exports = { Vault, compareEvents };
