// The entire surface the renderer can reach. Twenty-three calls, every argument
// validated, nothing that takes a path or a filename.
//
// Each handler returns { ok: true, ... } or { ok: false, error } rather than
// letting an exception cross the bridge: a rejected invoke in the renderer
// carries the main-process stack, which is detail a renderer has no business
// seeing. Validation failures are reported as a plain message instead.

const { app, ipcMain } = require('electron');
const { ValidationError, TAG_COLORS, MINUTES_IN_DAY } = require('./schema');
const { EDITION } = require('./edition');

// `onRendererReady` is called each time the page asks for its initial state,
// which is the first moment it can be relied on to be listening. The reminder
// scheduler waits for it, so a reminder that came due while the app was closed
// is not sent into a page that has not loaded yet.
function register(store, { onRendererReady } = {}) {
  const handlers = {
    // Full state, for the renderer's cache on startup.
    'state:load': () => {
      if (onRendererReady) onRendererReady();
      return { ...store.snapshot(), tagColors: TAG_COLORS, minutesInDay: MINUTES_IN_DAY,
               edition: EDITION, version: app.getVersion(), packaged: app.isPackaged };
    },

    'notes:create': () => ({ note: store.createNote(), ...store.snapshot() }),
    'notes:update': (noteId, patch) => ({ note: store.updateNote(noteId, patch), ...store.snapshot() }),
    'notes:delete': (noteId) => ({ deleted: store.deleteNote(noteId), ...store.snapshot() }),

    'tags:create': (input) => ({ tag: store.createTag(input), ...store.snapshot() }),
    'tags:delete': (tagId) => ({ deleted: store.deleteTag(tagId), ...store.snapshot() }),

    'events:create': (input) => ({ event: store.createEvent(input), ...store.snapshot() }),
    'events:update': (eventId, patch) => ({ event: store.updateEvent(eventId, patch), ...store.snapshot() }),
    'events:delete': (eventId) => ({ deleted: store.deleteEvent(eventId), ...store.snapshot() }),

    'todos:create': (input) => ({ todo: store.createTodo(input), ...store.snapshot() }),
    'todos:update': (todoId, patch) => ({ todo: store.updateTodo(todoId, patch), ...store.snapshot() }),
    'todos:delete': (todoId) => ({ deleted: store.deleteTodo(todoId), ...store.snapshot() }),
    'todos:move': (todoId, delta) => ({ todo: store.moveTodo(todoId, delta), ...store.snapshot() }),

    'habits:create': (input) => ({ habit: store.createHabit(input), ...store.snapshot() }),
    'habits:delete': (habitId) => ({ deleted: store.deleteHabit(habitId), ...store.snapshot() }),
    'moods:set': (input) => ({ mood: store.setMood(input), ...store.snapshot() }),
    'todos:place': (todoId, place) => ({ todo: store.placeTodo(todoId, place), ...store.snapshot() }),
    'habits:toggle': (habitId, toggle) => ({ habit: store.toggleHabit(habitId, toggle), ...store.snapshot() }),

    'folders:create': (input) => ({ folder: store.createFolder(input), ...store.snapshot() }),
    'folders:rename': (folderId, input) => ({ folder: store.renameFolder(folderId, input), ...store.snapshot() }),
    'folders:delete': (folderId) => ({ deleted: store.deleteFolder(folderId), ...store.snapshot() }),

    'pages:create': (input) => ({ page: store.createPage(input), ...store.snapshot() }),
    'pages:update': (pageId, patch) => ({ page: store.updatePage(pageId, patch), ...store.snapshot() }),
    'pages:delete': (pageId) => ({ deleted: store.deletePage(pageId), ...store.snapshot() }),

    // Lets the renderer force a write, e.g. when a page is closed.
    'state:flush': async () => { await store.flush(); return {}; },
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, ...(await fn(...args)) };
      } catch (err) {
        if (!(err instanceof ValidationError)) {
          console.error('ipc ' + channel + ' failed:', err);
        }
        return { ok: false, error: err instanceof ValidationError ? err.message : 'The operation failed.' };
      }
    });
  }

  return Object.keys(handlers);
}

module.exports = { register };
