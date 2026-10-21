// The system tray presence that lets Ethos keep running with its window closed.
//
// The icon is drawn here rather than shipped as a file: it is a 32x32 mark in
// the style of the logo (a dot beside a ring), encoded to PNG with zlib. That
// keeps the repo free of a binary asset that would need its own pipeline for
// the several sizes and themes a tray needs.

const zlib = require('zlib');
const { Tray, Menu, nativeImage } = require('electron');

const SIZE = 32;

function pngFromRgba(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                         // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Anti-aliased by coverage: how far a pixel centre sits inside the shape.
function coverage(dist, radius) {
  return Math.max(0, Math.min(1, radius - dist + 0.5));
}

function iconImage() {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      const dot = coverage(Math.hypot(px - 7, py - 17), 3.2);
      const ring = coverage(Math.abs(Math.hypot(px - 20, py - 16) - 8), 1.9);
      const a = Math.max(dot, ring);
      const i = (y * SIZE + x) * 4;
      rgba[i] = 235; rgba[i + 1] = 235; rgba[i + 2] = 235;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return nativeImage.createFromBuffer(pngFromRgba(rgba, SIZE, SIZE));
}

let tray = null;

// onShow / onQuit are supplied by the caller so this file knows nothing about
// the window or the quit sequence.
function ensureTray({ onShow, onQuit }) {
  if (tray) return tray;
  tray = new Tray(iconImage());
  tray.setToolTip('Ethos is running in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Ethos', click: onShow },
    { type: 'separator' },
    { label: 'Quit Ethos', click: onQuit },
  ]));
  tray.on('click', onShow);
  return tray;
}

function destroyTray() {
  if (tray) { tray.destroy(); tray = null; }
}

module.exports = { ensureTray, destroyTray, iconImage };
