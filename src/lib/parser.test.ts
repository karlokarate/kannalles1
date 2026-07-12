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

  it('detects a 7-digit UPC-E code without treating it as an amount', () => {
    const result = parseFoodRequestLocal('1234567');
    expect(result.status).toBe('parsed');
    expect(result.resolutionMode).toBe('barcode');
    expect(result.barcode).toBe('01234567');
  });

  it('parses compact metric amounts with German decimals', () => {
    expect(parseFoodRequestLocal('100g Reis')).toMatchObject({
      status: 'parsed',
      product: { name: 'Reis' },
      amount: { value: 100, unit: 'g', valueExplicit: true, unitExplicit: true }
    });
    expect(parseFoodRequestLocal('1,5kg gekochter Reis')).toMatchObject({
      status: 'parsed',
      product: { name: 'gekochter Reis' },
      amount: { value: 1.5, unit: 'kg', valueExplicit: true, unitExplicit: true }
    });
  });

  it('asks for correction instead of silently replacing nonpositive or absurd amounts', () => {
    for (const input of ['0 g Reis', '-2kg Reis', '101 kg Reis', '100001ml Saft']) {
      const parsed = parseFoodRequestLocal(input);
      expect(parsed.status, input).toBe('needs_clarification');
      expect(parsed.clarificationQuestion, input).toMatch(/Menge|groß/i);
    }
  });

  it('keeps numeric product brands intact when no quantity was expressed', () => {
    const parsed = parseFoodRequestLocal('7 Days Croissant');
    expect(parsed.status).toBe('parsed');
    expect(parsed.product.name).toBe('7 Days Croissant');
    expect(parsed.amount).toMatchObject({ value: 1, unit: 'portion', valueExplicit: false });
    expect(parsed.barcode).toBeNull();
    expect(parsed.resolutionMode).toBe('exact_product');
  });

  it('accepts common barcode punctuation and removes it from the product query', () => {
    const barcodeOnly = parseFoodRequestLocal('EAN: 3017-6204-2200-3');
    expect(barcodeOnly).toMatchObject({
      status: 'parsed',
      barcode: '3017620422003',
      resolutionMode: 'barcode',
      product: { name: 'Produkt per Barcode' }
    });
    const combined = parseFoodRequestLocal('1 Riegel Nutella 3017 6204 2200 3');
    expect(combined.product.name).toBe('Nutella');
    expect(combined.barcode).toBe('3017620422003');
  });
});
