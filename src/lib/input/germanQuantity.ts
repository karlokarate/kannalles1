export interface ParsedLeadingGermanQuantity {
  amount: number;
  consumedCharacters: number;
  source: 'numeric' | 'fraction' | 'spoken';
}

interface WordToken {
  value: string;
  end: number;
}

const VULGAR_FRACTIONS: Readonly<Record<string, string>> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅖': '2/5',
  '⅗': '3/5',
  '⅘': '4/5',
  '⅙': '1/6',
  '⅚': '5/6',
  '⅐': '1/7',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
  '⅑': '1/9',
  '⅒': '1/10'
};

const CARDINAL_WORDS: Readonly<Record<string, number>> = {
  null: 0,
  nul: 0,
  zero: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12
};

const DIGIT_WORDS: Readonly<Record<string, number>> = {
  null: 0,
  nul: 0,
  zero: 0,
  ein: 1,
  eins: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9
};

const HALF_FORMS = new Set(['halb', 'halbe', 'halben', 'halber', 'halbes']);
const ONE_FORMS = new Set(['ein', 'eins', 'eine', 'einen', 'einem', 'einer']);
const DENOMINATORS: Readonly<Record<string, number>> = {
  halb: 2,
  halbe: 2,
  halben: 2,
  halber: 2,
  halbes: 2,
  drittel: 3,
  viertel: 4,
  fünftel: 5,
  fuenftel: 5,
  sechstel: 6,
  siebtel: 7,
  achtel: 8,
  neuntel: 9,
  zehntel: 10,
  elftel: 11,
  zwölftel: 12,
  zwoelftel: 12
};

const COMPOUND_CARDINAL_STEMS: Readonly<Record<string, number>> = {
  ein: 1,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  zwoelf: 12
};

const HALF_COMPOUNDS = new Map<string, number>([
  ['anderthalb', 1.5],
  ['anderthalbe', 1.5],
  ['anderthalben', 1.5],
  ['anderthalber', 1.5],
  ['anderthalbes', 1.5],
  ['eineinhalb', 1.5],
  ['einhalb', 0.5]
]);

for (const [stem, amount] of Object.entries(COMPOUND_CARDINAL_STEMS)) {
  if (amount >= 2) HALF_COMPOUNDS.set(`${stem}einhalb`, amount + 0.5);
}

const COMPOUND_DENOMINATORS = Object.entries(DENOMINATORS)
  .filter(([word]) => !HALF_FORMS.has(word))
  .sort(([left], [right]) => right.length - left.length);

export function expandGermanVulgarFractions(value: string): string {
  return value.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]/gu, (glyph, offset: number, input: string) => {
    const fraction = VULGAR_FRACTIONS[glyph];
    const previous = offset > 0 ? input[offset - 1] : '';
    return `${/\d/u.test(previous) ? ' ' : ''}${fraction}`;
  });
}

function finitePositive(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function fraction(numerator: number, denominator: number, whole = 0): number | null {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator <= 0) return null;
  return finitePositive(whole + numerator / denominator);
}

function numericMatch(value: string): ParsedLeadingGermanQuantity | null {
  const mixed = value.match(/^(\d+)\s+(\d+)\s*[\/⁄]\s*(\d+)(?=$|\s|[\p{L}])/u);
  if (mixed) {
    const amount = fraction(Number(mixed[2]), Number(mixed[3]), Number(mixed[1]));
    if (amount !== null) {
      return { amount, consumedCharacters: mixed[0].length, source: 'fraction' };
    }
  }

  const simpleFraction = value.match(/^(\d+)\s*[\/⁄]\s*(\d+)(?=$|\s|[\p{L}])/u);
  if (simpleFraction) {
    const amount = fraction(Number(simpleFraction[1]), Number(simpleFraction[2]));
    if (amount !== null) {
      return { amount, consumedCharacters: simpleFraction[0].length, source: 'fraction' };
    }
  }

  const number = value.match(/^(\d+(?:[.,]\d+)?)(?=$|\s|[\p{L}])/u);
  if (!number) return null;
  const amount = finitePositive(Number(number[1].replace(',', '.')));
  return amount === null
    ? null
    : { amount, consumedCharacters: number[0].length, source: 'numeric' };
}

function leadingWords(value: string, maximum = 8): WordToken[] {
  const tokens: WordToken[] = [];
  const matcher = /[a-zäöüß]+/giu;
  let previousEnd = 0;

  for (const match of value.matchAll(matcher)) {
    const start = match.index ?? 0;
    if (tokens.length === 0 && start !== 0) break;
    if (tokens.length > 0 && !/^[\s-]+$/u.test(value.slice(previousEnd, start))) break;
    const word = match[0].toLocaleLowerCase('de-DE');
    const end = start + match[0].length;
    tokens.push({ value: word, end });
    previousEnd = end;
    if (tokens.length >= maximum) break;
  }
  return tokens;
}

function spokenDecimal(tokens: readonly WordToken[]): ParsedLeadingGermanQuantity | null {
  if (tokens.length < 3 || tokens[1].value !== 'komma') return null;
  const whole = CARDINAL_WORDS[tokens[0].value];
  if (whole === undefined) return null;

  const digits: number[] = [];
  let end = tokens[1].end;
  for (const token of tokens.slice(2)) {
    const digit = DIGIT_WORDS[token.value];
    if (digit === undefined) break;
    digits.push(digit);
    end = token.end;
  }
  if (digits.length === 0) return null;
  const amount = finitePositive(Number(`${whole}.${digits.join('')}`));
  return amount === null
    ? null
    : { amount, consumedCharacters: end, source: 'spoken' };
}

function compoundFraction(word: string): number | null {
  for (const [denominatorWord, denominator] of COMPOUND_DENOMINATORS) {
    if (!word.endsWith(denominatorWord)) continue;
    const numeratorWord = word.slice(0, -denominatorWord.length);
    const numerator = COMPOUND_CARDINAL_STEMS[numeratorWord];
    if (numerator !== undefined) return fraction(numerator, denominator);
  }
  return null;
}

function spokenMatch(value: string): ParsedLeadingGermanQuantity | null {
  const tokens = leadingWords(value);
  if (tokens.length === 0) return null;

  const decimal = spokenDecimal(tokens);
  if (decimal) return decimal;

  const directHalf = HALF_COMPOUNDS.get(tokens[0].value);
  if (directHalf !== undefined) {
    return { amount: directHalf, consumedCharacters: tokens[0].end, source: 'spoken' };
  }

  const whole = CARDINAL_WORDS[tokens[0].value];
  if (whole !== undefined && whole > 0) {
    if (tokens[1]?.value === 'und') {
      const halfIndex = ONE_FORMS.has(tokens[2]?.value ?? '') ? 3 : 2;
      if (HALF_FORMS.has(tokens[halfIndex]?.value ?? '')) {
        return {
          amount: whole + 0.5,
          consumedCharacters: tokens[halfIndex].end,
          source: 'spoken'
        };
      }
    }
    if (tokens[1]?.value === 'einhalb') {
      return {
        amount: whole + 0.5,
        consumedCharacters: tokens[1].end,
        source: 'spoken'
      };
    }
  }

  if (ONE_FORMS.has(tokens[0].value) && HALF_FORMS.has(tokens[1]?.value ?? '')) {
    return { amount: 0.5, consumedCharacters: tokens[1].end, source: 'fraction' };
  }

  if (HALF_FORMS.has(tokens[0].value)) {
    return { amount: 0.5, consumedCharacters: tokens[0].end, source: 'fraction' };
  }

  const compactFraction = compoundFraction(tokens[0].value);
  if (compactFraction !== null) {
    return { amount: compactFraction, consumedCharacters: tokens[0].end, source: 'fraction' };
  }

  const denominator = DENOMINATORS[tokens[1]?.value ?? ''];
  if (whole !== undefined && whole > 0 && denominator !== undefined) {
    const amount = fraction(whole, denominator);
    if (amount !== null) {
      return { amount, consumedCharacters: tokens[1].end, source: 'fraction' };
    }
  }

  const bareDenominator = DENOMINATORS[tokens[0].value];
  if (bareDenominator !== undefined) {
    const amount = fraction(1, bareDenominator);
    if (amount !== null) {
      return { amount, consumedCharacters: tokens[0].end, source: 'fraction' };
    }
  }

  if (whole !== undefined && whole > 0) {
    return { amount: whole, consumedCharacters: tokens[0].end, source: 'spoken' };
  }
  return null;
}

export function parseLeadingGermanQuantity(value: string): ParsedLeadingGermanQuantity | null {
  const expanded = expandGermanVulgarFractions(value).normalize('NFKC').trimStart();
  return numericMatch(expanded) ?? spokenMatch(expanded);
}
