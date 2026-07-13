import { healthHandler } from './_lib/handlers.js';

export default function handler(req, res) {
  return healthHandler(req, res, {
    deprecated: true,
    successorPath: '/api/v1/health'
  });
}
