// Ethos — app lifecycle, window, and security posture.
//
// Start with:  npm start   (or: npx electron .)

const path = require('path');
const { app, BrowserWindow, Notification, shell } = require('electron');

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

function osNotify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function quitForReal() {
  isQuitting = true;
  app.quit();
}

function createWindow() {
  const win = new BrowserWindow(windowOptions());
  lockDownNavigation(win.webContents);
  win.loadURL(START_URL);

  win.on('close', (event) => {
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
  protocolServer.handle(RENDERER_ROOT);

  const vault = new Vault(path.join(app.getPath('userData'), 'vault'));
  await vault.init();
  store = new Store(vault);
  await store.load();
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
  if (quitting || !store || !store.hasPendingWrites) return;
  event.preventDefault();
  quitting = true;
  store.flush()
    .catch(err => console.error('final flush failed:', err.message))
    .finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());

// A second instance would open the same vault twice and the two would overwrite
// each other's writes.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}
