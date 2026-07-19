import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const runtime = source('src/app/catalogUnitRuntime.ts');
const requestNormalizer = source('src/lib/resolution/catalogUnitRequest.ts');
const inputRequestAuthority = source('src/app/catalogInputRequest.ts');
const mealCalculation = source('src/lib/mealCalculation.ts');
const standardController = source('src/app/useCatalogController.ts');
const smartController = source('src/app/useSmartCatalogController.ts');
const favoriteController = source('src/app/useFavoriteSearchController.ts');
const unitControllers = [standardController, smartController];

describe('catalog unit runtime architecture', () => {
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

  it('removes the duplicated controller-local unit helpers', () => {
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
    expect(inputRequestAuthority).toContain('normalizeCatalogUnitRequest');
    expect(mealCalculation).toContain("from './resolution/catalogUnitRequest'");
    expect(mealCalculation).toContain('const normalizedRequest = normalizeCatalogUnitRequest(request)');
    for (const sourceText of [runtime, inputRequestAuthority, mealCalculation, ...unitControllers, favoriteController]) {
      expect(sourceText).not.toMatch(/request\.amount\s*\*\s*1_000/);
      expect(sourceText).not.toMatch(/parsed\.amount\s*\*\s*1_000/);
    }
  });

  it('requires smart multi-product resolution to opt into smart request and calibration scope', () => {
    expect(smartController).toContain("resolveCatalogUnitRuntime(base.product, base.request, 'smart')");
    expect(smartController).toContain("catalogCalibrationIdentity(product, 'smart')");
    expect(smartController).toContain("requestForInitialCatalogProduct(parsed, candidate, 'smart')");
    expect(inputRequestAuthority).toContain('defaultClinicCatalogUnitRequest(product, mode)');
  });

  it('preserves explicit non-piece requests for direct clinic values', () => {
    expect(runtime).toContain('function directClinicRuntimeState');
    expect(runtime).toContain("status: 'not_calculable'");
    expect(runtime).toContain("reason: 'requested-unit-unavailable'");
    expect(runtime).toContain("source: 'unresolved'");
    expect(runtime).toContain("request.unit === 'piece'");
  });

  it('forbids favorite promotion from becoming a second request authority', () => {
    expect(favoriteController).not.toContain("from './catalogUnitRuntime'");
    expect(favoriteController).not.toContain('normalizeCatalogUnitRequest');
    expect(favoriteController).not.toContain('defaultClinicCatalogUnitRequest');
    expect(favoriteController).not.toContain('parseCatalogQuery');
    expect(favoriteController).not.toContain('setRequest');
  });
});
