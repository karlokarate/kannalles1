import { productHandler } from '../_lib/handlers.js';

export default function handler(req, res) {
  const code = encodeURIComponent(String(req.query?.code || ''));
  return productHandler(req, res, {
    deprecated: true,
    successorPath: `/api/v1/product/${code}`
  });
}
