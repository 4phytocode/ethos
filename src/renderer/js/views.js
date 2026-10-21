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

let ctxMenu = null;

// items: [{ label, onClick }]
export function showCtx(event, items) {
  closeCtx();
  ctxMenu = document.createElement('div');
  ctxMenu.className = 'ctx-menu';

  for (const item of items) {
    const row = document.createElement('div');
    row.textContent = item.label;
    row.addEventListener('click', () => { closeCtx(); item.onClick(); });
    ctxMenu.appendChild(row);
  }

  ctxMenu.style.left = event.clientX + 'px';
  ctxMenu.style.top = event.clientY + 'px';
  document.body.appendChild(ctxMenu);
}

export function closeCtx() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
}
