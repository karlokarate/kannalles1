import { healthHandler } from '../_lib/handlers.js';

export default function handler(req, res) {
  return healthHandler(req, res);
}
