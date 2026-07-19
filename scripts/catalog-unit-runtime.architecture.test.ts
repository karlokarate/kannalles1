import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const runtime = source('src/app/catalogUnitRuntime.ts');
const inputRequest = source('src/app/catalogInputRequest.ts');
const requestNormalizer = source('src/lib/resolution/catalogUnitRequest.ts');
const mealCalculation = source('src/lib/mealCalculation.ts');
const searchState = source('src/lib/searchState.ts');
const standardController = source('src/app/useCatalogController.ts');
const smartController = source('src/app/useSmartCatalogController.ts');
const favoriteController = source('src/app/useFavoriteSearchController.ts');
const calculatorScreen = source('src/app/CalculatorScreen.tsx');
const unitControllers = [standardController, smartController];

describe('catalog unit and input request architecture', () => {
  it('keeps one application authority for evidence, calibration and clinic resolution', () => {
    expect(runtime.match(/\bresolveCatalogUnits\(/g)).toHaveLength(1);
    expect(runtime).toContain('findMatchingCatalogCalibrations');
    expect(runtime).toContain('directClinicResolution');
    expect(runtime).toContain('resolveSmartUnitState');

    for (const controller of unitControllers) {
      expect(controller).toContain("from './catalogUnitRuntime'");
      expect(controller).not.toMatch(/\bresolveCatalogUnits\b/);
      expect(controller).not.toMatch(/\btoMatchingUnitCalibration\b/);
      expect(controller).not.toMatch(/\bfindMatchingCatalogCalibrations\b/);
      expect(controller).not.toMatch(/\bdirectClinicResolution\b/);
    }
  });

  it('keeps one product-aware authority for parsed amount and unit requests', () => {
    expect(inputRequest).toContain('export function catalogRequestForInput');
    expect(inputRequest).toContain('genericDefaultPortionGrams(product)');
    expect(inputRequest).toContain('defaultClinicCatalogUnitRequest(product, mode)');

    for (const controller of [standardController, smartController, favoriteController]) {
      expect(controller).toContain("from './catalogInputRequest'");
      expect(controller).not.toMatch(/!parsed\.amountExplicit\s*&&\s*!parsed\.unitExplicit/);
      expect(controller).not.toMatch(/amount:\s*200,\s*unit:\s*'g'/);
    }
    expect(calculatorScreen).not.toMatch(/chooseCandidate[\s\S]{0,240}setRequest/);
  });

  it('carries the original parsed input through search, favorites and variants', () => {
    expect(searchState).toContain('input: CatalogInputIntent | null');
    expect(searchState).toContain("type: 'start'; query: string; input: CatalogInputIntent");
    expect(searchState).toContain('input: action.input');
    expect(standardController).toContain("dispatch({ type: 'start', query: parsed.catalogQuery, input: parsed })");
    expect(standardController).toContain('const selectionInput = search.input ?? implicitCatalogInput(hit.displayName)');
    expect(standardController).toContain('catalogRequestForInput(selectionInput, hit)');
    expect(favoriteController).toContain('const input = base.search.input');
    expect(favoriteController).toContain('catalogRequestForInput(input, preferred)');
    expect(favoriteController).not.toContain('parseCatalogQuery');
    expect(favoriteController).not.toContain('base.search.query');
  });

  it('removes duplicated controller-local unit helpers', () => {
    for (const controller of unitControllers) {
      expect(controller).not.toMatch(/function\s+pickerRequest\s*\(/);
      expect(controller).not.toMatch(/function\s+identity\s*\(/);
      expect(controller).not.toMatch(/function\s+productCalibrations\s*\(/);
      expect(controller).not.toMatch(/function\s+resolveProductUnit(?:s|State)\s*\(/);
      expect(controller).not.toMatch(/function\s+defaultClinic(?:Unit)?Request\s*\(/);
    }
  });

  it('keeps kilogram normalization in one lower-layer function and reuses it at request boundaries', () => {
    expect(requestNormalizer.match(/\*\s*1_000/g)).toHaveLength(1);
    expect(runtime).toContain("from '../lib/resolution/catalogUnitRequest'");
    expect(runtime).toContain('const normalizedRequest = normalizeCatalogUnitRequest(request)');
    expect(inputRequest).toContain('normalizeCatalogUnitRequest');
    expect(mealCalculation).toContain("from './resolution/catalogUnitRequest'");
    expect(mealCalculation).toContain('const normalizedRequest = normalizeCatalogUnitRequest(request)');
    for (const sourceText of [runtime, inputRequest, mealCalculation, ...unitControllers, favoriteController]) {
      expect(sourceText).not.toMatch(/request\.amount\s*\*\s*1_000/);
      expect(sourceText).not.toMatch(/parsed\.amount\s*\*\s*1_000/);
    }
  });

  it('requires smart multi-product input to opt into smart request and calibration scope', () => {
    expect(smartController).toContain("resolveCatalogUnitRuntime(base.product, base.request, 'smart')");
    expect(smartController).toContain("catalogCalibrationIdentity(product, 'smart')");
    expect(smartController).toContain("catalogRequestForInput(parsed, candidate, 'smart')");
  });

  it('preserves explicit non-piece requests for direct clinic values', () => {
    expect(runtime).toContain('function directClinicRuntimeState');
    expect(runtime).toContain("status: 'not_calculable'");
    expect(runtime).toContain("reason: 'requested-unit-unavailable'");
    expect(runtime).toContain("source: 'unresolved'");
    expect(runtime).toContain("request.unit === 'piece'");
  });

  it('never resets the recognized amount when a calibration is saved', () => {
    expect(standardController).toContain("setRequest((current) => ({ ...current, unit: calibrationUnit, unitExplicit: false }))");
    expect(standardController).not.toContain("setRequest({ amount: 1, unit: calibrationUnit");
  });
});
