import {
  CATALOG_UNIT_KINDS,
  buildCatalogImageUrl,
  decodeCatalogCode,
  decodeCatalogMetadata
} from '../../../Catalog/catalog-runtime.generated';
import type {
  CatalogBasis,
  CatalogProductRecord,
  CatalogProvenUnitEvidence,
  CatalogUnitKind,
  CatalogUnitSource
} from './catalogProtocol';

export interface CatalogSqlRow extends Record<string, unknown> {
  id: unknown;
  g: unknown;
  n: unknown;
  brand: unknown;
  c: unknown;
  s: unknown;
  q: unknown;
  u: unknown;
  m: unknown;
  r: unknown;
}

const UNIT_KIND_BY_CODE = new Map<number, CatalogUnitKind>(
  Object.entries(CATALOG_UNIT_KINDS).map(([name, code]) => [Number(code), name as CatalogUnitKind])
);
const UNIT_SOURCE_BY_CODE = new Map<number, CatalogUnitSource>([
  [0, 'none'],
  [1, 'manufacturerServing'],
  [2, 'explicitServingCount'],
  [3, 'explicitMultipackQuantity']
]);

function nullableFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requiredFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Ungültiger numerischer Katalogwert ${field}.`);
  }
  return value;
}

function basis(volume: boolean): CatalogBasis {
  return volume ? 'volume' : 'mass';
}

function unitKind(code: number): CatalogUnitKind {
  return UNIT_KIND_BY_CODE.get(code) ?? 'none';
}

function unitSource(code: number): CatalogUnitSource {
  return UNIT_SOURCE_BY_CODE.get(code) ?? 'none';
}

export function projectCatalogProductRow(row: CatalogSqlRow): CatalogProductRecord {
  const id = requiredFiniteNumber(row.id, 'id');
  if (!Number.isSafeInteger(id)) throw new TypeError('Katalog-ID liegt außerhalb des sicheren Integerbereichs.');
  const rescueCode = typeof row.g === 'string' && row.g.length > 0 ? row.g : null;
  const code = decodeCatalogCode(id, rescueCode);
  const metadataValue = requiredFiniteNumber(row.m, 'm');
  const metadata = decodeCatalogMetadata(metadataValue);
  const servingValue = metadata.hasServing ? nullableFiniteNumber(row.s) : null;
  const productQuantityValue = metadata.hasProductQuantity ? nullableFiniteNumber(row.q) : null;
  const provenKind = unitKind(metadata.provenUnitKind);
  const provenSource = unitSource(metadata.provenUnitSource);
  const provenValue = provenKind === 'none' ? null : nullableFiniteNumber(row.u);

  let provenSmallestUnit: CatalogProvenUnitEvidence | null = null;
  if (provenValue !== null && provenValue > 0 && provenKind !== 'none' && provenSource !== 'none') {
    provenSmallestUnit = {
      value: provenValue,
      basis: basis(metadata.provenUnitBasisVolume),
      kind: provenKind,
      source: provenSource
    };
  }

  const name = typeof row.n === 'string' ? row.n.trim() : '';
  if (!name) throw new TypeError('Katalogprodukt besitzt keinen Anzeigenamen.');
  const carbohydratesPer100 = requiredFiniteNumber(row.c, 'c');
  if (carbohydratesPer100 < 0) throw new TypeError('Kohlenhydratwert darf nicht negativ sein.');

  return {
    code,
    name,
    brand: typeof row.brand === 'string' && row.brand.trim() ? row.brand.trim() : null,
    carbohydratesPer100,
    carbohydrateBasis: basis(metadata.carbohydrateBasisVolume),
    carbohydrateSourcePrepared: metadata.carbohydrateSourcePrepared,
    unitEvidence: {
      manufacturerServing: servingValue !== null && servingValue > 0
        ? { value: servingValue, basis: basis(metadata.servingBasisVolume) }
        : null,
      productQuantity: productQuantityValue !== null && productQuantityValue > 0
        ? { value: productQuantityValue, basis: basis(metadata.productQuantityBasisVolume) }
        : null,
      provenSmallestUnit,
      defaultUnitKind: unitKind(metadata.defaultUnitKind)
    },
    imageUrl: buildCatalogImageUrl(code, metadataValue),
    hasQualityErrors: metadata.hasQualityErrors,
    rankOrdinal: requiredFiniteNumber(row.r, 'r')
  };
}
