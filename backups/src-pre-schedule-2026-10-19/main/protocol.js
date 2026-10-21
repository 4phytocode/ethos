// Serves the renderer over app://ethos/ instead of a data: or file: URL.
//
// This is what the restructure turned on. A data: URL gets an opaque origin,
// which means no Content-Security-Policy (there are no headers to put it on),
// no localStorage or IndexedDB, and no ES modules. A real, privileged scheme
// gives us a normal secure origin: the CSP below applies, modules load, and the
// page is a fixed set of files on disk instead of a 26KB string re-encoded on
// every reload.

const path = require('path');
const fs = require('fs/promises');
const { pathToFileURL } = require('url');
const { protocol, net } = require('electron');

const SCHEME = 'app';
const HOST = 'ethos';
const INDEX = 'index.html';

// Nothing executes or loads that we did not ship: no inline script, no inline
// style, no remote anything. `data:` stays allowed for img only, for inline SVG
// use. If a future feature needs the network it gets an explicit connect-src
// entry, never a blanket one.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// Must run before the app is ready: marks the scheme as a standard, secure
// origin so it behaves like https rather than like file:.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

function headers(filePath) {
  return {
    'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

function handle(rendererRoot) {
  const root = path.resolve(rendererRoot);

  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });

    // decodeURIComponent first so an encoded traversal cannot slip past, then
    // resolve and require the result to sit inside the renderer directory.
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (rel === '/' || rel === '') rel = '/' + INDEX;

    const target = path.resolve(root, '.' + rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) return new Response('Not found', { status: 404 });
    } catch {
      return new Response('Not found', { status: 404 });
    }

    // pathToFileURL, not string concatenation: on Windows a drive letter needs
    // file:///H:/... and 'file://' + path would read H: as the host.
    const res = await net.fetch(pathToFileURL(target).toString());
    return new Response(res.body, { status: 200, headers: headers(target) });
  });
}

module.exports = { registerScheme, handle, SCHEME, HOST, INDEX, origin: SCHEME + '://' + HOST };
