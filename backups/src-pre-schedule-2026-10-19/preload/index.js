// The bridge. Runs sandboxed, with contextIsolation on, so this is the only
// thing the page can see of the main process.
//
// It exposes functions, never the ipcRenderer object and never a channel name
// the page can choose. That distinction is the whole point: if the renderer
// could pass its own channel, any script running in the page would have the
// main process's full handler surface instead of these seventeen calls.

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

  events: {
    create: (input) => call('events:create', input),
    update: (eventId, patch) => call('events:update', eventId, patch),
    remove: (eventId) => call('events:delete', eventId),
  },
});
