import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const authority = source('src/app/catalogInputRequest.ts');
const runtime = source('src/app/catalogUnitRuntime.ts');
const selection = source('src/app/useCatalogUnitSelection.ts');
const catalogController = source('src/app/useCatalogController.ts');
const smartController = source('src/app/useSmartCatalogController.ts');
const favoriteController = source('src/app/useFavoriteSearchController.ts');
const calculator = source('src/app/CalculatorScreen.tsx');

describe('catalog input request architecture', () => {
  it('keeps parsed-input conversion in one authority', () => {
    expect(authority).toContain('requestFromParsedCatalogInput');
    expect(authority).toContain('requestForInitialCatalogProduct');
    expect(authority).toContain('requestForCatalogVariant');
    expect(authority).toContain('requestForBareCatalogProduct');
    expect(authority.match(/normalizeCatalogUnitRequest\(/g)).toHaveLength(1);

    expect(catalogController).toContain("from './catalogInputRequest'");
    expect(smartController).toContain("from './catalogInputRequest'");
    expect(catalogController).toContain('requestForInitialCatalogProduct(parsed, preferred)');
    expect(smartController).toContain("requestForInitialCatalogProduct(parsed, candidate, 'smart')");
  });

  it('applies the persisted personal standard before mass or catalog defaults', () => {
    expect(runtime).toContain('export function catalogPersonalDefaultUnitRequest');
    expect(authority).toContain('catalogPersonalDefaultUnitRequest');
    const bareRequest = authority.slice(
      authority.indexOf('export function requestForBareCatalogProduct'),
      authority.indexOf('export function requestForInitialCatalogProduct')
    );
    expect(bareRequest.indexOf('catalogPersonalDefaultUnitRequest'))
      .toBeLessThan(bareRequest.indexOf('genericDefaultPortionGrams'));
    expect(authority).toContain('parsedRequest.amount');
    expect(authority).toContain('current.amount');
  });

  it('uses one selection authority in standard and smart controllers', () => {
    expect(selection).toContain('export function resolveCatalogUnitSelection');
    expect(selection).toContain('if (!request.unitExplicit');
    expect(selection).toContain('resolution.selectedOptionId');
    for (const controller of [catalogController, smartController]) {
      expect(controller).toContain("from './useCatalogUnitSelection'");
      expect(controller).toContain('useCatalogUnitSelection(');
      expect(controller).not.toMatch(/setSelectedOptionId\(\(current\) => current && resolution/);
    }
  });

  it('forbids favorite promotion from reparsing or mutating calculation input', () => {
    expect(favoriteController).not.toContain('parseCatalogQuery');
    expect(favoriteController).not.toContain('setRequest');
    expect(favoriteController).not.toContain("type: 'resolve'");
    expect(favoriteController).toContain('base.search.query');
    expect(favoriteController).toContain('base.promoteSearchCandidate(preferred, merged)');
    expect(catalogController).toContain('promoteSearchCandidate: resolveSearchCandidate');
  });

  it('keeps product variant request changes in the controller, not the view', () => {
    const chooseCandidate = calculator.slice(
      calculator.indexOf('const chooseCandidate'),
      calculator.indexOf("if (c.mealOpen")
    );
    expect(chooseCandidate).toContain('c.selectCandidate(hit)');
    expect(chooseCandidate).not.toContain('setRequest');
    expect(catalogController).toContain('requestForCatalogVariant(current, hit)');
  });

  it('preserves current amount after confirming a calibration', () => {
    expect(catalogController).toContain("setRequest((current) => ({ ...current, unit: calibrationUnit, unitExplicit: false }))");
    expect(catalogController).not.toContain("setRequest({ amount: 1, unit: calibrationUnit");
  });

  it('removes all controller-local copies of parsed request defaulting', () => {
    for (const controller of [catalogController, smartController]) {
      expect(controller).not.toMatch(/parsed\.amount\s*,\s*unit:\s*parsed\.unit/);
      expect(controller).not.toMatch(/isGenericCatalogProduct\(candidate\).*amount:\s*200/s);
      expect(controller).not.toMatch(/defaultClinicCatalogUnitRequest\(candidate/);
    }
  });
});
