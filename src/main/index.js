// Ethos — app lifecycle, window, and security posture.
//
// Start with:  npm start   (or: npx electron .)

const path = require('path');
const { app, BrowserWindow, Notification, dialog, ipcMain, shell } = require('electron');

const protocolServer = require('./protocol');
const { Vault } = require('./vault');
const { Store } = require('./store');
const ipc = require('./ipc');
const { Reminders } = require('./reminders');
const { ensureTray, destroyTray } = require('./tray');

const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
// The Ethos mark, in place of Electron's default. Kept outside src/renderer so
// the app:// protocol can never serve it. Windows wants .ico for a crisp
// taskbar and title bar at every size; elsewhere the PNG is enough.
const ICON = path.join(__dirname, '..', '..', 'assets',
  process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const START_URL = protocolServer.origin + '/' + protocolServer.INDEX;

// Must happen before `ready`.
protocolServer.registerScheme();

// A second instance would open the same vault twice and the two would overwrite
// each other's writes. The lock is taken before anything else starts, so a
// losing instance never gets as far as opening the vault.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
// Before the store exists the window cannot be shown yet; the first instance
// is still starting up and will show itself.
else app.on('second-instance', () => { if (store) showWindow(); });

// Windows attributes toasts to an AppUserModelID. Without one, notifications
// from a dev build show as "electron.app.Electron" or are dropped.
if (process.platform === 'win32') app.setAppUserModelId('com.ethos.app');

// One window at a time, and one store behind it.
let store = null;
let mainWindow = null;
let reminders = null;

// Closing the window does not always mean quitting: while a to-do still has a
// reminder to deliver, the window hides to the tray and Ethos keeps running.
let isQuitting = false;
let hiddenToTray = false;
let toldAboutBackground = false;

// ─── Security ───
// Electron 44's defaults are already the safe ones; they are written out
// explicitly so a future edit cannot weaken them silently.
function windowOptions() {
  return {
    width: 1000,
    height: 700,
    minWidth: 400,
    minHeight: 300,
    title: 'Ethos',
    icon: ICON,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // A hidden window would otherwise have its timers throttled, which is
      // exactly when the page is being relied on to show a reminder.
      backgroundThrottling: false,
      // No devtools in a packaged build: a paid renderer is still untrusted,
      // and there is no reason to ship an inspector into it.
      devTools: !app.isPackaged,
    },
  };
}

// The renderer may not navigate anywhere except its own origin, and may not
// open windows at all. Genuine external links are handed to the real browser,
// and only if they are https.
function lockDownNavigation(contents) {
  contents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== protocolServer.origin) {
      event.preventDefault();
      openExternal(url);
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  // Nothing in Ethos embeds a frame or a worker from elsewhere.
  contents.on('will-attach-webview', (event) => event.preventDefault());

  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}

function openExternal(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return; }
  if (url.protocol !== 'https:') return;
  shell.openExternal(url.href);
}

// ─── Window ───

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { mainWindow = createWindow(); return; }
  hiddenToTray = false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Clicking the banner brings the window back, from the tray if need be.
function osNotify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  n.on('click', showWindow);
  n.show();
}

function clockText(minute) {
  const h = Math.floor(minute / 60), m = minute % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
}

function quitForReal() {
  isQuitting = true;
  app.quit();
}

// Closing waits for the page to save what it is still holding. A message sent
// from the page on its way out cannot be relied on, because the page is torn
// down as it sends it. So the window is kept open until the page answers
// (closeReady), with a grace period so a page that has hung cannot block closing.
const COMMIT_GRACE_MS = 1500;
const closeWaiters = new Map();   // window -> function that lets it close

function requestCommit(win, done) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    closeWaiters.delete(win);
    done();
  };
  const timer = setTimeout(finish, COMMIT_GRACE_MS);
  closeWaiters.set(win, finish);
  if (!win.webContents.isDestroyed()) win.webContents.send('commit-request');
}

ipcMain.on('window:close-ready', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const finish = win && closeWaiters.get(win);
  if (finish) finish();
});

function createWindow() {
  const win = new BrowserWindow(windowOptions());
  lockDownNavigation(win.webContents);
  win.loadURL(START_URL);

  let committed = false;
  win.on('close', (event) => {
    if (!committed) {
      event.preventDefault();
      requestCommit(win, () => {
        committed = true;
        if (!win.isDestroyed()) win.close();
      });
      return;
    }
    committed = false;   // the next close asks the page again
    if (isQuitting || !store || !store.hasUpcomingReminders()) return;
    event.preventDefault();
    win.hide();
    hiddenToTray = true;
    ensureTray({ onShow: showWindow, onQuit: quitForReal });
    if (!toldAboutBackground) {
      toldAboutBackground = true;
      osNotify('Ethos is still running',
        'It stays in the background so it can remind you. Quit it from the tray icon.');
    }
  });

  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  return win;
}

// ─── Lifecycle ───

app.whenReady().then(async () => {
  if (!hasLock) return;
  protocolServer.handle(RENDERER_ROOT);

  // If the vault cannot be opened (a newer build wrote it, or the disk failed),
  // say so and stop. Carrying on would leave a process with no window, and any
  // save would risk overwriting data this build does not understand.
  const vault = new Vault(path.join(app.getPath('userData'), 'vault'));
  try {
    await vault.init();
    store = new Store(vault);
    await store.load();
  } catch (err) {
    console.error('vault failed to open:', err.message);
    store = null;
    dialog.showErrorBox('Ethos could not open your vault',
      err.message + '\n\nEthos has stopped so nothing is overwritten.');
    app.exit(1);
    return;
  }
  // The reminder scheduler starts once the page has asked for its state, plus a
  // beat for its listener to attach. Starting it earlier would deliver any
  // overdue reminder into a page that is not there yet.
  let remindersStarted = false;
  ipc.register(store, {
    onRendererReady: () => {
      if (remindersStarted) return;
      remindersStarted = true;
      setTimeout(() => { if (reminders) reminders.start(); }, 1500);
    },
  });

  mainWindow = createWindow();

  reminders = new Reminders({
    store,
    send: (todo) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reminder', todo);
    },
    isInFront: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() &&
      mainWindow.isFocused() && !mainWindow.isMinimized(),
    osNotify: (todo) => osNotify("Time's up", todo.title),
    sendEvent: (ev) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('event-reminder', ev);
    },
    osNotifyEvent: (ev) => osNotify(ev.title, 'Starts at ' + clockText(ev.startMinute)),
    // Once the window is hidden and every reminder has been delivered there is
    // no reason left to stay alive.
    onIdle: () => { if (hiddenToTray) quitForReal(); },
  });

  app.on('activate', showWindow);
});

// Anything typed in the last half second is still only in memory. Hold the
// quit open until it is on disk.
let quitting = false;
app.on('before-quit', (event) => {
  isQuitting = true;
  if (reminders) reminders.stop();
  destroyTray();
  // The second pass, re-entered by the app.quit() below, lets the quit through.
  if (quitting || !store || !store.hasPendingWrites) return;
  event.preventDefault();
  quitting = true;
  store.flush()
    .catch(err => console.error('final flush failed:', err.message))
    .finally(() => {
      if (!store.hasPendingWrites) return app.quit();
      // A write is still failing (disk full, file locked). Quitting now would
      // discard the newest edits without a word, so let the user decide.
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Try again', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Ethos',
        message: 'Some changes could not be saved.',
        detail: 'Quitting now loses the unsaved changes.',
      });
      // "Try again" lets the quit re-enter this handler, which flushes once more.
      if (choice === 0) quitting = false;
      app.quit();
    });
});

app.on('window-all-closed', () => app.quit());
