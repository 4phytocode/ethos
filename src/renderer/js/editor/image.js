// Images, and bookmarks (a link shown as a card).
//
// An image is a file in the vault (vault/assets/<name>), imported through the
// main process, which checks what the bytes really are. The page shows it from
// app://ethos/vault-assets/<name>. Nothing is fetched from the network.

import { S, changed } from './state.js';
import * as M from './model.js';
import * as ops from './ops.js';
import { buildSide, applyAttrs, renderSpans, readSpans } from './dom.js';
import { icon } from '../icons.js';
import { cleanUrl } from './commands.js';
import { formDialog } from '../dialog.js';

const MAX_SIDE = 4096;
const MAX_BYTES = 10 * 1024 * 1024;
const SNAPS = [25, 50, 75, 100];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ─── Importing ───

async function prepare(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG, GIF or WebP image.');
  let blob = file;
  if (file.type !== 'image/gif') {
    try {
      const bmp = await createImageBitmap(file);
      const big = Math.max(bmp.width, bmp.height);
      if (big > MAX_SIDE) {
        const k = MAX_SIDE / big;
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        blob = await new Promise(r => c.toBlob(r, type, 0.9));
      }
      bmp.close();
    } catch { /* keep the original; main checks it */ }
  }
  if (blob.size > MAX_BYTES) throw new Error('Images can be up to 10 MB.');
  return new Uint8Array(await blob.arrayBuffer());
}

async function importOne(file) {
  const bytes = await prepare(file);
  const res = await window.ethos.assets.import(bytes);
  return res.asset;
}

// Add images after the block `afterId` (or the caret's block).
export async function importImages(files, afterId) {
  for (const f of files) {
    try {
      S.hooks.notify('Adding image', f.name || 'Pasted image');
      const asset = await importOne(f);
      if (afterId) S.lastId = afterId;
      ops.insertAfterCurrent(M.newBlock('image', { asset, width: 100, align: 'center', caption: [] }), { focus: false });
      afterId = S.blocks.find(b => b.asset === asset).id;
    } catch (err) {
      S.hooks.notify('Could not add the image', err.message, 'error');
    }
  }
}

export function pickImages() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.multiple = true;
  const id = ops.currentId();
  input.addEventListener('change', () => { if (input.files.length) importImages([...input.files], id); });
  input.click();
}

async function replaceImage(b) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.addEventListener('change', async () => {
    if (!input.files[0]) return;
    try {
      const asset = await importOne(input.files[0]);
      ops.snapshot();
      b.asset = asset;
      ops.rebuildBlock(b.id);
      changed();
    } catch (err) { S.hooks.notify('Could not replace the image', err.message, 'error'); }
  });
  input.click();
}

// ─── Lightbox and clipboard ───

function lightbox(src) {
  const scrim = el('div', 'img-lightbox');
  const img = el('img');
  img.src = src;
  img.alt = '';
  scrim.appendChild(img);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(scrim);
}

async function copyImage(b) {
  try {
    const res = await fetch('vault-assets/' + b.asset);
    let blob = await res.blob();
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    S.hooks.notify('Copied', 'The image is on the clipboard.');
  } catch { S.hooks.notify('Could not copy the image', 'Try View full size and copy from there.', 'error'); }
}

// The right-click items for an image block.
export function imageItems(b) {
  return [
    { label: 'Size', submenu: SNAPS.map(w => ({ label: w + '%', checked: b.width === w, onClick: () => { ops.snapshot(); b.width = w; ops.rebuildBlock(b.id); changed(); } })) },
    { label: 'Align', submenu: ['left', 'center', 'right'].map(a => ({ label: a[0].toUpperCase() + a.slice(1), checked: (b.align || 'center') === a, onClick: () => ops.setAlign([b.id], a) })) },
    { label: 'View full size', onClick: () => lightbox('vault-assets/' + b.asset) },
    { label: 'Replace…', onClick: () => replaceImage(b) },
    { label: 'Copy image', onClick: () => copyImage(b) },
    { separator: true },
    { label: 'Delete image', danger: true, onClick: () => ops.removeBlocks([b.id]) },
  ];
}

// ─── The image block ───

function buildImage(b) {
  const root = el('div', 'eb eb-image');
  root.dataset.id = b.id;
  root.dataset.type = 'image';
  root.appendChild(buildSide());
  const fig = el('figure', 'img-fig');
  const box = el('div', 'img-box');
  box.style.width = (b.width || 100) + '%';
  box.tabIndex = -1;
  const img = el('img', 'img-pic');
  img.alt = M.textOf(b.caption || []);
  img.draggable = false;
  img.src = 'vault-assets/' + b.asset;
  img.addEventListener('error', () => {
    box.classList.add('broken');
    img.hidden = true;
    box.prepend(el('div', 'img-missing', 'Image not found'));
  });
  img.addEventListener('dblclick', () => lightbox(img.src));
  box.appendChild(img);
  for (const side of ['l', 'r']) {
    const h = el('span', 'img-grip img-grip-' + side);
    h.setAttribute('aria-hidden', 'true');
    h.addEventListener('pointerdown', (e) => startResize(e, b, root, box, side));
    box.appendChild(h);
  }
  const cap = el('div', 'img-cap');
  cap.contentEditable = 'true';
  cap.setAttribute('role', 'textbox');
  cap.dataset.placeholder = 'Add a caption';
  cap.appendChild(renderSpans(b.caption || []));
  const live = () => ops.block(b.id) || b;
  cap.addEventListener('input', () => { live().caption = readSpans(cap); img.alt = M.textOf(live().caption); changed(); });
  cap.addEventListener('beforeinput', () => { const now = Date.now(); if (now - S.lastTypeAt > 800) ops.snapshot(); S.lastTypeAt = now; });
  cap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const i = ops.indexOf(b.id); const n = S.blocks[i + 1]; if (n) ops.focusBlock(n.id); else ops.insertBlock(i + 1, M.newBlock('p')); }
    if (e.key === 'Escape') { e.preventDefault(); if (S.hooks.selectBlock) S.hooks.selectBlock(b.id); }
  });
  cap.addEventListener('paste', (e) => { e.preventDefault(); const t = e.clipboardData.getData('text/plain').replace(/\s+/g, ' '); cap.ownerDocument.defaultView.getSelection().getRangeAt(0).insertNode(document.createTextNode(t)); cap.dispatchEvent(new Event('input', { bubbles: true })); });
  fig.append(box, cap);
  root.appendChild(fig);
  applyAttrs(root, b);
  return root;
}

function startResize(e, b, root, box, side) {
  e.preventDefault();
  e.stopPropagation();
  ops.snapshot();
  const col = box.parentElement.getBoundingClientRect();
  const center = col.left + col.width / 2;
  let width = b.width;
  const move = (m) => {
    const align = b.align || 'center';
    let w;
    if (align === 'center') w = (Math.abs(m.clientX - center) * 2 / col.width) * 100;
    else if (align === 'left') w = ((m.clientX - col.left) / col.width) * 100;
    else w = ((col.right - m.clientX) / col.width) * 100;
    if (side === 'l' && align === 'left') w = b.width;
    w = Math.max(10, Math.min(100, w));
    for (const s of SNAPS) if (Math.abs(w - s) <= 3) w = s;
    width = Math.round(w);
    box.style.width = width + '%';
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    b.width = width;
    changed();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ─── Bookmark ───

export function bookmarkItems(b) {
  return [
    { label: 'Open link', disabled: !/^https:/i.test(b.url), onClick: () => window.open(b.url) },
    { label: 'Edit…', onClick: () => editBookmark(b) },
    { separator: true },
    { label: 'Delete bookmark', danger: true, onClick: () => ops.removeBlocks([b.id]) },
  ];
}

async function editBookmark(b) {
  const v = await bookmarkForm(b.title, b.url);
  if (!v) return;
  ops.snapshot();
  b.title = v.title; b.url = v.url;
  ops.rebuildBlock(b.id);
  changed();
}

export async function bookmarkForm(title = '', url = 'https://') {
  const v = await formDialog({
    title: 'Link or bookmark', okLabel: 'OK',
    fields: [{ key: 'title', label: 'Title', value: title, maxLength: 200 }, { key: 'url', label: 'Address', value: url, placeholder: 'https://example.com', maxLength: 2000 }],
    validate: (x) => (cleanUrl(x.url) ? '' : 'Use a web address, like https://example.com'),
  });
  if (!v) return null;
  const clean = cleanUrl(v.url);
  let host = clean;
  try { host = new URL(clean).hostname.replace(/^www\./, ''); } catch { /* keep the address */ }
  return { title: v.title.trim() || host, url: clean };
}

function buildBookmark(b) {
  const root = el('div', 'eb eb-bookmark');
  root.dataset.id = b.id;
  root.dataset.type = 'bookmark';
  root.appendChild(buildSide());
  const card = el('div', 'bm-card');
  const ico = el('span', 'bm-ico');
  ico.appendChild(icon('link', 16));
  const text = el('div', 'bm-text');
  const title = el('input', 'bm-title');
  title.type = 'text';
  title.maxLength = 200;
  title.value = b.title;
  title.setAttribute('aria-label', 'Bookmark title');
  title.addEventListener('beforeinput', () => { const now = Date.now(); if (now - S.lastTypeAt > 800) ops.snapshot(); S.lastTypeAt = now; });
  title.addEventListener('input', () => { (ops.block(b.id) || b).title = title.value; changed(); });
  const url = el('span', 'bm-url', b.url);
  text.append(title, url);
  const openBtn = el('button', 'bm-open', 'Open');
  openBtn.type = 'button';
  const https = /^https:/i.test(b.url);
  openBtn.disabled = !https;
  openBtn.title = https ? 'Open in your browser' : 'Ethos opens https links only';
  openBtn.addEventListener('click', () => window.open(b.url));
  card.append(ico, text, openBtn);
  root.appendChild(card);
  applyAttrs(root, b);
  return root;
}

export function register() {
  S.builders.image = buildImage;
  S.builders.bookmark = buildBookmark;
  S.hooks.importImages = importImages;
  S.hooks.pickImage = pickImages;
}
