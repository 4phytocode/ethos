// Ethos 1.1 checks, run from ui-test.js inside the same window and vault.
// Drives the page through the UI and the state module, never window.ethos directly.

module.exports = async function runV11({ win, js, until, check, wait, shot }) {
  const key = (k, extra = '', target = 'document') =>
    js(`${target}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true${extra ? ', ' + extra : ''} }))`);
  const state = (expr) => js(`import('./js/state.js').then(s => (${expr}))`);
  const show = (view) => js(`import('./js/views.js').then(v => v.show(${JSON.stringify(view)}))`);

  // ───────────────────────── 2.1 background image opacity
  console.log('\nv1.1: background opacity');
  await show('settings-page');
  await js(`(() => { const r = document.getElementById('set-bg-opacity'); r.value = '40'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  check('the opacity slider sets the image opacity', await js(`getComputedStyle(document.body).getPropertyValue('--bd-image-opacity').trim() === '0.4' && document.getElementById('set-bg-opacity-num').textContent === '40%'`));
  check('and it is remembered', await js(`JSON.parse(localStorage.getItem('ethos.backdrop')).imageOpacity === 0.4`));
  await js(`(() => { const r = document.getElementById('set-bg-opacity'); r.value = '100'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);

  // ───────────────────────── 2.2 to-do description
  console.log('\nv1.1: to-do description');
  const today = await js(`import('./js/journal-streak.js').then(m => m.todayISO())`);
  const ids = await js(`import('./js/state.js').then(async s => {
    const a = await s.createTodo({ title: 'Write report', kind: 'task', date: ${JSON.stringify(today)}, minutes: 30 });
    const b = await s.createTodo({ title: 'Other task', kind: 'task', date: ${JSON.stringify(today)}, minutes: 20 });
    return [a.id, b.id];
  })`);
  await show('todo-page');
  await until(`!!document.querySelector('[data-todo-id="${ids[0]}"] .td-disclose')`);
  await js(`document.querySelector('[data-todo-id="${ids[0]}"] .td-disclose').click()`);
  check('the disclosure opens a description box', await until(`!!document.querySelector('[data-todo-id="${ids[0]}"] .td-desc')`));
  await js(`(() => { const t = document.querySelector('[data-todo-id="${ids[0]}"] .td-desc'); t.focus(); t.value = 'Intro, two paragraphs, sources.'; t.dispatchEvent(new Event('input')); })()`);
  await wait(700);
  check('typing saves the description', await state(`s.todo('${ids[0]}').description === 'Intro, two paragraphs, sources.'`));
  await js(`import('./js/state.js').then(s => s.updateTodo('${ids[1]}', { done: true }))`);
  await wait(300);
  check('the row stays open through an unrelated change', await js(`!!document.querySelector('[data-todo-id="${ids[0]}"] .td-desc')`));
  check('the box kept its text', await js(`document.querySelector('[data-todo-id="${ids[0]}"] .td-desc').value === 'Intro, two paragraphs, sources.'`));
  await js(`document.querySelector('[data-todo-id="${ids[0]}"] .td-disclose').click()`);
  check('collapsed, a one-line preview shows', await until(`document.querySelector('[data-todo-id="${ids[0]}"] .td-desc-preview')?.textContent.startsWith('Intro')`));

  // ───────────────────────── 2.3 context menu
  console.log('\nv1.1: context menu');
  await js(`window.__hit = ''; import('./js/views.js').then(v => v.showCtx({ x: 120, y: 120 }, [
    { heading: 'Insert' },
    { label: 'Sub', submenu: [{ label: 'Inner one', onClick: () => { window.__hit = 'inner'; } }] },
    { label: 'Off', disabled: true, onClick: () => { window.__hit = 'off'; } },
    { separator: true },
    { label: 'Tick', checked: true, hint: 'Ctrl+T', onClick: () => { window.__hit = 'tick'; } },
  ]))`);
  check('the menu shows heading, separator, hint and check', await until(`!!document.querySelector('.ctx-menu .menu-heading') && !!document.querySelector('.ctx-menu .menu-sep') && !!document.querySelector('.ctx-menu .menu-hint') && !!document.querySelector('.ctx-menu .menu-check')`));
  await key('ArrowDown');
  await key('ArrowRight');
  check('Right opens the submenu', await until(`document.querySelectorAll('.ctx-menu').length === 2`));
  await key('Enter');
  await js(`document.activeElement && document.activeElement.click && document.activeElement.classList.contains('menu-item') && document.activeElement.click()`);
  check('Enter in the submenu runs its item', await until(`window.__hit === 'inner'`));
  check('and the menu closes', await until(`document.querySelectorAll('.ctx-menu').length === 0`));
  await js(`window.__hit = ''; import('./js/views.js').then(v => v.showCtx({ x: 120, y: 120 }, [{ label: 'Off', disabled: true, onClick: () => { window.__hit = 'off'; } }, { label: 'On', onClick: () => { window.__hit = 'on'; } }]))`);
  await js(`document.querySelector('.ctx-menu .menu-item:disabled').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check('a disabled row does nothing', await js(`window.__hit === ''`));
  await key('Escape');
  check('Esc closes the menu', await until(`document.querySelectorAll('.ctx-menu').length === 0`));

  // ───────────────────────── 2.4 folders
  console.log('\nv1.1: folders');
  const f = await js(`import('./js/state.js').then(async s => {
    const a = await s.createFolder({ name: 'Uni' });
    const b = await s.createFolder({ name: 'Maths', parentId: a.id });
    const tag = await s.createTag({ name: 'exams', color: s.tagColorPalette()[2] });
    await s.updateFolder(a.id, { color: s.tagColorPalette()[1], tagIds: [tag.id] });
    return { a: a.id, b: b.id, color: s.tagColorPalette()[1] };
  })`);
  await show('notes-page');
  await until(`!!document.querySelector('#sb-tree [data-folder-id="${f.a}"]')`);
  check('a folder inside a folder is drawn indented', await js(`(() => { const a = document.querySelector('[data-folder-id="${f.a}"]'); const b = document.querySelector('[data-folder-id="${f.b}"]'); return !!a && !!b && b.closest('.sb-folder').parentElement.closest('.sb-folder') === a.closest('.sb-folder') && b.style.getPropertyValue('--depth') === '1'; })()`));
  check('a coloured folder tints its glyph', await js(`document.querySelector('[data-folder-id="${f.a}"] .sb-row-main > svg').style.color !== ''`));
  check('a tagged folder shows its tag dot', await js(`!!document.querySelector('[data-folder-id="${f.a}"] .sb-tag-dot')`));
  const refused = await js(`import('./js/state.js').then(s => s.updateFolder('${f.a}', { parentId: '${f.b}' }).then(() => false, () => true))`);
  check('a folder cannot go inside its own folder', refused);
  await js(`document.querySelector('[data-folder-id="${f.a}"] .sb-row-main').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 200 }))`);
  check('the folder menu has Colour, Tags and Move to submenus', await js(`[...document.querySelectorAll('.ctx-menu .menu-item.has-sub')].map(n => n.textContent).join('|').match(/Colour.*Tags.*Move to/) !== null`));
  await key('Escape');
  await js(`import('./js/state.js').then(s => s.removeFolder('${f.a}'))`);
  check('deleting a folder moves its subfolder to the top', await state(`s.folder('${f.b}').parentId === null`));
  await js(`import('./js/state.js').then(s => s.removeFolder('${f.b}'))`);

  // ───────────────────────── 2.5 search
  console.log('\nv1.1: search');
  await js(`import('./js/state.js').then(async s => {
    const folder = await s.createFolder({ name: 'Archive' });
    const tag = await s.createTag({ name: 'zebratag', color: s.tagColorPalette()[3] });
    await s.updateFolder(folder.id, { tagIds: [tag.id] });
    const p = await s.createPage({ folderId: null });
    await s.updatePage(p.id, { title: 'Quantum notes', blocks: [{ id: 'b1', type: 'p', spans: [{ t: 'Superposition and entanglement' }] }] });
  })`);
  await show('home');
  await js(`document.activeElement && document.activeElement.blur()`);
  await key('Tab');
  check('Tab on the page opens search', await until(`!!document.querySelector('.fs-scrim .fs-input')`));
  await key('Tab');
  check('Tab inside it changes what is searched', await js(`document.querySelector('.fs-chip[aria-pressed="true"]').textContent === 'Notes'`));
  await js(`(() => { const i = document.querySelector('.fs-input'); i.value = 'entangle'; i.dispatchEvent(new Event('input')); })()`);
  check('note text is searched', await until(`document.querySelector('.fs-row .fs-title')?.textContent === 'Quantum notes'`));
  await key('Alt', '');
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', altKey: true, bubbles: true, cancelable: true }))`);
  await js(`(() => { const i = document.querySelector('.fs-input'); i.value = 'zebratag'; i.dispatchEvent(new Event('input')); })()`);
  check('a folder is found by its tag name', await until(`document.querySelector('.fs-row .fs-title')?.textContent === 'Archive'`));
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', altKey: true, bubbles: true, cancelable: true }))`);
  await js(`(() => { const i = document.querySelector('.fs-input'); i.value = 'quantum'; i.dispatchEvent(new Event('input')); })()`);
  await until(`document.querySelector('.fs-row .fs-title')?.textContent === 'Quantum notes'`);
  await key('Enter');
  check('Enter opens the note', await until(`document.body.dataset.view === 'notes-page' && document.getElementById('nt-title').value === 'Quantum notes' && !document.querySelector('.fs-scrim')`));
  await show('todo-page');
  await js(`(document.querySelector('#todo-page input[type="text"], #todo-page input:not([type])') || {}).focus && document.querySelector('#todo-page input[type="text"], #todo-page input:not([type])').focus()`);
  const typingIn = await js(`document.activeElement && document.activeElement.tagName`);
  await key('Tab', '', 'document.activeElement');
  check('Tab while typing in a field does not open search', typingIn === 'INPUT' && !(await js(`!!document.querySelector('.fs-scrim')`)));
  await js(`document.querySelector('.fs-scrim') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await js(`document.activeElement && document.activeElement.blur(); localStorage.setItem('ethos.keys.tabSearch', 'off')`);
  await key('Tab');
  await wait(150);
  check('with the setting off, Tab does not open it', !(await js(`!!document.querySelector('.fs-scrim')`)));
  await js(`localStorage.removeItem('ethos.keys.tabSearch')`);
  await js(`document.getElementById('sb-search').click()`);
  check('the sidebar magnifier opens it', await until(`!!document.querySelector('.fs-scrim')`));
  await key('Escape');
  check('Esc closes it', await until(`!document.querySelector('.fs-scrim')`));

  // ───────────────────────── 2.6 command bar
  console.log('\nv1.1: command bar');
  await show('home');
  await js(`document.activeElement && document.activeElement.blur()`);
  await key('/');
  check('"/" opens the command bar', await until(`!!document.querySelector('.cmdbar .cmd-input') && document.querySelector('.cmd-input').value === '/'`));
  check('the bar is at the bottom right', await js(`(() => { const r = document.querySelector('.cmdbar').getBoundingClientRect(); return r.bottom > innerHeight - 40 && r.right > innerWidth / 2; })()`));
  await js(`(() => { const i = document.querySelector('.cmd-input'); i.value = '/zzz'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  check('an unknown command says so', await js(`document.querySelector('.cmd-error').textContent.includes("'zzz' is not a command")`));
  await js(`(() => { const i = document.querySelector('.cmd-input'); i.value = '/shut'; i.dispatchEvent(new Event('input')); })()`);
  check('typing "shut" lists shut-down', await js(`document.querySelector('.cmd-row .cmd-name')?.textContent === 'shut-down'`));
  await key('Escape');
  check('Esc closes it', await until(`!document.querySelector('.cmdbar')`));
  await show('notes-page');
  await js(`document.getElementById('nt-title').focus()`);
  await key('/', '', 'document.activeElement');
  check('"/" while typing does not open it', !(await js(`!!document.querySelector('.cmdbar')`)));
  await js(`document.activeElement.blur(); localStorage.setItem('ethos.test.noQuit', '1'); window.__shutdownCalls = 0`);
  await key('/');
  await until(`!!document.querySelector('.cmd-input')`);
  await js(`(() => { const i = document.querySelector('.cmd-input'); i.value = '/shut-down'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()`);
  check('Enter starts the outro', await until(`!!document.getElementById('outro')`, 1500));
  await wait(1500);
  await shot('outro-ring.png');
  check('the outro is still playing mid-way', await js(`!!document.getElementById('outro')`));
  check('and has not quit yet', await js(`window.__shutdownCalls === 0`));
  check('shut-down is called once, after the show', await until(`window.__shutdownCalls === 1`, 6000));
  check('the outro is cleared in the test', await js(`!document.getElementById('outro')`));
  await js(`localStorage.removeItem('ethos.test.noQuit')`);

  // ───────────────────────── 2.7 currently doing
  console.log('\nv1.1: currently doing');
  check('the card is in the sidebar foot, beside Settings', await js(`(() => { const s = document.querySelector('.sb-foot .sidebar-btn').getBoundingClientRect(); const n = document.getElementById('sb-now').getBoundingClientRect(); return n.left >= s.right - 1 && Math.abs(n.bottom - s.bottom) < 20; })()`));
  check('it draws a pixel cup with steam', await js(`document.querySelectorAll('#sb-now .now-cup-svg rect').length > 9 && document.querySelectorAll('#sb-now .now-steam').length === 3`));
  check('the time reads mm:ss or a dash', await js(`/^(\\d+:)?\\d\\d:\\d\\d$|^--:--$/.test(document.getElementById('now-time').textContent)`));
  check('the task line is small until hovered', await js(`parseFloat(getComputedStyle(document.getElementById('now-task')).fontSize) <= 10.5`));
  const r = await js(`(() => { const b = document.getElementById('sb-now').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
  win.focus();
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await wait(100);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: r.x, y: r.y });
  await wait(500);
  check('hovering makes the task larger', await js(`parseFloat(getComputedStyle(document.getElementById('now-task')).fontSize) >= 11.5`));
  await shot('nowcard-hover.png');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 5 });
  await js(`import('./js/state.js').then(async s => { for (const t of s.todos()) if (!t.done) await s.updateTodo(t.id, { done: true }); })`);
  await wait(300);
  check('with no task it says so', await js(`document.getElementById('now-task').textContent === 'No task'`));
  await js(`import('./js/state.js').then(s => s.createTodo({ title: 'Read chapter four', kind: 'task', date: ${JSON.stringify(today)}, minutes: 25 }))`);
  check('a task appears on the card', await until(`document.getElementById('now-task').textContent === 'Read chapter four'`));

  // ───────────────────────── 2.8 floating timers
  console.log('\nv1.1: floating timers');
  await show('timer-page');
  await js(`(() => { document.getElementById('tm-name').value = 'Float me'; document.getElementById('tm-h').value = '0'; document.getElementById('tm-m').value = '5'; document.getElementById('tm-s').value = '0'; document.getElementById('tm-submit').click(); })()`);
  await until(`!!document.querySelector('#tm-list [data-id]')`);
  const tid = await js(`[...document.querySelectorAll('#tm-list [data-id]')].find(n => n.textContent.includes('Float me')).dataset.id`);
  check('there is a timer to float', !!tid);
  await js(`document.querySelector('#tm-list [data-id="${tid}"] .tm-pop').click()`);
  check('Pop out makes a floating window outside the views', await until(`!!document.querySelector('#tm-floats .tmf[data-id="${tid}"]') && !document.querySelector('.view .tmf')`));
  await show('home');
  check('it stays over other views', await js(`document.querySelector('#tm-floats .tmf').getBoundingClientRect().width > 100`));
  const x0 = await js(`document.querySelector('.tmf').getBoundingClientRect().left`);
  await js(`(() => { const bar = document.querySelector('.tmf .tmf-bar'); const b = bar.getBoundingClientRect();
    bar.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: b.left + 30, clientY: b.top + 8 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + 30 - 150, clientY: b.top + 8 + 60 }));
    window.dispatchEvent(new PointerEvent('pointerup', {})); })()`);
  await wait(900);
  const x1 = await js(`document.querySelector('.tmf').getBoundingClientRect().left`);
  check('dragging the title bar moves the window', Math.abs((x0 - x1) - 150) < 4, 'moved ' + (x0 - x1));
  check('the new place is saved', await js(`(() => { const t = JSON.parse(localStorage.getItem('ethos.timers')).timers.find(t => t.id === '${tid}'); return t.float && t.float.open && Math.abs(t.float.x - ${x1}) <= 1; })()`));
  await js(`document.querySelector('.tmf .tmf-min').click()`);
  check('minimising leaves only the bar, with the time in it', await js(`document.querySelector('.tmf').classList.contains('min') && getComputedStyle(document.querySelector('.tmf .tmf-body')).display === 'none' && /\\d\\d:\\d\\d/.test(document.querySelector('.tmf .win-title-text').textContent)`));
  await js(`document.querySelector('.tmf .tmf-min').click()`);
  await key('T', 'ctrlKey: true, shiftKey: true');
  check('Ctrl+Shift+T hides the floating timers', await until(`!document.querySelector('.tmf')`));
  await key('T', 'ctrlKey: true, shiftKey: true');
  check('and brings them back', await until(`!!document.querySelector('.tmf')`));
  await js(`import('./js/views.js').then(() => { const t = document.querySelector('.tmf'); t.style.left = '-5000px'; })`);
  await js(`window.dispatchEvent(new Event('resize'))`);
  await wait(900);
  check('a window off the screen is pulled back', await js(`document.querySelector('.tmf').getBoundingClientRect().right > 20`));
  await shot('timer-float.png');
  await js(`document.querySelector('.tmf .tmf-close').click()`);
  check('close removes the window', await until(`!document.querySelector('.tmf')`));
  await show('home');
};
