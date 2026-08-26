'use strict';

/*
 * The tiny static server behind the desktop window. Kept out of main.js so it
 * can be exercised without Electron:  node static-server.js ..\frontend\out
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve a request path to a file inside siteDir.
 * The export uses trailingSlash, so /logs/ -> logs\index.html. Anything that
 * escapes siteDir (../) is rejected before it touches the filesystem.
 */
function resolveFile(siteDir, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0]);
  } catch (_) {
    return null; // malformed percent-encoding
  }

  const rel = path.normalize(decoded).replace(/^[\\/]+/, '');
  const abs = path.resolve(siteDir, rel);
  const root = path.resolve(siteDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;

  const candidates = path.extname(abs)
    ? [abs]
    : [path.join(abs, 'index.html'), `${abs}.html`];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The exported 404 page, if the export produced one. */
function notFoundPage(siteDir) {
  const page = path.join(path.resolve(siteDir), '404.html');
  return fs.existsSync(page) ? page : null;
}

/** Start the server; resolves with { server, baseUrl }. */
function startServer(siteDir) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(siteDir, 'index.html'))) {
      reject(
        new Error(
          `No exported site found at:\n${siteDir}\n\nRun "npm run build" in frontend\\ first.`,
        ),
      );
      return;
    }

    const server = http.createServer((req, res) => {
      const file = resolveFile(siteDir, url.parse(req.url).pathname || '/');
      if (!file) {
        // Serve the exported 404 page, but with an honest status code.
        const page = notFoundPage(siteDir);
        if (!page) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        fs.createReadStream(page).pipe(res);
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    });

    server.on('error', reject);
    // Port 0 lets the OS pick a free port, so the app never collides with
    // whatever else is already listening on this machine.
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

module.exports = { startServer, resolveFile, MIME };

// Manual check:  node static-server.js ..\frontend\out
if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'frontend', 'out'));
  startServer(dir).then(
    ({ baseUrl }) => console.log(`serving ${dir}\n${baseUrl}`),
    (err) => {
      console.error(err.message);
      process.exit(1);
    },
  );
}
