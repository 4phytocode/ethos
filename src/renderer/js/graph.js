// The graph: every Notes page and folder in one picture, after Obsidian's.
//
// Pages are dots, sized by how many links they have; folders are rings. A solid
// line is a link one page makes to another (page.links); a faint dashed line
// ties a page to its folder. The layout is a small force simulation: nodes push
// each other apart, lines pull like springs, a weak pull keeps everything near
// the middle. Only the view preferences are stored; positions are rebuilt each
// session.
//
// Read-only over the model. Clicking a page opens it in the Notes view; links
// are made in the note itself. Drawn on a canvas: a few hundred nodes stay
// cheap, and there is no inline style for the CSP to refuse.
//
// Same rules as the schedule: things move on springs, gesture listeners go on
// window, and prefers-reduced-motion settles the layout before it is shown.

import * as state from './state.js';
import { show, current, onEnter, onLeave } from './views.js';
import { openPage, currentPageId } from './notes.js';
import { onThemeChange } from './theme.js';

const VIEW = 'graph-page';
const PREFS_KEY = 'ethos.graph';

// Forces, per tick, scaled by the simulation's heat (alpha).
const REPEL = 320;             // push between every pair
const REPEL_RANGE2 = 600 * 600; // beyond this the push is negligible
const LINK_LEN = 70, LINK_K = 0.08;
const FOLDER_LEN = 48, FOLDER_K = 0.05;
const GRAVITY = 0.012;
const DAMPING = 0.6;           // share of velocity kept per tick
const ALPHA_MIN = 0.004;       // below this the layout counts as settled
const MIN_ZOOM = 0.2, MAX_ZOOM = 4;
const CLICK_SLOP = 4;          // px of travel before a press becomes a drag

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let canvas, ctx, statsEl, emptyEl, listEl, searchEl, sbBtn, panelEl;
let width = 0, height = 0, dpr = 1;
let colors = { fg: '#000', muted: '#6b6b6b', bg: '#fff', font: 'system-ui, sans-serif' };

let nodes = new Map();         // id -> node
let nodeList = [];
let edges = [];                // { a, b, kind: 'link' | 'folder', mutual }
let neighbours = new Map();    // id -> Set of ids

let alpha = 0, alphaTarget = 0;
let frame = 0;                 // pending requestAnimationFrame id
let cam = { x: 0, y: 0, k: 1 };
let camTo = null;              // where the camera is easing to, or null
let placed = false;            // has the layout been fitted to the view yet
let stale = true;              // the model changed while the graph was hidden

let hover = null;              // node under the pointer
let keyFocus = null;           // node whose list button has keyboard focus
let selected = null;           // folder clicked to keep its family lit
let drag = null;
let query = '';
let returnTo = 'notes-page';

let prefs = loadPrefs();

function loadPrefs() {
  const base = { folders: true, orphans: true, temporary: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return base; }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not fatal */ }
}

const pageName = (p) => p.title || 'Untitled';

// ─── Opening and closing ───

// The graph is a separate view, toggled on and off. Closing it returns to
// whatever was open before.
export function toggleGraph() {
  if (current() === VIEW) show(returnTo && returnTo !== VIEW ? returnTo : 'notes-page');
  else { returnTo = current(); show(VIEW); }
}

// ─── Building the picture from the model ───

function build() {
  const pages = state.pages().filter(p => prefs.temporary || !p.temporary);
  const ids = new Set(pages.map(p => p.id));

  // One line per pair, however many directions it is linked in.
  const linkEdges = [];
  const byPair = new Map();
  for (const p of pages) {
    for (const l of p.links) {
      if (!ids.has(l)) continue;
      const key = p.id < l ? p.id + '|' + l : l + '|' + p.id;
      const seen = byPair.get(key);
      if (seen) { seen.mutual = true; continue; }
      const e = { a: p.id, b: l, kind: 'link', mutual: false };
      byPair.set(key, e);
      linkEdges.push(e);
    }
  }
  const degree = new Map();
  for (const e of linkEdges) {
    degree.set(e.a, (degree.get(e.a) || 0) + 1);
    degree.set(e.b, (degree.get(e.b) || 0) + 1);
  }

  const shownPages = prefs.orphans ? pages : pages.filter(p => degree.get(p.id));
  const shownIds = new Set(shownPages.map(p => p.id));
  const folders = prefs.folders ? state.folders() : [];
  const folderIds = new Set(folders.map(f => f.id));

  edges = linkEdges.filter(e => shownIds.has(e.a) && shownIds.has(e.b));
  for (const p of shownPages) {
    if (p.folderId && folderIds.has(p.folderId)) edges.push({ a: p.folderId, b: p.id, kind: 'folder', mutual: false });
  }

  neighbours = new Map();
  for (const e of edges) {
    if (!neighbours.has(e.a)) neighbours.set(e.a, new Set());
    if (!neighbours.has(e.b)) neighbours.set(e.b, new Set());
    neighbours.get(e.a).add(e.b);
    neighbours.get(e.b).add(e.a);
  }

  // Keep every node that survives where it was, so a change elsewhere does not
  // throw the picture around. A new node starts beside something it touches.
  const old = nodes;
  nodes = new Map();
  const make = (id, kind, label, extra) => {
    const prev = old.get(id);
    const n = prev || { id, x: 0, y: 0, vx: 0, vy: 0, g: 0, gv: 0, fixed: false, fresh: true };
    Object.assign(n, { kind, label, ...extra });
    nodes.set(id, n);
    return n;
  };
  for (const f of folders) {
    const count = shownPages.filter(p => p.folderId === f.id).length;
    make(f.id, 'folder', f.name, { r: 7 + Math.min(9, Math.sqrt(count) * 2), temporary: false });
  }
  for (const p of shownPages) {
    const d = degree.get(p.id) || 0;
    make(p.id, 'page', pageName(p), { r: 4 + Math.min(8, Math.sqrt(d) * 2.2), temporary: p.temporary });
  }
  nodeList = [...nodes.values()];

  for (const n of nodeList) {
    if (!n.fresh) continue;
    n.fresh = false;
    const anchor = [...(neighbours.get(n.id) || [])].map(id => nodes.get(id)).find(m => m && !m.fresh);
    const spread = anchor ? 30 : 60 + Math.sqrt(nodeList.length) * 30;
    const angle = Math.random() * Math.PI * 2;
    const dist = (anchor ? 0.6 : 0.2) * spread + Math.random() * spread;
    n.x = (anchor ? anchor.x : 0) + Math.cos(angle) * dist;
    n.y = (anchor ? anchor.y : 0) + Math.sin(angle) * dist;
  }
  if (hover && !nodes.has(hover.id)) hover = null;
  if (keyFocus && !nodes.has(keyFocus.id)) keyFocus = null;
  if (selected && !nodes.has(selected)) selected = null;

  const linkCount = edges.filter(e => e.kind === 'link').length;
  statsEl.textContent = shownPages.length + (shownPages.length === 1 ? ' note' : ' notes') +
    ' · ' + linkCount + (linkCount === 1 ? ' link' : ' links') +
    (prefs.folders ? ' · ' + folders.length + (folders.length === 1 ? ' folder' : ' folders') : '');
  emptyEl.hidden = nodeList.length > 0;
  canvas.dataset.nodes = String(nodeList.length);
  canvas.dataset.links = String(linkCount);
  renderList(shownPages);
  stale = false;
}

// The nodes as real buttons: Tab reaches each note, focusing one lights it up
// in the picture and brings it into view, Enter opens it.
function renderList(pages) {
  listEl.replaceChildren();
  for (const p of [...pages].sort((a, b) => pageName(a).localeCompare(pageName(b)))) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gr-node-btn';
    b.dataset.id = p.id;
    const links = (neighbours.get(p.id) || new Set()).size;
    b.textContent = pageName(p) + ', ' + links + (links === 1 ? ' connection' : ' connections');
    b.addEventListener('focus', () => { keyFocus = nodes.get(p.id) || null; if (keyFocus) centreOn(keyFocus); kick(); });
    b.addEventListener('blur', () => { keyFocus = null; kick(); });
    b.addEventListener('click', () => openPage(p.id));
    li.append(b);
    listEl.append(li);
  }
}

// ─── Simulation ───

function heat(a) { alpha = Math.max(alpha, a); kick(); }

function tick() {
  const list = nodeList;
  const a = alpha;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    for (let j = i + 1; j < list.length; j += 1) {
      const q = list[j];
      let dx = q.x - p.x, dy = q.y - p.y;
      let d2 = dx * dx + dy * dy;
      if (d2 > REPEL_RANGE2) continue;
      if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
      const f = REPEL * a / d2;
      p.vx -= dx * f; p.vy -= dy * f;
      q.vx += dx * f; q.vy += dy * f;
    }
  }
  for (const e of edges) {
    const p = nodes.get(e.a), q = nodes.get(e.b);
    const dx = q.x - p.x, dy = q.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const [len, k] = e.kind === 'link' ? [LINK_LEN, LINK_K] : [FOLDER_LEN, FOLDER_K];
    const s = (d - len) * k * a / d;
    p.vx += dx * s; p.vy += dy * s;
    q.vx -= dx * s; q.vy -= dy * s;
  }
  for (const n of list) {
    if (n.fixed) { n.vx = 0; n.vy = 0; continue; }
    n.vx = (n.vx - n.x * GRAVITY * a) * DAMPING;
    n.vy = (n.vy - n.y * GRAVITY * a) * DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }
  alpha += (alphaTarget - alpha) * 0.02;
}

// Runs the layout to rest without drawing: for the first open, and for
// reduced motion, where the picture should appear already settled.
function settle(maxTicks) {
  alpha = Math.max(alpha, 1);
  for (let i = 0; i < maxTicks && alpha > ALPHA_MIN; i += 1) tick();
}

// ─── Camera ───

function toWorld(sx, sy) { return { x: (sx - cam.x) / cam.k, y: (sy - cam.y) / cam.k }; }

function fitTarget() {
  if (!nodeList.length) return { x: width / 2, y: height / 2, k: 1 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodeList) {
    x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r);
    x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 18);
  }
  // Fit into the space beside the floating panel, not under it. On a narrow
  // window the panel spans the top instead, and the whole width is used.
  const pad = 60;
  const box = panelEl.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  const left = width > 700 ? Math.max(pad, box.right - c.left + 24) : pad;
  const top = width > 700 ? pad : Math.max(pad, box.bottom - c.top + 16);
  const w = Math.max(width - left - pad, 80), h = Math.max(height - top - pad, 80);
  const k = clamp(Math.min(w / Math.max(x1 - x0, 1), h / Math.max(y1 - y0, 1)), MIN_ZOOM, 1.6);
  return { x: left + w / 2 - ((x0 + x1) / 2) * k, y: top + h / 2 - ((y0 + y1) / 2) * k, k };
}

function fit(animate = true) {
  const t = fitTarget();
  if (animate && !reduceMotion.matches) { camTo = t; kick(); } else { cam = t; camTo = null; draw(); }
}

function centreOn(n) {
  const k = Math.max(cam.k, 0.9);
  const t = { x: width / 2 - n.x * k, y: height / 2 - n.y * k, k };
  if (reduceMotion.matches) { cam = t; camTo = null; } else camTo = t;
}

function zoomAt(sx, sy, factor) {
  const k = clamp(cam.k * factor, MIN_ZOOM, MAX_ZOOM);
  const w = toWorld(sx, sy);
  cam = { x: sx - w.x * k, y: sy - w.y * k, k };
  camTo = null;
  kick();
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ─── The frame loop ───
// Runs only while something is moving: the layout cooling, a node's hover
// spring, or the camera easing. Idle, the graph costs nothing.

function kick() {
  if (!frame && current() === VIEW) frame = requestAnimationFrame(step);
}

function step() {
  frame = 0;
  let moving = false;
  if (alpha > ALPHA_MIN || drag) {
    if (reduceMotion.matches && !drag) settle(300); else tick();
    moving = alpha > ALPHA_MIN || !!drag;
  }
  // Each node's highlight is a small spring, so it swells past its size and
  // settles back rather than snapping.
  const lit = litSet();
  for (const n of nodeList) {
    const target = !lit ? 0 : lit.centre === n ? 1 : lit.focus.has(n.id) ? 0.3 : 0;
    if (reduceMotion.matches) { n.g = target; n.gv = 0; continue; }
    n.gv = (n.gv + (target - n.g) * 0.2) * 0.7;
    n.g += n.gv;
    if (Math.abs(target - n.g) > 0.002 || Math.abs(n.gv) > 0.002) moving = true;
  }
  if (camTo) {
    const e = 0.16;
    cam = { x: cam.x + (camTo.x - cam.x) * e, y: cam.y + (camTo.y - cam.y) * e, k: cam.k + (camTo.k - cam.k) * e };
    if (Math.abs(camTo.x - cam.x) < 0.3 && Math.abs(camTo.y - cam.y) < 0.3 && Math.abs(camTo.k - cam.k) < 0.001) {
      cam = camTo; camTo = null;
    } else moving = true;
  }
  draw();
  if (moving) kick();
}

// What is lit: the node under the pointer (or keyboard focus, or a clicked
// folder) and everything it touches. Search matches light up on their own.
function litSet() {
  const centre = drag && drag.node ? drag.node : hover || keyFocus || (selected && nodes.get(selected));
  const q = query;
  if (!centre && !q) return null;
  const focus = new Set();
  if (centre) {
    focus.add(centre.id);
    for (const id of neighbours.get(centre.id) || []) focus.add(id);
  }
  if (q) for (const n of nodeList) if (n.label.toLowerCase().includes(q)) focus.add(n.id);
  return { centre, focus };
}

function readColors() {
  const cs = getComputedStyle(document.body);
  colors = {
    fg: cs.getPropertyValue('--fg').trim() || '#000',
    muted: cs.getPropertyValue('--muted').trim() || '#6b6b6b',
    bg: cs.getPropertyValue('--bg').trim() || '#fff',
    font: cs.fontFamily || 'system-ui, sans-serif',
  };
}

function draw() {
  if (!ctx || !width) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.translate(cam.x, cam.y);
  ctx.scale(cam.k, cam.k);

  const lit = litSet();
  const openId = currentPageId();
  const touches = (e) => lit && lit.centre && (e.a === lit.centre.id || e.b === lit.centre.id);

  // Lines first, so dots sit on top of them.
  ctx.lineCap = 'round';
  for (const e of edges) {
    const p = nodes.get(e.a), q = nodes.get(e.b);
    const on = touches(e);
    ctx.globalAlpha = lit ? (on ? 0.85 : 0.07) : (e.kind === 'link' ? 0.32 : 0.16);
    ctx.strokeStyle = on ? colors.fg : (e.kind === 'link' ? colors.fg : colors.muted);
    ctx.lineWidth = (e.kind === 'link' ? (e.mutual ? 1.8 : 1.2) : 1) / cam.k * (on ? 1.4 : 1);
    ctx.setLineDash(e.kind === 'folder' ? [4 / cam.k, 4 / cam.k] : []);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
    // A one-way link gets a small arrowhead at the page it points to, when lit.
    if (on && e.kind === 'link' && !e.mutual) arrow(p, q);
  }
  ctx.setLineDash([]);

  for (const n of nodeList) {
    const dim = lit && !lit.focus.has(n.id);
    const r = n.r * (1 + 0.45 * n.g);
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    if (n.kind === 'folder') {
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = 2 / cam.k;
      ctx.strokeStyle = colors.muted;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(1.5, r * 0.28), 0, Math.PI * 2);
      ctx.fillStyle = colors.muted;
      ctx.fill();
    } else if (n.temporary) {
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.lineWidth = 1.5 / cam.k;
      ctx.strokeStyle = colors.fg;
      ctx.stroke();
    } else {
      ctx.fillStyle = colors.fg;
      ctx.fill();
    }
    // The note open in the editor wears a ring, so you can find your place.
    if (n.id === openId) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 4 / cam.k, 0, Math.PI * 2);
      ctx.lineWidth = 1.2 / cam.k;
      ctx.strokeStyle = colors.fg;
      ctx.stroke();
    }
  }

  // Labels: all of them once zoomed in, otherwise only what is lit. Constant
  // size on screen, so zooming never makes text unreadable.
  const zoomShow = clamp((cam.k - 0.55) / 0.3, 0, 1);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const n of nodeList) {
    const isLit = lit && lit.focus.has(n.id);
    const a = isLit ? 1 : (lit ? zoomShow * 0.25 : zoomShow * 0.8);
    if (a < 0.02) continue;
    const size = (n.kind === 'folder' ? 12 : 11.5) * (1 + 0.12 * n.g);
    ctx.font = (n.kind === 'folder' ? '600 ' : '') + (size / cam.k) + 'px ' + colors.font;
    ctx.globalAlpha = a;
    ctx.fillStyle = isLit ? colors.fg : colors.muted;
    const label = n.label.length > 32 ? n.label.slice(0, 31) + '…' : n.label;
    ctx.fillText(label, n.x, n.y + n.r * (1 + 0.45 * n.g) + 5 / cam.k);
  }
  ctx.globalAlpha = 1;
}

function arrow(p, q) {
  const dx = q.x - p.x, dy = q.y - p.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / d, uy = dy / d;
  const tip = q.r * (1 + 0.45 * q.g) + 2 / cam.k;
  const x = q.x - ux * tip, y = q.y - uy * tip;
  const s = 6 / cam.k;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - ux * s - uy * s * 0.6, y - uy * s + ux * s * 0.6);
  ctx.lineTo(x - ux * s + uy * s * 0.6, y - uy * s - ux * s * 0.6);
  ctx.closePath();
  ctx.fillStyle = colors.fg;
  ctx.fill();
}

// ─── Input ───

function local(e) {
  const b = canvas.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
}

function hit(sx, sy) {
  const w = toWorld(sx, sy);
  let best = null, bestD = Infinity;
  for (const n of nodeList) {
    const d = Math.hypot(n.x - w.x, n.y - w.y);
    const reach = n.r * (1 + 0.45 * n.g) + 5 / cam.k;
    if (d <= reach && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const p = local(e);
  const node = hit(p.x, p.y);
  drag = { node, sx: p.x, sy: p.y, cx: cam.x, cy: cam.y, moved: false };
  camTo = null;
  if (node) { node.fixed = true; alphaTarget = 0.25; heat(0.3); }
  canvas.classList.add('grabbing');
  try { canvas.setPointerCapture(e.pointerId); } catch { /* window listeners cover it */ }
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!drag) return;
  const p = local(e);
  if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) > CLICK_SLOP) drag.moved = true;
  if (!drag.moved) return;
  if (drag.node) {
    const w = toWorld(p.x, p.y);
    drag.node.x = w.x;
    drag.node.y = w.y;
  } else {
    cam = { ...cam, x: drag.cx + p.x - drag.sx, y: drag.cy + p.y - drag.sy };
  }
  kick();
}

function onDragEnd() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragEnd);
  canvas.classList.remove('grabbing');
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.node) { d.node.fixed = false; alphaTarget = 0; heat(0.12); }
  if (d.moved) return;
  // A press that did not travel is a click.
  if (!d.node) { selected = null; kick(); return; }
  if (d.node.kind === 'page') openPage(d.node.id);
  else { selected = selected === d.node.id ? null : d.node.id; kick(); }
}

function onHover(e) {
  if (drag) return;
  const p = local(e);
  const n = hit(p.x, p.y);
  if (n !== hover) {
    hover = n;
    canvas.classList.toggle('over-node', !!n);
    canvas.title = n ? (n.kind === 'page' ? 'Open ' + n.label : n.label + ' (folder)') : '';
    kick();
  }
}

function onKey(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') {
    e.preventDefault();
    toggleGraph();
    return;
  }
  if (current() !== VIEW) return;
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key === 'Escape') {
    if (e.target === searchEl && searchEl.value) { searchEl.value = ''; query = ''; kick(); return; }
    e.preventDefault();
    toggleGraph();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'f' || e.key === 'F') fit();
  else if (e.key === '+' || e.key === '=') zoomAt(width / 2, height / 2, 1.25);
  else if (e.key === '-') zoomAt(width / 2, height / 2, 0.8);
}

function resize() {
  const b = canvas.getBoundingClientRect();
  if (!b.width || !b.height) return;
  const firstSize = !width;
  dpr = window.devicePixelRatio || 1;
  // Keep the middle of the picture in the middle when the window changes size.
  if (!firstSize) { cam.x += (b.width - width) / 2; cam.y += (b.height - height) / 2; }
  width = b.width;
  height = b.height;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  draw();
}

// ─── Enter / leave ───

function enter() {
  sbBtn.setAttribute('aria-pressed', 'true');
  sbBtn.classList.add('on');
  readColors();
  resize();
  if (stale) build();
  if (!placed) {
    // First look: settle out of sight, then fit, then let it breathe a little.
    settle(reduceMotion.matches ? 400 : 160);
    fit(false);
    placed = true;
    if (!reduceMotion.matches) heat(0.15);
  } else {
    heat(0.08);
  }
  kick();
}

function leave() {
  sbBtn.setAttribute('aria-pressed', 'false');
  sbBtn.classList.remove('on');
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  hover = null;
  keyFocus = null;
  if (drag) onDragEnd();
}

// ─── Init ───

export function initGraph() {
  canvas = document.getElementById('gr-canvas');
  ctx = canvas.getContext('2d');
  statsEl = document.getElementById('gr-stats');
  emptyEl = document.getElementById('gr-empty');
  listEl = document.getElementById('gr-list');
  searchEl = document.getElementById('gr-search');
  sbBtn = document.getElementById('sb-graph');
  panelEl = document.querySelector('#graph-page .gr-panel');

  sbBtn.addEventListener('click', toggleGraph);
  document.getElementById('nt-graph').addEventListener('click', toggleGraph);
  document.getElementById('gr-close').addEventListener('click', toggleGraph);
  document.getElementById('gr-fit').addEventListener('click', () => fit());

  for (const chip of document.querySelectorAll('#graph-page .gr-chip[data-pref]')) {
    const key = chip.dataset.pref;
    chip.setAttribute('aria-pressed', String(prefs[key]));
    chip.addEventListener('click', () => {
      prefs[key] = !prefs[key];
      chip.setAttribute('aria-pressed', String(prefs[key]));
      savePrefs();
      build();
      heat(0.4);
    });
  }

  searchEl.addEventListener('input', () => { query = searchEl.value.trim().toLowerCase(); kick(); });
  // Enter brings the first match into view.
  searchEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !query) return;
    const n = nodeList.find(m => m.label.toLowerCase().includes(query));
    if (n) { centreOn(n); kick(); }
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('pointerleave', () => { if (hover && !drag) { hover = null; canvas.classList.remove('over-node'); kick(); } });
  canvas.addEventListener('dblclick', (e) => { const p = local(e); if (!hit(p.x, p.y)) fit(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  document.addEventListener('keydown', onKey);

  new ResizeObserver(() => { if (current() === VIEW) resize(); }).observe(canvas);
  // Light and dark swap the palette; the canvas does not inherit CSS.
  onThemeChange(() => { if (current() === VIEW) { readColors(); draw(); } });

  onEnter(VIEW, enter);
  onLeave(VIEW, leave);

  state.subscribe(() => {
    if (current() !== VIEW) { stale = true; return; }
    build();
    heat(0.3);
  });
}
