import { describe, expect, it } from 'vitest';
import { CLINIC_PRODUCT_COUNT, clinicCatalogProducts, directClinicResolution, isClinicCatalogProduct, searchClinicCatalog } from './clinicCatalog';

describe('Klinikum Leverkusen catalog adapter', () => {
  it('loads all institutional records and preserves missing values', () => {
    expect(CLINIC_PRODUCT_COUNT).toBe(105);
    const missing = searchClinicCatalog('Weizenvollkornbrot')[0];
    expect(missing.nutrition.carbohydratesPer100).toBe(-1);
    expect(isClinicCatalogProduct(missing)).toBe(true);
  });

  it('maps mass values without changing the hospital authority value', () => {
    const bread = searchClinicCatalog('Grahambrot')[0];
    expect(bread.nutrition).toMatchObject({ carbohydratesPer100: 66, basis: 'mass' });
  });

  it('keeps direct piece carbohydrate values out of gram semantics', () => {
    const pancake = searchClinicCatalog('Pfannkuchen mit Quark')[0];
    expect(isClinicCatalogProduct(pancake)).toBe(true);
    if (!isClinicCatalogProduct(pancake)) throw new Error('clinic product expected');
    expect(pancake.clinic.directCarbohydratesPerUnit).toBe(19);
    expect(directClinicResolution(pancake)?.options).toHaveLength(1);
  });

  it('supports browsing the complete list', () => {
    expect(clinicCatalogProducts()).toHaveLength(105);
  });
});
