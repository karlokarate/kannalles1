import { aiParseHandler } from '../_lib/ai-handler.js';

export default function handler(req, res) {
  return aiParseHandler(req, res, { deprecated: true });
}
