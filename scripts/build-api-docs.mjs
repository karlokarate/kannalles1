#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const document = JSON.parse(await readFile(path.join(root, 'contracts/generated/search-api.openapi.json'), 'utf8'));
const operations = [];
for (const [route, item] of Object.entries(document.paths ?? {})) {
  for (const [method, operation] of Object.entries(item)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    operations.push({
      method: method.toUpperCase(),
      route,
      operationId: operation.operationId ?? '',
      summary: operation.summary ?? '',
      statuses: Object.keys(operation.responses ?? {}).sort().join(', ')
    });
  }
}
operations.sort((a, b) => `${a.route}:${a.method}`.localeCompare(`${b.route}:${b.method}`));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const rows = operations.map((op) => `<tr><td><code>${escapeHtml(op.method)}</code></td><td><code>${escapeHtml(op.route)}</code></td><td>${escapeHtml(op.operationId)}</td><td>${escapeHtml(op.summary)}</td><td>${escapeHtml(op.statuses)}</td></tr>`).join('\n');
const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(document.info.title)} ${escapeHtml(document.info.version)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:auto;padding:2rem;color:#17221d}h1{line-height:1.15}table{border-collapse:collapse;width:100%;overflow:auto;display:block}th,td{border:1px solid #cbd5cf;padding:.55rem;text-align:left;vertical-align:top}th{background:#eef4f0}code{white-space:nowrap}pre{white-space:pre-wrap;background:#f5f7f6;padding:1rem;border-radius:.5rem}</style></head><body><h1>${escapeHtml(document.info.title)}</h1><p>Version <strong>${escapeHtml(document.info.version)}</strong> · OpenAPI ${escapeHtml(document.openapi)}</p><p>${escapeHtml(document.info.description ?? '')}</p><table><thead><tr><th>Methode</th><th>Pfad</th><th>operationId</th><th>Beschreibung</th><th>Statuscodes</th></tr></thead><tbody>${rows}</tbody></table><h2>Generatorregeln</h2><pre>${escapeHtml(JSON.stringify(document['x-kh-generator'] ?? {}, null, 2))}</pre><p>Maschinenlesbar: <a href="./search-api.openapi.json">JSON</a> · <a href="./search-api.openapi.yaml">YAML</a></p></body></html>\n`;
const markdown = `# ${document.info.title}\n\nVersion **${document.info.version}**, OpenAPI **${document.openapi}**.\n\n| Methode | Pfad | operationId | Beschreibung | Statuscodes |\n|---|---|---|---|---|\n${operations.map((op) => `| ${op.method} | \`${op.route}\` | \`${op.operationId}\` | ${op.summary.replaceAll('|', '\\|')} | ${op.statuses} |`).join('\n')}\n`;
await mkdir(path.join(root, 'docs/api'), { recursive: true });
await mkdir(path.join(root, 'docs/generated'), { recursive: true });
await writeFile(path.join(root, 'docs/api/index.html'), html);
await writeFile(path.join(root, 'docs/generated/search-api.md'), markdown);
console.log(JSON.stringify({ apiDocs: 'docs/api/index.html', operations: operations.length }));
