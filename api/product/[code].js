import { handleOptions, productThroughGateway, sendGatewayError, setCors } from '../_lib/gateway.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  setCors(res);
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const code = String(req.query.code || '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(code)) {
    res.status(400).json({ error: 'Ungültiger Barcode.' });
    return;
  }

  const knownCarbohydrates = req.query.known_carbs === '1';
  let productApiMode = 'hybrid';
  if (req.query.product_api === 'v2') productApiMode = 'v2';
  if (req.query.product_api === 'v3') productApiMode = 'v3';
  try {
    const payload = await productThroughGateway(code, { knownCarbohydrates, productApiMode });
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=86400');
    res.status(200).json(payload);
  } catch (error) {
    sendGatewayError(res, error, 'Produktabruf fehlgeschlagen.');
  }
}
