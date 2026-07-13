#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (process.env.PLAYWRIGHT_SKIP_BUILD !== '1') {
  const build = spawnSync(npmCommand, npmCli ? [npmCli, 'run', 'build'] : ['run', 'build'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (build.status !== 0) {
    console.error(`Production build failed: ${build.error?.message ?? `exit ${build.status ?? 'unknown'}`}`);
    process.exit(build.status ?? 1);
  }
}

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

const server = createServer(async (request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

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
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(target).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Real catalog preview: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
