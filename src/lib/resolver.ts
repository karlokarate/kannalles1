import type {
  CalculationResult,
  Confidence,
  Countability,
  FoodUnit,
  OffProduct,
  ParsedFoodRequest,
  PieceCalibration,
  PortionOption,
  ProductSummary,
  SearchHit
} from '../types';
import { createId, displayBrand, displayProductName, normalizeText, unitLabels } from './format';
import { calibrationWeight } from './calibration';
import {
  getPreparationIntent,
  isPlainBaseFoodText,
  preparationProfileFor
} from './preparation';
import type { PreparationState } from './preparation';
import { candidateIdentityScore, genericIdentityCompatible, isGenericCategoryQuery } from './identity';
import type { BaseFoodReference } from './baseFoods';

interface CarbValue {
  value: number | null;
  basis: '100g' | '100ml';
  prepared: boolean;
}

interface PreparationMatch {
  requested: PreparationState | null;
  compatible: boolean;
  explicitEvidence: boolean;
  label: string | null;
}


function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nearlyEqual(a: number, b: number, relativeTolerance = 0.08, absoluteTolerance = 0.35): boolean {
  return Math.abs(a - b) <= Math.max(absoluteTolerance, Math.max(a, b) * relativeTolerance);
}

function hitText(hit: SearchHit): string {
  return normalizeText([
    hit.product_name_de,
    hit.product_name,
    hit.generic_name_de,
    hit.generic_name,
    hit.brands,
    ...(hit.categories_tags ?? [])
  ].filter(Boolean).join(' '));
}

function identityText(hit: SearchHit): string {
  return normalizeText([
    hit.product_name_de,
    hit.product_name,
    hit.generic_name_de,
    hit.generic_name,
    ...(hit.categories_tags ?? [])
  ].filter(Boolean).join(' '));
}

function rawCarbsPer100(hit: SearchHit): CarbValue {
  const per100g = numberOrNull(hit.nutriments?.carbohydrates_100g);
  if (per100g !== null) return { value: per100g, basis: '100g', prepared: false };
  const per100ml = numberOrNull(hit.nutriments?.carbohydrates_100ml);
  return { value: per100ml, basis: '100ml', prepared: false };
}

function preparedCarbsPer100(hit: SearchHit): CarbValue {
  const prepared100g = numberOrNull(hit.nutriments?.carbohydrates_prepared_100g);
  if (prepared100g !== null) return { value: prepared100g, basis: '100g', prepared: true };
  const prepared100ml = numberOrNull(hit.nutriments?.carbohydrates_prepared_100ml);
  return { value: prepared100ml, basis: '100ml', prepared: true };
}

function preparationFlags(hit: SearchHit) {
  const text = hitText(hit);
  return {
    text,
    cookedText: /\b(gekocht\w*|gegart\w*|vorgekocht\w*|cooked|boiled|steamed|verzehrfertig\w*|ready[- ]to[- ]eat|prepared|microwave|mikrowell\w*)\b/.test(text),
    uncookedText: /\b(ungekocht\w*|trocken\w*|roh\w*|uncooked|dry|raw)\b/.test(text),
    frozenText: /\b(tiefgefroren\w*|gefroren\w*|tiefkuhl\w*|frozen)\b/.test(text),
    drainedText: /\b(abgetropft\w*|abtropfgewicht|drained)\b/.test(text)
  };
}

function baseFoodCompatible(query: string, hit: SearchHit): boolean {
  const profile = preparationProfileFor(query);
  if (!profile) return true;
  return isPlainBaseFoodText(query, identityText(hit));
}

function carbsPer100(hit: SearchHit, query = ''): CarbValue {
  const intent = getPreparationIntent(query);
  const flags = preparationFlags(hit);
  const prepared = preparedCarbsPer100(hit);
  const raw = rawCarbsPer100(hit);
  const profile = intent.profile;

  if (!baseFoodCompatible(query, hit)) return { value: null, basis: raw.basis, prepared: false };
  if (!intent.state) return raw;

  if (intent.state === 'cooked' || intent.state === 'prepared') {
    if (prepared.value !== null) return prepared;
    if (raw.value === null || flags.uncookedText) return { value: null, basis: raw.basis, prepared: false };
    if (profile?.plainDishExclusions.test(flags.text)) return { value: null, basis: raw.basis, prepared: false };
    if (flags.cookedText) return raw;
    // A plain base-food hit with a value in the cooked range is accepted even
    // when the product name omits the word “cooked”. Dry products are rejected.
    if (profile && raw.value <= profile.cookedMaxCarbs) return raw;
    return { value: null, basis: raw.basis, prepared: false };
  }

  if (intent.state === 'uncooked') {
    if (raw.value === null || flags.cookedText || prepared.value !== null) return { value: null, basis: raw.basis, prepared: false };
    if (flags.uncookedText) return raw;
    if (profile && raw.value >= profile.dryMinCarbs) return raw;
    return { value: null, basis: raw.basis, prepared: false };
  }

  if (intent.state === 'frozen') return flags.frozenText ? raw : { value: null, basis: raw.basis, prepared: false };
  if (intent.state === 'drained') return flags.drainedText ? raw : { value: null, basis: raw.basis, prepared: false };
  return raw;
}

function preparationCompatibility(query: string, hit: SearchHit): PreparationMatch {
  const intent = getPreparationIntent(query);
  if (!intent.state) return { requested: null, compatible: true, explicitEvidence: false, label: null };
  const selected = carbsPer100(hit, query);
  const flags = preparationFlags(hit);
  const explicitEvidence = selected.prepared
    || ((intent.state === 'cooked' || intent.state === 'prepared') && flags.cookedText)
    || (intent.state === 'uncooked' && flags.uncookedText)
    || (intent.state === 'frozen' && flags.frozenText)
    || (intent.state === 'drained' && flags.drainedText);
  return { requested: intent.state, compatible: selected.value !== null, explicitEvidence, label: intent.label };
}

function germanyRelated(hit: SearchHit): boolean {
  const countries = (hit.countries_tags ?? []).map(normalizeText);
  return countries.some((country) => ['en:germany', 'en:deutschland', 'de:deutschland'].includes(country));
}


function scoreHit(query: string, hit: SearchHit, preferGermanMarket: boolean): number {
  const carb = carbsPer100(hit, query).value;
  const preparation = preparationCompatibility(query, hit);
  let score = candidateIdentityScore(query, hit);

  if (preferGermanMarket && germanyRelated(hit)) score += 12;
  if (carb !== null && carb >= 0 && carb <= 100) score += 18;
  if (preparation.requested && preparation.compatible) score += preparation.explicitEvidence ? 45 : 20;
  if (preparation.requested && !preparation.compatible) score -= 300;
  if (preparationProfileFor(query) && baseFoodCompatible(query, hit)) score += 80;
  if (preparationProfileFor(query) && !baseFoodCompatible(query, hit)) score -= 400;
  return score;
}

export function rankExactCandidates(query: string, hits: SearchHit[], preferGermanMarket: boolean): SearchHit[] {
  return hits
    .map((hit) => ({ hit, identity: candidateIdentityScore(query, hit), score: scoreHit(query, hit, preferGermanMarket) }))
    .filter(({ hit, identity }) => {
      if (identity < 300) return false;
      if (!baseFoodCompatible(query, hit)) return false;
      if (!preparationCompatibility(query, hit).compatible) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .map(({ hit }) => hit);
}

export function shouldResolveAsExactProduct(query: string, hits: SearchHit[]): boolean {
  if (isGenericCategoryQuery(query)) return false;
  return hits.slice(0, 6).some((hit) => candidateIdentityScore(query, hit) >= 700);
}

export interface GenericResolution {
  hits: SearchHit[];
  median: number | null;
  basis: '100g' | '100ml';
  middleRange: { from: number; to: number } | null;
  confidence: Confidence;
  preparationLabel: string | null;
  preparationInferred: boolean;
  preparedValuesUsed: number;
}

function percentile(values: number[], fraction: number): number {
  const ordered = [...values].sort((a, b) => a - b);
  if (ordered.length === 1) return ordered[0];
  const position = (ordered.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function resolveGenericCandidates(query: string, hits: SearchHit[], preferGermanMarket: boolean): GenericResolution {
  const preparationIntent = getPreparationIntent(query);
  const requestedPreparation = preparationIntent.state;
  const ranked = hits
    .map((hit) => ({ hit, score: scoreHit(query, hit, preferGermanMarket) }))
    .filter(({ hit, score }) => {
      const carb = carbsPer100(hit, query).value;
      if (carb === null || carb < 0 || carb > 100) return false;
      if ((hit.completeness ?? 0) < 0.3) return false;
      if (score < (requestedPreparation ? 120 : 350)) return false;
      if (!genericIdentityCompatible(query, hit)) return false;
      if (!baseFoodCompatible(query, hit)) return false;
      if (!preparationCompatibility(query, hit).compatible) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const german = ranked.filter(({ hit }) => germanyRelated(hit));
  const pool = preferGermanMarket && german.length >= 3 ? german : ranked;
  const deduplicated: SearchHit[] = [];
  const seen = new Set<string>();
  for (const { hit } of pool) {
    const carb = carbsPer100(hit, query).value;
    const brand = normalizeText(displayBrand(hit.brands) ?? displayProductName(hit));
    const key = `${brand}|${carb?.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(hit);
    if (deduplicated.length >= 12) break;
  }

  const carbItems = deduplicated.map((hit) => carbsPer100(hit, query));
  const bases = carbItems.map((item) => item.basis);
  const basis: '100g' | '100ml' = bases.filter((item) => item === '100ml').length > bases.length / 2 ? '100ml' : '100g';
  const compatibleItems = carbItems.filter((item) => item.basis === basis && item.value !== null);
  const values = compatibleItems.map((item) => item.value as number);
  if (!values.length) {
    return {
      hits: [], median: null, basis, middleRange: null, confidence: 'missing',
      preparationLabel: preparationIntent.label,
      preparationInferred: preparationIntent.inferred,
      preparedValuesUsed: 0
    };
  }

  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const spread = q3 - q1;
  const confidence: Confidence = values.length >= 5 && spread <= 6 ? 'high' : values.length >= 3 ? 'medium' : 'low';
  return {
    hits: deduplicated,
    median: median(values),
    basis,
    middleRange: { from: q1, to: q3 },
    confidence,
    preparationLabel: preparationIntent.label,
    preparationInferred: preparationIntent.inferred,
    preparedValuesUsed: compatibleItems.filter((item) => item.prepared).length
  };
}

function unitWords(unit: FoodUnit, allowGenericPieceForBar: boolean): string {
  if (unit === 'bar') return allowGenericPieceForBar ? 'riegel|bars?|stuck|stueck|pieces?|pcs' : 'riegel|bars?';
  if (unit === 'slice') return 'scheiben?|slices?|tranchen?';
  if (unit === 'piece') {
    return [
      'stuck', 'stueck', 'pieces?', 'pcs', 'einheiten?', 'units?', 'sticks?',
      'salzstangen?', 'salzsticks?', 'kekse?', 'cookies?', 'cracker', 'crackers',
      'wurst', 'würstchen', 'wurstchen', 'sausages?', 'bonbons?', 'pralinen?',
      'kugeln?', 'bällchen', 'ballchen', 'riegel'
    ].join('|');
  }
  return '';
}

function parseExplicitUnitCount(textValue: string | undefined, unit: FoodUnit, allowGenericPieceForBar = false): number | null {
  if (!textValue || !['bar', 'slice', 'piece'].includes(unit)) return null;
  const text = normalizeText(textValue);
  const words = unitWords(unit, allowGenericPieceForBar);
  const adjacent = text.match(new RegExp(`\\b(\\d+)\\s*(?:x\\s*)?(?:${words})\\b`, 'i'));
  if (adjacent) {
    const count = Number(adjacent[1]);
    if (Number.isInteger(count) && count > 0 && count <= 200) return count;
  }
  const leading = text.match(new RegExp(`^\\s*(\\d+)\\b(?=[^,;()]{0,45}\\b(?:${words})\\b)`, 'i'));
  if (leading) {
    const count = Number(leading[1]);
    if (Number.isInteger(count) && count > 0 && count <= 200) return count;
  }
  return null;
}

function parseXWeight(textValue: string | undefined): { count: number; perUnitWeightG: number } | null {
  if (!textValue) return null;
  const patterns = [
    /(?:^|\s|\()([1-9]\d*)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*g\b/i,
    /(?:^|\s|\()([1-9]\d*)\s*(?:stuck|stueck|pieces?|pcs|units?|sticks?|salzstangen?|salzsticks?|riegel|bars?|scheiben?|slices?)\s*(?:à|a|je)\s*(\d+(?:[.,]\d+)?)\s*g\b/i
  ];
  const match = patterns.map((pattern) => textValue.match(pattern)).find(Boolean);
  if (!match) return null;
  const count = Number(match[1]);
  const perUnitWeightG = Number(match[2].replace(',', '.'));
  if (!Number.isInteger(count) || count <= 0 || count > 500 || !Number.isFinite(perUnitWeightG) || perUnitWeightG <= 0) return null;
  return { count, perUnitWeightG };
}

function parseGramWeight(textValue: string | undefined): number | null {
  if (!textValue) return null;
  const match = textValue.match(/(?:^|\s|\()(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parsePackageWeight(textValue: string | undefined): number | null {
  if (!textValue) return null;
  const xWeight = parseXWeight(textValue);
  if (xWeight) return xWeight.count * xWeight.perUnitWeightG;
  const equality = textValue.match(/=\s*(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (equality) {
    const value = Number(equality[1].replace(',', '.'));
    if (Number.isFinite(value) && value > 0) return value;
  }
  return parseGramWeight(textValue);
}

function packageWeightG(product: OffProduct | undefined, hit: SearchHit): number | null {
  const unit = product?.product_quantity_unit ?? hit.product_quantity_unit;
  if (unit?.toLowerCase() === 'g') {
    const structured = numberOrNull(product?.product_quantity ?? hit.product_quantity);
    if (structured !== null) return structured;
  }
  return parsePackageWeight(product?.quantity ?? hit.quantity);
}

function barLike(product: OffProduct, hit: SearchHit): boolean {
  const text = normalizeText([
    displayProductName(product), displayProductName(hit),
    ...(product.categories_tags ?? []), ...(hit.categories_tags ?? [])
  ].join(' '));
  return /\b(riegel|bar|bars|candy-chocolate-bars|chocolate-nuts-cookie-bars|bueno|duplo|hanuta|knoppers)\b/.test(text);
}

function individuallyWrappedPieceLike(product: OffProduct, hit: SearchHit): boolean {
  const text = normalizeText([
    displayProductName(product), displayProductName(hit),
    product.brands, displayBrand(hit.brands),
    ...(product.categories_tags ?? []), ...(hit.categories_tags ?? [])
  ].join(' '));
  return /\b(bifi|wurst|wurstchen|würstchen|sausage|snack stick|schokobon|bonbon|praline|kugel|single serving snack)\b/.test(text);
}

function hasMultipackEvidence(product: OffProduct | undefined, hit: SearchHit): boolean {
  const text = normalizeText([
    product?.quantity, hit.quantity, displayProductName(product ?? hit)
  ].filter(Boolean).join(' '));
  return /\b(\d+er[- ]?pack|multipack|multi pack|vorteilspack|familienpackung|\d+\s*[x×]\s*\d+(?:[.,]\d+)?\s*g|\d+\s*(?:riegel|stuck|stueck|stück|pieces?|pcs))\b/.test(text);
}

function singlePackageUnit(product: OffProduct | undefined, hit: SearchHit, packageWeight: number | null): FoodUnit | null {
  if (packageWeight === null || packageWeight <= 0 || packageWeight > 150 || hasMultipackEvidence(product, hit)) return null;
  if (individuallyWrappedPieceLike(product ?? {}, hit) && packageWeight <= 80) return 'piece';
  return null;
}

function productSummary(hit: SearchHit, product?: OffProduct): ProductSummary {
  return {
    barcode: product?.code ?? hit.code ?? null,
    name: displayProductName(product ?? hit),
    brand: product?.brands?.trim() || displayBrand(hit.brands),
    imageUrl: product?.image_front_url ?? hit.image_front_url ?? null,
    packageDescription: product?.quantity ?? hit.quantity ?? null,
    packageWeightG: packageWeightG(product, hit),
    servingDescription: product?.serving_size ?? hit.serving_size ?? null,
    servingWeightG: numberOrNull(product?.serving_quantity ?? hit.serving_quantity),
    categories: product?.categories_tags ?? hit.categories_tags ?? []
  };
}

function mergeProductIntoHit(hit: SearchHit, product: OffProduct | undefined): SearchHit {
  if (!product) return hit;
  return {
    ...hit,
    code: product.code ?? hit.code,
    product_name: product.product_name ?? hit.product_name,
    product_name_de: product.product_name_de ?? hit.product_name_de,
    generic_name: product.generic_name ?? hit.generic_name,
    generic_name_de: product.generic_name_de ?? hit.generic_name_de,
    brands: product.brands ?? hit.brands,
    quantity: product.quantity ?? hit.quantity,
    product_quantity: product.product_quantity ?? hit.product_quantity,
    product_quantity_unit: product.product_quantity_unit ?? hit.product_quantity_unit,
    serving_size: product.serving_size ?? hit.serving_size,
    serving_quantity: product.serving_quantity ?? hit.serving_quantity,
    nutrition_data_per: product.nutrition_data_per ?? hit.nutrition_data_per,
    nutrition_data_prepared_per: product.nutrition_data_prepared_per ?? hit.nutrition_data_prepared_per,
    data_quality_errors_tags: product.data_quality_errors_tags ?? hit.data_quality_errors_tags,
    countries_tags: product.countries_tags ?? hit.countries_tags,
    categories_tags: product.categories_tags ?? hit.categories_tags,
    image_front_url: product.image_front_url ?? hit.image_front_url,
    nutriments: { ...(hit.nutriments ?? {}), ...(product.nutriments ?? {}) }
  };
}

interface UnitWeightEvidence {
  value: number;
  source: 'serving-unit-count' | 'package-unit-count' | 'multipack-explicit';
  note: string;
}

interface CountedUnitResolution {
  weightG: number | null;
  confidence: Confidence;
  note: string;
  source: PortionOption['source'];
}

function resolveCountedUnitWeight(
  unit: FoodUnit,
  hit: SearchHit,
  product: OffProduct | undefined
): CountedUnitResolution {
  if (!['bar', 'slice', 'piece'].includes(unit)) {
    return {
      weightG: null,
      confidence: 'missing',
      note: 'Keine zählbare Einheit angefordert.',
      source: 'unresolved'
    };
  }
  const isBar = unit === 'bar' && barLike(product ?? {}, hit);
  const servingWeight = numberOrNull(product?.serving_quantity ?? hit.serving_quantity);
  const packageWeight = packageWeightG(product, hit);
  const servingLabel = product?.serving_size ?? hit.serving_size;
  const quantityLabel = product?.quantity ?? hit.quantity;
  const productName = displayProductName(product ?? hit);
  const evidences: UnitWeightEvidence[] = [];

  const servingCount = parseExplicitUnitCount(servingLabel, unit, isBar);
  if (servingWeight !== null && servingCount !== null) {
    evidences.push({ value: servingWeight / servingCount, source: 'serving-unit-count', note: `Einheitengewicht aus „${servingLabel}“ abgeleitet.` });
  }

  const quantityCount = parseExplicitUnitCount(quantityLabel, unit, isBar)
    ?? parseExplicitUnitCount(productName, unit, isBar);
  if (packageWeight !== null && quantityCount !== null) {
    evidences.push({
      value: packageWeight / quantityCount,
      source: 'package-unit-count',
      note: `Einheitengewicht aus ${quantityCount} ausdrücklich genannten Einheiten und ${packageWeight} g Packungsgewicht abgeleitet.`
    });
  }

  const xWeight = parseXWeight(quantityLabel);
  if (xWeight) {
    const explicitCount = parseExplicitUnitCount(quantityLabel, unit, isBar)
      ?? parseExplicitUnitCount(productName, unit, isBar);
    const impliedTotal = xWeight.count * xWeight.perUnitWeightG;
    const packageIsCompatible = packageWeight === null || nearlyEqual(packageWeight, impliedTotal, 0.04, 0.75);
    const unitTypeIsCompatible = isBar || explicitCount === xWeight.count || (unit === 'piece' && individuallyWrappedPieceLike(product ?? {}, hit));
    if (packageIsCompatible && unitTypeIsCompatible) {
      evidences.push({ value: xWeight.perUnitWeightG, source: 'multipack-explicit', note: `Einheitengewicht direkt aus „${quantityLabel}“ abgeleitet.` });
    }
  }

  const valid = evidences.filter((evidence) => Number.isFinite(evidence.value) && evidence.value > 0);
  if (!valid.length) {
    return {
      weightG: null,
      confidence: 'missing',
      note: 'Die API nennt keine eindeutige Anzahl passender Einheiten; Portions- oder Packungsgewicht wurde nicht als Stückgewicht geraten.',
      source: 'unresolved'
    };
  }
  const ordered = valid.map((evidence) => evidence.value).sort((a, b) => a - b);
  if (!nearlyEqual(ordered[0], ordered[ordered.length - 1], 0.1, 0.5)) {
    return {
      weightG: null,
      confidence: 'missing',
      note: 'Widersprüchliche Packungs- und Portionsangaben; es wurde bewusst kein Stückgewicht geraten.',
      source: 'unresolved'
    };
  }
  const sourcePriority: UnitWeightEvidence['source'][] = ['serving-unit-count', 'multipack-explicit', 'package-unit-count'];
  const selected = [...valid].sort((a, b) => sourcePriority.indexOf(a.source) - sourcePriority.indexOf(b.source))[0];
  const source: PortionOption['source'] = selected.source === 'multipack-explicit'
    ? 'explicit-multipack'
    : selected.source === 'package-unit-count'
      ? 'count-and-net-weight'
      : 'explicit-unit';
  return { weightG: median(ordered), confidence: 'high', note: selected.note, source };
}

function portionId(unit: FoodUnit, weightG: number | null, source: string): string {
  return `${unit}:${weightG === null ? 'variable' : weightG.toFixed(3)}:${source}`;
}

export function derivePortionOptions(
  hit: SearchHit,
  product: OffProduct | undefined,
  basis: '100g' | '100ml' = '100g'
): PortionOption[] {
  const options: PortionOption[] = [];
  const add = (option: Omit<PortionOption, 'recommended'>) => {
    if (options.some((item) => item.unit === option.unit && item.weightG === option.weightG && item.source === option.source)) return;
    options.push({ ...option, recommended: false });
  };

  const countedUnits: FoodUnit[] = barLike(product ?? {}, hit) ? ['bar', 'piece', 'slice'] : ['piece', 'bar', 'slice'];
  for (const unit of countedUnits) {
    const resolved = resolveCountedUnitWeight(unit, hit, product);
    if (resolved.weightG !== null) {
      add({
        id: portionId(unit, resolved.weightG, resolved.source),
        unit,
        label: unitLabels[unit],
        weightG: resolved.weightG,
        volumeMl: null,
        source: resolved.source,
        confidence: resolved.confidence,
        note: resolved.note
      });
    }
  }

  const servingWeight = numberOrNull(product?.serving_quantity ?? hit.serving_quantity);
  if (servingWeight !== null && servingWeight > 0) {
    add({
      id: portionId('portion', servingWeight, 'manufacturer-serving'),
      unit: 'portion',
      label: 'Portion',
      weightG: basis === '100g' ? servingWeight : null,
      volumeMl: basis === '100ml' ? servingWeight : null,
      source: 'manufacturer-serving',
      confidence: 'high',
      note: (product?.serving_size ?? hit.serving_size)
        ? `Herstellerportion laut API: ${product?.serving_size ?? hit.serving_size}.`
        : 'Normalisierte Herstellerportion aus der API.'
    });
  }

  const packageWeight = packageWeightG(product, hit);
  const inferredSingleUnit = singlePackageUnit(product, hit, packageWeight);
  if (inferredSingleUnit && packageWeight !== null) {
    add({
      id: portionId(inferredSingleUnit, packageWeight, 'single-package'),
      unit: inferredSingleUnit,
      label: unitLabels[inferredSingleUnit],
      weightG: packageWeight,
      volumeMl: null,
      source: 'single-package',
      confidence: 'medium',
      note: 'Einzeln verpacktes Produkt ohne Mehrpackungs-Hinweis; das Packungsgewicht wird als eine editierbare Einheit angeboten.'
    });
  }
  if (packageWeight !== null && packageWeight > 0) {
    add({
      id: portionId('package', packageWeight, 'package'),
      unit: 'package',
      label: 'Packung',
      weightG: packageWeight,
      volumeMl: null,
      source: 'package',
      confidence: 'high',
      note: 'Gesamtgewicht der Verkaufspackung.'
    });
  }

  if (basis === '100ml') {
    add({ id: 'ml:variable:volume', unit: 'ml', label: 'Milliliter', weightG: null, volumeMl: 1, source: 'volume', confidence: 'high', note: 'Direkte Volumenberechnung.' });
  } else {
    add({ id: 'g:variable:mass', unit: 'g', label: 'Gramm', weightG: 1, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsberechnung.' });
    add({ id: 'kg:variable:mass', unit: 'kg', label: 'Kilogramm', weightG: 1000, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsberechnung.' });
  }

  const counted = options.filter((option) =>
    ['explicit-unit', 'explicit-multipack', 'count-and-net-weight'].includes(option.source)
    && option.weightG !== null
  );
  let recommended: PortionOption | undefined = counted.sort((a, b) => {
    if (barLike(product ?? {}, hit) && a.unit === 'bar' && b.unit !== 'bar') return -1;
    if (barLike(product ?? {}, hit) && b.unit === 'bar' && a.unit !== 'bar') return 1;
    return (a.weightG ?? Infinity) - (b.weightG ?? Infinity);
  })[0];
  recommended ??= options.find((option) => option.source === 'manufacturer-serving');
  recommended ??= options.find((option) => option.source === 'single-package');
  recommended ??= options.find((option) => option.source === 'package');
  recommended ??= options.find((option) => option.unit === (basis === '100ml' ? 'ml' : 'g'));
  if (recommended) recommended.recommended = true;
  return options;
}

interface UnitIntent {
  countability: Countability;
  smallestUnit: Extract<FoodUnit, 'piece' | 'bar' | 'slice'> | null;
}

function productUnitIntent(
  request: ParsedFoodRequest,
  hit: SearchHit,
  product: OffProduct | undefined,
  calibration: PieceCalibration | null,
  options: PortionOption[]
): UnitIntent {
  if (request.amount.unitExplicit && ['piece', 'bar', 'slice'].includes(request.amount.unit)) {
    return { countability: 'countable', smallestUnit: request.amount.unit as UnitIntent['smallestUnit'] };
  }
  if (calibration && ['piece', 'bar', 'slice'].includes(calibration.unit.kind)) {
    return { countability: 'countable', smallestUnit: calibration.unit.kind as UnitIntent['smallestUnit'] };
  }

  const proven = options
    .filter((option) =>
      ['piece', 'bar', 'slice'].includes(option.unit)
      && option.weightG !== null
      && ['explicit-unit', 'explicit-multipack', 'count-and-net-weight'].includes(option.source)
    )
    .sort((a, b) => (a.weightG ?? Infinity) - (b.weightG ?? Infinity))[0];
  if (proven) return { countability: 'countable', smallestUnit: proven.unit as UnitIntent['smallestUnit'] };

  const text = normalizeText([
    request.product.name,
    displayProductName(product ?? hit),
    product?.generic_name,
    product?.generic_name_de,
    hit.generic_name,
    hit.generic_name_de,
    product?.serving_size,
    hit.serving_size,
    ...(product?.categories_tags ?? []),
    ...(hit.categories_tags ?? [])
  ].filter(Boolean).join(' '));

  if (barLike(product ?? {}, hit)) return { countability: 'countable', smallestUnit: 'bar' };
  if (/\b(scheibe|scheiben|slice|slices|toastbrot|sandwichbrot|knackebrot|knäckebrot)\b/.test(text)) {
    return { countability: 'countable', smallestUnit: 'slice' };
  }
  if (/\b(salzstange|salzstangen|salzstick|salzsticks|bonbon|bonbons|keks|kekse|cookie|cookies|cracker|crackers|bifi|wurstchen|würstchen|sausage|praline|pralinen|schokobon|schokobons|kugel|kugeln|stick|sticks)\b/.test(text)) {
    return { countability: 'countable', smallestUnit: 'piece' };
  }
  if (/\b(nutella|nuss-nougat-creme|honig|reis|nudeln|pasta|milch|joghurt|yoghurt|quark|marmelade|aufstrich|öl|oel|saft|wasser)\b/.test(text)) {
    return { countability: 'non_countable', smallestUnit: null };
  }
  return { countability: 'unknown', smallestUnit: null };
}

function optionPriority(option: PortionOption): number {
  if (option.source === 'user-calibration') return 20;
  if (option.source === 'explicit-unit') return 30;
  if (option.source === 'explicit-multipack') return 40;
  if (option.source === 'count-and-net-weight') return 50;
  if (option.source === 'generic-consensus') return 70;
  if (option.source === 'manufacturer-serving') return 80;
  if (option.source === 'single-package') return 90;
  if (option.source === 'package') return 95;
  if (option.source === 'mass' || option.source === 'volume') return 100;
  return 110;
}

function prepareExactOptions(
  request: ParsedFoodRequest,
  hit: SearchHit,
  product: OffProduct | undefined,
  calibration: PieceCalibration | null,
  sourceOptions: PortionOption[]
): { options: PortionOption[]; countability: Countability } {
  const options = sourceOptions.map((option) => ({
    ...option,
    smallestEdibleUnit: ['piece', 'bar', 'slice'].includes(option.unit),
    priority: optionPriority(option),
    recommended: false
  }));
  const intent = productUnitIntent(request, hit, product, calibration, options);
  const calibrationValue = calibrationWeight(calibration);

  if (calibration && calibrationValue !== null) {
    const unit = calibration.unit.kind;
    options.unshift({
      id: portionId(unit, calibrationValue, 'user-calibration'),
      unit,
      label: unitLabels[unit],
      weightG: calibrationValue,
      volumeMl: null,
      source: 'user-calibration',
      confidence: 'high',
      note: calibration.measurement.mode === 'group_weighing'
        ? `Persönlich gemessen (${calibration.measurement.measuredCount} gemeinsam gewogen).`
        : 'Persönlich gemessenes Einzelgewicht.',
      recommended: false,
      smallestEdibleUnit: calibration.unit.smallestEdibleUnit,
      priority: calibration.scope === 'barcode' ? 20 : calibration.scope === 'exact_product' ? 60 : 70
    });
  }

  const explicitUnit = request.amount.unitExplicit ? request.amount.unit : null;
  const wantedCountedUnit = explicitUnit && ['piece', 'bar', 'slice'].includes(explicitUnit)
    ? explicitUnit as UnitIntent['smallestUnit']
    : intent.smallestUnit;
  if (wantedCountedUnit && !options.some((option) => option.unit === wantedCountedUnit)) {
    options.unshift({
      id: portionId(wantedCountedUnit, null, 'unresolved'),
      unit: wantedCountedUnit,
      label: unitLabels[wantedCountedUnit],
      weightG: null,
      volumeMl: null,
      source: 'unresolved',
      confidence: 'missing',
      note: `Einzelgewicht für ${unitLabels[wantedCountedUnit]} ermitteln.`,
      recommended: false,
      smallestEdibleUnit: true,
      priority: 110
    });
  }

  let recommended: PortionOption | undefined;
  if (explicitUnit) {
    recommended = options
      .filter((option) => option.unit === explicitUnit)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0];
  }
  recommended ??= options
    .filter((option) => option.source === 'user-calibration')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0];
  if (!recommended && intent.countability === 'countable') {
    recommended = options
      .filter((option) => option.unit === intent.smallestUnit)
      .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))[0];
  }
  recommended ??= options
    .filter((option) => option.smallestEdibleUnit && option.weightG !== null)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999) || (a.weightG ?? Infinity) - (b.weightG ?? Infinity))[0];
  recommended ??= options.find((option) => option.source === 'manufacturer-serving');
  recommended ??= options.find((option) => option.source === 'single-package');
  recommended ??= options.find((option) => option.source === 'package');
  recommended ??= options.find((option) => option.unit === 'ml' || option.unit === 'g');
  if (recommended) recommended.recommended = true;

  const unique = new Map<string, PortionOption>();
  for (const option of options) {
    const key = `${option.unit}|${option.weightG ?? option.volumeMl ?? 'unknown'}|${option.source}`;
    if (!unique.has(key)) unique.set(key, option);
  }
  const ordered = [...unique.values()].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const group = (option: PortionOption) => option.smallestEdibleUnit
      ? 0
      : option.source === 'manufacturer-serving'
        ? 1
        : option.source === 'package' || option.source === 'single-package'
          ? 2
          : 3;
    return group(a) - group(b) || (a.priority ?? 999) - (b.priority ?? 999);
  });
  return { options: ordered, countability: intent.countability };
}

export interface GenericUnitConsensus {
  option: PortionOption;
  sampleSize: number;
  middleRange: { from: number; to: number };
}

/**
 * Derive a generic counted-unit weight only from explicit high-confidence
 * package/serving evidence. A single branded product is not generalized to a
 * whole food category: at least two independent, mutually compatible products
 * are required.
 */
export function resolveGenericUnitConsensus(
  hits: SearchHit[],
  unit: FoodUnit,
  basis: '100g' | '100ml' = '100g'
): GenericUnitConsensus | null {
  if (!['piece', 'bar', 'slice'].includes(unit) || basis !== '100g') return null;

  const evidence: Array<{ weightG: number; key: string }> = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const option = derivePortionOptions(hit, undefined, basis).find((candidate) =>
      candidate.unit === unit
      && ['explicit-unit', 'explicit-multipack', 'count-and-net-weight'].includes(candidate.source)
      && candidate.confidence === 'high'
      && candidate.weightG !== null
    );
    if (!option?.weightG) continue;
    const brand = normalizeText(displayBrand(hit.brands) ?? displayProductName(hit));
    const key = hit.code ?? `${brand}|${option.weightG.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push({ weightG: option.weightG, key });
  }

  if (evidence.length < 2) return null;
  const values = evidence.map((item) => item.weightG).sort((a, b) => a - b);
  const central = median(values);
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const fullSpread = values[values.length - 1] - values[0];
  const allowedSpread = Math.max(0.8, central * (values.length >= 3 ? 0.35 : 0.2));
  if (fullSpread > allowedSpread) return null;

  const confidence: Confidence = values.length >= 4 && (q3 - q1) <= Math.max(0.5, central * 0.2)
    ? 'high'
    : 'medium';
  const rounded = Math.round(central * 1000) / 1000;
  return {
    option: {
      id: portionId(unit, rounded, 'generic-consensus'),
      unit,
      label: unitLabels[unit],
      weightG: rounded,
      volumeMl: null,
      source: 'generic-consensus',
      confidence,
      note: `Median eines ausdrücklich belegten ${unitLabels[unit]}gewichts aus ${values.length} unabhängigen Produkten.`,
      recommended: true
    },
    sampleSize: values.length,
    middleRange: { from: q1, to: q3 }
  };
}

function calculateCarbs(per100: number | null, basis: '100g' | '100ml', totalMassG: number | null, totalVolumeMl: number | null): number | null {
  if (per100 === null) return null;
  if (basis === '100g' && totalMassG !== null) return totalMassG * per100 / 100;
  if (basis === '100ml' && totalVolumeMl !== null) return totalVolumeMl * per100 / 100;
  return null;
}

interface EffectiveSelection {
  amount: number;
  unit: FoodUnit;
  unitWeightG: number | null;
  totalMassG: number | null;
  totalVolumeMl: number | null;
  selectedPortionId: string | null;
  confidence: Confidence;
  note: string | null;
}

function selectionFromOption(amount: number, option: PortionOption): EffectiveSelection {
  if (option.unit === 'g') return { amount, unit: 'g', unitWeightG: null, totalMassG: amount, totalVolumeMl: null, selectedPortionId: option.id, confidence: option.confidence, note: option.note };
  if (option.unit === 'kg') return { amount, unit: 'kg', unitWeightG: null, totalMassG: amount * 1000, totalVolumeMl: null, selectedPortionId: option.id, confidence: option.confidence, note: option.note };
  if (option.unit === 'ml') return { amount, unit: 'ml', unitWeightG: null, totalMassG: null, totalVolumeMl: amount, selectedPortionId: option.id, confidence: option.confidence, note: option.note };
  if (option.weightG !== null) return { amount, unit: option.unit, unitWeightG: option.weightG, totalMassG: amount * option.weightG, totalVolumeMl: null, selectedPortionId: option.id, confidence: option.confidence, note: option.note };
  if (option.volumeMl !== null) return { amount, unit: option.unit, unitWeightG: null, totalMassG: null, totalVolumeMl: amount * option.volumeMl, selectedPortionId: option.id, confidence: option.confidence, note: option.note };
  return { amount, unit: option.unit, unitWeightG: null, totalMassG: null, totalVolumeMl: null, selectedPortionId: option.id, confidence: 'missing', note: option.note };
}

function chooseExactSelection(
  request: ParsedFoodRequest,
  options: PortionOption[],
  calibration: PieceCalibration | null,
  manualWeightG?: number | null
): EffectiveSelection {
  const explicitUnit = request.amount.unitExplicit === true;
  const explicitAmount = request.amount.valueExplicit === true;
  let amount = request.amount.value;
  let desiredUnit = request.amount.unit;

  if (!explicitUnit) {
    const recommended = options.find((option) => option.recommended) ?? options[0];
    if (recommended) desiredUnit = recommended.unit;
    if (!explicitAmount) amount = desiredUnit === 'g' ? 100 : desiredUnit === 'kg' ? 0.1 : desiredUnit === 'ml' ? 100 : 1;
  }

  const weightOverride = manualWeightG
    ?? (calibration?.unit.kind === desiredUnit ? calibrationWeight(calibration) : null);
  if (weightOverride !== null && weightOverride > 0 && !['g', 'kg', 'ml'].includes(desiredUnit)) {
    return {
      amount,
      unit: desiredUnit,
      unitWeightG: weightOverride,
      totalMassG: amount * weightOverride,
      totalVolumeMl: null,
      selectedPortionId: portionId(desiredUnit, weightOverride, 'manual'),
      confidence: calibration ? 'high' : 'medium',
      note: calibration ? 'Gespeichertes Einheitengewicht verwendet.' : 'Manuell angegebenes Einheitengewicht verwendet.'
    };
  }

  const option = options.find((item) => item.unit === desiredUnit && (explicitUnit || item.recommended))
    ?? options.find((item) => item.unit === desiredUnit)
    ?? (!explicitUnit ? options.find((item) => item.recommended) : undefined);
  if (option) return selectionFromOption(amount, option);
  return { amount, unit: desiredUnit, unitWeightG: null, totalMassG: null, totalVolumeMl: null, selectedPortionId: null, confidence: 'missing', note: `Für ${unitLabels[desiredUnit]} liegt kein eindeutiges Gewicht vor.` };
}

function genericOptions(basis: '100g' | '100ml', selectedUnit: FoodUnit): PortionOption[] {
  const options: PortionOption[] = basis === '100ml'
    ? [{ id: 'ml:variable:volume', unit: 'ml', label: 'Milliliter', weightG: null, volumeMl: 1, source: 'volume', confidence: 'high', note: 'Direkte Volumenberechnung.', recommended: selectedUnit === 'ml' }]
    : [
        { id: 'g:variable:mass', unit: 'g', label: 'Gramm', weightG: 1, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsberechnung.', recommended: selectedUnit === 'g' },
        { id: 'kg:variable:mass', unit: 'kg', label: 'Kilogramm', weightG: 1000, volumeMl: null, source: 'mass', confidence: 'high', note: 'Direkte Gewichtsberechnung.', recommended: selectedUnit === 'kg' }
      ];
  for (const unit of ['piece', 'bar', 'slice', 'portion'] as FoodUnit[]) {
    if (unit === selectedUnit || !['g', 'kg', 'ml'].includes(selectedUnit)) {
      options.push({
        id: `${unit}:variable:unresolved`,
        unit,
        label: unitLabels[unit],
        weightG: null,
        volumeMl: null,
        source: 'unresolved',
        confidence: 'missing',
        note: `Gewicht je ${unitLabels[unit]} erforderlich.`,
        recommended: unit === selectedUnit,
        smallestEdibleUnit: ['piece', 'bar', 'slice'].includes(unit),
        priority: 110
      });
    }
  }
  if (!options.some((option) => option.recommended)) options[0].recommended = true;
  return options;
}

function effectiveRequest(request: ParsedFoodRequest, selection: EffectiveSelection): ParsedFoodRequest {
  return {
    ...request,
    amount: {
      ...request.amount,
      value: selection.amount,
      unit: selection.unit
    }
  };
}

export function buildExactResult(
  request: ParsedFoodRequest,
  hit: SearchHit,
  product: OffProduct | undefined,
  calibration: PieceCalibration | null,
  manualWeightG?: number | null
): CalculationResult {
  const combinedHit = mergeProductIntoHit(hit, product);
  const nutrition = carbsPer100(combinedHit, request.product.name);
  const prepared = prepareExactOptions(
    request,
    combinedHit,
    product,
    calibration,
    derivePortionOptions(combinedHit, product, nutrition.basis)
  );
  const options = prepared.options;
  const selection = chooseExactSelection(request, options, calibration, manualWeightG);
  if (selection.selectedPortionId?.endsWith(':manual') && selection.unitWeightG !== null) {
    options.push({
      id: selection.selectedPortionId,
      unit: selection.unit,
      label: unitLabels[selection.unit],
      weightG: selection.unitWeightG,
      volumeMl: null,
      source: 'manual',
      confidence: selection.confidence,
      note: selection.note ?? 'Manuelles Gewicht.',
      recommended: true
    });
    options.forEach((option) => { if (option.id !== selection.selectedPortionId) option.recommended = false; });
  }
  const carbohydratesG = calculateCarbs(nutrition.value, nutrition.basis, selection.totalMassG, selection.totalVolumeMl);
  const preparationIntent = getPreparationIntent(request.product.name);
  const notes = [
    selection.note,
    preparationIntent.inferred ? 'Für dieses Grundnahrungsmittel wurde der verzehrfertige/gekochte Zustand angenommen.' : null,
    nutrition.prepared ? 'Ausdrücklich zubereitete Nährwerte aus dem API-Datensatz verwendet.' : null,
    preparationIntent.state && nutrition.value === null
      ? `Kein belastbarer Nährwert für „${preparationIntent.label}“ gefunden; trockene Rohware wurde nicht ersatzweise verwendet.`
      : null
  ].filter((note): note is string => Boolean(note));
  const adjustedRequest = effectiveRequest(request, selection);

  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    request: adjustedRequest,
    product: productSummary(combinedHit, product),
    mode: 'exact',
    status: carbohydratesG !== null ? 'calculated' : nutrition.value === null ? 'not_found' : 'needs_unit_calibration',
    carbohydratesG,
    carbohydratesPer100: nutrition.value,
    basis: nutrition.basis,
    totalMassG: selection.totalMassG,
    totalVolumeMl: selection.totalVolumeMl,
    unitWeightG: selection.unitWeightG,
    amount: selection.amount,
    unit: selection.unit,
    countability: prepared.countability,
    confidence: carbohydratesG !== null ? selection.confidence : 'missing',
    sourceLabel: 'Open Food Facts',
    methodLabel: 'Konkretes Produkt · deterministische Berechnung',
    sampleSize: null,
    middleRange: null,
    candidates: [combinedHit],
    notes,
    favorite: false,
    portionOptions: options,
    selectedPortionId: selection.selectedPortionId
  };
}

export function buildBaseFoodReferenceResult(
  request: ParsedFoodRequest,
  reference: BaseFoodReference,
  calibration: PieceCalibration | null,
  manualWeightG?: number | null
): CalculationResult {
  const noExplicitQuantity = request.amount.valueExplicit !== true && request.amount.unitExplicit !== true;
  const selectedUnit: FoodUnit = noExplicitQuantity ? 'g' : request.amount.unit;
  const selectedAmount = noExplicitQuantity ? 100 : request.amount.value;
  const options = genericOptions('100g', selectedUnit);
  const override = manualWeightG
    ?? (calibration?.unit.kind === selectedUnit ? calibrationWeight(calibration) : null);
  let selection: EffectiveSelection;

  if (override !== null && override > 0 && !['g', 'kg', 'ml'].includes(selectedUnit)) {
    const manualOption: PortionOption = {
      id: portionId(selectedUnit, override, 'manual'),
      unit: selectedUnit,
      label: unitLabels[selectedUnit],
      weightG: override,
      volumeMl: null,
      source: calibration ? 'user-calibration' : 'manual',
      confidence: calibration ? 'high' : 'medium',
      note: calibration ? 'Gespeichertes Einheitengewicht verwendet.' : 'Manuell angegebenes Einheitengewicht verwendet.',
      recommended: true,
      smallestEdibleUnit: ['piece', 'bar', 'slice'].includes(selectedUnit),
      priority: calibration ? 20 : 25
    };
    options.forEach((option) => { option.recommended = false; });
    options.unshift(manualOption);
    selection = selectionFromOption(selectedAmount, manualOption);
  } else {
    selection = selectionFromOption(selectedAmount, options.find((option) => option.recommended) ?? options[0]);
  }

  const carbohydratesG = calculateCarbs(
    reference.carbohydratesPer100g,
    '100g',
    selection.totalMassG,
    selection.totalVolumeMl
  );
  const adjustedRequest = effectiveRequest(request, selection);

  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    request: adjustedRequest,
    product: {
      barcode: null,
      name: reference.label,
      brand: null,
      imageUrl: null,
      packageDescription: null,
      packageWeightG: null,
      servingDescription: reference.stateLabel,
      servingWeightG: null,
      categories: []
    },
    mode: 'generic',
    status: carbohydratesG !== null ? 'calculated' : 'needs_unit_calibration',
    carbohydratesG,
    carbohydratesPer100: reference.carbohydratesPer100g,
    basis: '100g',
    totalMassG: selection.totalMassG,
    totalVolumeMl: selection.totalVolumeMl,
    unitWeightG: selection.unitWeightG,
    amount: selection.amount,
    unit: selection.unit,
    countability: ['piece', 'bar', 'slice'].includes(selection.unit)
      ? 'countable'
      : ['g', 'kg', 'ml'].includes(selection.unit)
        ? 'non_countable'
        : 'unknown',
    confidence: carbohydratesG !== null ? 'high' : selection.confidence,
    sourceLabel: reference.sourceLabel,
    methodLabel: `Generisches Basislebensmittel · ${reference.stateLabel}`,
    sampleSize: null,
    middleRange: reference.middleRange,
    candidates: [],
    notes: [reference.note, 'Ein konkretes Markenprodukt kann über „Produkt wählen“ ausgewählt werden.'],
    favorite: false,
    portionOptions: options,
    selectedPortionId: selection.selectedPortionId
  };
}

export function buildGenericResult(
  request: ParsedFoodRequest,
  resolution: GenericResolution,
  calibration: PieceCalibration | null,
  manualWeightG?: number | null
): CalculationResult {
  const representative = resolution.hits[0] ?? {};
  const noExplicitQuantity = request.amount.valueExplicit !== true && request.amount.unitExplicit !== true;
  const selectedUnit: FoodUnit = noExplicitQuantity ? (resolution.basis === '100ml' ? 'ml' : 'g') : request.amount.unit;
  const selectedAmount = noExplicitQuantity ? 100 : request.amount.value;
  const options = genericOptions(resolution.basis, selectedUnit);
  const consensus = resolveGenericUnitConsensus(resolution.hits, selectedUnit, resolution.basis);
  if (consensus) {
    for (const option of options) option.recommended = false;
    const unresolvedIndex = options.findIndex((option) => option.unit === selectedUnit && option.weightG === null);
    if (unresolvedIndex >= 0) options.splice(unresolvedIndex, 1);
    options.push(consensus.option);
  }
  const override = manualWeightG
    ?? (calibration?.unit.kind === selectedUnit ? calibrationWeight(calibration) : null);
  let selection: EffectiveSelection;
  if (override !== null && override > 0 && !['g', 'kg', 'ml'].includes(selectedUnit)) {
    const manualOption: PortionOption = {
      id: portionId(selectedUnit, override, 'manual'), unit: selectedUnit, label: unitLabels[selectedUnit],
      weightG: override, volumeMl: null, source: calibration ? 'user-calibration' : 'manual', confidence: calibration ? 'high' : 'medium',
      note: calibration ? 'Gespeichertes Einheitengewicht verwendet.' : 'Manuell angegebenes Einheitengewicht verwendet.', recommended: true,
      smallestEdibleUnit: ['piece', 'bar', 'slice'].includes(selectedUnit),
      priority: calibration ? 20 : 25
    };
    options.forEach((option) => { option.recommended = false; });
    options.unshift(manualOption);
    selection = selectionFromOption(selectedAmount, manualOption);
  } else {
    selection = selectionFromOption(selectedAmount, options.find((option) => option.recommended) ?? options[0]);
  }
  const carbohydratesG = calculateCarbs(resolution.median, resolution.basis, selection.totalMassG, selection.totalVolumeMl);
  const notes = [
    selection.note,
    resolution.preparationInferred ? 'Für dieses Grundnahrungsmittel wurde der verzehrfertige/gekochte Zustand angenommen.' : null,
    resolution.preparationLabel ? `Zustand „${resolution.preparationLabel}“ wurde bei der Kandidatenfilterung zwingend berücksichtigt.` : null,
    resolution.preparedValuesUsed > 0 ? `${resolution.preparedValuesUsed} Treffer lieferten ausdrücklich zubereitete Nährwerte.` : null,
    consensus ? `Das ${unitLabels[selectedUnit]}gewicht wurde deterministisch aus ${consensus.sampleSize} übereinstimmenden, ausdrücklich belegten Produktangaben gebildet.` : null,
    resolution.hits.length ? `Median aus ${resolution.hits.length} gefilterten Basisprodukten.` : resolution.preparationLabel
      ? `Keine passenden Basisprodukt-Treffer im Zustand „${resolution.preparationLabel}“ gefunden.`
      : 'Keine ausreichenden Vergleichsprodukte gefunden.'
  ].filter((note): note is string => Boolean(note));
  const adjustedRequest = effectiveRequest(request, selection);

  return {
    id: createId(), createdAt: new Date().toISOString(), request: adjustedRequest,
    product: {
      barcode: null, name: request.product.name, brand: null,
      imageUrl: representative.image_front_url ?? null,
      packageDescription: null, packageWeightG: null,
      servingDescription: null, servingWeightG: null,
      categories: representative.categories_tags ?? []
    },
    mode: 'generic',
    status: carbohydratesG !== null ? 'calculated' : resolution.median === null ? 'not_found' : 'needs_unit_calibration',
    carbohydratesG,
    carbohydratesPer100: resolution.median,
    basis: resolution.basis,
    totalMassG: selection.totalMassG,
    totalVolumeMl: selection.totalVolumeMl,
    unitWeightG: selection.unitWeightG,
    amount: selection.amount,
    unit: selection.unit,
    countability: ['piece', 'bar', 'slice'].includes(selection.unit)
      ? 'countable'
      : ['g', 'kg', 'ml'].includes(selection.unit)
        ? 'non_countable'
        : 'unknown',
    confidence: carbohydratesG !== null ? resolution.confidence : selection.confidence,
    sourceLabel: 'Open Food Facts',
    methodLabel: resolution.preparationLabel ? `Generischer Basisprodukt-Median (${resolution.preparationLabel})` : 'Generischer Median',
    sampleSize: resolution.hits.length,
    middleRange: resolution.middleRange,
    candidates: resolution.hits,
    notes,
    favorite: false,
    portionOptions: options,
    selectedPortionId: selection.selectedPortionId
  };
}

function applyPortion(result: CalculationResult, amount: number, option: PortionOption): CalculationResult {
  const selection = selectionFromOption(amount, option);
  const carbohydratesG = calculateCarbs(result.carbohydratesPer100, result.basis, selection.totalMassG, selection.totalVolumeMl);
  return {
    ...result,
    id: createId(),
    createdAt: new Date().toISOString(),
    amount,
    unit: option.unit,
    request: { ...result.request, amount: { ...result.request.amount, value: amount, unit: option.unit, valueExplicit: true, unitExplicit: true } },
    totalMassG: selection.totalMassG,
    totalVolumeMl: selection.totalVolumeMl,
    unitWeightG: selection.unitWeightG,
    carbohydratesG,
    status: carbohydratesG !== null ? 'calculated' : result.carbohydratesPer100 === null ? 'not_found' : 'needs_unit_calibration',
    confidence: carbohydratesG !== null ? option.confidence : 'missing',
    selectedPortionId: option.id
  };
}

export function recalculateWithPortion(result: CalculationResult, amount: number, portionId: string): CalculationResult {
  const option = result.portionOptions.find((item) => item.id === portionId);
  if (!option) return result;
  return applyPortion(result, amount, option);
}

export function recalculateResult(
  result: CalculationResult,
  amount: number,
  unitWeightG = result.unitWeightG
): CalculationResult {
  let option = result.portionOptions.find((item) => item.id === result.selectedPortionId);
  if (unitWeightG !== null && !['g', 'kg', 'ml'].includes(result.unit)) {
    const manualOption: PortionOption = {
      id: portionId(result.unit, unitWeightG, 'manual'),
      unit: result.unit,
      label: unitLabels[result.unit],
      weightG: unitWeightG,
      volumeMl: null,
      source: 'manual',
      confidence: 'high',
      note: 'Manuell bestätigtes Einheitengewicht.',
      recommended: true
    };
    option = manualOption;
    const filtered = result.portionOptions
      .filter((item) => !(item.source === 'manual' && item.unit === result.unit))
      .map((item) => ({ ...item, recommended: false }));
    result = { ...result, portionOptions: [...filtered, manualOption] };
  }
  option ??= result.portionOptions.find((item) => item.unit === result.unit)
    ?? { id: 'fallback', unit: result.unit, label: unitLabels[result.unit], weightG: unitWeightG, volumeMl: null, source: 'manual', confidence: unitWeightG !== null ? 'high' : 'missing', note: '', recommended: true };
  return applyPortion(result, amount, option);
}

function massOption(result: CalculationResult): PortionOption {
  return result.portionOptions.find((item) => item.unit === 'g') ?? {
    id: 'g:variable:mass',
    unit: 'g',
    label: 'Gramm',
    weightG: 1,
    volumeMl: null,
    source: 'mass',
    confidence: 'high',
    note: 'Manuell eingegebenes Gesamtgewicht.',
    recommended: false
  };
}

function volumeOption(result: CalculationResult): PortionOption {
  return result.portionOptions.find((item) => item.unit === 'ml') ?? {
    id: 'ml:variable:volume',
    unit: 'ml',
    label: 'Milliliter',
    weightG: null,
    volumeMl: 1,
    source: 'volume',
    confidence: 'high',
    note: 'Manuell eingegebene Gesamtmenge.',
    recommended: false
  };
}

/**
 * Apply a manually measured total mass without losing a selected counted unit.
 * For example, 10 Salzstangen with 28 g total become a calibrated 2.8 g per
 * piece. Direct gram/kilogram selections remain direct mass selections.
 */
export function recalculateWithManualTotalMass(
  result: CalculationResult,
  totalMassG: number
): CalculationResult {
  if (!Number.isFinite(totalMassG) || totalMassG <= 0 || result.basis !== '100g') return result;

  if (result.unit === 'g') return applyPortion(result, totalMassG, massOption(result));
  if (result.unit === 'kg') {
    const kilograms = result.portionOptions.find((item) => item.unit === 'kg') ?? {
      id: 'kg:variable:mass',
      unit: 'kg' as const,
      label: 'Kilogramm',
      weightG: 1000,
      volumeMl: null,
      source: 'mass' as const,
      confidence: 'high' as const,
      note: 'Manuell eingegebenes Gesamtgewicht.',
      recommended: false
    };
    return applyPortion(result, totalMassG / 1000, kilograms);
  }

  if (result.unit === 'ml' || !Number.isFinite(result.amount) || result.amount <= 0) {
    const grams = massOption(result);
    const withMassOption = result.portionOptions.some((item) => item.id === grams.id)
      ? result
      : { ...result, portionOptions: [...result.portionOptions, grams] };
    return applyPortion(withMassOption, totalMassG, grams);
  }

  return recalculateResult(result, result.amount, totalMassG / result.amount);
}

/** Apply a manually entered total volume for products whose nutrition basis is 100 ml. */
export function recalculateWithManualTotalVolume(
  result: CalculationResult,
  totalVolumeMl: number
): CalculationResult {
  if (!Number.isFinite(totalVolumeMl) || totalVolumeMl <= 0 || result.basis !== '100ml') return result;
  const millilitres = volumeOption(result);
  const withVolumeOption = result.portionOptions.some((item) => item.id === millilitres.id)
    ? result
    : { ...result, portionOptions: [...result.portionOptions, millilitres] };
  return applyPortion(withVolumeOption, totalVolumeMl, millilitres);
}
