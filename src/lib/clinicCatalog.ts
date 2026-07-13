import clinicDatabase from '../../Catalog/klinikum-leverkusen-kh-db-v1.1.0-complete.json';
import type { CatalogProduct, CatalogSearchHit } from './catalog/catalogDomain';
import type { CatalogUnitRequest, ResolvedUnitOption } from './resolution/catalogResolution';

export type ClinicMode = 'clinic-only' | 'hybrid' | 'off';

interface RawClinicProduct {
  code: string;
  product_name_de?: string;
  product_name?: string;
  generic_name_de?: string;
  brands?: string | null;
  nutriments?: { carbohydrates_100g?: number; carbohydrates_100ml?: number; carbohydrates_serving?: number };
  data_quality_errors_tags?: string[];
  kh_meta?: {
    category_id?: string;
    aliases?: string[];
    reference?: {
      amount?: { value?: number; unit?: string; is_discrete?: boolean };
      carbohydrates_g?: number | null;
      status?: string;
      scale_mode?: string;
      scalable?: boolean;
    };
    quality?: { confidence?: number; requires_human_review?: boolean; review_status?: string };
  };
}

export interface ClinicProductMetadata {
  source: 'klinikum-leverkusen';
  categoryId: string | null;
  referenceAmount: number;
  referenceUnit: 'g' | 'ml' | 'piece';
  directCarbohydratesPerUnit: number | null;
  valueStatus: 'numeric' | 'missing' | 'external_lookup_required';
  reviewRequired: boolean;
}

export interface ClinicCatalogProduct extends CatalogProduct {
  readonly clinic: ClinicProductMetadata;
}

const rawProducts = (clinicDatabase as { products?: RawClinicProduct[] }).products ?? [];

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('de-DE').replace(/[^a-z0-9äöüß]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function productId(index: number): number { return -2_000_000 - index; }

function convert(raw: RawClinicProduct, index: number): ClinicCatalogProduct {
  const reference = raw.kh_meta?.reference;
  const referenceUnit = reference?.amount?.unit === 'ml' ? 'ml' : reference?.amount?.unit === 'piece' ? 'piece' : 'g';
  const direct = referenceUnit === 'piece' && typeof reference?.carbohydrates_g === 'number' ? reference.carbohydrates_g : null;
  const basis = referenceUnit === 'ml' ? 'volume' : 'mass';
  const carbohydrates = typeof raw.nutriments?.carbohydrates_100g === 'number'
    ? raw.nutriments.carbohydrates_100g
    : typeof raw.nutriments?.carbohydrates_100ml === 'number'
      ? raw.nutriments.carbohydrates_100ml
      : direct ?? -1;
  const referenceAmount = typeof reference?.amount?.value === 'number' && reference.amount.value > 0 ? reference.amount.value : referenceUnit === 'piece' ? 1 : 100;
  return {
    productId: productId(index),
    code: raw.code,
    displayName: raw.product_name_de?.trim() || raw.product_name?.trim() || raw.generic_name_de?.trim() || raw.code,
    brand: raw.brands?.trim() || 'Klinikum Leverkusen',
    nutrition: { carbohydratesPer100: carbohydrates, basis, source: 'prepared' },
    unitEvidence: direct === null
      ? { manufacturerServing: null, productQuantity: null, provenSmallestUnit: null, defaultUnitKind: basis }
      : {
          manufacturerServing: null,
          productQuantity: null,
          provenSmallestUnit: { unitKind: 'piece', baseValue: 100, basis: 'mass', source: 'explicit_serving_count', smallestEdibleUnit: true },
          defaultUnitKind: 'piece'
        },
    imageReference: null,
    hasQualityErrors: Boolean(raw.data_quality_errors_tags?.length || raw.kh_meta?.quality?.requires_human_review),
    rankOrdinal: index,
    clinic: {
      source: 'klinikum-leverkusen',
      categoryId: raw.kh_meta?.category_id ?? null,
      referenceAmount,
      referenceUnit,
      directCarbohydratesPerUnit: direct,
      valueStatus: reference?.status === 'external_lookup_required' ? 'external_lookup_required' : carbohydrates < 0 ? 'missing' : 'numeric',
      reviewRequired: Boolean(raw.kh_meta?.quality?.requires_human_review)
    }
  };
}

const PRODUCTS = rawProducts.map(convert);
const SEARCH_TEXT = rawProducts.map((raw, index) => normalize([
  raw.code,
  PRODUCTS[index].displayName,
  raw.generic_name_de,
  raw.brands,
  ...(raw.kh_meta?.aliases ?? [])
].filter(Boolean).join(' ')));

export function isClinicCatalogProduct(product: CatalogProduct): product is ClinicCatalogProduct {
  return 'clinic' in product && (product as ClinicCatalogProduct).clinic?.source === 'klinikum-leverkusen';
}

export function clinicCatalogProducts(limit = PRODUCTS.length): CatalogSearchHit[] {
  return PRODUCTS.slice(0, limit).map((product, resultIndex) => ({ ...product, resultIndex }));
}

export function clinicProductByCode(code: string): ClinicCatalogProduct | null {
  return PRODUCTS.find((product) => product.code === code) ?? null;
}

export function searchClinicCatalog(query: string, limit = 20): CatalogSearchHit[] {
  const needle = normalize(query);
  if (!needle) return clinicCatalogProducts(limit);
  const tokens = needle.split(' ').filter(Boolean);
  return PRODUCTS
    .map((product, index) => ({ product, index, text: SEARCH_TEXT[index] }))
    .filter(({ text }) => tokens.every((token) => text.includes(token)))
    .sort((a, b) => {
      const score = (text: string, name: string) => (normalize(name) === needle ? 100 : 0) + (text.startsWith(needle) ? 20 : 0);
      return score(b.text, b.product.displayName) - score(a.text, a.product.displayName) || a.index - b.index;
    })
    .slice(0, limit)
    .map(({ product }, resultIndex) => ({ ...product, resultIndex }));
}

export function clinicDefaultRequest(product: ClinicCatalogProduct): CatalogUnitRequest {
  return { amount: product.clinic.referenceAmount, unit: product.clinic.referenceUnit, unitExplicit: false };
}

export function directClinicResolution(product: ClinicCatalogProduct): { status: 'resolved'; selectedOptionId: string; options: ResolvedUnitOption[]; reason: 'smallest-proven-unit' } | null {
  if (product.clinic.directCarbohydratesPerUnit === null) return null;
  const option: ResolvedUnitOption = {
    id: 'piece:clinic-direct:100', unit: 'piece', label: 'Stück', basis: 'mass', baseValue: 100,
    source: 'explicit_serving_count', smallestEdibleUnit: true,
    note: 'Direkter KH-Wert je Klinikportion; kein Grammgewicht wird abgeleitet.', priority: 1, recommended: true
  };
  return { status: 'resolved', selectedOptionId: option.id, options: [option], reason: 'smallest-proven-unit' };
}

export const CLINIC_PRODUCT_COUNT = PRODUCTS.length;
