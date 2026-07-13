import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogProductRecord } from './catalog/catalogProtocol';

vi.mock('./catalog/catalogClient', () => ({
  searchOfflineCatalog: vi.fn(),
  getOfflineCatalogProduct: vi.fn(),
  cancelOfflineCatalogRequests: vi.fn()
}));

import {
  cancelOfflineCatalogRequests,
  getOfflineCatalogProduct,
  searchOfflineCatalog
} from './catalog/catalogClient';
import {
  DataSourceError,
  authenticateOffAccount,
  cancelPendingApiRequests,
  canonicalizeSearchQuery,
  getProductByBarcode,
  searchFoodCandidates,
  searchFoodCandidatesOutcome
} from './api';

const product: CatalogProductRecord = {
  code: '8000500310427',
  name: 'Kinder Bueno',
  brand: 'Ferrero',
  carbohydratesPer100: 49.5,
  carbohydrateBasis: 'mass',
  carbohydrateSourcePrepared: false,
  servingValue: 43,
  servingBasis: 'mass',
  productQuantityValue: 43,
  productQuantityBasis: 'mass',
  provenUnitValue: 21.5,
  provenUnitKind: 'bar',
  provenUnitSource: 'explicitServingCount',
  provenUnitBasis: 'mass',
  defaultUnitKind: 'bar',
  imageUrl: 'https://images.openfoodfacts.org/images/products/800/050/031/0427/front_de.12.200.jpg',
  hasQualityErrors: false,
  rankOrdinal: 1000
};

beforeEach(() => {
  vi.mocked(searchOfflineCatalog).mockReset();
  vi.mocked(getOfflineCatalogProduct).mockReset();
  vi.mocked(cancelOfflineCatalogRequests).mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe('offline SQLite search adapter', () => {
  it('canonicalizes before the catalog query and never contacts an online product API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(searchOfflineCatalog).mockResolvedValue([product]);

    const response = await searchFoodCandidates('  Kinder   Bueno  ', 10);

    expect(searchOfflineCatalog).toHaveBeenCalledWith('Kinder Bueno', 10, undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.hits).toHaveLength(1);
    expect(response.hits[0]).toMatchObject({
      code: product.code,
      product_name: product.name,
      brands: product.brand,
      serving_size: '1 Riegel (21.5 g)',
      serving_quantity: 21.5,
      nutrition_data_per: '100g',
      image_front_url: product.imageUrl,
      nutriments: { carbohydrates_100g: 49.5 }
    });
    expect(response.hits[0].categories_tags).toContain('kh-catalog-unit-bar');
  });

  it('maps a volume/prepared product without inventing a mass basis', async () => {
    vi.mocked(searchOfflineCatalog).mockResolvedValue([{
      ...product,
      carbohydratesPer100: 8.2,
      carbohydrateBasis: 'volume',
      carbohydrateSourcePrepared: true,
      servingValue: 250,
      servingBasis: 'volume',
      productQuantityValue: 1000,
      productQuantityBasis: 'volume',
      provenUnitValue: null,
      provenUnitKind: 'none',
      provenUnitSource: 'none',
      provenUnitBasis: null,
      defaultUnitKind: 'volume'
    }]);

    const response = await searchFoodCandidates('Getränk', 20);
    expect(response.hits[0]).toMatchObject({
      serving_size: '250 ml',
      product_quantity_unit: 'ml',
      nutrition_data_per: '100ml',
      nutrition_data_prepared_per: '100ml',
      nutriments: {
        carbohydrates_100ml: 8.2,
        carbohydrates_prepared_100ml: 8.2
      }
    });
  });

  it('returns a typed not_found outcome for an empty, reachable catalog', async () => {
    vi.mocked(searchOfflineCatalog).mockResolvedValue([]);
    const outcome = await searchFoodCandidatesOutcome('Nicht vorhanden');
    expect(outcome.status).toBe('not_found');
    expect(outcome.diagnostics).toMatchObject({
      networkAttempted: false,
      retryAllowedImmediately: true
    });
  });

  it('returns temporarily_unavailable instead of leaking a worker exception', async () => {
    const error = Object.assign(new Error('Hashprüfung fehlgeschlagen'), { code: 'CATALOG_HASH_MISMATCH' });
    vi.mocked(searchOfflineCatalog).mockRejectedValue(error);
    const outcome = await searchFoodCandidatesOutcome('Apfel');
    expect(outcome.status).toBe('temporarily_unavailable');
    expect(outcome.result).toBeNull();
    expect(outcome.diagnostics).toMatchObject({
      networkAttempted: false,
      errorKind: 'parse',
      retryAllowedImmediately: true,
      message: 'Hashprüfung fehlgeschlagen'
    });
  });
});

describe('offline barcode adapter', () => {
  it('reads the selected product from the same local catalog', async () => {
    vi.mocked(getOfflineCatalogProduct).mockResolvedValue(product);
    const response = await getProductByBarcode(product.code);
    expect(getOfflineCatalogProduct).toHaveBeenCalledWith(product.code, undefined);
    expect(response.product).toMatchObject({
      code: product.code,
      product_name: product.name,
      serving_size: '1 Riegel (21.5 g)'
    });
  });

  it('does not replace a missing barcode with an unrelated product', async () => {
    vi.mocked(getOfflineCatalogProduct).mockResolvedValue(null);
    await expect(getProductByBarcode('3017620422003')).rejects.toMatchObject({
      name: 'DataSourceError',
      kind: 'http',
      status: 404
    });
  });
});

describe('retired online paths', () => {
  it('cancels only local catalog requests', () => {
    cancelPendingApiRequests();
    expect(cancelOfflineCatalogRequests).toHaveBeenCalledOnce();
  });

  it('cannot authenticate an OFF account while the product runtime is offline-only', async () => {
    await expect(authenticateOffAccount({ userId: 'legacy', password: 'secret' }))
      .rejects.toBeInstanceOf(DataSourceError);
  });

  it('keeps controlled typo correction in the canonical query', () => {
    expect(canonicalizeSearchQuery('Erdüsse')).toBe('Erdnüsse');
  });
});
