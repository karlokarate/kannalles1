import { describe, expect, it } from 'vitest';
import {
  expandGermanVulgarFractions,
  parseLeadingGermanQuantity
} from './germanQuantity';

function amount(value: string): number | null {
  return parseLeadingGermanQuantity(value)?.amount ?? null;
}

describe('German leading quantity grammar', () => {
  it.each([
    ['ein halbes Brötchen', 0.5],
    ['eine halbe Portion Nudeln', 0.5],
    ['einen halben Apfel', 0.5],
    ['einem halben Riegel', 0.5],
    ['halbes Brötchen', 0.5],
    ['halb Brötchen', 0.5],
    ['anderthalb Brötchen', 1.5],
    ['eineinhalb Brötchen', 1.5],
    ['zweieinhalb Brötchen', 2.5],
    ['dreieinhalb Scheiben Brot', 3.5],
    ['zwei einhalb Portionen', 2.5],
    ['ein und ein halb Brötchen', 1.5],
    ['drei halbe Brötchen', 1.5]
  ])('parses spoken half quantities: %s', (input, expected) => {
    expect(amount(input)).toBe(expected);
  });

  it.each([
    ['ein Viertel Brötchen', 0.25],
    ['Viertel Brötchen', 0.25],
    ['drei Viertel Brötchen', 0.75],
    ['dreiviertel Brötchen', 0.75],
    ['zwei Drittel Portion', 2 / 3],
    ['zweidrittel Portion', 2 / 3],
    ['fünf Achtel Portion', 5 / 8],
    ['fuenfachtel Portion', 5 / 8]
  ])('parses spoken fractions: %s', (input, expected) => {
    expect(amount(input)).toBeCloseTo(expected, 12);
  });

  it.each([
    ['1/2 Brötchen', 0.5],
    ['3/4 Brötchen', 0.75],
    ['1 1/2 Brötchen', 1.5],
    ['½ Brötchen', 0.5],
    ['1½ Brötchen', 1.5],
    ['¾ Brötchen', 0.75],
    ['1,25 Portionen', 1.25],
    ['0.5 Portionen', 0.5]
  ])('parses numeric and symbolic fractions: %s', (input, expected) => {
    expect(amount(input)).toBe(expected);
  });

  it.each([
    ['null komma fünf Brötchen', 0.5],
    ['eins komma fünf Brötchen', 1.5],
    ['ein komma zwei fünf Portionen', 1.25],
    ['zwei komma null fünf Portionen', 2.05]
  ])('parses spoken decimal quantities: %s', (input, expected) => {
    expect(amount(input)).toBe(expected);
  });

  it('consumes the complete amount phrase instead of only the article', () => {
    expect(parseLeadingGermanQuantity('ein halbes Brötchen')).toEqual({
      amount: 0.5,
      consumedCharacters: 'ein halbes'.length,
      source: 'fraction'
    });
  });

  it('preserves whole-number behavior', () => {
    expect(parseLeadingGermanQuantity('zwei Brötchen')).toEqual({
      amount: 2,
      consumedCharacters: 'zwei'.length,
      source: 'spoken'
    });
    expect(parseLeadingGermanQuantity('12 Brötchen')).toEqual({
      amount: 12,
      consumedCharacters: 2,
      source: 'numeric'
    });
  });

  it('expands vulgar fractions before NFKC can merge mixed numbers', () => {
    expect(expandGermanVulgarFractions('½ Brötchen')).toBe('1/2 Brötchen');
    expect(expandGermanVulgarFractions('1½ Brötchen')).toBe('1 1/2 Brötchen');
    expect(expandGermanVulgarFractions('2¾ Portionen')).toBe('2 3/4 Portionen');
  });

  it.each(['0 Brötchen', 'null Brötchen', '1/0 Brötchen', 'Brötchen'])('does not accept invalid or absent positive amounts: %s', (input) => {
    expect(parseLeadingGermanQuantity(input)).toBeNull();
  });
});
