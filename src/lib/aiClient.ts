import type { ParsedFoodRequest } from '../types';
import { parseFoodRequestLocal } from './parser';

/**
 * Offline cutover: parsing is deliberately local-only. The signature is kept
 * temporarily so persisted settings and existing callers cannot re-enable a
 * hidden network path.
 */
export async function parseFoodRequestWithAi(
  rawInput: string,
  _gatewayUrl: string,
  signal?: AbortSignal
): Promise<ParsedFoodRequest> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Anfrage abgebrochen.', 'AbortError');
  }
  return parseFoodRequestLocal(rawInput);
}
