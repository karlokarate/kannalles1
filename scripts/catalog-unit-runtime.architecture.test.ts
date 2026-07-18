import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const runtime = source('src/app/catalogUnitRuntime.ts');
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

  it('requires the smart controller to opt into smart calibration scope explicitly', () => {
    expect(smartController).toContain("resolveCatalogUnitRuntime(base.product, base.request, 'smart')");
    expect(smartController).toContain("catalogCalibrationIdentity(product, 'smart')");
    expect(smartController).toContain("defaultClinicCatalogUnitRequest(candidate, 'smart')");
  });

  it('routes favorite request defaults through the same runtime helpers', () => {
    expect(favoriteController).toContain("from './catalogUnitRuntime'");
    expect(favoriteController).toContain('normalizeCatalogUnitRequest');
    expect(favoriteController).toContain('defaultClinicCatalogUnitRequest');
    expect(favoriteController).not.toContain('clinicDefaultRequest');
    expect(favoriteController).not.toMatch(/parsed\.amount\s*\*\s*1_000/);
  });
});
