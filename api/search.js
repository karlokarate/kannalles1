import { handleOptions, searchThroughGateway, setCors } from './_lib/gateway.js';

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

function normalizeSearchQuery(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .split(/(\s+|[-/])/)
    .map((part) => SEARCH_TERM_ALIASES.get(aliasKey(part)) || part)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const requestedQuery = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const query = normalizeSearchQuery(requestedQuery);
  if (!query) {
    res.status(400).json({ error: 'q ist erforderlich.' });
    return;
  }

  const rawPageSize = Number(req.query.page_size || 10);
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(20, Math.max(1, Math.round(rawPageSize))) : 10;
  const searchApiMode = req.query.search_api === 'v2' ? 'legacy-only' : 'auto';

  try {
    const payload = await searchThroughGateway(query, pageSize, { searchApiMode });
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=900');
    res.status(200).json({
      ...payload,
      query_requested: requestedQuery,
      query_used: query
    });
  } catch (error) {
    // A total upstream outage is not a client rate limit. Returning 502 without
    // Retry-After prevents the PWA from installing an artificial local lock.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: 'Produktsuche vorübergehend nicht verfügbar.',
      detail: error?.message || String(error),
      attempts: error?.attempts || [],
      query_requested: requestedQuery,
      query_used: query,
      retryAllowedImmediately: true
    });
  }
}
