// Model-layer checks: vault, store and schema, with no Electron and no window.
//
// These are the pieces that hold the user's data, and they import nothing from
// electron on purpose, so they can be exercised in plain node with `npm run
// check`. Run this before and after touching anything under src/main.

const assert = require('assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { Vault } = require('../src/main/vault');
const { Store } = require('../src/main/store');
const { Timers, MAX_TIMERS } = require('../src/main/timers');
const { ValidationError, TAG_COLORS, SCHEMA_VERSION, MAX_DONE_DATES } = require('../src/main/schema');

let passed = 0;
const failures = [];

// Every Store a test opens, so pending debounce timers can be cancelled before
// the temp directory goes away.
const opened = [];

async function test(name, fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ethos-check-'));
  opened.length = 0;
  try {
    await fn(root);
    passed += 1;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  FAIL ' + name + '\n       ' + err.message);
  } finally {
    for (const store of opened) store.dispose();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function freshStore(root) {
  const vault = new Vault(path.join(root, 'vault'));
  await vault.init();
  const store = new Store(vault);
  await store.load();
  opened.push(store);
  return { vault, store };
}

// Reopens the same directory with a new Store, the way a restart would.
async function reopen(root) {
  const vault = new Vault(path.join(root, 'vault'));
  await vault.init();
  const store = new Store(vault);
  await store.load();
  opened.push(store);
  return store;
}

async function main() {
  console.log('vault + store');

  await test('a note survives a restart', async (root) => {
    const { store } = await freshStore(root);
    const note = store.createNote();
    store.updateNote(note.id, { title: 'First entry', content: 'Hello.' });
    await store.flush();

    const after = await reopen(root);
    assert.strictEqual(after.notes.length, 1);
    assert.strictEqual(after.notes[0].title, 'First entry');
    assert.strictEqual(after.notes[0].content, 'Hello.');
  });

  await test('a tag survives a restart and is reusable from another note', async (root) => {
    const { store } = await freshStore(root);
    const tag = store.createTag({ name: 'Ideas', color: TAG_COLORS[1] });
    const a = store.createNote();
    const b = store.createNote();
    store.updateNote(a.id, { tagIds: [tag.id] });
    store.updateNote(b.id, { tagIds: [tag.id] });
    await store.flush();

    const after = await reopen(root);
    assert.strictEqual(after.tags.length, 1, 'one tag');
    assert.ok(after.notes.every(n => n.tagIds[0] === tag.id), 'both notes reference it');
  });

  await test('recolouring a tag shows on every note using it', async (root) => {
    const { store } = await freshStore(root);
    const tag = store.createTag({ name: 'Work', color: TAG_COLORS[0] });
    const note = store.createNote();
    store.updateNote(note.id, { tagIds: [tag.id] });

    // Same name, different colour: updates in place rather than forking.
    const again = store.createTag({ name: 'work', color: TAG_COLORS[3] });
    assert.strictEqual(again.id, tag.id, 'same tag, not a duplicate');
    assert.strictEqual(store.tags.length, 1);
    assert.strictEqual(store.tags[0].color, TAG_COLORS[3]);
    // The note still points at the id, so it renders the new colour.
    assert.strictEqual(store.notes[0].tagIds[0], tag.id);
  });

  await test('deleting a tag removes it from notes', async (root) => {
    const { store } = await freshStore(root);
    const tag = store.createTag({ name: 'Temp', color: TAG_COLORS[2] });
    const note = store.createNote();
    store.updateNote(note.id, { tagIds: [tag.id] });
    store.deleteTag(tag.id);
    await store.flush();

    const after = await reopen(root);
    assert.strictEqual(after.tags.length, 0);
    assert.deepStrictEqual(after.notes[0].tagIds, []);
  });

  await test('deleting a note removes its file', async (root) => {
    const { vault, store } = await freshStore(root);
    const note = store.createNote();
    await store.flush();
    await fs.access(vault.noteFile(note.id));      // exists

    store.deleteNote(note.id);
    await store.flush();
    await assert.rejects(() => fs.access(vault.noteFile(note.id)), 'file is gone');

    const after = await reopen(root);
    assert.strictEqual(after.notes.length, 0);
  });

  await test('an unknown tag id is dropped rather than stored', async (root) => {
    const { store } = await freshStore(root);
    const note = store.createNote();
    store.updateNote(note.id, { tagIds: ['t_' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12)] });
    assert.deepStrictEqual(store.notes[0].tagIds, [], 'dangling reference dropped');
  });

  await test('invalid input is rejected', async (root) => {
    const { store } = await freshStore(root);
    const note = store.createNote();

    assert.throws(() => store.createTag({ name: 'Bad', color: 'red; background: url(x)' }),
      ValidationError, 'colour outside the palette');
    assert.throws(() => store.createTag({ name: '', color: TAG_COLORS[0] }),
      ValidationError, 'empty name');
    assert.throws(() => store.createTag({ name: 'x'.repeat(50), color: TAG_COLORS[0] }),
      ValidationError, 'name too long');
    assert.throws(() => store.updateNote(note.id, { tagIds: 'nope' }),
      ValidationError, 'tagIds must be a list');
    assert.throws(() => store.updateNote(note.id, {}),
      ValidationError, 'empty patch');
    assert.throws(() => store.updateNote('n_not-a-real-id', { title: 'x' }),
      /no such note/, 'unknown note');
  });

  await test('a path cannot be built from a hostile note id', async (root) => {
    const { vault } = await freshStore(root);
    for (const bad of ['../escape', 'n_../../escape', 'n_' + 'a'.repeat(36) + '/../x']) {
      assert.throws(() => vault.noteFile(bad), /refusing to build a path/, bad);
    }
  });

  await test('a corrupt note file is quarantined, not fatal', async (root) => {
    const { vault, store } = await freshStore(root);
    const keep = store.createNote();
    store.updateNote(keep.id, { title: 'Good' });
    await store.flush();

    // A truncated file, as a crash mid-write would once have left behind.
    const broken = path.join(vault.notesDir, 'n_' + '1'.repeat(8) + '-1111-1111-1111-' + '1'.repeat(12) + '.json');
    await fs.writeFile(broken, '{"title": "trunc', 'utf8');

    const after = await reopen(root);
    assert.strictEqual(after.notes.length, 1, 'the good note still loads');
    assert.strictEqual(after.notes[0].title, 'Good');
    const names = await fs.readdir(vault.notesDir);
    assert.ok(names.some(n => n.includes('.corrupt-')), 'the bad file was moved aside, not deleted');
  });

  await test('a vault from a newer build is refused', async (root) => {
    const vault = new Vault(path.join(root, 'vault'));
    await vault.init();
    await fs.writeFile(vault.metaFile, JSON.stringify({ schemaVersion: 99 }), 'utf8');
    await assert.rejects(() => vault.load(), /newer version/);
  });

  await test('no-op updates do not queue a write', async (root) => {
    const { store } = await freshStore(root);
    const note = store.createNote();
    await store.flush();
    assert.strictEqual(store.hasPendingWrites, false);

    store.updateNote(note.id, { title: 'Untitled', content: '' });
    assert.strictEqual(store.hasPendingWrites, false, 'identical values changed nothing');

    store.updateNote(note.id, { content: 'real change' });
    assert.strictEqual(store.hasPendingWrites, true);
  });

  await test('an edit made during a slow save is written, not dropped', async (root) => {
    const { vault, store } = await freshStore(root);
    const note = store.createNote();
    await store.flush();

    // The stub captures the note as it was when the write began, so the first
    // pass really writes the old text and the edit below has to go out after it.
    const realSave = vault.saveNote.bind(vault);
    vault.saveNote = (n) => {
      const frozen = { ...n };
      return new Promise(r => setTimeout(r, 150)).then(() => realSave(frozen));
    };
    try {
      store.updateNote(note.id, { content: 'first' });
      const pass = store.flush();
      await new Promise(r => setTimeout(r, 20));
      assert.strictEqual(store.hasPendingWrites, true, 'a write in flight counts as pending');
      store.updateNote(note.id, { content: 'second' });
      await store.flush();
      await pass;
      assert.strictEqual(store.hasPendingWrites, false);
    } finally {
      vault.saveNote = realSave;
    }
    const again = await reopen(root);
    assert.strictEqual(again.notes.find(n => n.id === note.id).content, 'second');
  });

  await test('a missing note or event is a validation error', async (root) => {
    const { store } = await freshStore(root);
    assert.throws(() => store.updateNote('n_missing', { content: 'x' }), ValidationError);
    assert.throws(() => store.updateEvent('e_missing', { title: 'x' }), ValidationError);
  });

  await test('a habit cannot be ticked past the cap that would drop it on restart', async (root) => {
    const { store } = await freshStore(root);
    const habit = store.createHabit({ name: 'Water' });
    const pad = (n) => String(n).padStart(2, '0');
    habit.doneDates = Array.from({ length: MAX_DONE_DATES }, (_, i) => {
      const d = new Date(2000, 0, 1 + i);
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    });
    assert.throws(() => store.toggleHabit(habit.id, { date: '2026-10-21', done: true }, Date.now()),
      ValidationError);
  });

  await test('a snapshot cannot be used to mutate the store', async (root) => {
    const { store } = await freshStore(root);
    const note = store.createNote();
    const snap = store.snapshot();
    snap.notes[0].title = 'hacked';
    snap.notes[0].tagIds.push('t_whatever');
    assert.strictEqual(store.notes[0].title, note.title);
    assert.deepStrictEqual(store.notes[0].tagIds, []);
  });

  console.log('\nschedule');

  await test('an event survives a restart', async (root) => {
    const { store } = await freshStore(root);
    store.createEvent({ date: '2026-03-04', title: 'Dentist', startMinute: 9 * 60 + 30, durationMinutes: 45 });
    await store.flush();

    const after = await reopen(root);
    assert.strictEqual(after.events.length, 1);
    assert.strictEqual(after.events[0].title, 'Dentist');
    assert.strictEqual(after.events[0].date, '2026-03-04');
    assert.strictEqual(after.events[0].startMinute, 570);
    assert.strictEqual(after.events[0].durationMinutes, 45);
    assert.strictEqual(after.events[0].done, false);
  });

  await test('events come back in chronological order', async (root) => {
    const { store } = await freshStore(root);
    store.createEvent({ date: '2026-03-05', title: 'Later day' });
    store.createEvent({ date: '2026-03-04', title: 'Evening', startMinute: 20 * 60 });
    store.createEvent({ date: '2026-03-04', title: 'Morning', startMinute: 8 * 60 });
    store.createEvent({ date: '2026-03-04', title: 'All day' });   // no start time
    await store.flush();

    const after = await reopen(root);
    assert.deepStrictEqual(after.events.map(e => e.title),
      ['All day', 'Morning', 'Evening', 'Later day'],
      'all-day first within a date, then by start time, then by date');
  });

  await test('moving an event re-sorts it', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createEvent({ date: '2026-03-04', title: 'A', startMinute: 60 });
    store.createEvent({ date: '2026-03-04', title: 'B', startMinute: 120 });
    store.updateEvent(a.id, { startMinute: 180 });
    assert.deepStrictEqual(store.events.map(e => e.title), ['B', 'A']);
  });

  await test('an all-day event cannot carry a duration', async (root) => {
    const { store } = await freshStore(root);
    assert.throws(() => store.createEvent({ date: '2026-03-04', title: 'x', durationMinutes: 30 }),
      ValidationError, 'duration with no start');

    // The same rule has to hold when a patch creates the situation, which is
    // why updateEvent validates the merged record and not the patch alone.
    const timed = store.createEvent({ date: '2026-03-04', title: 'y', startMinute: 600, durationMinutes: 30 });
    assert.throws(() => store.updateEvent(timed.id, { startMinute: null }),
      ValidationError, 'clearing the start while a duration remains');
    // Clearing both at once is fine.
    const cleared = store.updateEvent(timed.id, { startMinute: null, durationMinutes: null });
    assert.strictEqual(cleared.startMinute, null);
    assert.strictEqual(cleared.durationMinutes, null);
  });

  await test('bad dates and times are rejected', async (root) => {
    const { store } = await freshStore(root);
    for (const date of ['2026-02-30', '2026-13-01', '04-03-2026', '2026-3-4', 'today', '']) {
      assert.throws(() => store.createEvent({ date, title: 'x' }), ValidationError, 'date ' + JSON.stringify(date));
    }
    assert.throws(() => store.createEvent({ date: '2026-03-04', startMinute: 1440 }),
      ValidationError, 'minute past end of day');
    assert.throws(() => store.createEvent({ date: '2026-03-04', startMinute: -1 }),
      ValidationError, 'negative minute');
    assert.throws(() => store.createEvent({ date: '2026-03-04', startMinute: 9.5 }),
      ValidationError, 'fractional minute');
    assert.throws(() => store.createEvent({ date: '2026-03-04', startMinute: 600, durationMinutes: 0 }),
      ValidationError, 'zero duration');
    assert.throws(() => store.updateEvent('e_not-real', { title: 'x' }), /no such event/);
  });

  await test('a leap day is accepted', async (root) => {
    const { store } = await freshStore(root);
    const e = store.createEvent({ date: '2028-02-29', title: 'Leap' });
    assert.strictEqual(e.date, '2028-02-29');
    assert.throws(() => store.createEvent({ date: '2027-02-29', title: 'Not a leap year' }), ValidationError);
  });

  await test('done can be toggled and persists', async (root) => {
    const { store } = await freshStore(root);
    const e = store.createEvent({ date: '2026-03-04', title: 'Ship it' });
    store.updateEvent(e.id, { done: true });
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.events[0].done, true);
    assert.throws(() => store.updateEvent(e.id, { done: 'yes' }), ValidationError, 'done must be boolean');
  });

  await test('deleting a tag clears it from events too', async (root) => {
    const { store } = await freshStore(root);
    const tag = store.createTag({ name: 'Health', color: TAG_COLORS[2] });
    const e = store.createEvent({ date: '2026-03-04', title: 'Checkup' });
    store.updateEvent(e.id, { tagIds: [tag.id] });
    assert.deepStrictEqual(store.events[0].tagIds, [tag.id]);

    store.deleteTag(tag.id);
    await store.flush();
    const after = await reopen(root);
    assert.deepStrictEqual(after.events[0].tagIds, [], 'reference dropped from the event');
  });

  await test('deleting an event persists', async (root) => {
    const { store } = await freshStore(root);
    const keep = store.createEvent({ date: '2026-03-04', title: 'Keep' });
    const drop = store.createEvent({ date: '2026-03-04', title: 'Drop', startMinute: 600 });
    await store.flush();
    assert.strictEqual(store.deleteEvent(drop.id), true);
    assert.strictEqual(store.deleteEvent(drop.id), false, 'deleting twice is a no-op');
    await store.flush();

    const after = await reopen(root);
    assert.deepStrictEqual(after.events.map(e => e.title), ['Keep']);
    assert.strictEqual(after.events[0].id, keep.id);
  });

  await test('a version 1 vault opens and gains a schedule', async (root) => {
    // Exactly what the previous build left on disk: no events.json at all.
    const dir = path.join(root, 'vault');
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
    await fs.writeFile(path.join(dir, 'tags.json'), JSON.stringify({ tags: [] }), 'utf8');

    const store = await reopen(root);
    assert.deepStrictEqual(store.events, [], 'missing events.json is not an error');
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION, 'migrated on open');

    store.createEvent({ date: '2026-03-04', title: 'First event' });
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.events.length, 1);
  });

  await test('a fresh vault records its version on disk', async (root) => {
    // Regression: load() used to default a missing meta.json to the current
    // version and then skip the write, so a brand new vault carried no marker
    // at all. The next build to open it would assume its own version and run
    // no migrations.
    const { vault, store } = await freshStore(root);
    const meta = JSON.parse(await fs.readFile(vault.metaFile, 'utf8'));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION, 'stamped at creation, before any data');
    assert.strictEqual(store.notes.length, 0);
  });

  await test('a vault with data but no meta is treated as version 1', async (root) => {
    // What a pre-versioning build left behind: data, no meta.json. Guessing
    // the current version here would read old records as though they were new.
    const dir = path.join(root, 'vault');
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tags.json'),
      JSON.stringify({ tags: [{ id: 't_' + '2'.repeat(8) + '-2222-2222-2222-' + '2'.repeat(12), name: 'Old', color: TAG_COLORS[0], createdAt: 1 }] }), 'utf8');

    const store = await reopen(root);
    assert.strictEqual(store.tags.length, 1, 'the old data still loads');
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION, 'migrated up and stamped');
  });

  await test('a corrupt events file is quarantined, not fatal', async (root) => {
    const { vault, store } = await freshStore(root);
    store.createNote();
    await store.flush();
    await fs.writeFile(vault.eventsFile, '{"events": [', 'utf8');

    const after = await reopen(root);
    assert.deepStrictEqual(after.events, [], 'events empty rather than throwing');
    assert.strictEqual(after.notes.length, 1, 'the rest of the vault still loads');
  });

  await test('one bad event does not discard the good ones', async (root) => {
    const { vault, store } = await freshStore(root);
    store.createEvent({ date: '2026-03-04', title: 'Good' });
    await store.flush();

    const raw = JSON.parse(await fs.readFile(vault.eventsFile, 'utf8'));
    raw.events.push({ id: 'e_nope', title: 'Bad', date: 'whenever', tagIds: [] });
    await fs.writeFile(vault.eventsFile, JSON.stringify(raw), 'utf8');

    const after = await reopen(root);
    assert.deepStrictEqual(after.events.map(e => e.title), ['Good']);
  });

  await test('an event snapshot cannot mutate the store', async (root) => {
    const { store } = await freshStore(root);
    store.createEvent({ date: '2026-03-04', title: 'Real' });
    const snap = store.snapshot();
    snap.events[0].title = 'hacked';
    snap.events[0].tagIds.push('t_whatever');
    assert.strictEqual(store.events[0].title, 'Real');
    assert.deepStrictEqual(store.events[0].tagIds, []);
  });

  await test('a no-op event update queues no write', async (root) => {
    const { store } = await freshStore(root);
    const e = store.createEvent({ date: '2026-03-04', title: 'Same', startMinute: 600 });
    await store.flush();
    assert.strictEqual(store.hasPendingWrites, false);
    store.updateEvent(e.id, { title: 'Same', startMinute: 600 });
    assert.strictEqual(store.hasPendingWrites, false);
    store.updateEvent(e.id, { title: 'Different' });
    assert.strictEqual(store.hasPendingWrites, true);
  });

  console.log('\nto-dos');

  // A fixed moment mid-morning, so every finish time in these checks is exact.
  const NOW = new Date(2026, 2, 4, 10, 0, 0).getTime();
  const TODAY = '2026-03-04';
  const TOMORROW = '2026-03-05';
  const MIN = 60000;

  await test('tasks are planned end to end from now', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createTodo({ title: 'Write report', date: TODAY, minutes: 30 }, NOW);
    const b = store.createTodo({ title: 'Review PRs', date: TODAY, minutes: 45 }, NOW);
    const c = store.createTodo({ title: 'Email', date: TODAY, minutes: 15 }, NOW);
    assert.strictEqual(a.dueAt, NOW + 30 * MIN);
    assert.strictEqual(b.dueAt, NOW + 75 * MIN, 'starts when the first finishes');
    assert.strictEqual(c.dueAt, NOW + 90 * MIN, 'and so on down the list');
  });

  await test('a task with no estimate does not push the others back', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'First', date: TODAY, minutes: 20 }, NOW);
    const open = store.createTodo({ title: 'No estimate', date: TODAY }, NOW);
    const last = store.createTodo({ title: 'Last', date: TODAY, minutes: 10 }, NOW);
    assert.strictEqual(open.dueAt, null);
    assert.strictEqual(last.dueAt, NOW + 30 * MIN);
  });

  await test('finishing a task early pulls the rest forward', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createTodo({ title: 'A', date: TODAY, minutes: 60 }, NOW);
    const b = store.createTodo({ title: 'B', date: TODAY, minutes: 30 }, NOW);
    assert.strictEqual(b.dueAt, NOW + 90 * MIN);

    // A is finished after only ten minutes, not sixty.
    store.updateTodo(a.id, { done: true }, NOW + 10 * MIN);
    assert.strictEqual(store.todos.find(t => t.id === b.id).dueAt, NOW + 40 * MIN);
  });

  await test('another day has no finish time until it arrives', async (root) => {
    const { store } = await freshStore(root);
    const t = store.createTodo({ title: 'Tomorrow', date: TOMORROW, minutes: 30 }, NOW);
    assert.strictEqual(t.dueAt, null);

    const nextMorning = new Date(2026, 2, 5, 9, 0, 0).getTime();
    store.ensurePlan(nextMorning);
    assert.strictEqual(store.todos[0].dueAt, nextMorning + 30 * MIN);
  });

  await test('a reminder fires once, when the finish time arrives', async (root) => {
    const { store } = await freshStore(root);
    const t = store.createTodo({ title: 'Stretch', date: TODAY, minutes: 30 }, NOW);
    assert.strictEqual(store.dueReminders(NOW + 29 * MIN).length, 0, 'not yet');
    assert.deepStrictEqual(store.dueReminders(NOW + 30 * MIN).map(x => x.id), [t.id]);

    store.markNotified(t.id);
    assert.strictEqual(store.dueReminders(NOW + 31 * MIN).length, 0, 'never twice');
  });

  await test('a fired reminder is not repeated after a restart', async (root) => {
    const { store } = await freshStore(root);
    const t = store.createTodo({ title: 'Walk', date: TODAY, minutes: 10 }, NOW);
    store.markNotified(t.id);
    await store.flush();

    const after = await reopen(root);
    assert.strictEqual(after.todos[0].notified, true);
    assert.strictEqual(after.dueReminders(NOW + 20 * MIN).length, 0);
  });

  await test('an overdue task is not given a fresh estimate by an unrelated edit', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createTodo({ title: 'Overdue', date: TODAY, minutes: 30 }, NOW);
    store.markNotified(a.id);
    const dueBefore = store.todos[0].dueAt;

    // Forty minutes on, a new task arrives. A is still not ticked off.
    const later = NOW + 40 * MIN;
    const b = store.createTodo({ title: 'New', date: TODAY, minutes: 20 }, later);
    assert.strictEqual(store.todos[0].dueAt, dueBefore, 'the overdue task keeps its time');
    assert.strictEqual(b.dueAt, later + 20 * MIN, 'the new one is planned from now');
  });

  await test('changing the estimate re-arms the reminder', async (root) => {
    const { store } = await freshStore(root);
    const t = store.createTodo({ title: 'Draft', date: TODAY, minutes: 10 }, NOW);
    store.markNotified(t.id);
    store.updateTodo(t.id, { minutes: 90 }, NOW + 20 * MIN);
    assert.strictEqual(store.todos[0].notified, false);
    assert.strictEqual(store.todos[0].dueAt, NOW + 20 * MIN + 90 * MIN);
  });

  await test('moving a task re-plans the day', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Short', date: TODAY, minutes: 10 }, NOW);
    const long = store.createTodo({ title: 'Long', date: TODAY, minutes: 60 }, NOW);
    store.moveTodo(long.id, -1, NOW);
    assert.deepStrictEqual(store.todos.map(t => t.title), ['Long', 'Short']);
    assert.strictEqual(store.todos[0].dueAt, NOW + 60 * MIN);
    assert.strictEqual(store.todos[1].dueAt, NOW + 70 * MIN);
    // Moving the first one further up changes nothing and does not throw.
    store.moveTodo(long.id, -1, NOW);
    assert.strictEqual(store.todos[0].title, 'Long');
  });

  await test('deleting a task closes the gap', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createTodo({ title: 'A', date: TODAY, minutes: 30 }, NOW);
    store.createTodo({ title: 'B', date: TODAY, minutes: 30 }, NOW);
    assert.strictEqual(store.deleteTodo(a.id, NOW), true);
    assert.strictEqual(store.deleteTodo(a.id, NOW), false, 'twice is a no-op');
    assert.strictEqual(store.todos[0].dueAt, NOW + 30 * MIN);
  });

  await test('the app only has a reason to stay alive while a reminder is pending', async (root) => {
    const { store } = await freshStore(root);
    assert.strictEqual(store.hasUpcomingReminders(NOW), false, 'nothing planned');
    const t = store.createTodo({ title: 'Focus', date: TODAY, minutes: 25 }, NOW);
    assert.strictEqual(store.hasUpcomingReminders(NOW), true);
    store.markNotified(t.id);
    assert.strictEqual(store.hasUpcomingReminders(NOW), false, 'already delivered');
    store.createTodo({ title: 'Untimed', date: TODAY }, NOW);
    assert.strictEqual(store.hasUpcomingReminders(NOW), false, 'no estimate, no reminder');
  });

  await test('a to-do survives a restart', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Persist me', date: TODAY, minutes: 45 }, NOW);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.todos.length, 1);
    assert.strictEqual(after.todos[0].title, 'Persist me');
    assert.strictEqual(after.todos[0].minutes, 45);
    assert.strictEqual(after.todos[0].dueAt, NOW + 45 * MIN);
  });

  await test('bad to-do input is rejected', async (root) => {
    const { store } = await freshStore(root);
    for (const bad of [
      { title: '', date: TODAY },
      { title: '   ', date: TODAY },
      { title: 'x', date: 'soon' },
      { title: 'x', date: '2026-02-30' },
      { title: 'x', date: TODAY, minutes: 0 },
      { title: 'x', date: TODAY, minutes: 1.5 },
      { title: 'x', date: TODAY, minutes: 1441 },
      { title: 'x'.repeat(300), date: TODAY },
    ]) {
      assert.throws(() => store.createTodo(bad, NOW), ValidationError, JSON.stringify(bad).slice(0, 40));
    }
    const t = store.createTodo({ title: 'ok', date: TODAY }, NOW);
    assert.throws(() => store.updateTodo(t.id, {}, NOW), ValidationError, 'empty patch');
    assert.throws(() => store.updateTodo(t.id, { done: 'yes' }, NOW), ValidationError, 'done must be boolean');
    assert.throws(() => store.updateTodo('k_not-real', { done: true }, NOW), /no such to-do/);
    assert.throws(() => store.moveTodo(t.id, 2, NOW), ValidationError, 'delta');
  });

  await test('a to-do snapshot cannot mutate the store', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Real', date: TODAY, minutes: 5 }, NOW);
    const snap = store.snapshot();
    snap.todos[0].title = 'hacked';
    assert.strictEqual(store.todos[0].title, 'Real');
  });

  console.log('\nreminders');
  const { Reminders } = require('../src/main/reminders');

  function remindersFor(store, { inFront = false, boom = false } = {}) {
    const log = { sent: [], os: [], idle: 0 };
    const r = new Reminders({
      store,
      send: (t) => { if (boom) throw new Error('window gone'); log.sent.push(t.title); },
      isInFront: () => inFront,
      osNotify: (t) => log.os.push(t.title),
      onIdle: () => { log.idle += 1; },
    });
    return { r, log };
  }

  await test('the in-app toast always goes first', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Ship', date: TODAY, minutes: 10 }, NOW);
    const { r, log } = remindersFor(store, { inFront: true });
    r.tick(NOW + 10 * MIN);
    assert.deepStrictEqual(log.sent, ['Ship']);
    assert.deepStrictEqual(log.os, [], 'no system banner over a window already in front');
  });

  await test('a system notification is added when the window is not in front', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Ship', date: TODAY, minutes: 10 }, NOW);
    const { r, log } = remindersFor(store, { inFront: false });
    r.tick(NOW + 10 * MIN);
    assert.deepStrictEqual(log.sent, ['Ship'], 'still delivered in-app');
    assert.deepStrictEqual(log.os, ['Ship']);
  });

  await test('each reminder is delivered once across many ticks', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Once', date: TODAY, minutes: 10 }, NOW);
    const { r, log } = remindersFor(store);
    for (let i = 0; i < 6; i += 1) r.tick(NOW + (10 + i) * MIN);
    assert.strictEqual(log.sent.length, 1);
  });

  await test('several tasks remind in order as their times arrive', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'First', date: TODAY, minutes: 10 }, NOW);
    store.createTodo({ title: 'Second', date: TODAY, minutes: 10 }, NOW);
    const { r, log } = remindersFor(store);
    r.tick(NOW + 5 * MIN);
    assert.deepStrictEqual(log.sent, []);
    r.tick(NOW + 10 * MIN);
    assert.deepStrictEqual(log.sent, ['First']);
    r.tick(NOW + 20 * MIN);
    assert.deepStrictEqual(log.sent, ['First', 'Second']);
  });

  await test('a delivery failure does not repeat the reminder', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Flaky', date: TODAY, minutes: 10 }, NOW);
    const { r } = remindersFor(store, { boom: true });
    r.tick(NOW + 10 * MIN);
    r.tick(NOW + 11 * MIN);
    assert.strictEqual(store.todos[0].notified, true, 'marked before delivery was attempted');
  });

  await test('it reports idle once nothing is left to remind about', async (root) => {
    const { store } = await freshStore(root);
    store.createTodo({ title: 'Last one', date: TODAY, minutes: 10 }, NOW);
    const { r, log } = remindersFor(store);
    r.tick(NOW + 1 * MIN);
    assert.strictEqual(log.idle, 0, 'a reminder is still pending');
    r.tick(NOW + 10 * MIN);
    assert.strictEqual(log.idle, 1, 'delivered, so nothing left');
  });

  console.log('\nhabits');

  await test('a habit survives a restart', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Read 20 pages' }, NOW);
    store.toggleHabit(h.id, { date: TODAY, done: true }, NOW);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.habits.length, 1);
    assert.strictEqual(after.habits[0].name, 'Read 20 pages');
    assert.deepStrictEqual(after.habits[0].doneDates, [TODAY]);
  });

  await test('a habit can be ticked and unticked', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Water' }, NOW);
    store.toggleHabit(h.id, { date: TODAY, done: true }, NOW);
    assert.deepStrictEqual(store.habits[0].doneDates, [TODAY]);
    store.toggleHabit(h.id, { date: TODAY, done: false }, NOW);
    assert.deepStrictEqual(store.habits[0].doneDates, []);
  });

  await test('completed days stay sorted and never duplicate', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Stretch' }, NOW);
    for (const d of ['2026-03-03', '2026-03-01', '2026-03-03', '2026-03-02']) {
      store.toggleHabit(h.id, { date: d, done: true }, NOW);
    }
    assert.deepStrictEqual(store.habits[0].doneDates, ['2026-03-01', '2026-03-02', '2026-03-03']);
  });

  await test('a future day cannot be ticked', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Run' }, NOW);
    assert.throws(() => store.toggleHabit(h.id, { date: TOMORROW, done: true }, NOW),
      /not happened yet/);
    assert.deepStrictEqual(store.habits[0].doneDates, []);
  });

  await test('past days can be filled in', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Journal' }, NOW);
    store.toggleHabit(h.id, { date: '2026-02-20', done: true }, NOW);
    assert.deepStrictEqual(store.habits[0].doneDates, ['2026-02-20']);
  });

  await test('bad habit input is rejected', async (root) => {
    const { store } = await freshStore(root);
    assert.throws(() => store.createHabit({ name: '' }, NOW), ValidationError);
    assert.throws(() => store.createHabit({ name: '   ' }, NOW), ValidationError);
    assert.throws(() => store.createHabit({ name: 'x'.repeat(61) }, NOW), ValidationError);
    const h = store.createHabit({ name: 'ok' }, NOW);
    assert.throws(() => store.toggleHabit(h.id, { date: 'today', done: true }, NOW), ValidationError);
    assert.throws(() => store.toggleHabit(h.id, { date: TODAY, done: 1 }, NOW), ValidationError);
    assert.throws(() => store.toggleHabit('h_not-real', { date: TODAY, done: true }, NOW), /no such habit/);
  });

  await test('deleting a habit persists', async (root) => {
    const { store } = await freshStore(root);
    const keep = store.createHabit({ name: 'Keep' }, NOW);
    const drop = store.createHabit({ name: 'Drop' }, NOW);
    assert.strictEqual(store.deleteHabit(drop.id), true);
    assert.strictEqual(store.deleteHabit(drop.id), false);
    await store.flush();
    const after = await reopen(root);
    assert.deepStrictEqual(after.habits.map(h => h.id), [keep.id]);
  });

  await test('a no-op habit toggle queues no write', async (root) => {
    const { store } = await freshStore(root);
    const h = store.createHabit({ name: 'Same' }, NOW);
    store.toggleHabit(h.id, { date: TODAY, done: true }, NOW);
    await store.flush();
    assert.strictEqual(store.hasPendingWrites, false);
    store.toggleHabit(h.id, { date: TODAY, done: true }, NOW);
    assert.strictEqual(store.hasPendingWrites, false, 'already ticked');
  });

  await test('a habit snapshot cannot mutate the store', async (root) => {
    const { store } = await freshStore(root);
    store.createHabit({ name: 'Real' }, NOW);
    const snap = store.snapshot();
    snap.habits[0].doneDates.push('2026-03-04');
    snap.habits[0].name = 'hacked';
    assert.deepStrictEqual(store.habits[0].doneDates, []);
    assert.strictEqual(store.habits[0].name, 'Real');
  });

  console.log('\nmigration to v3');

  await test('a version 2 vault opens and gains to-dos and habits', async (root) => {
    // Exactly what the previous build left: schema 2, no todos.json or habits.json.
    const dir = path.join(root, 'vault');
    await fs.mkdir(path.join(dir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 2 }), 'utf8');
    await fs.writeFile(path.join(dir, 'tags.json'), JSON.stringify({ tags: [] }), 'utf8');

    const store = await reopen(root);
    assert.deepStrictEqual(store.todos, []);
    assert.deepStrictEqual(store.habits, []);
    const meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION);

    store.createTodo({ title: 'First', date: TODAY, minutes: 5 }, NOW);
    store.createHabit({ name: 'First habit' }, NOW);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.todos.length, 1);
    assert.strictEqual(after.habits.length, 1);
  });

  await test('a corrupt to-do file is quarantined, not fatal', async (root) => {
    const { vault, store } = await freshStore(root);
    store.createNote();
    await store.flush();
    await fs.writeFile(vault.todosFile, '{"todos": [', 'utf8');
    const after = await reopen(root);
    assert.deepStrictEqual(after.todos, []);
    assert.strictEqual(after.notes.length, 1, 'the rest of the vault still loads');
  });

  await test('one bad to-do does not discard the good ones', async (root) => {
    const { vault, store } = await freshStore(root);
    store.createTodo({ title: 'Good', date: TODAY, minutes: 5 }, NOW);
    await store.flush();
    const raw = JSON.parse(await fs.readFile(vault.todosFile, 'utf8'));
    raw.todos.push({ id: 'k_nope', title: 'Bad', date: 'whenever' });
    await fs.writeFile(vault.todosFile, JSON.stringify(raw), 'utf8');
    const after = await reopen(root);
    assert.deepStrictEqual(after.todos.map(t => t.title), ['Good']);
  });

  console.log('\nschedule reminders (v4)');


  await test('an event reminder fires remindMinutes before the start, once', async (root) => {
    const { store } = await freshStore(root);
    // 10:30 start, 10 minute warning -> fires at 10:20.
    const e = store.createEvent({ date: TODAY, title: 'Standup', startMinute: 630,
      durationMinutes: 15, remindMinutes: 10 });
    assert.strictEqual(e.remindMinutes, 10);
    assert.strictEqual(store.dueEventReminders(NOW + 19 * MIN).length, 0, 'not yet');
    assert.deepStrictEqual(store.dueEventReminders(NOW + 20 * MIN).map(x => x.id), [e.id]);
    store.markEventNotified(e.id);
    assert.strictEqual(store.dueEventReminders(NOW + 21 * MIN).length, 0, 'never twice');
  });

  await test('moving an event re-arms its reminder; a finished event never fires', async (root) => {
    const { store } = await freshStore(root);
    const e = store.createEvent({ date: TODAY, title: 'Call', startMinute: 630,
      durationMinutes: 15, remindMinutes: 0 });
    store.markEventNotified(e.id);
    store.updateEvent(e.id, { startMinute: 660 });
    assert.strictEqual(store.events[0].notified, false, 're-armed');
    // Opening the app long after the event ended: dropped, not announced late.
    assert.strictEqual(store.dueEventReminders(NOW + 5 * 60 * MIN).length, 0);
  });

  await test('the scheduler delivers event reminders and always raises the OS banner', async (root) => {
    const { store } = await freshStore(root);
    store.createEvent({ date: TODAY, title: 'Gym', startMinute: 605, remindMinutes: 5 });
    const sent = [], os = [];
    const r = new Reminders({ store, send() {}, isInFront: () => true, osNotify() {},
      sendEvent: (ev) => sent.push(ev.title), osNotifyEvent: (ev) => os.push(ev.title) });
    r.tick(NOW);
    assert.deepStrictEqual(sent, ['Gym']);
    assert.deepStrictEqual(os, ['Gym'], 'even with the window in front');
    r.tick(NOW + MIN);
    assert.strictEqual(sent.length, 1);
  });

  await test('an upcoming event reminder keeps the app alive in the tray', async (root) => {
    const { store } = await freshStore(root);
    assert.strictEqual(store.hasUpcomingReminders(NOW), false);
    store.createEvent({ date: TODAY, title: 'Later', startMinute: 900, remindMinutes: 15 });
    assert.strictEqual(store.hasUpcomingReminders(NOW), true);
    store.createEvent({ date: TOMORROW, title: 'Tomorrow', startMinute: 900, remindMinutes: 15 });
    store.deleteEvent(store.events.find(x => x.title === 'Later').id);
    assert.strictEqual(store.hasUpcomingReminders(NOW), false, 'tomorrow does not count');
  });

  await test('event colour and reminder survive a restart; bad colour is rejected', async (root) => {
    const { store } = await freshStore(root);
    store.createEvent({ date: TODAY, title: 'Blue', startMinute: 60, color: TAG_COLORS[0], remindMinutes: 30 });
    assert.throws(() => store.createEvent({ date: TODAY, color: 'red;background:url(x)' }), ValidationError);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.events[0].color, TAG_COLORS[0]);
    assert.strictEqual(after.events[0].remindMinutes, 30);
  });

  await test('a pre-v4 event loads with no colour and no reminder', async (root) => {
    const dir = path.join(root, 'vault');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ schemaVersion: 3 }), 'utf8');
    const t = Date.now();
    await fs.writeFile(path.join(dir, 'events.json'), JSON.stringify({ events: [{
      id: 'e_00000000-0000-4000-8000-000000000000', title: 'Old', date: TODAY,
      startMinute: 60, durationMinutes: 30, note: '', done: false, tagIds: [],
      createdAt: t, updatedAt: t }] }), 'utf8');
    const store = await reopen(root);
    assert.strictEqual(store.events.length, 1);
    assert.strictEqual(store.events[0].color, null);
    assert.strictEqual(store.events[0].remindMinutes, null);
  });

  console.log('\nnotes section');

  await test('folders and pages survive a restart', async (root) => {
    const { store } = await freshStore(root);
    const f = store.createFolder({ name: 'Ideas' });
    const p = store.createPage({ folderId: f.id });
    store.updatePage(p.id, { title: 'First', content: 'Body' });
    store.createPage({ temporary: true });
    await store.flush();
    const after = await reopen(root);
    assert.deepStrictEqual(after.folders.map(x => x.name), ['Ideas']);
    assert.strictEqual(after.pages.length, 2);
    const first = after.pages.find(x => x.title === 'First');
    assert.strictEqual(first.folderId, f.id);
    assert.strictEqual(after.pages.filter(x => x.temporary).length, 1);
  });

  await test('deleting a folder unfiles its pages instead of deleting them', async (root) => {
    const { store } = await freshStore(root);
    const f = store.createFolder({ name: 'Doomed' });
    const p = store.createPage({ folderId: f.id });
    store.deleteFolder(f.id);
    assert.strictEqual(store.pages.length, 1);
    assert.strictEqual(store.pages[0].folderId, null);
    assert.strictEqual(p.id, store.pages[0].id);
  });

  await test('a page cannot point at a missing folder, and page ids cannot build paths', async (root) => {
    const { vault, store } = await freshStore(root);
    assert.throws(() => store.createPage({ folderId: 'f_00000000-0000-4000-8000-000000000000' }), ValidationError);
    const p = store.createPage({});
    assert.throws(() => store.updatePage(p.id, { folderId: 'nope' }), ValidationError);
    assert.throws(() => vault.pageFile('../escape'));
    assert.throws(() => store.createFolder({ name: '   ' }), ValidationError);
  });

  console.log('\nnote links (v7)');

  await test('links between pages survive a restart', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createPage({});
    const b = store.createPage({});
    const c = store.createPage({});
    store.updatePage(a.id, { links: [b.id, c.id] });
    store.updatePage(b.id, { links: [a.id] });
    await store.flush();
    const after = await reopen(root);
    assert.deepStrictEqual(after.pages.find(p => p.id === a.id).links, [b.id, c.id]);
    assert.deepStrictEqual(after.pages.find(p => p.id === b.id).links, [a.id]);
    assert.deepStrictEqual(after.pages.find(p => p.id === c.id).links, []);
  });

  await test('self, duplicate and missing links are dropped; bad links are rejected', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createPage({});
    const b = store.createPage({});
    const gone = 'p_00000000-0000-4000-8000-000000000000';
    store.updatePage(a.id, { links: [a.id, b.id, b.id, gone] });
    assert.deepStrictEqual(store.pages.find(p => p.id === a.id).links, [b.id]);
    assert.throws(() => store.updatePage(a.id, { links: 'p_x' }), ValidationError);
    assert.throws(() => store.updatePage(a.id, { links: ['../escape'] }), ValidationError);
    assert.throws(() => store.updatePage(a.id, { links: ['f_00000000-0000-4000-8000-000000000000'] }), ValidationError);
    assert.throws(() => store.updatePage(a.id, { links: new Array(201).fill(b.id) }), ValidationError);
  });

  await test('the same links again do not queue a write', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createPage({});
    const b = store.createPage({});
    store.updatePage(a.id, { links: [b.id] });
    await store.flush();
    store.updatePage(a.id, { links: [b.id] });
    assert.strictEqual(store.hasPendingWrites, false);
  });

  await test('deleting a page removes the links that pointed at it', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createPage({});
    const b = store.createPage({});
    const c = store.createPage({});
    store.updatePage(a.id, { links: [b.id, c.id] });
    store.updatePage(c.id, { links: [b.id] });
    store.deletePage(b.id);
    assert.deepStrictEqual(store.pages.find(p => p.id === a.id).links, [c.id]);
    assert.deepStrictEqual(store.pages.find(p => p.id === c.id).links, []);
    await store.flush();
    const after = await reopen(root);
    assert.deepStrictEqual(after.pages.find(p => p.id === a.id).links, [c.id]);
  });

  await test('a v6 page with no links field loads as linking to nothing', async (root) => {
    const vault = new Vault(path.join(root, 'vault'));
    await vault.init();
    const id = 'p_11111111-2222-4333-8444-555555555555';
    await fs.writeFile(vault.metaFile, JSON.stringify({ schemaVersion: 6 }), 'utf8');
    await fs.writeFile(vault.pageFile(id), JSON.stringify({
      id, title: 'Old', content: '', folderId: null, temporary: false, createdAt: 1, updatedAt: 1,
    }), 'utf8');
    const store = await reopen(root);
    assert.deepStrictEqual(store.pages.find(p => p.id === id).links, []);
    const meta = JSON.parse(await fs.readFile(vault.metaFile, 'utf8'));
    assert.strictEqual(meta.schemaVersion, SCHEMA_VERSION);
  });

  await test('a snapshot cannot be used to change a page\'s links', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createPage({});
    const b = store.createPage({});
    store.updatePage(a.id, { links: [b.id] });
    store.snapshot().pages.find(p => p.id === a.id).links.push('p_x');
    assert.deepStrictEqual(store.pages.find(p => p.id === a.id).links, [b.id]);
  });

  console.log('\nto-do day plan (v6)');

  await test('a pinned task runs from its time and unpinned tasks flow around it', async (root) => {
    const { store } = await freshStore(root);
    // 10:00 now. A 60 min task, then a task pinned 10:30-11:00, then 20 min.
    const a = store.createTodo({ title: 'Essay outline', date: TODAY, minutes: 60 }, NOW);
    const b = store.createTodo({ title: 'Seminar', date: TODAY, minutes: 30, startMinute: 10 * 60 + 30 }, NOW);
    const c = store.createTodo({ title: 'Flashcards', date: TODAY, minutes: 20 }, NOW);
    const at = (h, m) => new Date(2026, 2, 4, h, m).getTime();
    assert.strictEqual(store.todos.find(t => t.id === b.id).dueAt, at(11, 0));
    // The 60 min task cannot fit before 10:30, so it starts after the seminar.
    assert.strictEqual(store.todos.find(t => t.id === a.id).dueAt, at(12, 0));
    assert.strictEqual(store.todos.find(t => t.id === c.id).dueAt, at(12, 20));
  });

  await test('remember items are never planned and keep no time', async (root) => {
    const { store } = await freshStore(root);
    const r = store.createTodo({ title: 'Bring library card', date: TODAY, kind: 'remember', minutes: 30, startMinute: 600 }, NOW);
    const got = store.todos.find(t => t.id === r.id);
    assert.strictEqual(got.kind, 'remember');
    assert.strictEqual(got.minutes, null);
    assert.strictEqual(got.startMinute, null);
    assert.strictEqual(got.dueAt, null);
  });

  await test('dragging moves within a list and across lists, and survives a restart', async (root) => {
    const { store } = await freshStore(root);
    const a = store.createTodo({ title: 'A', date: TODAY, minutes: 10 }, NOW);
    const b = store.createTodo({ title: 'B', date: TODAY, minutes: 10 }, NOW);
    const r = store.createTodo({ title: 'R', date: TODAY, kind: 'remember' }, NOW);
    store.placeTodo(b.id, { kind: 'task', index: 0 }, NOW);
    assert.deepStrictEqual(store.todos.filter(t => t.kind === 'task').map(t => t.title), ['B', 'A']);
    store.placeTodo(a.id, { kind: 'remember', index: 0 }, NOW);
    const after = store.todos.find(t => t.id === a.id);
    assert.strictEqual(after.kind, 'remember');
    assert.strictEqual(after.minutes, null);
    assert.deepStrictEqual(store.todos.filter(t => t.kind === 'remember').map(t => t.title), ['A', 'R']);
    store.placeTodo(r.id, { kind: 'task', index: 5 }, NOW);
    assert.deepStrictEqual(store.todos.filter(t => t.kind === 'task').map(t => t.title), ['B', 'R']);
    await store.flush();
    const back = await reopen(root);
    assert.deepStrictEqual(back.todos.filter(t => t.kind === 'task').map(t => t.title), ['B', 'R']);
    assert.deepStrictEqual(back.todos.filter(t => t.kind === 'remember').map(t => t.title), ['A']);
  });

  await test('bad to-do kind, start and place are rejected; a v5 to-do loads as a task', async (root) => {
    const { store } = await freshStore(root);
    assert.throws(() => store.createTodo({ title: 'x', date: TODAY, kind: 'maybe' }, NOW), ValidationError);
    assert.throws(() => store.createTodo({ title: 'x', date: TODAY, startMinute: 1440 }, NOW), ValidationError);
    const t = store.createTodo({ title: 'x', date: TODAY }, NOW);
    assert.throws(() => store.placeTodo(t.id, { kind: 'task', index: -1 }, NOW), ValidationError);
    const old = require('../src/main/schema').parseTodo({ id: t.id, title: 'old', date: TODAY, minutes: 5, done: false,
      dueAt: null, notified: false, createdAt: NOW, updatedAt: NOW });
    assert.strictEqual(old.kind, 'task');
    assert.strictEqual(old.startMinute, null);
  });

  console.log('\nmoods');

  await test('a mood survives a restart, and a second check-in replaces it', async (root) => {
    const { store } = await freshStore(root);
    store.setMood({ date: TODAY, feeling: 'good', text: '' }, NOW);
    store.setMood({ date: TODAY, feeling: 'bad', text: 'Long day.' }, NOW);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.moods.length, 1);
    assert.strictEqual(after.moods[0].feeling, 'bad');
    assert.strictEqual(after.moods[0].text, 'Long day.');
  });

  await test('bad mood input is rejected', async (root) => {
    const { store } = await freshStore(root);
    assert.throws(() => store.setMood({ date: TODAY, feeling: 'meh' }, NOW), ValidationError);
    assert.throws(() => store.setMood({ date: TODAY, feeling: 'note', text: '  ' }, NOW), ValidationError);
    assert.throws(() => store.setMood({ date: '2999-01-01', feeling: 'good' }, NOW), ValidationError);
    assert.throws(() => store.setMood({ date: TODAY, feeling: 'good', text: 'x'.repeat(281) }, NOW), ValidationError);
  });

  console.log('\ngoals, day notes and tables (v8)');

  await test('goals: one per horizon, survive a restart, empty text clears', async (root) => {
    const { store } = await freshStore(root);
    store.setGoal({ horizon: 'week', text: 'Finish chapter 3' }, NOW);
    store.setGoal({ horizon: 'year', text: 'Pass the exams' }, NOW);
    store.setGoal({ horizon: 'week', done: true }, NOW + 1);
    assert.strictEqual(store.goals.length, 2);
    await store.flush();
    let after = await reopen(root);
    const week = after.goals.find(g => g.horizon === 'week');
    assert.strictEqual(week.text, 'Finish chapter 3');
    assert.strictEqual(week.done, true);
    // A new goal for the horizon starts again, not done.
    after.setGoal({ horizon: 'week', text: 'Chapter 4' }, NOW + 2);
    assert.strictEqual(after.goals.find(g => g.horizon === 'week').done, false);
    assert.strictEqual(after.setGoal({ horizon: 'year', text: '  ' }, NOW + 3), null);
    assert.strictEqual(after.goals.length, 1);
    assert.throws(() => after.setGoal({ horizon: 'decade', text: 'x' }), ValidationError);
    assert.throws(() => after.setGoal({ horizon: 'month', done: true }), ValidationError);
    assert.throws(() => after.setGoal({ horizon: 'week', text: 'x'.repeat(201) }), ValidationError);
  });

  await test('day notes: sections and subjects, sorted by date, survive a restart', async (root) => {
    const { store } = await freshStore(root);
    const b = store.createDayNote({ date: '2026-03-12', section: 'Studies', subjects: ['Maths', 'maths', ' Physics '] }, NOW);
    store.createDayNote({ date: '2026-03-10', section: '', text: 'Dentist' }, NOW);
    assert.deepStrictEqual(b.subjects, ['Maths', 'Physics'], 'trimmed, case-insensitive de-dup');
    assert.deepStrictEqual(store.daynotes.map(d => d.date), ['2026-03-10', '2026-03-12']);
    assert.strictEqual(store.daynotes[0].section, 'General');
    store.updateDayNote(b.id, { done: true, date: '2026-03-01' }, NOW);
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.daynotes[0].id, b.id);
    assert.strictEqual(after.daynotes[0].done, true);
    assert.throws(() => after.createDayNote({ date: '2026-02-30' }), ValidationError);
    assert.throws(() => after.createDayNote({ date: '2026-03-01', subjects: Array(21).fill('a').map((x, i) => x + i) }), ValidationError);
    assert.throws(() => after.updateDayNote(b.id, {}), ValidationError);
    assert.strictEqual(after.deleteDayNote(b.id), true);
  });

  await test('page tables round-trip; stale cells are dropped, bad structure refused', async (root) => {
    const { store } = await freshStore(root);
    const page = store.createPage({}, NOW);
    const table = {
      id: 'tab1', title: 'Revision',
      columns: [
        { id: 'c1', name: 'Topic', type: 'text' },
        { id: 'c2', name: 'Done', type: 'progress' },
        { id: 'c3', name: 'State', type: 'select', options: ['Todo', 'Done'] },
        { id: 'c4', name: 'Ok', type: 'check' },
      ],
      rows: [{ id: 'r1', cells: { c1: 'Algebra', c2: 140, c3: 'Nope', c4: true, zz: 1 } }],
    };
    store.updatePage(page.id, { tables: [table], content: '{{table:tab1}}' }, NOW + 1);
    const cells = store.pages[0].tables[0].rows[0].cells;
    assert.deepStrictEqual(cells, { c1: 'Algebra', c2: 100, c4: true }, 'clamped, unknown option and column dropped');
    const before = store.pages[0].updatedAt;
    store.updatePage(page.id, { pinned: true }, NOW + 5);
    assert.strictEqual(store.pages[0].updatedAt, before, 'pinning is not an edit');
    await store.flush();
    const after = await reopen(root);
    assert.strictEqual(after.pages[0].tables[0].title, 'Revision');
    assert.strictEqual(after.pages[0].pinned, true);
    // The snapshot is a copy all the way down.
    after.snapshot().pages[0].tables[0].rows[0].cells.c1 = 'hacked';
    assert.strictEqual(after.pages[0].tables[0].rows[0].cells.c1, 'Algebra');
    assert.throws(() => after.updatePage(page.id, { tables: [{ ...table, columns: [] }] }), ValidationError);
    assert.throws(() => after.updatePage(page.id, { tables: [{ ...table, columns: [{ id: 'c1', type: 'formula' }] }] }), ValidationError);
    assert.throws(() => after.updatePage(page.id, { tables: [table, table] }), ValidationError);
    assert.throws(() => after.updatePage(page.id, { tables: [{ ...table, id: '../x' }] }), ValidationError);
  });

  await test('a v7 vault opens at v8 with no goals and plain pages', async (root) => {
    const { store, vault } = await freshStore(root);
    store.createPage({}, NOW);
    await store.flush();
    await fs.writeFile(vault.metaFile, JSON.stringify({ schemaVersion: 7 }), 'utf8');
    const after = await reopen(root);
    assert.deepStrictEqual(after.goals, []);
    assert.deepStrictEqual(after.daynotes, []);
    assert.deepStrictEqual(after.pages[0].tables, []);
    assert.strictEqual(after.pages[0].pinned, false);
    const meta = JSON.parse(await fs.readFile(vault.metaFile, 'utf8'));
    assert.strictEqual(meta.schemaVersion, 8);
  });

  console.log('\ntimers');

  // Each test stops its Timers, so no timeout outlives it.
  const withTimers = async (fn) => {
    const rung = [];
    const timers = new Timers({ ring: (t) => rung.push(t), now: () => NOW });
    try { await fn(timers, rung); } finally { timers.stop(); }
  };

  await test('a timer rings once, at its end, with its label and banner choice', () => withTimers((timers, rung) => {
    timers.arm('tea', { endsAt: NOW + 5000, label: 'Tea', notify: true }, NOW);
    assert.strictEqual(timers.tick(NOW + 4999).length, 0, 'not yet');
    assert.strictEqual(timers.tick(NOW + 5000).length, 1);
    assert.deepStrictEqual(rung, [{ id: 'tea', label: 'Tea', notify: true }]);
    assert.strictEqual(timers.tick(NOW + 9000).length, 0, 'never twice');
    assert.strictEqual(timers.hasArmed(), false);
  }));

  await test('arming again replaces a timer; disarm and clear forget it', () => withTimers((timers, rung) => {
    timers.arm('a', { endsAt: NOW + 1000, label: '', notify: false }, NOW);
    timers.arm('a', { endsAt: NOW + 8000, label: '', notify: false }, NOW);
    assert.strictEqual(timers.tick(NOW + 2000).length, 0, 'the later end wins');
    timers.disarm('a');
    timers.arm('b', { endsAt: NOW + 1000, label: '', notify: false }, NOW);
    timers.clear();
    assert.strictEqual(timers.tick(NOW + 10000).length, 0);
    assert.strictEqual(rung.length, 0);
  }));

  await test('bad timer input is rejected', () => withTimers((timers) => {
    const ok = { endsAt: NOW + 1000, label: 'x', notify: true };
    assert.throws(() => timers.arm('Bad Id', ok, NOW), ValidationError);
    assert.throws(() => timers.arm('a'.repeat(33), ok, NOW), ValidationError);
    assert.throws(() => timers.arm('a', null, NOW), ValidationError);
    assert.throws(() => timers.arm('a', { ...ok, endsAt: 'soon' }, NOW), ValidationError);
    assert.throws(() => timers.arm('a', { ...ok, endsAt: NOW + 101 * 3600 * 1000 }, NOW), ValidationError);
    assert.throws(() => timers.arm('a', { ...ok, label: 'x'.repeat(41) }, NOW), ValidationError);
    assert.throws(() => timers.arm('a', { ...ok, notify: 'yes' }, NOW), ValidationError);
    assert.throws(() => timers.disarm(42), ValidationError);
    for (let i = 0; i < MAX_TIMERS; i += 1) timers.arm('t' + i, ok, NOW);
    assert.throws(() => timers.arm('onemore', ok, NOW), ValidationError);
    timers.arm('t0', ok, NOW);   // re-arming one already held is still fine
  }));

  await test('a ring that throws is not rung again', async () => {
    let calls = 0;
    const timers = new Timers({ ring: () => { calls += 1; throw new Error('page gone'); }, now: () => NOW });
    const quiet = console.error;
    console.error = () => {};
    try {
      timers.arm('x', { endsAt: NOW, label: '', notify: false }, NOW);
      timers.tick(NOW);
      timers.tick(NOW + 60000);
    } finally { console.error = quiet; timers.stop(); }
    assert.strictEqual(calls, 1);
  });

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) {
    for (const f of failures) console.error('\n' + f.name + ':\n' + (f.err.stack || f.err.message));
    process.exit(1);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
