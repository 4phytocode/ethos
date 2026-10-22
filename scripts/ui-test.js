// End-to-end checks in the real Electron window. Run: npm run test:ui
//
// Uses a throwaway userData folder, so the real vault is never touched and the
// single-instance lock does not collide with a running copy of Ethos. Loads the
// real main process, then drives the page with executeJavaScript.
//
// Covers: the empty-page nudge (appears after NUDGE_MS on an empty page, not
// on a written one), the prompt panel, the mood check-in and log, the
// homepage grid alignment, and renderer console errors. Saves screenshots of
// the homepage and the nudge to the temp folder it prints.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ethos-ui-'));
app.setPath('userData', tmp);
require('../src/main/index.js');

const NUDGE_WAIT_MS = 11500;   // the test nudge delay (10s) plus slack
const TEST_NUDGE_MS = 10000;   // set through ethos.test.nudgeMs; the product default is 30s
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
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') errors.push(e.message);
  });
  if (win.webContents.isLoading()) await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(3500); // intro animation + state load
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => fs.writeFileSync(path.join(tmp, name), (await win.webContents.capturePage()).toPNG());
  const nudgeShown = () => js(`(() => { const n = document.getElementById('jp-nudge'); return !n.hidden && n.offsetParent !== null; })()`);

  console.log('\nhomepage');
  await win.setSize(1400, 900);
  await wait(400);
  const r = await js(`(() => {
    const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right) }; };
    return { quote: box('.home-quote'), mood: box('.mood-card'), clock: box('.home-clock'),
             todo: box('.todo-card'), habits: box('.home-habits') };
  })()`);
  check('quote, clock and habits share a left edge', r.quote.l === r.clock.l && r.clock.l === r.habits.l, JSON.stringify(r));
  check('mood and to-do cards share both edges', r.mood.l === r.todo.l && r.mood.r === r.todo.r, JSON.stringify(r));
  check('habits segment ends where the to-do card ends', r.habits.r === r.todo.r, JSON.stringify(r));
  check('fixed habit bar is gone', await js(`!document.querySelector('.habit-bar')`));
  check('backdrop is on (gradient) by default', await js(`document.body.dataset.bg === 'gradient'`));
  await shot('home.png');
  await js(`document.getElementById('sb-hide').click()`);
  await wait(700);
  const c = await js(`(() => { const v = document.getElementById('home').getBoundingClientRect();
    const a = document.querySelector('.home-quote').getBoundingClientRect(), b = document.querySelector('.home-habits').getBoundingClientRect();
    return Math.abs((a.left - v.left) - (v.right - b.right)); })()`);
  check('homepage centres when the sidebar is hidden', c <= 20, 'off by ' + c + 'px');
  await shot('home-centred.png');
  await js(`document.getElementById('sb-show').click()`);
  await wait(700);

  console.log('\nmood');
  await js(`document.querySelector('.mood-choice[data-feeling="good"]').click()`);
  check('picking a feeling shows the text field', await js(`!document.getElementById('mood-form').hidden`));
  await js(`document.getElementById('mood-text').value = 'Slept well.'; document.querySelector('.mood-done').click()`);
  await wait(500);
  check('Done logs it and shows the summary', await js(`!document.getElementById('mood-logged').hidden && document.getElementById('mood-logged-line').textContent.includes('Slept well.')`));
  await js(`document.querySelector('[data-view-link="mood-page"]').click()`);
  await wait(300);
  const rows = await js(`[...document.querySelectorAll('.mood-row')].slice(0, 2).map(li => li.textContent)`);
  check('log shows today first', rows[0] && rows[0].startsWith('Today') && rows[0].includes('Slept well.'), JSON.stringify(rows));
  check('a missed day reads "Not logged"', rows[1] && rows[1].includes('Not logged'), JSON.stringify(rows));

  await js(`localStorage.setItem('ethos.test.nudgeMs', '${TEST_NUDGE_MS}')`);
  console.log('\njournal nudge (waits ~' + Math.round(NUDGE_WAIT_MS / 1000) + 's per case)');
  await js(`document.getElementById('new-page-btn').click()`);
  await wait(600);
  check('new journal opens the editor', await js(`document.body.dataset.view === 'journal-page'`));
  check('"Show prompts" is visible from the start', await js(`document.getElementById('jp-prompts-btn').offsetParent !== null`));
  check('nudge is not shown straight away', !(await nudgeShown()));
  await wait(5000);
  check('nudge is still hidden at 5s', !(await nudgeShown()));
  await wait(NUDGE_WAIT_MS - 5000);
  check('nudge appears on an empty page after the wait', await nudgeShown());
  check('nudge has the agreed wording', await js(`document.getElementById('jp-nudge').textContent.startsWith('An empty page can sometimes be intimidating.')`));
  await shot('nudge.png');

  await js(`document.getElementById('jp-nudge').click()`);
  await wait(300);
  check('clicking the nudge opens the prompts', await js(`!document.getElementById('jp-prompts').hidden && document.getElementById('jp-prompt-text').textContent.length > 10`));
  check('clicking the nudge hides it', !(await nudgeShown()));
  await js(`document.querySelector('.jp-prompt-kinds [data-kind="deep"]').click()`);
  const deep = await js(`document.getElementById('jp-prompt-text').textContent`);
  check('"Surprise me" draws from the deep set', await js(`import('./js/prompts-data.js').then(m => m.DEEP.includes(${JSON.stringify(deep)}))`));
  await js(`document.getElementById('jp-prompt-use').click()`);
  check('"Use this" puts the prompt at the top of the page', await js(`document.getElementById('jp-textarea').value.startsWith(${JSON.stringify(deep)})`));
  check('"Use this" closes the panel', await js(`document.getElementById('jp-prompts').hidden`));

  await js(`document.getElementById('jp-prompts-btn').click()`);
  await js(`document.getElementById('jp-prompt-no').click()`);
  check('"No thanks" closes the panel', await js(`document.getElementById('jp-prompts').hidden`));

  // A page with writing on it must not be nudged.
  await js(`document.getElementById('back-from-journal').click()`);
  await wait(400);
  await js(`document.getElementById('new-page-btn').click()`);
  await wait(600);
  await js(`(() => { const t = document.getElementById('jp-textarea'); t.value = 'Today I went for a long walk.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(NUDGE_WAIT_MS);
  check('no nudge on a page that has writing', !(await nudgeShown()));

  console.log('\npaper');
  await js(`document.querySelector('#jp-paper [data-paper="grid"]').click()`);
  check('grid paper applies to the editor', await js(`document.getElementById('jp-textarea').dataset.paper === 'grid' && getComputedStyle(document.getElementById('jp-textarea')).backgroundImage.includes('linear-gradient')`));

  console.log('\nto-do day plan');
  await js(`document.querySelector('.sidebar-btn[data-view="todo-page"]').click()`);
  await wait(300);
  check('coaching line is shown', await js(`document.querySelector('.td-coach-main').textContent.includes('Be specific with what you want to get done today')`));
  await js(`(() => { const t = document.getElementById('td-title'); t.value = 'Draft essay introduction 45m at 2pm'; t.dispatchEvent(new Event('input')); })()`);
  const preview = await js(`document.getElementById('td-preview').textContent`);
  check('preview reads the time out of the text', preview.includes('45 min') && /Starts\s*2:00/i.test(preview) && /Done\s*2:45/i.test(preview), preview);
  await js(`document.querySelector('#td-add .td-add-btn').click()`);
  await wait(500);
  const row = await js(`(() => { const r = document.querySelector('#td-list .td-item'); return r && { title: r.querySelector('.td-item-title').textContent, meta: r.querySelector('.td-item-meta').textContent }; })()`);
  check('task is added with the time words taken out of its title', row && row.title === 'Draft essay introduction', JSON.stringify(row));
  check('task shows its length and its slot', row && row.meta.includes('45 min') && /2:00.*2:45/.test(row.meta), JSON.stringify(row));
  await js(`(() => { const t = document.getElementById('td-title'); t.value = 'Problem set 3 30m'; document.querySelector('#td-add .td-add-btn').click(); })()`);
  await wait(500);
  check('summary says when you should be finished', await js(`/finished by/.test(document.getElementById('td-summary').textContent)`));
  await js(`(() => { const t = document.getElementById('td-rem-title'); t.value = 'Bring library card'; t.form.requestSubmit(); })()`);
  await wait(500);
  check('a thing to remember lands in its own list', await js(`[...document.querySelectorAll('#td-rem-list .td-item-title')].some(n => n.textContent === 'Bring library card')`));

  // Drag "Problem set 3" from To do into To remember, below the existing item.
  await js(`(() => {
    const row = [...document.querySelectorAll('#td-list .td-item')].find(r => r.textContent.includes('Problem set 3'));
    const list = document.getElementById('td-rem-list');
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const b = list.getBoundingClientRect();
    list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: b.bottom - 2 }));
    list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: b.bottom - 2 }));
  })()`);
  await wait(600);
  const remTitles = await js(`[...document.querySelectorAll('#td-rem-list .td-item-title')].map(n => n.textContent)`);
  check('dragging a task into To remember moves it there, at the drop point', JSON.stringify(remTitles) === JSON.stringify(['Bring library card', 'Problem set 3']), JSON.stringify(remTitles));

  await js(`document.querySelector('.sidebar-btn[data-view="schedule-page"]').click()`);
  await wait(800);
  await js(`[...document.querySelectorAll('#sc-seg button')].find(b => b.dataset.mode === 'day').click()`);
  await wait(600);
  check('the timed task appears on the schedule', await js(`[...document.querySelectorAll('.sc-todo .sc-ev-title')].some(n => n.textContent === 'Draft essay introduction')`));
  check('the remember items appear in the all-day row', await js(`[...document.querySelectorAll('.sc-todo-chip')].some(n => n.textContent.includes('Bring library card'))`));
  await shot('schedule-todos.png');
  await js(`document.querySelector('.sc-todo').click()`);
  await wait(400);
  check('clicking it opens the to-do list', await js(`document.body.dataset.view === 'todo-page'`));
  await shot('todo.png');

  console.log('\nbackground image');
  await js(`document.querySelector('.sidebar-btn[data-view="settings-page"]').click()`);
  check('remove button hidden with no upload', await js(`document.getElementById('set-bg-clear').hidden`));
  // Stand in for an upload: a stored image, then pick Image so Settings redraws.
  await js(`localStorage.setItem('ethos.backdropImage', 'data:image/jpeg;base64,AAAA');
    [...document.querySelectorAll('#set-bg-mode .set-seg')].find(b => b.textContent === 'Image').click()`);
  check('remove button shows once an image is uploaded', await js(`!document.getElementById('set-bg-clear').hidden`));
  await js(`document.querySelector('.set-tile:last-child').click()`);
  await js(`document.getElementById('set-bg-clear').click()`);
  check('remove forgets the image and hides the button', await js(`!localStorage.getItem('ethos.backdropImage') && document.getElementById('set-bg-clear').hidden`));
  check('the backdrop falls back to a preset', await js(`document.getElementById('bd-image').style.backgroundImage.includes('backgrounds/peaks.jpg')`));
  await shot('settings.png');

  console.log('\nnote links and graph');
  // Polls for the expected state instead of sleeping a fixed time (bugs.md 8.10).
  const until = async (code, ms = 3000) => {
    for (let t = 0; t <= ms; t += 100) { if (await js(code)) return true; await wait(100); }
    return false;
  };
  const newNote = async (title) => {
    await js(`document.getElementById('sb-new-page').click()`);
    await until(`document.body.dataset.view === 'notes-page' && !document.getElementById('nt-doc').hidden`);
    await js(`(() => { const t = document.getElementById('nt-title'); t.value = ${JSON.stringify(title)}; t.dispatchEvent(new Event('input')); })()`);
    return until(`[...document.querySelectorAll('#sb-tree .sb-row-label')].some(n => n.textContent === ${JSON.stringify(title)})`);
  };
  check('three notes are created', (await newNote('Gamma')) && (await newNote('Beta')) && (await newNote('Alpha')));
  await js(`document.getElementById('nt-link-add').click()`);
  const offered = await js(`[...document.querySelectorAll('#nt-picker-list .nt-pick-title')].map(n => n.textContent)`);
  check('the picker offers the other notes, not this one', offered.includes('Beta') && offered.includes('Gamma') && !offered.includes('Alpha'), JSON.stringify(offered));
  await js(`(() => { const i = document.getElementById('nt-picker-input'); i.value = 'bet'; i.dispatchEvent(new Event('input'));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  check('Enter links the match and shows it as a chip',
    await until(`[...document.querySelectorAll('#nt-links-out .nt-link-open')].map(n => n.textContent).join() === 'Beta'`));
  check('the picker closes after a pick', await js(`document.getElementById('nt-picker').hidden`));
  // An autosave redraws the chips; one already shown must hold still.
  await js(`(() => { const b = document.getElementById('nt-body'); b.value = 'See Beta.'; b.dispatchEvent(new Event('input')); })()`);
  check('an autosave does not replay the chip animation',
    await until(`document.querySelector('#nt-links-out .nt-link-chip').classList.contains('settled')`));
  await wait(400);
  await shot('note-links.png');
  await js(`document.querySelector('#nt-links-out .nt-link-open').click()`);
  check('the chip opens the linked note', await until(`document.getElementById('nt-title').value === 'Beta'`));
  check('the linked note lists its backlink',
    await until(`!document.getElementById('nt-backlinks').hidden && document.getElementById('nt-links-in').textContent.includes('Alpha')`));

  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }))`);
  check('Ctrl+G opens the graph as its own view', await until(`document.body.dataset.view === 'graph-page'`));
  check('the sidebar toggle shows it is on', await js(`document.getElementById('sb-graph').getAttribute('aria-pressed') === 'true'`));
  check('the graph has every note and the one link',
    await until(`(() => { const c = document.getElementById('gr-canvas'); return c.dataset.nodes === '3' && c.dataset.links === '1'; })()`),
    await js(`JSON.stringify(document.getElementById('gr-canvas').dataset)`));
  await wait(900);
  check('the canvas is drawn on', await js(`(() => { const c = document.getElementById('gr-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n > 200; })()`));
  await shot('graph.png');
  await js(`document.querySelector('#graph-page .gr-chip[data-pref="orphans"]').click()`);
  check('"Unlinked notes" off hides the note with no links', await until(`document.getElementById('gr-canvas').dataset.nodes === '2'`));
  await js(`document.querySelector('#graph-page .gr-chip[data-pref="orphans"]').click()`);
  await until(`document.getElementById('gr-canvas').dataset.nodes === '3'`);
  check('every note is reachable by keyboard', await js(`[...document.querySelectorAll('#gr-list .gr-node-btn')].length === 3`));
  await js(`document.getElementById('sb-graph').click()`);
  check('the toggle closes it and goes back to where you were', await until(`document.body.dataset.view === 'notes-page' && document.getElementById('nt-title').value === 'Beta'`));
  await js(`document.getElementById('sb-graph').click()`);
  await until(`document.body.dataset.view === 'graph-page'`);
  await js(`[...document.querySelectorAll('#gr-list .gr-node-btn')].find(b => b.textContent.startsWith('Alpha')).click()`);
  check('choosing a node opens that note', await until(`document.body.dataset.view === 'notes-page' && document.getElementById('nt-title').value === 'Alpha'`));

  // Deleting Beta has to take Alpha's link to it along.
  await js(`[...document.querySelectorAll('#sb-tree .sb-row-main')].find(b => b.textContent === 'Beta').click()`);
  await until(`document.getElementById('nt-title').value === 'Beta'`);
  await js(`document.getElementById('nt-delete').click()`);
  await until(`![...document.querySelectorAll('#sb-tree .sb-row-label')].some(n => n.textContent === 'Beta')`);
  await js(`[...document.querySelectorAll('#sb-tree .sb-row-main')].find(b => b.textContent === 'Alpha').click()`);
  check('deleting a note removes the links to it',
    await until(`document.getElementById('nt-title').value === 'Alpha' && !document.querySelector('#nt-links-out .nt-link-open')`));

  console.log('\nconsole');
  check('no renderer errors', errors.length === 0, errors.join(' | '));
}

app.whenReady().then(() => run().catch(err => { console.error(err); results.push({ ok: false }); }).finally(() => {
  const failed = results.filter(r => !r.ok).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  console.log('screenshots: ' + tmp);
  app.exit(failed ? 1 : 0);
}));
