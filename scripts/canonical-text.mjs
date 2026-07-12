import path from 'node:path';

const TEXT_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.txt', '.yaml', '.yml'
]);

export function normalizeTextEol(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

export function canonicalFileBytes(relativePath, bytes) {
  if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return bytes;
  return Buffer.from(normalizeTextEol(bytes.toString('utf8')), 'utf8');
}
