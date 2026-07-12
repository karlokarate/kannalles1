import { describe, expect, it } from 'vitest';
import { parseFoodRequestLocal } from './parser';

describe('parseFoodRequestLocal', () => {
  it('parses an explicitly requested branded bar', () => {
    const result = parseFoodRequestLocal('1 Riegel Kinder Bueno');
    expect(result.status).toBe('parsed');
    expect(result.amount).toMatchObject({ value: 1, unit: 'bar', valueExplicit: true, unitExplicit: true });
    expect(result.product.name).toBe('Kinder Bueno');
    expect(result.resolutionMode).toBe('exact_product');
  });

  it('treats a bare count as pieces but records that the unit was inferred', () => {
    const result = parseFoodRequestLocal('14 Salzstangen');
    expect(result.amount).toMatchObject({ value: 14, unit: 'piece', valueExplicit: true, unitExplicit: false });
    expect(result.product.name).toBe('Salzstangen');
    expect(result.resolutionMode).toBe('generic_category');
  });

  it('keeps a product-only query unit-neutral for DTO portion selection', () => {
    const result = parseFoodRequestLocal('Bifi');
    expect(result.amount).toMatchObject({ value: 1, unit: 'portion', valueExplicit: false, unitExplicit: false });
    expect(result.resolutionMode).toBe('exact_product');
  });

  it('parses grams and preserves the preparation state', () => {
    const result = parseFoodRequestLocal('200 Gramm gekochter Reis');
    expect(result.amount).toMatchObject({ value: 200, unit: 'g', valueExplicit: true, unitExplicit: true });
    expect(result.product.name).toBe('gekochter Reis');
  });

  it('corrects common branded and base-food typos before searching', () => {
    expect(parseFoodRequestLocal('1 nutello').product.name).toBe('nutella');
    const spaghetti = parseFoodRequestLocal('spagetti');
    expect(spaghetti.product.name).toBe('spaghetti');
    expect(spaghetti.resolutionMode).toBe('generic_category');
  });

  it('detects a barcode', () => {
    const result = parseFoodRequestLocal('3017620693809');
    expect(result.resolutionMode).toBe('barcode');
    expect(result.barcode).toBe('3017620693809');
  });
});
