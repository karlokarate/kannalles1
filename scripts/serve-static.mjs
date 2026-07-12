#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const types = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.txt', 'text/plain; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8']
]);

export function startStaticServer(options = {}) {
  const root = path.resolve(options.root || process.env.SITE_DIR || process.argv[2] || 'dist');
  const port = Number(options.port || process.env.PORT || 4173);
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('Bad request');
      return;
    }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(400).end('Bad request');
      return;
    }
    const info = await stat(target).catch(() => null);
    if (!info?.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }
    response.setHeader('Content-Type', types.get(path.extname(target).toLowerCase()) || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(target).pipe(response);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Static test server: http://127.0.0.1:${port} (${root})`);
  });
  return server;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) startStaticServer();
