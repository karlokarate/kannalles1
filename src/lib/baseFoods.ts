import { normalizeText } from './format';
import { getPreparationIntent } from './preparation';

export interface BaseFoodReference {
  id: string;
  blsCode: string;
  label: string;
  aliases: RegExp;
  carbohydratesPer100g: number;
  middleRange: { from: number; to: number };
  stateLabel: string;
  sourceLabel: string;
  note: string;
}

const BLS_VERSION = 'BLS 4.0';
const BLS_PUBLISHER = 'Max Rubner-Institut 2025';
const BLS_DOI = '10.25826/Data20251217-134202-0';

function blsSourceLabel(code: string): string {
  return `${BLS_VERSION} · ${code} · MRI 2025`;
}

function blsNote(code: string, qualifier: string): string {
  return `Offizieller Bundeslebensmittelschlüssel ${BLS_VERSION}, Datensatz ${code}, Nährstoff „Kohlenhydrate, verfügbar“ (${BLS_PUBLISHER}, CC BY 4.0, DOI ${BLS_DOI}). ${qualifier}`;
}

/**
 * Small, transparent fallback table for common staple foods in their usual
 * ready-to-eat state. It exists because Open Food Facts is product-centric:
 * a generic query such as “Nudeln” can otherwise be dominated by specialty
 * products (instant noodles, legume pasta, meal kits, etc.).
 *
 * Values are deliberately shown as generic references, never as a branded
 * product claim. Product-specific labels and barcodes still use OFF data.
 */
const REFERENCES: BaseFoodReference[] = [
  {
    id: 'peanuts-roasted-unsalted',
    blsCode: 'H110600',
    label: 'Erdnüsse, geröstet',
    aliases: /\b(erdnuss|erdnusse|erdnuesse|peanut|peanuts)\b/,
    carbohydratesPer100g: 9.9,
    middleRange: { from: 9.9, to: 9.9 },
    stateLabel: 'geröstet',
    sourceLabel: blsSourceLabel('H110600'),
    note: blsNote('H110600', 'Gewürzte, ummantelte oder anderweitig verarbeitete Produkte können abweichen und sollten als konkretes Produkt gesucht werden.')
  },
  {
    id: 'pasta-cooked',
    blsCode: 'E401032',
    label: 'Nudeln, gekocht',
    aliases: /\b(nudel\w*|pasta|spaghetti|macaroni|maccheroni)\b/,
    carbohydratesPer100g: 28.68,
    middleRange: { from: 28.68, to: 28.68 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('E401032'),
    note: blsNote('E401032', 'Gilt für eifreie gekochte Teigwaren ohne Sauce; Spezialnudeln und Fertiggerichte sind ausgeschlossen.')
  },
  {
    id: 'rice-cooked',
    blsCode: 'C352032',
    label: 'Reis, gekocht',
    aliases: /\b(reis|rice)\b/,
    carbohydratesPer100g: 24.8,
    middleRange: { from: 24.8, to: 24.8 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('C352032'),
    note: blsNote('C352032', 'Gilt für polierten gekochten Reis ohne Sauce oder weitere Zutaten.')
  },
  {
    id: 'couscous-cooked',
    blsCode: 'C119232',
    label: 'Couscous, zubereitet',
    aliases: /\bcouscous\b/,
    carbohydratesPer100g: 31.05,
    middleRange: { from: 31.05, to: 31.05 },
    stateLabel: 'zubereitet / verzehrfertig',
    sourceLabel: blsSourceLabel('C119232'),
    note: blsNote('C119232', 'Gilt für gekochten Hartweizen-Couscous ohne Sauce.')
  },
  {
    id: 'bulgur-cooked',
    blsCode: 'C119132',
    label: 'Bulgur, gekocht',
    aliases: /\bbulgur\b/,
    carbohydratesPer100g: 29.1,
    middleRange: { from: 29.1, to: 29.1 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('C119132'),
    note: blsNote('C119132', 'Gilt für gekochten Hartweizen-Bulgur ohne weitere Zutaten.')
  },
  {
    id: 'quinoa-cooked',
    blsCode: 'C118032',
    label: 'Quinoa, gekocht',
    aliases: /\bquinoa\b/,
    carbohydratesPer100g: 16.92,
    middleRange: { from: 16.92, to: 16.92 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('C118032'),
    note: blsNote('C118032', 'Gilt für weiße gekochte Quinoa ohne weitere Zutaten.')
  },
  {
    id: 'lentils-cooked',
    blsCode: 'H730132',
    label: 'Linsen, gekocht',
    aliases: /\blinse\w*\b/,
    carbohydratesPer100g: 15.5,
    middleRange: { from: 15.5, to: 15.5 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('H730132'),
    note: blsNote('H730132', 'Gilt für reife gekochte Linsen ohne Sauce.')
  },
  {
    id: 'chickpeas-cooked',
    blsCode: 'G770432',
    label: 'Kichererbsen, gekocht',
    aliases: /\bkichererbse\w*\b/,
    carbohydratesPer100g: 17.4,
    middleRange: { from: 17.4, to: 17.4 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('G770432'),
    note: blsNote('G770432', 'Gilt für reife gekochte Kichererbsen ohne weitere Zutaten.')
  },
  {
    id: 'potatoes-boiled',
    blsCode: 'K110132',
    label: 'Kartoffeln, gekocht',
    aliases: /\bkartoffel\w*\b/,
    carbohydratesPer100g: 15.832,
    middleRange: { from: 15.832, to: 15.832 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: blsSourceLabel('K110132'),
    note: blsNote('K110132', 'Gilt für geschälte gekochte Kartoffeln ohne Sauce oder Fettzugabe.')
  }
];

const SPECIALTY_TERMS = /\b(erdnussbutter|peanut butter|erdnusscreme|peanut cream|flips|ummantelt|coated|wasabi|schokolade|chocolate|vollkorn|wholegrain|edamame|soja|soy|protein|high protein|glutenfrei|gluten-free|konjak|shirataki|instant|ramen|cup|fix|bolognese|carbonara|pesto|sauce|soße|sosse|salat|auflauf|fertiggericht)\b/;
const LEGUME_PASTA = /(?:\b(?:linsen?|kichererbsen?)nudel\w*\b|\b(linse\w*|lentil|kichererbse\w*|chickpea)\b.*\b(nudel\w*|pasta|spaghetti)\b|\b(nudel\w*|pasta|spaghetti)\b.*\b(linse\w*|lentil|kichererbse\w*|chickpea)\b)/;

export function getBaseFoodReference(query: string): BaseFoodReference | null {
  const normalized = normalizeText(query);
  const intent = getPreparationIntent(query);

  // Explicit dry/raw requests must never be silently converted to cooked food.
  if (intent.state === 'uncooked' || intent.state === 'frozen') return null;
  if (SPECIALTY_TERMS.test(normalized)) return null;
  if (LEGUME_PASTA.test(normalized)) return null;

  return REFERENCES.find((reference) => reference.aliases.test(normalized)) ?? null;
}

export function isKnownBaseFoodQuery(query: string): boolean {
  return getBaseFoodReference(query) !== null;
}
