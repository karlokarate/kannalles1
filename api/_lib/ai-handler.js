import { createHmac } from 'node:crypto';
import { AiParseRequestSchema } from '../../server/generated/search-api.schemas.mjs';
import { resolveAiConfiguration } from '../../server/gateway-core/index.mjs';
import { parseFoodRequest } from './ai.js';
import {
  handleOptions,
  markDeprecatedAlias,
  sendGatewayError,
  sendHttpError,
  setCors
} from './gateway.js';

function requestSignal(req) {
  if (req.signal instanceof AbortSignal) return req.signal;
  const controller = new AbortController();
  req.once?.('aborted', () => controller.abort(new DOMException('Client disconnected', 'AbortError')));
  return controller.signal;
}

export function safetyIdentifierForRequest(req) {
  const salt = String(process.env.AI_SAFETY_SALT || '');
  if (!salt) return undefined;
  const configuration = resolveAiConfiguration(process.env);
  if (configuration.production && !configuration.safetySaltStrong) return undefined;
  const trustedExpressAddress = String(req.ip || '').trim();
  const address = trustedExpressAddress || String(req.socket?.remoteAddress || '').trim();
  if (!address) return undefined;
  return `kh_${createHmac('sha256', salt).update(address.toLocaleLowerCase('en-US')).digest('hex').slice(0, 32)}`;
}

export async function aiParseHandler(req, res, options = {}) {
  if (handleOptions(req, res)) return;
  if (!setCors(res, req)) return sendHttpError(res, 403, 'Dieser Request-Origin ist nicht freigegeben.');
  if (options.deprecated) markDeprecatedAlias(res, '/api/v1/ai/parse');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendHttpError(res, 405, 'Method not allowed');
  }
  const configuration = resolveAiConfiguration(process.env);
  if (configuration.reasonCode === 'AI_SAFETY_SALT_MISSING_OR_WEAK') {
    return sendHttpError(
      res,
      503,
      'KI-Parsing ist deaktiviert, bis ein ausreichend starker AI_SAFETY_SALT konfiguriert ist.'
    );
  }
  if (configuration.reasonCode === 'DISTRIBUTED_COORDINATION_REQUIRED') {
    return sendHttpError(
      res,
      503,
      'KI-Parsing ist deaktiviert, bis eine verteilte Redis-Koordination konfiguriert ist.'
    );
  }
  const parsed = AiParseRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendHttpError(res, 400, 'Eingabe muss 1 bis 200 Zeichen lang sein.');
  const safetyIdentifier = safetyIdentifierForRequest(req);
  if (configuration.production && configuration.configured && !safetyIdentifier) {
    return sendHttpError(res, 503, 'KI-Parsing ist ohne sicheres Nutzerbudget nicht verfügbar.');
  }
  try {
    return res.status(200).json(await parseFoodRequest(parsed.data.input, {
      signal: requestSignal(req),
      safetyIdentifier
    }));
  } catch (error) {
    return sendGatewayError(res, error, 'KI-Parsing ist vorübergehend nicht verfügbar.');
  }
}
