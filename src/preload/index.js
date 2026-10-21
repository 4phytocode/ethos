// The bridge. Runs sandboxed, with contextIsolation on, so this is the only
// thing the page can see of the main process.
//
// It exposes functions, never the ipcRenderer object and never a channel name
// the page can choose. That distinction is the whole point: if the renderer
// could pass its own channel, any script running in the page would have the
// main process's full handler surface instead of these calls.

const { contextBridge, ipcRenderer } = require('electron');

// Turns the { ok, error } envelope back into a normal promise for callers,
// so renderer code can use try/catch and does not have to check a flag.
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || !res.ok) throw new Error((res && res.error) || 'The operation failed.');
  return res;
}

contextBridge.exposeInMainWorld('ethos', {
  loadState: () => call('state:load'),
  flush: () => call('state:flush'),

  notes: {
    create: () => call('notes:create'),
    update: (noteId, patch) => call('notes:update', noteId, patch),
    remove: (noteId) => call('notes:delete', noteId),
  },

  tags: {
    create: (input) => call('tags:create', input),
    remove: (tagId) => call('tags:delete', tagId),
  },

  todos: {
    create: (input) => call('todos:create', input),
    update: (todoId, patch) => call('todos:update', todoId, patch),
    remove: (todoId) => call('todos:delete', todoId),
    move: (todoId, delta) => call('todos:move', todoId, delta),
    place: (todoId, place) => call('todos:place', todoId, place),
  },

  moods: {
    set: (input) => call('moods:set', input),
  },
  habits: {
    create: (input) => call('habits:create', input),
    remove: (habitId) => call('habits:delete', habitId),
    toggle: (habitId, toggle) => call('habits:toggle', habitId, toggle),
  },

  // Main -> page. Subscribes to reminders and hands the callback plain data
  // only: the ipc event object, and with it the sender, never reaches the page.
  // Returns an unsubscribe function.
  onReminder: (callback) => {
    const listener = (_event, todo) => {
      callback({ id: todo.id, title: todo.title, minutes: todo.minutes });
    };
    ipcRenderer.on('reminder', listener);
    return () => ipcRenderer.removeListener('reminder', listener);
  },

  // Main -> page, asked just before the window closes so the page can save what
  // it is still holding. The page answers with closeReady().
  onCommitRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('commit-request', listener);
    return () => ipcRenderer.removeListener('commit-request', listener);
  },

  // Page -> main: everything typed is handed over, the window may close.
  closeReady: () => ipcRenderer.send('window:close-ready'),

  // Main -> page, for schedule events. Same rules as onReminder.
  onEventReminder: (callback) => {
    const listener = (_event, ev) => {
      callback({ id: ev.id, title: ev.title, date: ev.date, startMinute: ev.startMinute });
    };
    ipcRenderer.on('event-reminder', listener);
    return () => ipcRenderer.removeListener('event-reminder', listener);
  },

  folders: {
    create: (input) => call('folders:create', input),
    rename: (folderId, input) => call('folders:rename', folderId, input),
    remove: (folderId) => call('folders:delete', folderId),
  },

  pages: {
    create: (input) => call('pages:create', input),
    update: (pageId, patch) => call('pages:update', pageId, patch),
    remove: (pageId) => call('pages:delete', pageId),
  },

  events: {
    create: (input) => call('events:create', input),
    update: (eventId, patch) => call('events:update', eventId, patch),
    remove: (eventId) => call('events:delete', eventId),
  },
});
