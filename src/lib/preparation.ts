import { normalizeText } from './format';
import { uniqueQueries } from './query';

export type PreparationState = 'cooked' | 'uncooked' | 'frozen' | 'drained' | 'prepared';

export interface PreparationProfile {
  id: string;
  queryPattern: RegExp;
  /** The hit must actually describe this base food, not just mention it in a recipe title. */
  baseIdentityPattern: RegExp;
  cookedMaxCarbs: number;
  dryMinCarbs: number;
  /** Compound meals, instant products, sauces and seasoning mixes that must not represent the base food. */
  plainDishExclusions: RegExp;
  cookedSearchTerms: (cleanQuery: string) => string[];
}

export interface PreparationIntent {
  state: PreparationState | null;
  explicit: boolean;
  inferred: boolean;
  profile: PreparationProfile | null;
  label: string | null;
}

const EXPLICIT_UNCOOKED = /\b(ungekocht\w*|trocken\w*|roh\w*|uncooked|dry|raw)\b/;
const EXPLICIT_COOKED = /\b(gekocht\w*|gegart\w*|vorgekocht\w*|cooked|boiled|steamed)\b/;
const EXPLICIT_PREPARED = /\b(zubereitet\w*|verzehrfertig\w*|ready[- ]to[- ]eat|prepared)\b/;
const EXPLICIT_FROZEN = /\b(tiefgefroren\w*|gefroren\w*|tiefkuhl\w*|frozen)\b/;
const EXPLICIT_DRAINED = /\b(abgetropft\w*|abtropfgewicht|drained)\b/;

const COMMON_MEAL_EXCLUSIONS =
  /\b(fix|würz\w*|wurz\w*|seasoning|gewürz\w*|gewurz\w*|sauce|soße|sosse|soup|suppe|eintopf|stew|salat|salad|auflauf|casserole|fertiggericht|ready meal|meal kit|snack)\b/;

function replaceFoodTerm(cleanQuery: string, pattern: RegExp, replacement: string): string {
  return cleanQuery.replace(pattern, replacement).replace(/\s+/g, ' ').trim();
}

function genericCookedTerms(query: string, english: string): string[] {
  return [
    `${query} gekocht`,
    `${query} zubereitet`,
    `cooked ${english}`,
    `boiled ${english}`
  ];
}

function pastaCookedTerms(query: string): string[] {
  const normalized = normalizeText(query);
  if (/\bspaghetti\b/.test(normalized)) {
    return [
      replaceFoodTerm(query, /\bspaghetti\b/i, 'gekochte Spaghetti'),
      replaceFoodTerm(query, /\bspaghetti\b/i, 'cooked spaghetti'),
      'gekochte Spaghetti',
      'cooked spaghetti'
    ];
  }
  return [
    replaceFoodTerm(query, /\b(nudel\w*|pasta|macaroni|maccheroni)\b/i, 'gekochte Nudeln'),
    replaceFoodTerm(query, /\b(nudel\w*|pasta|macaroni|maccheroni)\b/i, 'cooked pasta'),
    'gekochte Nudeln',
    'cooked pasta'
  ];
}

export const PREPARATION_PROFILES: PreparationProfile[] = [
  {
    id: 'rice',
    queryPattern: /\b(reis|rice)\b/,
    baseIdentityPattern: /\b(?:[a-z]*reis[a-z]*|rice)\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(milchreis|rice pudding|risotto|paella|sushi|curry|kokos|coconut|gemuse|vegetable|tomate|tomato|gebraten|fried|bowl|biriyani|biryani)\b/,
    cookedSearchTerms: (query) => [
      replaceFoodTerm(query, /\breis\b/i, 'gekochter Reis'),
      replaceFoodTerm(query, /\breis\b/i, 'cooked rice'),
      ...genericCookedTerms(query, 'rice')
    ]
  },
  {
    id: 'pasta',
    queryPattern: /\b(nudel\w*|pasta|spaghetti|macaroni|maccheroni)\b/,
    baseIdentityPattern: /\b(?:[a-z]*nudel[a-z]*|pasta|spaghetti|macaroni|maccheroni)\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(instant|ramen|cup noodles?|nudeltopf|asia snack|yakisoba|maggi|knorr|bolognese|carbonara|lasagne|auflauf|casserole|tomate|tomato|pesto|kase|cheese|salat|salad|sauce|soße|sosse|fix|würz\w*|wurz\w*|seasoning|fertiggericht|ready meal|suppe|soup)\b/,
    cookedSearchTerms: pastaCookedTerms
  },
  {
    id: 'couscous',
    queryPattern: /\bcouscous\b/,
    baseIdentityPattern: /\bcouscous\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 50,
    plainDishExclusions: /\b(salat|salad|gemuse|vegetable|sauce|curry|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'couscous')
  },
  {
    id: 'bulgur',
    queryPattern: /\bbulgur\b/,
    baseIdentityPattern: /\bbulgur\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 50,
    plainDishExclusions: /\b(salat|salad|gemuse|vegetable|sauce|curry|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'bulgur')
  },
  {
    id: 'quinoa',
    queryPattern: /\bquinoa\b/,
    baseIdentityPattern: /\bquinoa\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 50,
    plainDishExclusions: /\b(salat|salad|gemuse|vegetable|sauce|curry|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'quinoa')
  },
  {
    id: 'polenta',
    queryPattern: /\b(polenta|maisgries|maisgriess)\b/,
    baseIdentityPattern: /\b(polenta|maisgries|maisgriess)\b/,
    cookedMaxCarbs: 35,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(chips|snack|kase|cheese|sauce|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'polenta')
  },
  {
    id: 'lentils',
    queryPattern: /\b(linse\w*|lentils?)\b/,
    baseIdentityPattern: /\b(linse\w*|lentils?)\b/,
    cookedMaxCarbs: 40,
    dryMinCarbs: 45,
    plainDishExclusions: /\b(suppe|soup|salat|salad|curry|eintopf|stew|sauce|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'lentils')
  },
  {
    id: 'chickpeas',
    queryPattern: /\b(kichererbse\w*|chickpeas?)\b/,
    baseIdentityPattern: /\b(kichererbse\w*|chickpeas?)\b/,
    cookedMaxCarbs: 40,
    dryMinCarbs: 45,
    plainDishExclusions: /\b(hummus|salat|salad|curry|eintopf|stew|sauce|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'chickpeas')
  },
  {
    id: 'beans',
    queryPattern: /\b(bohne\w*|kidneybohne\w*|beans?)\b/,
    baseIdentityPattern: /\b(bohne\w*|kidneybohne\w*|beans?)\b/,
    cookedMaxCarbs: 40,
    dryMinCarbs: 45,
    plainDishExclusions: /\b(suppe|soup|salat|salad|chili|curry|eintopf|stew|sauce|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'beans')
  },
  {
    id: 'barley',
    queryPattern: /\b(graupen?|gerste\w*|barley)\b/,
    baseIdentityPattern: /\b(graupen?|gerste\w*|barley)\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(suppe|soup|salat|salad|eintopf|stew|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'barley')
  },
  {
    id: 'buckwheat',
    queryPattern: /\b(buchweizen|buckwheat)\b/,
    baseIdentityPattern: /\b(buchweizen|buckwheat)\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(mehl|flour|brot|bread|nudel|pasta|pfannkuchen|pancake|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'buckwheat')
  },
  {
    id: 'millet',
    queryPattern: /\b(hirse|millet)\b/,
    baseIdentityPattern: /\b(hirse|millet)\b/,
    cookedMaxCarbs: 45,
    dryMinCarbs: 55,
    plainDishExclusions: /\b(mehl|flour|brot|bread|porridge|brei|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'millet')
  },
  {
    id: 'potatoes',
    queryPattern: /\b(kartoffel\w*|potatoes?)\b/,
    baseIdentityPattern: /\b(kartoffel\w*|potatoes?)\b/,
    cookedMaxCarbs: 35,
    dryMinCarbs: 45,
    plainDishExclusions: /\b(chips|pommes|fries|puffer|rosti|gratin|salat|salad|puree|püree|mashed|fix|instant)\b/,
    cookedSearchTerms: (query) => genericCookedTerms(query, 'potatoes')
  }
];

export function preparationProfileFor(query: string): PreparationProfile | null {
  const text = normalizeText(query);
  return PREPARATION_PROFILES.find((profile) => profile.queryPattern.test(text)) ?? null;
}

export function preparationLabel(state: PreparationState | null): string | null {
  if (state === 'cooked') return 'gekocht/zubereitet';
  if (state === 'uncooked') return 'ungekocht/trocken';
  if (state === 'prepared') return 'zubereitet';
  if (state === 'frozen') return 'gefroren';
  if (state === 'drained') return 'abgetropft';
  return null;
}

export function getPreparationIntent(query: string): PreparationIntent {
  const text = normalizeText(query);
  const profile = preparationProfileFor(query);

  if (EXPLICIT_UNCOOKED.test(text)) {
    return { state: 'uncooked', explicit: true, inferred: false, profile, label: preparationLabel('uncooked') };
  }
  if (EXPLICIT_COOKED.test(text)) {
    return { state: 'cooked', explicit: true, inferred: false, profile, label: preparationLabel('cooked') };
  }
  if (EXPLICIT_PREPARED.test(text)) {
    return { state: 'prepared', explicit: true, inferred: false, profile, label: preparationLabel('prepared') };
  }
  if (EXPLICIT_FROZEN.test(text)) {
    return { state: 'frozen', explicit: true, inferred: false, profile, label: preparationLabel('frozen') };
  }
  if (EXPLICIT_DRAINED.test(text)) {
    return { state: 'drained', explicit: true, inferred: false, profile, label: preparationLabel('drained') };
  }

  // Grundnahrungsmittel werden standardmäßig im verzehrfertigen Zustand
  // ausgewertet. Nur eine ausdrücklich trockene/rohe Anfrage hebt das auf.
  if (profile) {
    return { state: 'cooked', explicit: false, inferred: true, profile, label: preparationLabel('cooked') };
  }

  return { state: null, explicit: false, inferred: false, profile: null, label: null };
}

export function stripPreparationWords(query: string): string {
  return query
    .replace(/\b(ungekocht(?:e|er|es|en|em)?|trocken(?:e|er|es|en|em)?|roh(?:e|er|es|en|em)?|gekocht(?:e|er|es|en|em)?|gegart(?:e|er|es|en|em)?|vorgekocht(?:e|er|es|en|em)?|zubereitet(?:e|er|es|en|em)?|verzehrfertig(?:e|er|es|en|em)?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function preparedSearchQueries(cleanQuery: string): string[] {
  const intent = getPreparationIntent(cleanQuery);
  const cleanWithoutState = stripPreparationWords(cleanQuery) || cleanQuery;
  const attempts: string[] = [];

  if (intent.state === 'cooked' || intent.state === 'prepared') {
    const cookedTerms = intent.profile?.cookedSearchTerms(cleanWithoutState) ?? [
      `${cleanWithoutState} gekocht`,
      `${cleanWithoutState} zubereitet`
    ];

    for (const term of cookedTerms) {
      attempts.push(`"${term}"`, term);
    }
    attempts.push(`"${cleanWithoutState}"`, cleanWithoutState);
    return uniqueQueries(attempts);
  }

  if (cleanQuery.split(' ').length > 1) attempts.push(`"${cleanQuery}"`);
  attempts.push(cleanQuery);
  return uniqueQueries(attempts);
}

export function isPlainBaseFoodText(query: string, text: string): boolean {
  const profile = preparationProfileFor(query);
  if (!profile) return true;
  const normalized = normalizeText(text);
  if (!profile.baseIdentityPattern.test(normalized)) return false;
  if (profile.plainDishExclusions.test(normalized)) return false;
  if (COMMON_MEAL_EXCLUSIONS.test(normalized)) return false;
  return true;
}
