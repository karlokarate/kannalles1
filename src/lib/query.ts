import { normalizeText } from './format';

const TOKEN_CORRECTIONS: Record<string, string> = {
  nutello: 'nutella',
  nutela: 'nutella',
  nuttella: 'nutella',
  kinderr: 'kinder',
  buno: 'bueno',
  buenno: 'bueno',
  salzstangn: 'salzstangen',
  salzstangeen: 'salzstangen',
  nudln: 'nudeln',
  spagetti: 'spaghetti',
  spagheti: 'spaghetti',
  kartofeln: 'kartoffeln',
  kichererbsn: 'kichererbsen',
  schokobon: 'schokobons',
  schokobons: 'schokobons',
  'schoko-bons': 'schokobons',
  bifie: 'bifi',
  bifii: 'bifi'
};

const LUCENE_SPECIAL = /([+\-!(){}[\]^"~*?:\\/]|&&|\|\|)/g;

function preserveCaseReplacement(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function correctCommonFoodTypos(value: string): string {
  return value
    .split(/(\s+|[-/])/)
    .map((part) => {
      const normalized = normalizeText(part);
      const replacement = TOKEN_CORRECTIONS[normalized];
      return replacement ? preserveCaseReplacement(part, replacement) : part;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeLuceneToken(token: string): string {
  return token.replace(LUCENE_SPECIAL, '\\$1');
}

export function fuzzyLuceneQuery(value: string): string | null {
  const tokens = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (!tokens.length) return null;

  let fuzzyCount = 0;
  const query = tokens.map((token) => {
    const plain = normalizeText(token).replace(/[^a-z0-9äöüß-]/g, '');
    if (plain.length < 5 || /^\d+$/.test(plain)) return escapeLuceneToken(token);
    fuzzyCount += 1;
    return `${escapeLuceneToken(token)}~1`;
  }).join(' ');

  return fuzzyCount ? query : null;
}

export function uniqueQueries(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value?.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase('de-DE');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}
