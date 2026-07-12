#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'contracts/generated/search-api.generated.test.ts');
const content = `/** Generated contract tests. Do not edit manually. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AiParseResponseSchema,
  ProductGatewayResponseSchema,
  SearchGatewayResponseSchema,
  buildGatewayProductUrl,
  buildGatewaySearchUrl
} from '../../src/generated/search-api';
import { getKHCheckerOptionalGatewayAPIMock } from '../../generated-tests/search-api.msw';

const document = JSON.parse(readFileSync(new URL('./search-api.openapi.json', import.meta.url), 'utf8'));

describe('generated optional gateway contract', () => {
  it('publishes OpenAPI 3.1 and all four operations for the current version', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe('2.2.4');
    expect(Object.keys(document.paths).sort()).toEqual([
      '/api/ai/parse', '/api/health', '/api/product/{code}', '/api/search'
    ]);
    expect(document['x-kh-generator']).toMatchObject({
      appVersion: '2.2.4', localCooldownAllowed: false,
      maximumDirectSearchBackendsPerAction: 2, productHydrationFanOutAllowed: false
    });
  });

  it('uses Orval URL builders through the generated absolute gateway adapter', () => {
    expect(buildGatewaySearchUrl('https://kh.example/root/', 'Kinder Bueno', 15))
      .toBe('https://kh.example/root/api/search?q=Kinder+Bueno&page_size=15');
    expect(buildGatewayProductUrl('https://kh.example/root', '4000417025005', true))
      .toBe('https://kh.example/root/api/product/4000417025005?known_carbs=1');
  });

  it('validates gateway search and product payloads at runtime', () => {
    expect(SearchGatewayResponseSchema.parse({ hits: [], count: 0, source: 'gateway' }).hits).toEqual([]);
    expect(ProductGatewayResponseSchema.parse({ status: 'success', code: '4000417025005' }).code)
      .toBe('4000417025005');
    expect(() => SearchGatewayResponseSchema.parse({ hits: 'invalid' })).toThrow();
  });

  it('validates the optional AI parser response without hand-written duplicate schemas', () => {
    const parsed = AiParseResponseSchema.parse({
      status: 'parsed', rawInput: '2 Äpfel',
      product: { name: 'Apfel', brand: null, variant: null },
      amount: { value: 2, unit: 'piece' }, resolutionMode: 'generic_category',
      barcode: null, clarificationQuestion: null, parser: 'openai'
    });
    expect(parsed.amount.value).toBe(2);
  });

  it('generates four MSW handlers from the same OpenAPI input', () => {
    expect(getKHCheckerOptionalGatewayAPIMock()).toHaveLength(4);
  });
});
`;
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, content);
console.log('Generated contract test:', path.relative(root, target));
