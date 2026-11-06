// View switching and the shared right-click menu.

const viewEls = {};
const hooks = { leave: {}, enter: {} };

export function initViews() {
  document.querySelectorAll('.view').forEach(v => { viewEls[v.id] = v; });

  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => show(btn.dataset.view));
  });

  const brand = document.getElementById('brand-home');
  brand.addEventListener('click', () => show('home'));

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => show(btn.dataset.back));
  });
  document.querySelectorAll('[data-view-link]').forEach(btn => {
    btn.addEventListener('click', () => show(btn.dataset.viewLink));
  });

  document.addEventListener('click', closeCtx);

  // Chrome that belongs to only some views keys off this, so it has to be
  // right before the first navigation, not just after one.
  const active = document.querySelector('.view.active');
  document.body.dataset.view = active ? active.id : 'home';
  document.querySelectorAll('.sidebar-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.view === document.body.dataset.view));
}

// Lets a view run something when it is navigated away from, e.g. the note
// editor persisting what is in its fields.
export function onLeave(viewId, fn) { hooks.leave[viewId] = fn; }

// Runs once the view is visible, so it can measure itself (scroll positions,
// popover anchors). A hidden view has no layout.
export function onEnter(viewId, fn) { hooks.enter[viewId] = fn; }

export function current() { return document.body.dataset.view; }

export function show(name) {
  // A view that belongs to the full edition goes Home in the demo, however it was
  // reached (sidebar, link, or a stale shortcut).
  if (document.body.dataset.edition === 'demo') {
    const target = document.getElementById(name);
    if (target && target.hasAttribute('data-full-only')) name = 'home';
  }
  const was = document.body.dataset.view;
  for (const key in viewEls) {
    const wasActive = viewEls[key].classList.contains('active');
    if (wasActive && key !== name && hooks.leave[key]) hooks.leave[key]();
    viewEls[key].classList.toggle('active', key === name);
  }
  document.body.dataset.view = name;
  document.querySelectorAll('.sidebar-btn')
    .forEach(b => b.classList.toggle('active', b.dataset.view === name));
  closeCtx();
  if (hooks.enter[name] && was !== name) hooks.enter[name]();
}

// ─── Context menu ───
//
// items: [{ label, onClick }] plus, all optional:
//   hint: 'Ctrl+B'       right-aligned shortcut text
//   disabled, checked    greyed out / ticked
//   color: '#rrggbb'     a small colour square before the label
//   danger               shown in the danger colour
//   submenu: [items]     opens beside the row
// and the non-rows { separator: true } and { heading: 'Insert' }.
//
// Opens at the pointer (an event) or at { x, y }. Keyboard: Up/Down move, Right
// opens a submenu, Left closes it, Enter runs, Esc closes one level, a letter
// jumps to the next row that starts with it. It closes on a click elsewhere, on
// Esc, when the window loses focus, on scroll, and on a view change.

const HEX = /^#[0-9a-f]{6}$/i;
let ctxStack = [];        // open menus, the outermost first
let ctxReturn = null;     // where focus goes back to if the menu had it
let ctxOpenTimer = null;

function itemRows(menu) {
  return [...menu.children].filter(n => n.classList.contains('menu-item') && !n.disabled);
}

function buildMenu(items, level) {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu menu';
  menu.setAttribute('role', 'menu');
  menu.dataset.level = String(level);
  // Pressing a row must not take the caret or selection from what is behind it.
  menu.addEventListener('mousedown', (e) => e.preventDefault());
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  for (const item of items) {
    if (item.separator) {
      const s = document.createElement('div');
      s.className = 'menu-sep';
      s.setAttribute('role', 'separator');
      menu.appendChild(s);
      continue;
    }
    if (item.heading) {
      const h = document.createElement('div');
      h.className = 'menu-heading';
      h.textContent = item.heading;
      menu.appendChild(h);
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'menu-item' + (item.danger ? ' danger' : '');
    row.setAttribute('role', item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
    if (item.checked !== undefined) row.setAttribute('aria-checked', String(!!item.checked));
    row.disabled = !!item.disabled;

    const lead = document.createElement('span');
    lead.className = 'menu-lead';
    if (item.color && HEX.test(item.color)) {
      const sw = document.createElement('i');
      sw.className = 'menu-swatch';
      sw.style.background = item.color;
      lead.appendChild(sw);
    } else if (item.checked) {
      lead.classList.add('menu-check');
    }
    row.appendChild(lead);

    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = item.label;
    row.appendChild(label);

    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'menu-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }

    if (item.submenu) {
      row.classList.add('has-sub');
      row.setAttribute('aria-haspopup', 'menu');
      const arrow = document.createElement('span');
      arrow.className = 'menu-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      row.appendChild(arrow);
      row.addEventListener('click', (e) => { e.stopPropagation(); openSub(row, item.submenu, level); });
      row.addEventListener('pointerenter', () => {
        clearTimeout(ctxOpenTimer);
        ctxOpenTimer = setTimeout(() => openSub(row, item.submenu, level), 120);
      });
    } else {
      row.addEventListener('pointerenter', () => { clearTimeout(ctxOpenTimer); closeAbove(level); });
      row.addEventListener('click', () => { if (item.disabled) return; closeCtx(); if (item.onClick) item.onClick(); });
    }
    menu.appendChild(row);
  }
  return menu;
}

function clampInto(menu, x, y) {
  const box = menu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function closeAbove(level) {
  while (ctxStack.length > level + 1) ctxStack.pop().remove();
  document.querySelectorAll('.menu-item.sub-open').forEach(r => {
    if (!ctxStack.some(m => m.parentRow === r)) r.classList.remove('sub-open');
  });
}

function openSub(row, items, level) {
  closeAbove(level);
  if (ctxStack[level + 1] && ctxStack[level + 1].parentRow === row) return;
  const sub = buildMenu(items, level + 1);
  sub.parentRow = row;
  row.classList.add('sub-open');
  document.body.appendChild(sub);
  const r = row.getBoundingClientRect();
  const box = sub.getBoundingClientRect();
  // To the right of the row; to the left when it would run off the window.
  const x = r.right + box.width + 4 <= window.innerWidth ? r.right - 2 : r.left - box.width + 2;
  clampInto(sub, x, r.top - 3);
  ctxStack.push(sub);
}

function onKey(e) {
  if (!ctxStack.length) return;
  const menu = ctxStack[ctxStack.length - 1];
  const rows = itemRows(menu);
  const at = rows.indexOf(document.activeElement);
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (e.key === 'Escape') {
    stop();
    if (ctxStack.length > 1) {
      const parent = menu.parentRow;
      closeAbove(ctxStack.length - 2);
      if (parent) { parent.classList.remove('sub-open'); parent.focus(); }
    } else closeCtx();
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    stop();
    if (!rows.length) return;
    const next = e.key === 'ArrowDown' ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
    rows[next].focus();
  } else if (e.key === 'ArrowRight') {
    if (at >= 0 && rows[at].classList.contains('has-sub')) { stop(); rows[at].click(); const s = ctxStack[ctxStack.length - 1]; const first = itemRows(s)[0]; if (first) first.focus(); }
  } else if (e.key === 'ArrowLeft') {
    if (ctxStack.length > 1) {
      stop();
      const parent = menu.parentRow;
      closeAbove(ctxStack.length - 2);
      if (parent) { parent.classList.remove('sub-open'); parent.focus(); }
    }
  } else if (e.key === 'Home' || e.key === 'End') {
    stop();
    if (rows.length) rows[e.key === 'Home' ? 0 : rows.length - 1].focus();
  } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const ch = e.key.toLowerCase();
    const order = rows.slice(at + 1).concat(rows.slice(0, at + 1));
    const hit = order.find(r => r.textContent.trim().toLowerCase().startsWith(ch));
    if (hit) { stop(); hit.focus(); }
  } else if (e.key === 'Tab') {
    stop();   // Tab does not leave an open menu
  }
}

// A scroll closes the menu, but not the one a moment ago that opening it caused
// (a handle click scrolls its block into view, and that scroll event arrives late).
let ctxOpenedAt = 0;
const closeOnScroll = (e) => {
  if (performance.now() - ctxOpenedAt < 250) return;
  if (!e.target.closest || !e.target.closest('.ctx-menu')) closeCtx();
};

export function showCtx(event, items) {
  closeCtx();
  ctxOpenedAt = performance.now();
  ctxReturn = document.activeElement;
  const menu = buildMenu(items, 0);
  document.body.appendChild(menu);
  const x = typeof event.clientX === 'number' ? event.clientX : event.x;
  const y = typeof event.clientY === 'number' ? event.clientY : event.y;
  // The menu opens at the pointer, but never past the window's right or bottom
  // edge (bugs.md 2.4): it moves back in by its own size when it would overflow.
  clampInto(menu, x, y);
  ctxStack = [menu];
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);
  document.addEventListener('scroll', closeOnScroll, true);
}

export function closeCtx() {
  clearTimeout(ctxOpenTimer);
  if (!ctxStack.length) return;
  const hadFocus = ctxStack.some(m => m.contains(document.activeElement));
  for (const m of ctxStack) m.remove();
  ctxStack = [];
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('blur', closeCtx);
  window.removeEventListener('resize', closeCtx);
  document.removeEventListener('scroll', closeOnScroll, true);
  if (hadFocus && ctxReturn && ctxReturn.isConnected && typeof ctxReturn.focus === 'function') ctxReturn.focus();
  ctxReturn = null;
}

export function ctxOpen() { return ctxStack.length > 0; }
