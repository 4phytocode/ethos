// The background behind the views: off, a slow moving gradient, or an image,
// behind the homepage only or the whole app. See styles/backdrop.css.
//
// Per-machine, like the rest of Appearance, so it lives in localStorage.
//
// Images are either a bundled preset (renderer/backgrounds/, photos from
// Unsplash, shipped with the app so nothing is fetched at runtime and the CSP
// stays "no remote anything") or the user's own file. The user's file is
// downscaled and re-encoded as a JPEG data URL before it is stored: the CSP
// allows `img-src data:`, and a full-size photo would blow the ~5MB quota.
//
// The gradient takes a named palette (light and dark variants live in CSS,
// keyed off body[data-bg-palette]) or three custom colours set inline.

const KEY = 'ethos.backdrop';
const IMAGE_KEY = 'ethos.backdropImage';
const MAX_SIDE = 2560;
const HEX = /^#[0-9a-f]{6}$/i;

const MODES = [['off', 'Off'], ['gradient', 'Gradient'], ['image', 'Image']];
const SCOPES = [['home', 'Homepage'], ['all', 'Everywhere']];
const SPEEDS = [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']];
const PALETTES = [['aurora', 'Aurora'], ['dawn', 'Dawn'], ['ocean', 'Ocean'],
  ['forest', 'Forest'], ['dusk', 'Dusk'], ['custom', 'Custom']];
// File name in renderer/backgrounds/ (plus -thumb.jpg) and its label.
export const PRESETS = [['forest', 'Forest'], ['valley', 'Valley'], ['meadow', 'Meadow'],
  ['canyon', 'Canyon'], ['hills', 'Hills'], ['peaks', 'Peaks'], ['shore', 'Shore'], ['night', 'Night']];

const DEFAULTS = { mode: 'gradient', scope: 'home', palette: 'aurora', speed: 'normal',
  colors: ['#c7d7fe', '#fbcfe8', '#bbf7d0'], image: 'preset:peaks' };

let prefs = { ...DEFAULTS, colors: [...DEFAULTS.colors] };
let els = null;

const has = (list, id) => list.some(x => x[0] === id);

function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* defaults */ }
  if (!raw || typeof raw !== 'object') return;
  if (has(MODES, raw.mode)) prefs.mode = raw.mode;
  if (has(SCOPES, raw.scope)) prefs.scope = raw.scope;
  if (has(PALETTES, raw.palette)) prefs.palette = raw.palette;
  if (has(SPEEDS, raw.speed)) prefs.speed = raw.speed;
  if (Array.isArray(raw.colors) && raw.colors.length === 3 && raw.colors.every(c => HEX.test(c))) prefs.colors = raw.colors;
  if (raw.image === 'custom' || (typeof raw.image === 'string' && has(PRESETS, raw.image.replace(/^preset:/, '')))) prefs.image = raw.image;
  // A store from before presets existed had only a custom image.
  if (raw.mode === 'image' && raw.image === undefined) prefs.image = 'custom';
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function customImage() {
  try {
    const v = localStorage.getItem(IMAGE_KEY) || '';
    // Only ever our own re-encoded data URL, so it is safe to put in url().
    return v.startsWith('data:image/jpeg;base64,') ? v : '';
  } catch { return ''; }
}

function imageUrl() {
  if (prefs.image === 'custom') return customImage();
  return 'backgrounds/' + prefs.image.replace(/^preset:/, '') + '.jpg';
}

function apply() {
  const body = document.body;
  const url = prefs.mode === 'image' ? imageUrl() : '';
  // "Image" with nothing usable falls back to the gradient rather than a blank page.
  body.dataset.bg = prefs.mode === 'image' && !url ? 'gradient' : prefs.mode;
  body.dataset.bgScope = prefs.scope;
  body.dataset.bgPalette = prefs.palette;
  body.dataset.bgSpeed = prefs.speed;
  for (const [i, v] of ['--bd-a', '--bd-b', '--bd-c'].entries()) {
    if (prefs.palette === 'custom') body.style.setProperty(v, prefs.colors[i]);
    else body.style.removeProperty(v);
  }
  const layer = document.getElementById('bd-image');
  if (layer) layer.style.backgroundImage = url ? 'url("' + url + '")' : '';
}

function set(patch) { Object.assign(prefs, patch); save(); apply(); render(); }

// Runs before the first paint, alongside initAppearance().
export function initBackdrop() {
  load();
  apply();
}

// ─── Settings > Background ───

export function initBackdropSettings() {
  els = {
    mode: document.getElementById('set-bg-mode'),
    scope: document.getElementById('set-bg-scope'),
    gradientRows: document.querySelectorAll('.set-bg-gradient'),
    imageRows: document.querySelectorAll('.set-bg-imagerow'),
    palettes: document.getElementById('set-bg-palettes'),
    custom: document.getElementById('set-bg-custom'),
    colors: [...document.querySelectorAll('#set-bg-custom input[type="color"]')],
    speed: document.getElementById('set-bg-speed'),
    presets: document.getElementById('set-bg-presets'),
    file: document.getElementById('set-bg-file'),
    clear: document.getElementById('set-bg-clear'),
    hint: document.getElementById('set-bg-image-hint'),
  };
  if (!els.mode) return;

  els.file.addEventListener('change', () => {
    const f = els.file.files && els.file.files[0];
    els.file.value = '';
    if (f) useFile(f);
  });
  // Forgets the uploaded image; if it was in use, falls back to the default preset.
  els.clear.addEventListener('click', () => {
    try { localStorage.removeItem(IMAGE_KEY); } catch { /* ignore */ }
    set(prefs.image === 'custom' ? { image: DEFAULTS.image } : {});
  });
  // Live while dragging the picker; saved as it goes.
  els.colors.forEach((input, i) => input.addEventListener('input', () => {
    if (!HEX.test(input.value)) return;
    prefs.colors[i] = input.value;
    save(); apply();
    const sw = els.palettes.querySelector('[data-palette="custom"]');
    if (sw) sw.style.setProperty('--sw-' + 'abc'[i], input.value);
  }));
  render();
}

function segs(root, options, current, onPick) {
  root.innerHTML = '';
  for (const [id, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'set-seg' + (current === id ? ' on' : '');
    b.textContent = label;
    b.addEventListener('click', () => onPick(id));
    root.appendChild(b);
  }
}

function render() {
  if (!els) return;
  segs(els.mode, MODES, prefs.mode, (mode) => set({ mode }));
  segs(els.scope, SCOPES, prefs.scope, (scope) => set({ scope }));
  segs(els.speed, SPEEDS, prefs.speed, (speed) => set({ speed }));
  els.gradientRows.forEach(r => { r.hidden = prefs.mode !== 'gradient'; });
  els.imageRows.forEach(r => { r.hidden = prefs.mode !== 'image'; });

  els.palettes.innerHTML = '';
  for (const [id, label] of PALETTES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'set-swatch' + (prefs.palette === id ? ' on' : '');
    b.dataset.palette = id;
    b.setAttribute('aria-label', label + ' gradient');
    if (id === 'custom') prefs.colors.forEach((c, i) => b.style.setProperty('--sw-' + 'abc'[i], c));
    const dot = document.createElement('i');
    const name = document.createElement('span');
    name.textContent = label;
    b.append(dot, name);
    b.addEventListener('click', () => set({ palette: id }));
    els.palettes.appendChild(b);
  }
  els.custom.hidden = prefs.palette !== 'custom';
  els.colors.forEach((input, i) => { input.value = prefs.colors[i]; });

  els.presets.innerHTML = '';
  for (const [id, label] of PRESETS) {
    els.presets.appendChild(tile(label, 'preset:' + id, 'backgrounds/' + id + '-thumb.jpg'));
  }
  const own = customImage();
  els.presets.appendChild(tile(own ? 'Your image' : 'Upload…', 'custom', own));
  els.clear.hidden = !own;
}

function tile(label, value, src) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'set-tile' + (prefs.image === value ? ' on' : '');
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    b.appendChild(img);
  }
  const name = document.createElement('span');
  name.textContent = label;
  b.appendChild(name);
  b.addEventListener('click', () => {
    // Clicking "Your image" again while it is selected picks a new file.
    if (value === 'custom' && (!customImage() || prefs.image === 'custom')) { els.file.click(); return; }
    set({ image: value });
  });
  return b;
}

// Read as a data URL, not URL.createObjectURL: the CSP has no blob: in img-src.
function useFile(file) {
  const reader = new FileReader();
  reader.onload = () => decode(String(reader.result));
  reader.onerror = () => { els.hint.textContent = 'That file could not be read.'; };
  reader.readAsDataURL(file);
}

function decode(url) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    try {
      localStorage.setItem(IMAGE_KEY, canvas.toDataURL('image/jpeg', 0.9));
    } catch {
      els.hint.textContent = 'That image is too large to keep. Try a smaller one.';
      return;
    }
    set({ mode: 'image', image: 'custom' });
  };
  img.onerror = () => { els.hint.textContent = 'That file could not be read as an image.'; };
  img.src = url;
}
