import { normalizeText } from './format';
import { getPreparationIntent } from './preparation';

export interface BaseFoodReference {
  id: string;
  label: string;
  aliases: RegExp;
  carbohydratesPer100g: number;
  middleRange: { from: number; to: number };
  stateLabel: string;
  sourceLabel: string;
  note: string;
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
    label: 'Erdnüsse, geröstet und ungesalzen',
    aliases: /\b(erdnuss|erdnusse|erdnuesse|peanut|peanuts)\b/,
    carbohydratesPer100g: 9.4,
    middleRange: { from: 9.4, to: 9.4 },
    stateLabel: 'geröstet / ungesalzen',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für geröstete, ungesalzene Erdnüsse. Gesalzene, gewürzte, ummantelte oder anderweitig verarbeitete Produkte können abweichen und sollten als konkretes Produkt gesucht werden.'
  },
  {
    id: 'pasta-cooked',
    label: 'Nudeln, gekocht',
    aliases: /\b(nudel\w*|pasta|spaghetti|macaroni|maccheroni)\b/,
    carbohydratesPer100g: 30.9,
    middleRange: { from: 25, to: 31 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochte Weizennudeln ohne Sauce. Spezialnudeln und Fertiggerichte sind ausgeschlossen.'
  },
  {
    id: 'rice-cooked',
    label: 'Reis, gekocht',
    aliases: /\b(reis|rice)\b/,
    carbohydratesPer100g: 28.2,
    middleRange: { from: 25, to: 30 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochten weißen Reis ohne Sauce oder weitere Zutaten.'
  },
  {
    id: 'couscous-cooked',
    label: 'Couscous, zubereitet',
    aliases: /\bcouscous\b/,
    carbohydratesPer100g: 23.2,
    middleRange: { from: 21, to: 25 },
    stateLabel: 'zubereitet / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für zubereiteten Couscous ohne Sauce.'
  },
  {
    id: 'bulgur-cooked',
    label: 'Bulgur, gekocht',
    aliases: /\bbulgur\b/,
    carbohydratesPer100g: 18.6,
    middleRange: { from: 17, to: 21 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochten Bulgur ohne weitere Zutaten.'
  },
  {
    id: 'quinoa-cooked',
    label: 'Quinoa, gekocht',
    aliases: /\bquinoa\b/,
    carbohydratesPer100g: 21.3,
    middleRange: { from: 19, to: 23 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochte Quinoa ohne weitere Zutaten.'
  },
  {
    id: 'lentils-cooked',
    label: 'Linsen, gekocht',
    aliases: /\blinse\w*\b/,
    carbohydratesPer100g: 20.1,
    middleRange: { from: 18, to: 22 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochte Linsen ohne Sauce.'
  },
  {
    id: 'chickpeas-cooked',
    label: 'Kichererbsen, gekocht',
    aliases: /\bkichererbse\w*\b/,
    carbohydratesPer100g: 27.4,
    middleRange: { from: 24, to: 29 },
    stateLabel: 'gekocht / abgetropft',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochte beziehungsweise abgetropfte Kichererbsen.'
  },
  {
    id: 'potatoes-boiled',
    label: 'Kartoffeln, gekocht',
    aliases: /\bkartoffel\w*\b/,
    carbohydratesPer100g: 20.1,
    middleRange: { from: 17, to: 21 },
    stateLabel: 'gekocht / verzehrfertig',
    sourceLabel: 'Basislebensmittel-Referenz',
    note: 'Generischer Referenzwert für gekochte Kartoffeln ohne Sauce oder Fettzugabe.'
  }
];

const SPECIALTY_TERMS = /\b(erdnussbutter|peanut butter|erdnusscreme|peanut cream|flips|ummantelt|coated|wasabi|schokolade|chocolate|vollkorn|wholegrain|edamame|soja|soy|linse\w*|lentil|kichererbse\w*|chickpea|protein|high protein|glutenfrei|gluten-free|konjak|shirataki|instant|ramen|cup|fix|bolognese|carbonara|pesto|sauce|soße|sosse|salat|auflauf|fertiggericht)\b/;

export function getBaseFoodReference(query: string): BaseFoodReference | null {
  const normalized = normalizeText(query);
  const intent = getPreparationIntent(query);

  // Explicit dry/raw requests must never be silently converted to cooked food.
  if (intent.state === 'uncooked' || intent.state === 'frozen') return null;
  if (SPECIALTY_TERMS.test(normalized)) return null;

  return REFERENCES.find((reference) => reference.aliases.test(normalized)) ?? null;
}

export function isKnownBaseFoodQuery(query: string): boolean {
  return getBaseFoodReference(query) !== null;
}
