import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const rootDir = path.resolve(process.argv[2] ?? 'dist');
// GitHub project Pages serves this repository below /kannalles1/. Testing the
// subpath catches accidental root-absolute asset, manifest or service-worker
// references that a localhost-root check would miss.
const basePath = '/kannalles1/';
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.png', 'image/png']
]);

function resolveRequestPath(requestUrl = '/') {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  if (!url.pathname.startsWith(basePath)) return null;
  const relative = decodeURIComponent(url.pathname.slice(basePath.length)).replace(/^\/+/, '') || 'index.html';
  const candidate = path.resolve(rootDir, relative);
  if (candidate !== rootDir && !candidate.startsWith(`${rootDir}${path.sep}`)) return null;
  return candidate;
}

const server = http.createServer(async (request, response) => {
  const filePath = resolveRequestPath(request.url);
  if (!filePath) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
      'Service-Worker-Allowed': basePath
    });
    response.end(content);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Kein lokaler Prüfport verfügbar.');
  const origin = `http://127.0.0.1:${address.port}`;
  const required = [basePath, `${basePath}manifest.webmanifest`, `${basePath}sw.js`];
  const results = [];
  for (const pathname of required) {
    const response = await fetch(`${origin}${pathname}`);
    const body = await response.text();
    if (!response.ok || !body.trim()) throw new Error(`HTTP-Prüfung fehlgeschlagen: ${pathname} -> ${response.status}`);
    results.push(`${pathname}=${response.status}`);
  }

  const index = await (await fetch(`${origin}${basePath}`)).text();
  const localReferences = [...index.matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/gi)]
    .map((match) => match[1]);
  for (const reference of localReferences) {
    const response = await fetch(new URL(reference, `${origin}${basePath}`));
    if (!response.ok) throw new Error(`Referenz nicht per Pages-Unterpfad erreichbar: ${reference} -> ${response.status}`);
  }

  const manifest = await (await fetch(`${origin}${basePath}manifest.webmanifest`)).json();
  for (const icon of manifest.icons ?? []) {
    const response = await fetch(new URL(icon.src, `${origin}${basePath}`));
    if (!response.ok) throw new Error(`Manifest-Icon nicht per Pages-Unterpfad erreichbar: ${icon.src} -> ${response.status}`);
  }

  console.log(`Statische Pages-Unterpfadprüfung bestanden: ${results.join(', ')}, ${localReferences.length} HTML-Referenzen und ${(manifest.icons ?? []).length} Icons.`);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
