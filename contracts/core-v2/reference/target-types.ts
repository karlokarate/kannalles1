/**
 * Compile-time reference to the production catalog boundary.
 *
 * This file is intentionally not a second type authority. Consumers import
 * production types from src/lib/catalog/catalogDomain.ts.
 */
export type {
  CatalogCountability,
  CatalogDiagnosticValue,
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogImageReference,
  CatalogMeasure,
  CatalogNutritionBasis,
  CatalogNutritionSource,
  CatalogOperation,
  CatalogProduct,
  CatalogSearchHit,
  CatalogSlotId,
  CatalogStatus,
  CatalogStatusState,
  CatalogUnitEvidence,
  CatalogUnitEvidenceSource,
  CatalogUnitKind
} from '../../../src/lib/catalog/catalogDomain';
