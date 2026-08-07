/* ============================================================
   DITHERPUNK — Local dev server

   Zero dependencies. Serves this folder over HTTP, which the app
   needs: the worker and the palette manifest can't load from a
   file:// page.

   Usage:  node serve.js  [port]  [--no-open]
   Or just double-click serve.cmd
   ============================================================ */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const startPort = parseInt(args.find(a => /^\d+$/.test(a)) || process.env.PORT || '8765', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.hex':  'text/plain; charset=utf-8',   // film simulation palettes
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    // decodeURIComponent matters here — "Film Simulations" arrives as %20.
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (urlPath.endsWith('/')) urlPath += 'index.html';

  const filePath = path.join(ROOT, urlPath);

  // Never serve outside the project folder.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — ' + urlPath);
      log(404, req.method, urlPath);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      // No caching, or you'll be testing yesterday's app.js after an edit.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(buf);
    log(200, req.method, urlPath);
  });
});

// Quiet the per-palette request flood; 169 .hex files load on every boot.
let hexHits = 0;
function log(code, method, urlPath) {
  if (urlPath.endsWith('.hex')) {
    hexHits++;
    if (hexHits % 50 !== 0) return;
    console.log(`  ${code}  ${hexHits} palettes served…`);
    return;
  }
  const mark = code === 200 ? '  ' : '! ';
  console.log(`${mark}${code}  ${method}  ${urlPath}`);
}

function listen(port, attemptsLeft) {
  server.once('error', err => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`  port ${port} busy, trying ${port + 1}…`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('Could not start server:', err.message);
      process.exit(1);
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}/`;
    console.log('');
    console.log('  ┌─────────────────────────────────────────┐');
    console.log('  │  DITHERPUNK — dev server                │');
    console.log('  └─────────────────────────────────────────┘');
    console.log('');
    console.log(`     ${url}`);
    console.log('');
    console.log('     Caching is off — just refresh after an edit.');
    console.log('     Ctrl+C to stop.');
    console.log('');
    if (!noOpen) open(url);
  });
}

function open(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
            : process.platform === 'darwin' ? `open "${url}"`
            : `xdg-open "${url}"`;
  exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' }, () => {});
}

listen(startPort, 10);
