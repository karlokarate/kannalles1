import {
  CATALOG_UNIT_KINDS,
  buildCatalogImageUrl,
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
  Object.entries(CATALOG_UNIT_KINDS).map(([name, code]) => [
    Number(code),
    name === 'none' ? null : (name as CatalogUnitKind)
  ])
);
const UNIT_SOURCE_BY_CODE = new Map<number, CatalogUnitEvidenceSource | null>([
  [0, null],
  [1, 'manufacturer_serving'],
  [2, 'explicit_serving_count'],
  [3, 'explicit_multipack_quantity']
]);

function nullablePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Ungültiger numerischer Katalogwert ${field}.`);
  }
  return value;
}

function basis(volume: boolean): CatalogNutritionBasis {
  return volume ? 'volume' : 'mass';
}

function unitKind(code: number): CatalogUnitKind | null {
  return UNIT_KIND_BY_CODE.get(code) ?? null;
}

function unitSource(code: number): CatalogUnitEvidenceSource | null {
  return UNIT_SOURCE_BY_CODE.get(code) ?? null;
}

function countability(kind: CatalogUnitKind): CatalogCountability {
  if (kind === 'piece' || kind === 'bar' || kind === 'slice' || kind === 'package') return 'countable';
  if (kind === 'mass' || kind === 'volume') return 'non_countable';
  return 'unknown';
}

export function projectCatalogProductRow(row: CatalogSqlRow): CatalogProduct {
  const productId = requiredFiniteNumber(row.id, 'id');
  if (!Number.isSafeInteger(productId)) {
    throw new TypeError('Katalog-ID liegt außerhalb des sicheren Integerbereichs.');
  }
  const rescueCode = typeof row.g === 'string' && row.g.length > 0 ? row.g : null;
  const code = decodeCatalogCode(productId, rescueCode);
  const metadataValue = requiredFiniteNumber(row.m, 'm');
  if (!Number.isSafeInteger(metadataValue) || metadataValue < 0) {
    throw new TypeError('Katalogmetadaten sind ungültig.');
  }
  const metadata = decodeCatalogMetadata(metadataValue);
  const displayName = typeof row.n === 'string' ? row.n.trim() : '';
  if (!displayName) throw new TypeError('Katalogprodukt besitzt keinen Anzeigenamen.');
  const carbohydratesPer100 = requiredFiniteNumber(row.c, 'c');
  if (carbohydratesPer100 < 0) throw new TypeError('Kohlenhydratwert darf nicht negativ sein.');

  const manufacturerServingValue = metadata.hasServing ? nullablePositiveNumber(row.s) : null;
  const productQuantityValue = metadata.hasProductQuantity ? nullablePositiveNumber(row.q) : null;
  const provenKind = unitKind(metadata.provenUnitKind);
  const provenSource = unitSource(metadata.provenUnitSource);
  const provenValue = provenKind === null ? null : nullablePositiveNumber(row.u);

  let provenUnit: CatalogUnitEvidence | null = null;
  if (provenKind !== null && provenSource !== null && provenValue !== null) {
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

  const defaultUnitKind = unitKind(metadata.defaultUnitKind) ?? 'mass';
  const imageUrl = buildCatalogImageUrl(code, metadataValue);
  return {
    productId,
    code,
    displayName,
    brand: typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : null,
    carbohydratesPer100,
    nutritionBasis: basis(metadata.carbohydrateBasisVolume),
    nutritionSource: metadata.carbohydrateSourcePrepared ? 'prepared' : 'as_sold',
    manufacturerServing: manufacturerServingValue === null
      ? null
      : { value: manufacturerServingValue, basis: basis(metadata.servingBasisVolume) },
    productQuantity: productQuantityValue === null
      ? null
      : { value: productQuantityValue, basis: basis(metadata.productQuantityBasisVolume) },
    provenUnit,
    defaultUnitKind,
    image: imageUrl === null ? null : { url: imageUrl, optionalNetwork: true },
    hasQualityErrors: metadata.hasQualityErrors,
    rankOrdinal: requiredFiniteNumber(row.r, 'r')
  };
}

/** Assigns resultIndex without sorting, filtering or otherwise changing SQLite order. */
export function projectCatalogSearchRows(rows: readonly CatalogSqlRow[]): readonly CatalogSearchHit[] {
  return rows.map((row, resultIndex) => ({
    ...projectCatalogProductRow(row),
    resultIndex
  }));
}
