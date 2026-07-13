/**
 * Compile-time reference to the frozen production catalog boundary.
 *
 * This file is not a second type authority. Consumers import production types
 * directly from src/lib/catalog/catalogDomain.ts.
 */
export type {
  CatalogDiagnosticValue,
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogImageReference,
  CatalogMeasure,
  CatalogNutrition,
  CatalogNutritionBasis,
  CatalogNutritionSource,
  CatalogOperation,
  CatalogProduct,
  CatalogProvenUnitEvidence,
  CatalogSearchHit,
  CatalogSlotId,
  CatalogSlotState,
  CatalogStatus,
  CatalogStatusState,
  CatalogUnitEvidence,
  CatalogUnitEvidenceSource,
  CatalogUnitKind
} from '../../../src/lib/catalog/catalogDomain';
