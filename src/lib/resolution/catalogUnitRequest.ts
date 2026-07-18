import type { CatalogUnitRequest } from './catalogResolution';

/**
 * Converts transport-only units into the resolver's canonical unit vocabulary.
 * Counted units and explicitness are never inferred or rewritten.
 */
export function normalizeCatalogUnitRequest(request: CatalogUnitRequest): CatalogUnitRequest {
  return request.unit === 'kg'
    ? { amount: request.amount * 1_000, unit: 'g', unitExplicit: true }
    : request;
}
