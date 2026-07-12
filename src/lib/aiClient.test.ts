import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFoodRequestWithAi } from './aiClient';

function aiResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 'parsed',
    rawInput: 'vom Modell verändert',
    product: { name: 'Apfel', brand: null, variant: null },
    amount: { value: 10, unit: 'g' },
    resolutionMode: 'exact_product',
    barcode: null,
    clarificationQuestion: null,
    parser: 'openai',
    ...overrides
  };
}

function mockGateway(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })));
}

afterEach(() => vi.unstubAllGlobals());

describe('AI parser evidence adapter', () => {
  it('keeps the original input and locally explicit 100 g instead of an AI-changed 10 g', async () => {
    mockGateway(aiResponse({ amount: { value: 10, unit: 'g' } }));
    const parsed = await parseFoodRequestWithAi('100 g Apfel', 'https://gateway.example/');
    expect(parsed.rawInput).toBe('100 g Apfel');
    expect(parsed.amount).toMatchObject({ value: 100, unit: 'g', valueExplicit: true, unitExplicit: true });
  });

  it('falls back to the deterministic local parser for a hallucinated barcode', async () => {
    mockGateway(aiResponse({
      resolutionMode: 'barcode',
      barcode: '3017620422003',
      product: { name: 'Nutella', brand: 'Ferrero', variant: null }
    }));
    const parsed = await parseFoodRequestWithAi('1 Apfel', 'https://gateway.example/');
    expect(parsed.parser).toBe('local');
    expect(parsed.barcode).toBeNull();
    expect(parsed.product.name.toLowerCase()).toContain('apfel');
  });

  it('accepts only a normalized barcode that is actually present in the input', async () => {
    mockGateway(aiResponse({
      resolutionMode: 'barcode',
      barcode: '1234567',
      product: { name: 'Produkt', brand: null, variant: null }
    }));
    const parsed = await parseFoodRequestWithAi('Barcode 1 2 3 4 5 6 7', 'https://gateway.example/');
    expect(parsed.parser).toBe('openai');
    expect(parsed.rawInput).toBe('Barcode 1 2 3 4 5 6 7');
    expect(parsed.barcode).toBe('01234567');
  });

  it('preserves a locally evidenced barcode when the AI omits it', async () => {
    mockGateway(aiResponse({ barcode: null, resolutionMode: 'exact_product' }));
    const parsed = await parseFoodRequestWithAi('EAN (3017.6204.2200.3)', 'https://gateway.example/');
    expect(parsed.barcode).toBe('3017620422003');
    expect(parsed.resolutionMode).toBe('barcode');
  });

  it('does not let an AI response repair an explicitly nonpositive amount silently', async () => {
    mockGateway(aiResponse({ amount: { value: 100, unit: 'g' } }));
    const parsed = await parseFoodRequestWithAi('0g Apfel', 'https://gateway.example/');
    expect(parsed.parser).toBe('local');
    expect(parsed.status).toBe('needs_clarification');
    expect(parsed.clarificationQuestion).toMatch(/größer als 0/);
  });
});
