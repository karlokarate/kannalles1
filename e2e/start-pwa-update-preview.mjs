#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const sitesRoot = path.join(root, '.pwa-update-test');
const port = Number(process.env.PORT || 4174);
let activeBuild = 'old';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

function writeJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(Buffer.byteLength(body)));
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(status).end(body);
}

const server = createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url || '/', 'http://127.0.0.1');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (url.pathname.startsWith('/__pwa_test__/activate/')) {
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end('Method not allowed');
      return;
    }
    const requested = url.pathname.slice('/__pwa_test__/activate/'.length);
    if (requested !== 'old' && requested !== 'new') {
      writeJson(response, 400, { error: 'unknown build' });
      return;
    }
    const target = path.join(sitesRoot, requested, 'index.html');
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      writeJson(response, 503, { error: `build ${requested} is missing` });
      return;
    }
    activeBuild = requested;
    writeJson(response, 200, { activeBuild });
    return;
  }

  if (url.pathname === '/__pwa_test__/state') {
    writeJson(response, 200, { activeBuild });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  const site = path.join(sitesRoot, activeBuild);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let target = path.resolve(site, relative);
  if (target !== site && !target.startsWith(`${site}${path.sep}`)) {
    response.writeHead(400).end('Bad request');
    return;
  }

  let info = await stat(target).catch(() => null);
  if (!info?.isFile() && !path.extname(relative)) {
    target = path.join(site, 'index.html');
    info = await stat(target).catch(() => null);
  }
  if (!info?.isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }

  response.setHeader('Content-Type', contentTypes.get(path.extname(target).toLowerCase()) || 'application/octet-stream');
  response.setHeader('Content-Length', String(info.size));
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Service-Worker-Allowed', '/');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method === 'HEAD') {
    response.writeHead(200).end();
    return;
  }
  createReadStream(target).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PWA update preview (${activeBuild}): http://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
