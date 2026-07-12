import { createHash } from 'node:crypto';

const MAX_QUERY_LENGTH = 120;
const LUCENE_SPECIAL = /([+\-=!(){}[\]^"~*?:\\/]|&&|\|\|)/g;
const SEARCH_TERM_ALIASES = new Map([
  ['erdnuss', 'Erdnuss'],
  ['erdnusse', 'Erdnuss'],
  ['erdnuesse', 'Erdnuss'],
  ['peanut', 'Erdnuss'],
  ['peanuts', 'Erdnuss']
]);

function aliasKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/ß/g, 'ss');
}

export function normalizeSearchQuery(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .split(/(\s+|[-/])/)
    .map((part) => SEARCH_TERM_ALIASES.get(aliasKey(part)) || part)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Search-a-licious accepts an Elasticsearch query string. Treat user input as
 * a literal so punctuation in a product name cannot become query syntax.
 */
export function escapeSearchQuery(value) {
  return normalizeSearchQuery(value).replace(LUCENE_SPECIAL, '\\$1');
}

export function opaqueFingerprint(value) {
  return createHash('sha256')
    .update(String(value ?? '').normalize('NFKC'), 'utf8')
    .digest('base64url')
    .slice(0, 24);
}

export function queryFingerprint(value) {
  const canonical = normalizeSearchQuery(value)
    .normalize('NFKC')
    .toLocaleLowerCase('de-DE');
  // 144 bits of SHA-256 keeps user-controlled queries opaque in diagnostics
  // and makes cross-user cache collisions computationally infeasible.
  return opaqueFingerprint(canonical);
}

/**
 * Mirrors Product Opener's documented leading-zero normalization:
 * significant codes <=7 digits become EAN-8, 9..12 digits become EAN-13.
 */
export function normalizeBarcode(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 14) return null;
  const significant = digits.replace(/^0+/, '') || '0';
  if (significant.length <= 7) return significant.padStart(8, '0');
  if (significant.length === 8) return significant;
  if (significant.length <= 12) return significant.padStart(13, '0');
  if (significant.length <= 14) return significant;
  return null;
}

export function normalizeSearchMode(value) {
  if (value === 'search-index' || value === 'search-a-licious' || value === 'legacy') return value;
  // Backwards compatibility for the pre-v1 generated client.
  if (value === 'v2' || value === 'legacy-only') return 'legacy';
  return 'auto';
}

export function normalizeProductMode(value) {
  return value === 'v2' || value === 'v3' || value === 'hybrid' ? value : 'hybrid';
}

export function normalizePageSize(value, fallback = 15) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, Math.round(parsed))) : fallback;
}
