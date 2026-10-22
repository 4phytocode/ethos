// The system tray presence that lets Ethos keep running with its window closed.
//
// The icon is a file in assets/ (tray-16.png, with tray-16@2x.png for high-DPI
// screens; Electron picks the @2x file by its name). It is generated from the
// logo by scripts/build-icons.py.

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

const ICON = path.join(__dirname, '..', '..', 'assets', 'tray-16.png');

let tray = null;

// onShow / onQuit are supplied by the caller so this file knows nothing about
// the window or the quit sequence.
function ensureTray({ onShow, onQuit }) {
  if (tray) return tray;
  tray = new Tray(nativeImage.createFromPath(ICON));
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

module.exports = { ensureTray, destroyTray };
