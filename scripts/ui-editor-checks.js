// The note editor, driven the way a person drives it: real key events and typed
// characters (sendInputEvent), not synthetic page events, wherever the browser's
// own typing path matters.

const fs = require('fs');
const path = require('path');

module.exports = async function editorChecks({ win, js, until, check, wait, shot, tmp }) {
  const wc = win.webContents;
  const KEY = { ' ': 'Space', '\n': 'Return' };
  const typed = async (text) => {
    for (const ch of text) {
      const kc = KEY[ch] || (/[a-z0-9]/i.test(ch) ? ch : null);
      if (kc) wc.sendInputEvent({ type: 'keyDown', keyCode: kc });
      wc.sendInputEvent({ type: 'char', keyCode: ch });
      if (kc) wc.sendInputEvent({ type: 'keyUp', keyCode: kc });
    }
    await wait(60);
  };
  const press = async (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(50);
  };
  const ed = (expr) => js(`import('./js/editor/index.js').then(m => (${expr}))`);
  const blocks = () => ed('m.getBlocks()');
  const sketch = (bs) => bs.map(b => b.type + (b.indent ? '@' + b.indent : '') + ':' + (b.spans ? b.spans.map(s => (s.m ? '[' + s.m.join('') + ']' : '') + s.t).join('') : b.type === 'code' ? b.text : '')).join('|');
  const sk = async () => sketch(await blocks());
  const setCaret = (sel, off) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); const n = t.firstChild; const s = getSelection();
    if (!n) { s.collapse(t, 0); return; } s.collapse(n, ${off === 'end' ? 'n.length' : off}); })()`);
  const selectText = (sel, a, b) => js(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); const n = t.firstChild; getSelection().setBaseAndExtent(n, ${a}, n, ${b}); })()`);
  const focusedBlock = () => js(`(() => { const e = document.activeElement && document.activeElement.closest('.eb'); return e ? e.dataset.id : null; })()`);

  console.log('\nv1.1 editor: typing and keys');
  win.focus();
  const pid = await js(`import('./js/state.js').then(async s => { const p = await s.createPage({}); await s.updatePage(p.id, { title: 'Editor test' }); return p.id; })`);
  await js(`import('./js/notes.js').then(m => m.openPage(${JSON.stringify(pid)}))`);
  await until(`!!document.querySelector('#nt-blocks .eb-text')`);
  check('a new note has one empty paragraph', (await sk()) === 'p:');
  check('the native caret is hidden and the drawn caret exists', await js(`getComputedStyle(document.querySelector('.eb-text')).caretColor !== getComputedStyle(document.querySelector('.eb-text')).color && !!document.querySelector('.ed-caret')`));
  check('the page has no border around the title', await js(`(() => { const s = getComputedStyle(document.getElementById('nt-title')); return s.borderTopWidth === '0px' && s.boxShadow === 'none'; })()`));

  await js(`document.querySelector('#nt-blocks .eb-text').focus()`);
  await typed('Hello world');
  check('typed text reaches the model', (await sk()) === 'p:Hello world', await sk());
  await selectText('#nt-blocks .eb-text', 6, 11);
  await press('B', ['control']);
  check('Ctrl+B bolds the selection', (await sk()) === 'p:Hello [b]world', await sk());
  await press('Z', ['control']);
  check('Ctrl+Z undoes it', (await sk()) === 'p:Hello world', await sk());
  await press('Y', ['control']);
  check('Ctrl+Y redoes it', (await sk()) === 'p:Hello [b]world', await sk());
  await selectText('#nt-blocks .eb-text', 0, 5);
  await press('I', ['control']);
  await press('U', ['control']);
  await press('X', ['control', 'shift']);
  check('italic, underline and strikethrough combine', (await blocks())[0].spans[0].m.join('') === 'ius', JSON.stringify((await blocks())[0].spans[0]));
  await press('Space', ['control']);
  check('Ctrl+Space clears the formatting', !(await blocks())[0].spans[0].m, JSON.stringify((await blocks())[0].spans));

  // A caret with nothing selected: bold, then type.
  await js(`(() => { const t = document.querySelector('#nt-blocks .eb-text'); t.focus(); getSelection().setBaseAndExtent(t, t.childNodes.length, t, t.childNodes.length); })()`);
  await press('Return');
  await press('B', ['control']);
  await typed('bolded');
  check('bold with no selection applies to what is typed next', (await sk()) === 'p:Hello [b]world|p:[b]bolded', await sk());
  await press('Return');
  await typed('# ');
  check('"# " turns a paragraph into a heading', (await blocks())[2].type === 'h1', await sk());
  await typed('Title');
  await press('Return');
  check('Enter after a heading gives a paragraph', (await blocks())[3].type === 'p', await sk());
  await typed('- one');
  await press('Return');
  await press('Tab');
  await typed('two');
  check('"- " makes a list, Enter continues it, Tab indents it', (await sk()).endsWith('bullet:one|bullet@1:two'), await sk());
  await press('Return');
  await press('Return');
  check('Enter on an empty item steps out one level', (await sk()).endsWith('bullet@1:two|bullet:'), await sk());
  await press('Return');
  check('and then ends the list', (await sk()).endsWith('bullet@1:two|p:'), await sk());
  await typed('1. first');
  check('"1. " starts a numbered list', (await blocks()).slice(-1)[0].type === 'number', await sk());
  await press('Return');
  await typed('second');
  check('the numbers count up', await js(`[...document.querySelectorAll('.eb-number .eb-mark')].map(n => n.textContent).join() === '1.,2.'`));
  await press('Return');
  await press('Return');
  await typed('[] ');
  await typed('call mum');
  check('"[] " makes a task, which can be ticked', (await blocks()).slice(-1)[0].type === 'todo', await sk());
  await js(`document.querySelector('.eb-todo .eb-tick').click()`);
  check('ticking a task crosses it out', await js(`document.querySelector('.eb-todo').classList.contains('checked')`) && (await blocks()).slice(-1)[0].checked === true);

  await press('Return');
  await press('Return');
  await typed('ab');
  await press('Left');
  await press('Return');
  check('Enter splits a paragraph at the caret', (await sk()).endsWith('p:a|p:b'), await sk());
  await press('Backspace');
  check('Backspace at the start joins it back', (await sk()).endsWith('p:ab') && !(await sk()).endsWith('p:a|p:b'), await sk());

  console.log('\nv1.1 editor: undo, toggles, code');
  await press('End');
  await press('Return');
  await typed('one');
  await wait(900);
  await typed(' two');
  const before = await sk();
  await press('Z', ['control']);
  check('undo steps back one burst of typing', (await sk()) !== before && (await sk()).endsWith('p:one'), await sk());
  await press('Y', ['control']);
  check('redo brings it back', (await sk()) === before, await sk());
  await press('Return');
  await typed('> ');
  await typed('More');
  check('"> " makes a toggle', (await blocks()).slice(-1)[0].type === 'toggle', await sk());
  await press('Return');
  await typed('hidden');
  check('Enter in an open toggle makes an indented child', (await sk()).endsWith('toggle:More|p@1:hidden'), await sk());
  await js(`document.querySelector('.eb-toggle .eb-arrow').click()`);
  check('closing the toggle hides its contents', await js(`document.querySelector('.eb-toggle ~ .eb[data-indent="1"]').hidden === true`) && (await blocks()).slice(-2)[0].open === false);
  await js(`document.querySelector('.eb-toggle .eb-arrow').click()`);

  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.focus(); getSelection().setBaseAndExtent(t, t.childNodes.length, t, t.childNodes.length); })()`);
  await press('Return');
  await press('Return');
  await typed('```js');
  await press('Return');
  check('a code fence makes a code block', (await blocks()).slice(-1)[0].type === 'code' && (await blocks()).slice(-1)[0].lang === 'javascript', await sk());
  check('and puts the caret in it', await js(`document.activeElement.classList.contains('code-in')`));
  await typed('const x = 1;');
  await press('Tab');
  check('typing in code reaches the model', (await blocks()).slice(-1)[0].text === 'const x = 1;  ', JSON.stringify((await blocks()).slice(-1)[0].text));
  check('code is highlighted, and Tab adds two spaces', await js(`!!document.querySelector('.code-hl .tk-kw') && document.querySelector('.code-hl .tk-kw').textContent === 'const'`));
  await press('Escape');
  check('Esc leaves the code block for a paragraph', (await blocks()).slice(-1)[0].type === 'p' && await js(`document.activeElement.classList.contains('eb-text')`), await sk());
  check('the line caret is a thin bar', await js(`document.querySelector('.ed-caret').getBoundingClientRect().width <= 3`));
  await shot('editor-blocks.png');

  console.log('\nv1.1 editor: insert mode and the caret');
  await typed('abc');
  await press('Home');
  await press('Insert');
  check('Insert shows OVR in the toolbar', await js(`!document.querySelector('.tb-ovr').hidden`));
  check('the caret becomes a block', await until(`(() => { const c = document.querySelector('.ed-caret'); return c && !c.hidden && c.classList.contains('block') && c.getBoundingClientRect().width > 4; })()`));
  await typed('X');
  check('typing in Insert mode replaces the next character', (await sk()).endsWith('p:Xbc'), await sk());
  await press('Insert');
  check('Insert again goes back to a line caret', await js(`document.querySelector('.tb-ovr').hidden && !document.querySelector('.ed-caret').classList.contains('block')`));
  await typed('Q');
  check('and typing inserts again', (await sk()).endsWith('p:XQbc'), await sk());

  console.log('\nv1.1 editor: paste, links, footnotes, find');
  await press('Return');
  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.focus(); const dt = new DataTransfer();
    dt.setData('text/html', '<b>bold</b> plain<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2"><a href="javascript:alert(1)">bad</a>');
    dt.setData('text/plain', 'bold plain bad'); t.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
  await wait(100);
  const pasted = (await blocks()).slice(-1)[0];
  check('pasted HTML keeps bold and drops scripts, images and bad links', pasted.spans[0].m && pasted.spans[0].m[0] === 'b' && !pasted.spans.some(s => s.href) &&
    await js(`!document.querySelector('#nt-blocks script, #nt-blocks img') && !window.__pwned`), JSON.stringify(pasted.spans));
  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.focus(); getSelection().selectAllChildren(t); })()`);
  await press('K', ['control']);
  check('Ctrl+K opens the link dialog', await until(`!!document.querySelector('.dlg-scrim input')`));
  await js(`(() => { const i = document.querySelectorAll('.dlg-scrim input'); i[1].value = 'javascript:alert(1)'; i[1].dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('a javascript: address cannot be used', await js(`document.querySelector('.dlg-scrim .dlg-buttons .primary').disabled === true`));
  await js(`(() => { const i = document.querySelectorAll('.dlg-scrim input'); i[1].value = 'example.com/page'; i[1].dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await js(`document.querySelector('.dlg-scrim .dlg-buttons .primary').click()`);
  await wait(150);
  check('a plain address becomes an https link', (await blocks()).slice(-1)[0].spans.some(s => s.href === 'https://example.com/page'), JSON.stringify((await blocks()).slice(-1)[0].spans));

  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.focus(); getSelection().collapse(t, t.childNodes.length); })()`);
  await press('Return');
  await typed('word');
  await press('F', ['control', 'alt']);
  await typed('!');
  check('Ctrl+Alt+F inserts a footnote and lists it', await js(`document.querySelectorAll('.eb-text .fn').length === 1 && document.querySelector('.eb-text .fn').dataset.n === '1' && !!document.querySelector('.fnl .fnl-text')`));
  await js(`(() => { const t = document.querySelector('.fnl-text'); t.focus(); t.value = 'A note.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('the footnote text is kept on the span', JSON.stringify(await blocks()).includes('"fn":"A note."'));
  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].find(x => x.textContent.startsWith('Hello')); t.focus(); getSelection().collapse(t.firstChild, 2); })()`);
  await press('F', ['control', 'alt']);
  check('a footnote placed earlier renumbers the later one', await js(`[...document.querySelectorAll('.eb-text .fn')].map(n => n.dataset.n).join() === '1,2'`));

  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.focus(); getSelection().collapse(t, t.childNodes.length); })()`);
  await press('Return');
  await typed('the cat the dog the');
  await press('F', ['control']);
  check('Ctrl+F opens find', await until(`!document.querySelector('.ed-find').hidden`));
  await js(`(() => { const i = document.querySelector('.find-input'); i.value = 'the'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('find counts the matches', await until(`document.querySelector('.find-count').textContent === '1 of 3'`), await js(`document.querySelector('.find-count').textContent`));
  await press('H', ['control']);
  await js(`(() => { const i = document.querySelectorAll('.find-input'); i[1].value = 'a'; })()`);
  await js(`[...document.querySelectorAll('.find-wide')].find(b => b.textContent === 'Replace all').click()`);
  check('Replace all changes every match', (await sk()).endsWith('p:a cat a dog a'), await sk());
  await press('Z', ['control']);
  check('and one undo puts them all back', (await sk()).endsWith('p:the cat the dog the'), await sk());
  await press('Escape');

  console.log('\nv1.1 editor: right-click, handles, blocks');
  const lastId = async () => (await blocks()).slice(-1)[0].id;
  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); })()`);
  check('right-click opens the Insert menu', await until(`!!document.querySelector('.ctx-menu .menu-heading') && document.querySelector('.ctx-menu .menu-heading').textContent === 'Insert'`));
  const labels = await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].map(n => n.querySelector('.menu-label').textContent)`);
  const want = ['Table', 'Task list', 'Toggle', 'Bulleted list', 'Numbered list', 'Divider (horizontal rule)', 'Footnote', 'Code block', 'Image…', 'Link / bookmark…', 'Text style'];
  check('it lists table, task list, toggle, bullets, rule, footnote, code, image, link, styles', want.every(w => labels.includes(w)), labels.join(' | '));
  const clickMenu = (label) => js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
  const rightClickLast = () => js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); })()`);
  await clickMenu('Divider (horizontal rule)');
  check('Divider adds a rule and a paragraph after it', (await blocks()).slice(-2)[0].type === 'divider' && (await blocks()).slice(-1)[0].type === 'p', await sk());
  for (const [label, type] of [['Task list', 'todo'], ['Toggle', 'toggle'], ['Bulleted list', 'bullet'], ['Numbered list', 'number']]) {
    await rightClickLast();
    await until(`!!document.querySelector('.ctx-menu')`);
    await clickMenu(label);
    check('Insert > ' + label + ' makes a ' + type + ' block', (await blocks()).some(b => b.type === type && b === b) && (await blocks()).slice(-1)[0].type === type, await sk());
    await press('Return');
    await press('Return');
    await press('Return');
  }
  await rightClickLast();
  await until(`!!document.querySelector('.ctx-menu')`);
  await clickMenu('Code block');
  check('Insert > Code block adds code', (await blocks()).slice(-1)[0].type === 'code');
  await press('Escape');
  await rightClickLast();
  await until(`!!document.querySelector('.ctx-menu')`);
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Table').click()`);
  await until(`document.querySelectorAll('.ctx-menu').length === 2`);
  await js(`document.querySelectorAll('.ctx-menu')[1].querySelector('.menu-item').click()`);
  check('Insert > Table > Blank adds a table block', await until(`document.querySelectorAll('#nt-blocks .eb-table .nt-table').length >= 1`));

  // The handle menu.
  await js(`(() => { const e = document.querySelector('.eb-h1'); e.querySelector('.eb-grip').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: e.getBoundingClientRect().top + 10 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: e.getBoundingClientRect().top + 10 })); })()`);
  check('clicking a block handle selects the block and opens its menu', await until(`document.querySelector('.eb-h1').classList.contains('selected') && !!document.querySelector('.ctx-menu')`));
  check('the block menu has Turn into, Colour, Duplicate and Delete', await js(`['Turn into', 'Colour', 'Duplicate', 'Delete block'].every(l => [...document.querySelectorAll('.ctx-menu .menu-label')].some(n => n.textContent === l))`));
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Duplicate').click()`);
  check('Duplicate copies the block', (await blocks()).filter(b => b.type === 'h1').length === 2, await sk());

  // Drag a block down by its handle.
  const beforeOrder = await sk();
  await js(`(() => { document.querySelector('.eb-h1').focus(); })()`);
  await js(`(() => { const first = document.querySelector('.eb-h1'); const grip = first.querySelector('.eb-grip'); const r = first.getBoundingClientRect(); const bottom = document.querySelector('#nt-blocks').lastElementChild.getBoundingClientRect();
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: r.left, clientY: r.top + 8 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left, clientY: r.top + 40 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left, clientY: bottom.bottom + 5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left, clientY: bottom.bottom + 5 })); })()`);
  await wait(300);
  check('dragging a handle moves the block', (await sk()) !== beforeOrder && (await blocks()).slice(-1)[0].type === 'h1', await sk());

  // Block selection with Esc.
  await js(`(() => { const t = document.querySelector('.eb-bullet .eb-text'); t.focus(); })()`);
  await press('Escape');
  check('Esc selects the block', await js(`document.querySelectorAll('.eb.selected').length === 1`));
  const countBefore = (await blocks()).length;
  await press('Delete');
  check('Delete removes the selected block', (await blocks()).length === countBefore - 1);

  console.log('\nv1.1 editor: images and bookmarks');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await js(`(() => { const t = [...document.querySelectorAll('.eb-text')].pop(); if (t) t.focus(); })()`);
  await js(`import('./js/editor/image.js').then(m => { const b = atob(${JSON.stringify(PNG)}); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return m.importImages([new File([a], 'dot.png', { type: 'image/png' })], null); })`);
  check('an imported image becomes an image block', await until(`!!document.querySelector('.eb-image img')`, 5000));
  check('the image loads from the vault', await until(`(() => { const i = document.querySelector('.eb-image img'); return i && i.complete && i.naturalWidth > 0 && i.getAttribute('src').startsWith('vault-assets/'); })()`, 4000));
  const assetDir = path.join(tmp, 'vault', 'assets');
  check('the file is in the vault assets folder', fs.existsSync(assetDir) && fs.readdirSync(assetDir).some(n => /^a_[0-9a-f-]{36}\.png$/.test(n)));
  check('the vault serves images, and nothing else under that name', await js(`Promise.all([fetch('vault-assets/' + document.querySelector('.eb-image img').getAttribute('src').split('/')[1]).then(r => r.status),
    fetch('vault-assets/..%2f..%2fmain%2fvault.js').then(r => r.status), fetch('vault-assets/not-an-image.png').then(r => r.status)]).then(s => s.join())`) === '200,404,404');
  await js(`document.querySelector('.eb-image .img-box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }))`);
  check('right-clicking an image offers size, align, full size and delete', await until(`['Size', 'Align', 'View full size', 'Delete image'].every(l => [...document.querySelectorAll('.ctx-menu .menu-label')].some(n => n.textContent === l))`));
  await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await js(`import('./js/editor/ops.js').then(o => { const id = document.querySelector('.eb-image').dataset.id; return import('./js/editor/handles.js').then(h => h.selectBlock(id)); })`);
  await press('Delete');
  check('selecting an image block and pressing Delete removes it', await js(`!document.querySelector('.eb-image')`));

  console.log('\nv1.1 editor: tables');
  const tbl = '#nt-blocks .eb-table:last-of-type';
  await until(`!!document.querySelector('#nt-blocks .nt-table')`);
  const cols0 = await js(`document.querySelectorAll('#nt-blocks .nt-table .nt-th').length`);
  await js(`(() => { const td = document.querySelector('#nt-blocks .nt-table tbody td.nt-td'); td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })); })()`);
  check('right-clicking a cell offers Row, Column and Table items', await until(`['Row', 'Column', 'Table'].every(l => [...document.querySelectorAll('.ctx-menu .menu-label')].some(n => n.textContent === l))`));
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Column').click()`);
  await until(`document.querySelectorAll('.ctx-menu').length >= 2`);
  check('the Column menu has type, calculation, sort, filter, hide, delete', await js(`['Type', 'Calculation', 'Sort ascending', 'Sort descending', 'Filter', 'Hide', 'Delete column'].every(l => [...document.querySelectorAll('.ctx-menu .menu-label')].some(n => n.textContent === l))`));
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Delete column').click()`);
  check('Delete column removes it', await until(`document.querySelectorAll('#nt-blocks .nt-table .nt-th').length === ${cols0 - 1}`));
  check('and says so with an Undo', await until(`!!document.querySelector('.ethos-notif-stack') && /Column deleted/.test(document.querySelector('.ethos-notif-stack').textContent)`));
  await until(`[...document.querySelectorAll('.ethos-notif-stack button')].some(b => /Undo/.test(b.textContent))`);
  await js(`[...document.querySelectorAll('.ethos-notif-stack button')].find(b => /Undo/.test(b.textContent)).click()`);
  check('Undo brings the column back', await until(`document.querySelectorAll('#nt-blocks .nt-table .nt-th').length === ${cols0}`));

  // Sort: a number column, descending.
  await js(`(async () => { const s = await import('./js/editor/state.js'); const t = s.S.tables[0];
    t.columns[1].type = 'number'; t.columns[1].options = [];
    t.rows[0].cells[t.columns[1].id] = 3; t.rows[1].cells[t.columns[1].id] = 30; t.rows[2].cells[t.columns[1].id] = 12; t.rows[0].cells[t.columns[0].id] = 'three'; t.rows[1].cells[t.columns[0].id] = 'thirty'; t.rows[2].cells[t.columns[0].id] = 'twelve';
    const o = await import('./js/editor/ops.js'); o.rebuildBlock(s.S.blocks.find(b => b.type === 'table').id); })()`);
  await js(`(() => { const th = document.querySelectorAll('#nt-blocks .nt-table .nt-th')[1]; th.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 })); })()`);
  await until(`!!document.querySelector('.ctx-menu')`);
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Column').click()`);
  await until(`document.querySelectorAll('.ctx-menu').length >= 2`);
  await js(`[...document.querySelectorAll('.ctx-menu .menu-item')].find(n => n.querySelector('.menu-label').textContent === 'Sort descending').click()`);
  check('sorting a number column descending puts the largest first', await until(`document.querySelector('#nt-blocks .nt-table tbody tr .nt-cell').value === 'thirty'`), await js(`[...document.querySelectorAll('#nt-blocks .nt-table tbody tr input.nt-cell')].map(i => i.value).join()`));
  check('the header shows the sort', await js(`!!document.querySelector('#nt-blocks .nt-table .nt-sort')`));

  console.log('\nv1.1 editor: saved shape and speed');
  await wait(900);
  const saved = await js(`import('./js/state.js').then(s => s.page(${JSON.stringify(pid)}))`);
  check('the page was saved as blocks', saved.blocks.length > 5 && saved.blocks.some(b => b.type === 'code') && saved.blocks.some(b => b.type === 'table'));
  check('the plain text is derived and holds the words', saved.content.includes('Hello world') && saved.content.includes('const x = 1;'));
  check('a saved sort is kept on the table', saved.tables[0].sort && saved.tables[0].sort.dir === 'desc');
  await js(`(async () => { const s = await import('./js/editor/state.js'); const o = await import('./js/editor/ops.js'); const m = await import('./js/editor/model.js');
    s.S.blocks = Array.from({ length: 2000 }, (_, i) => m.newBlock('p', { spans: [{ t: 'Paragraph number ' + i }] })); o.syncDOM(); })()`);
  const per = await js(`(() => { const t = document.querySelectorAll('#nt-blocks .eb-text')[1000]; t.focus(); getSelection().setBaseAndExtent(t, t.childNodes.length, t, t.childNodes.length);
    const t0 = performance.now(); for (let i = 0; i < 50; i++) { t.firstChild.nodeValue += 'x'; t.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' })); } return (performance.now() - t0) / 50; })()`);
  check('typing in a 2000-block note costs under 4 ms a character', per < 4, per.toFixed(2) + ' ms');
};
