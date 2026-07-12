import { handleOptions, searchThroughGateway, sendGatewayError, setCors } from './_lib/gateway.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const query = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!query) {
    res.status(400).json({ error: 'q ist erforderlich.' });
    return;
  }

  const rawPageSize = Number(req.query.page_size || 15);
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(20, Math.max(1, Math.round(rawPageSize))) : 15;
  const searchApiMode = req.query.search_api === 'v2' ? 'legacy-only' : 'auto';

  try {
    const payload = await searchThroughGateway(query, pageSize, { searchApiMode });
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=900');
    res.status(200).json(payload);
  } catch (error) {
    sendGatewayError(res, error, 'Produktsuche fehlgeschlagen.');
  }
}
