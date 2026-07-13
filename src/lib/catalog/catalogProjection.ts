import {
  CATALOG_UNIT_KINDS,
  decodeCatalogCode,
  decodeCatalogMetadata
} from '../../../Catalog/catalog-runtime.generated';
import type {
  CatalogCountability,
  CatalogNutritionBasis,
  CatalogProduct,
  CatalogSearchHit,
  CatalogUnitEvidence,
  CatalogUnitEvidenceSource,
  CatalogUnitKind
} from './catalogDomain';

export interface CatalogSqlRow extends Record<string, unknown> {
  readonly id: unknown;
  readonly g: unknown;
  readonly n: unknown;
  readonly brand: unknown;
  readonly c: unknown;
  readonly s: unknown;
  readonly q: unknown;
  readonly u: unknown;
  readonly m: unknown;
  readonly r: unknown;
}

const UNIT_KIND_BY_CODE = new Map<number, CatalogUnitKind | null>(
  Object.entries(CATALOG_UNIT_KINDS).map(([kind, code]) => [
    Number(code),
    kind === 'none' ? null : kind as CatalogUnitKind
  ])
);

const UNIT_SOURCE_BY_CODE = new Map<number, CatalogUnitEvidenceSource | null>([
  [0, null],
  [1, 'manufacturer_serving'],
  [2, 'explicit_serving_count'],
  [3, 'explicit_multipack_quantity']
]);

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Ungültiger numerischer Katalogwert ${field}.`);
  }
  return value;
}

function nullablePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function basis(volume: boolean): CatalogNutritionBasis {
  return volume ? 'volume' : 'mass';
}

function countability(kind: CatalogUnitKind): CatalogCountability {
  if (kind === 'piece' || kind === 'bar' || kind === 'slice') return 'countable';
  if (kind === 'mass' || kind === 'volume') return 'non_countable';
  return 'unknown';
}

function requiredUnitKind(code: number, fallbackBasis: CatalogNutritionBasis): CatalogUnitKind {
  return UNIT_KIND_BY_CODE.get(code) ?? fallbackBasis;
}

export function projectCatalogProductRow(row: CatalogSqlRow): CatalogProduct {
  const productId = requiredFiniteNumber(row.id, 'id');
  if (!Number.isSafeInteger(productId)) {
    throw new TypeError('Katalog-ID liegt außerhalb des sicheren Integerbereichs.');
  }
  const rescueCode = typeof row.g === 'string' && row.g.length > 0 ? row.g : null;
  const code = decodeCatalogCode(productId, rescueCode);
  const metadataValue = requiredFiniteNumber(row.m, 'm');
  const metadata = decodeCatalogMetadata(metadataValue);
  const nutritionBasis = basis(metadata.carbohydrateBasisVolume);
  const defaultUnitKind = requiredUnitKind(metadata.defaultUnitKind, nutritionBasis);

  const provenKind = UNIT_KIND_BY_CODE.get(metadata.provenUnitKind) ?? null;
  const provenSource = UNIT_SOURCE_BY_CODE.get(metadata.provenUnitSource) ?? null;
  const provenValue = nullablePositiveNumber(row.u);
  let provenUnit: CatalogUnitEvidence | null = null;
  if (provenKind && provenSource && provenValue !== null) {
    provenUnit = {
      value: provenValue,
      basis: basis(metadata.provenUnitBasisVolume),
      kind: provenKind,
      source: provenSource,
      countability: countability(provenKind),
      smallestEdibleUnit: provenKind !== 'package',
      proven: true
    };
  }

  const displayName = typeof row.n === 'string' ? row.n.trim() : '';
  if (!displayName) throw new TypeError('Katalogprodukt besitzt keinen Anzeigenamen.');
  const carbohydratesPer100 = requiredFiniteNumber(row.c, 'c');
  if (carbohydratesPer100 < 0) throw new TypeError('Kohlenhydratwert darf nicht negativ sein.');

  const servingValue = metadata.hasServing ? nullablePositiveNumber(row.s) : null;
  const quantityValue = metadata.hasProductQuantity ? nullablePositiveNumber(row.q) : null;

  return {
    productId,
    code,
    displayName,
    brand: typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : null,
    carbohydratesPer100,
    nutritionBasis,
    nutritionSource: metadata.carbohydrateSourcePrepared ? 'prepared' : 'as_sold',
    manufacturerServing: servingValue === null
      ? null
      : { value: servingValue, basis: basis(metadata.servingBasisVolume) },
    productQuantity: quantityValue === null
      ? null
      : { value: quantityValue, basis: basis(metadata.productQuantityBasisVolume) },
    provenUnit,
    defaultUnitKind,
    // Atlas owns the image reference. Forge intentionally does not compose a URL
    // and will bind the corrected catalog-native reference after owner integration.
    image: null,
    hasQualityErrors: metadata.hasQualityErrors,
    rankOrdinal: requiredFiniteNumber(row.r, 'r')
  };
}

export function projectCatalogSearchRows(rows: readonly CatalogSqlRow[]): readonly CatalogSearchHit[] {
  return rows.map((row, resultIndex) => ({
    ...projectCatalogProductRow(row),
    resultIndex
  }));
}
