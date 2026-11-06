// Runs only the note-editor checks (scripts/ui-editor-checks.js) in a real
// window with a throwaway vault. Faster than the whole UI suite while the editor
// is being worked on:  npm run test:editor   (also run by test:ui)

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ethos-ed-'));
app.setPath('userData', tmp);
process.env.ETHOS_EDITION = 'full';
require('../src/main/index.js');

const results = [];
const errors = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (detail && !ok ? '  (' + detail + ')' : ''));
}

async function run() {
  let win = null;
  for (let i = 0; i < 100 && !win; i += 1) { win = BrowserWindow.getAllWindows()[0]; if (!win) await wait(100); }
  if (!win) throw new Error('no window');
  win.webContents.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  await win.setSize(1400, 900);
  win.show();
  win.focus();
  await wait(4200);
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(tmp, name), (await win.webContents.capturePage()).toPNG());
  const until = async (code, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await js(code)) return true; await wait(50); }
    return false;
  };
  await require('./ui-editor-checks')({ win, js, until, check, wait, shot, tmp });
  console.log('\nconsole');
  check('no renderer errors', errors.length === 0, errors.join(' | '));
}

app.whenReady().then(() => run().catch(err => { console.error(err); console.log('renderer errors:', errors.join(' | ')); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter(r => !r.ok).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  console.log('screenshots: ' + tmp);
  app.exit(failed ? 1 : 0);
}));
