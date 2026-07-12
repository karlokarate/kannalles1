import type { SearchHit } from '../types';
import { displayBrand, displayProductName, normalizeText } from './format';
import { preparationProfileFor, isPlainBaseFoodText } from './preparation';

interface GenericIdentityProfile {
  queryPattern: RegExp;
  identityPattern: RegExp;
  exclusions: RegExp;
}

const GENERIC_IDENTITY_PROFILES: GenericIdentityProfile[] = [
  {
    queryPattern: /\b(salzstange\w*|salzstick\w*|pretzel sticks?)\b/,
    identityPattern: /\b(salzstange\w*|salzstick\w*|pretzel sticks?)\b/,
    exclusions: /\b(cracker|vollkorn|wholegrain|sesam|sesame|paprika|dinkel|spelt|glutenfrei|gluten-free|mini|supersize|mix|protein)\b/
  },
  {
    queryPattern: /\b(cookies?|kekse?|cookie)\b/,
    identityPattern: /\b(cookies?|kekse?|cookie)\b/,
    exclusions: /\b(riegel|bars?|cereal bar|muesli|musli|waffel|wafer|bueno|eis|ice cream|kuchen|cake|brownie|protein bar)\b/
  },
  {
    queryPattern: /\b(toastbrot|toast)\b/,
    identityPattern: /\b(toastbrot|toast|sandwichbrot)\b/,
    exclusions: /\b(crouton|chips|pizza|burger|sandwich belegt|toastie)\b/
  },
  {
    queryPattern: /\b(mehrkornbrot|mehrkorn|multigrain bread)\b/,
    identityPattern: /\b(mehrkornbrot|mehrkorn|multigrain bread)\b/,
    exclusions: /\b(cracker|knackebrot|toastie|chips)\b/
  },
  {
    queryPattern: /\b(brot|broetchen|brotchen|brötchen|bread|rolls?)\b/,
    identityPattern: /\b(brot|broetchen|brotchen|brötchen|bread|rolls?)\b/,
    exclusions: /\b(cracker|chips|pizza|burger|sandwich belegt|toastie|panade|breadcrumb)\b/
  }
];

const GENERIC_FOOD_TERMS = /\b(salzstange\w*|salzstick\w*|nudel\w*|pasta|spaghetti|reis|brot|toastbrot|toast|mehrkornbrot|broetchen|brotchen|brötchen|cookies?|kekse?|cookie|cracker|apfel|aepfel|äpfel|banane|kartoffel\w*|couscous|bulgur|quinoa|linse\w*|bohne\w*|kichererbse\w*|milch|joghurt|kaese|käse|haferflocken|muesli|musli)\b/;

const VARIANT_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'mini', pattern: /\b(mini|minis|miniatur)\b/ },
  { id: 'carazza', pattern: /\bcarazza\b/ },
  { id: 'roll', pattern: /\brolls?\b/ },
  { id: 'veggie', pattern: /\b(veggie|vegetarisch|vegan)\b/ },
  { id: 'white', pattern: /\b(white|weiss|weiß)\b/ },
  { id: 'dark', pattern: /\b(dark|zartbitter)\b/ },
  { id: 'coconut', pattern: /\b(coconut|kokos)\b/ },
  { id: 'ice', pattern: /\b(ice|eis|frozen)\b/ },
  { id: 'protein', pattern: /\bprotein\b/ },
  { id: 'wholegrain', pattern: /\b(vollkorn|wholegrain)\b/ },
  { id: 'sesame', pattern: /\b(sesam|sesame)\b/ },
  { id: 'paprika', pattern: /\bpaprika\b/ },
  { id: 'spelt', pattern: /\b(dinkel|spelt)\b/ },
  { id: 'glutenfree', pattern: /\b(glutenfrei|gluten-free)\b/ },
  { id: 'hazelnut', pattern: /\b(haselnuss|hazelnut)\b/ },
  { id: 'strawberry', pattern: /\b(erdbeer|strawberry)\b/ }
];

const PACKAGING_NOISE = /\b(\d+er[- ]?pack|\d+er|\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*g|multipack|multi pack|vorteilspack|familienpackung|family pack|packung|pack|plus\s*\d+\s*gratis|gratis|\d+\s*riegel|\d+\s*stueck|\d+\s*stück)\b/g;

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return longest ? 1 - editDistance(left, right) / longest : 1;
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9äöüß]+/)
    .filter((token) => token.length > 2);
}

function overlapRatio(query: string, candidate: string): number {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return 0;
  const candidateTokens = tokens(candidate);
  const matches = queryTokens.filter((queryToken) => candidateTokens.some((candidateToken) => {
    if (candidateToken === queryToken || candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) return true;
    const tolerance = Math.max(queryToken.length, candidateToken.length) >= 8 ? 2 : 1;
    return editDistance(queryToken, candidateToken) <= tolerance;
  }));
  return matches.length / queryTokens.length;
}

export function productIdentityText(hit: SearchHit): string {
  return normalizeText([
    hit.product_name_de,
    hit.product_name,
    hit.generic_name_de,
    hit.generic_name,
    displayBrand(hit.brands)
  ].filter(Boolean).join(' '));
}

export function detectVariantIds(value: string): Set<string> {
  const normalized = normalizeText(value);
  return new Set(VARIANT_PATTERNS.filter((entry) => entry.pattern.test(normalized)).map((entry) => entry.id));
}

export function isGenericCategoryQuery(query: string): boolean {
  const normalized = normalizeText(query);
  return Boolean(preparationProfileFor(query) || GENERIC_FOOD_TERMS.test(normalized));
}

export function genericIdentityCompatible(query: string, hit: SearchHit): boolean {
  if (preparationProfileFor(query)) {
    return isPlainBaseFoodText(query, productIdentityText(hit));
  }

  const normalizedQuery = normalizeText(query);
  const identity = productIdentityText(hit);
  const profile = GENERIC_IDENTITY_PROFILES.find((entry) => entry.queryPattern.test(normalizedQuery));
  if (profile) {
    return profile.identityPattern.test(identity) && !profile.exclusions.test(identity);
  }

  return overlapRatio(normalizedQuery, identity) >= 0.66;
}

export function candidateIdentityScore(query: string, hit: SearchHit): number {
  const normalizedQuery = normalizeText(query);
  const name = normalizeText(displayProductName(hit));
  const brand = normalizeText(displayBrand(hit.brands) ?? '');
  const generic = normalizeText(hit.generic_name_de ?? hit.generic_name ?? '');
  const brandAndName = normalizeText(`${brand} ${name}`);
  const nameAndBrand = normalizeText(`${name} ${brand}`);
  const identity = normalizeText(`${name} ${generic} ${brand}`);

  let score = 0;
  if (name === normalizedQuery) score = 1100;
  else if (brandAndName === normalizedQuery || nameAndBrand === normalizedQuery) score = 1080;
  else if (brand === normalizedQuery && /\b(original|the original|classic|klassik)\b/.test(name)) score = 1010;
  else if (brand === normalizedQuery && name === brand) score = 1000;
  else if (name.startsWith(`${normalizedQuery} `)) score = 900;
  else if (name.includes(normalizedQuery)) score = 800;
  else if (brandAndName.includes(normalizedQuery) || nameAndBrand.includes(normalizedQuery)) score = 760;
  else {
    const overlap = overlapRatio(normalizedQuery, identity);
    const nameSimilarity = similarity(normalizedQuery, name);
    const combinedSimilarity = Math.max(similarity(normalizedQuery, brandAndName), similarity(normalizedQuery, nameAndBrand));
    if (overlap === 1) score = 720;
    else if (nameSimilarity >= 0.88 || combinedSimilarity >= 0.88) score = 690;
    else if (overlap >= 0.75) score = 560;
    else if (overlap >= 0.5) score = 380;
  }

  const queryVariants = detectVariantIds(normalizedQuery);
  const candidateVariants = detectVariantIds(`${name} ${generic}`);
  for (const variant of candidateVariants) {
    if (!queryVariants.has(variant)) score -= 150;
  }
  for (const variant of queryVariants) {
    if (candidateVariants.has(variant)) score += 90;
    else score -= 80;
  }

  if (brand === normalizedQuery && /\b(original|the original|classic|klassik)\b/.test(name)) score += 70;
  if (hit.image_front_url) score += 8;
  score += Math.round((hit.completeness ?? 0) * 10);
  score += Math.min(10, Math.log10((hit.unique_scans_n ?? 0) + 1) * 4);
  return score;
}

export function canonicalProductName(value: string): string {
  let normalized = normalizeText(value).replace(PACKAGING_NOISE, ' ');
  for (const entry of VARIANT_PATTERNS) normalized = normalized.replace(entry.pattern, ' ');
  return normalized.replace(/\b(the original|original|classic|klassik)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sameProductFamily(query: string, hit: SearchHit): boolean {
  if (candidateIdentityScore(query, hit) >= 560) return true;
  const queryCanonical = canonicalProductName(query);
  const nameCanonical = canonicalProductName(displayProductName(hit));
  return Boolean(queryCanonical && nameCanonical && (
    nameCanonical.includes(queryCanonical)
    || queryCanonical.includes(nameCanonical)
    || similarity(queryCanonical, nameCanonical) >= 0.84
  ));
}
