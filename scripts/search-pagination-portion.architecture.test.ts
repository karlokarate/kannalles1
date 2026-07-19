import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const pagination = source('src/lib/catalog/catalogPagination.ts');
const client = source('src/lib/catalog/catalogClient.ts');
const worker = source('src/lib/catalog/catalog.worker.ts');
const controller = source('src/app/useCatalogController.ts');
const smartController = source('src/app/useSmartCatalogController.ts');
const parser = source('src/app/queryParser.ts');
const calculator = source('src/app/CalculatorScreen.tsx');
const settings = source('src/app/SettingsScreen.tsx');
const packageJson = JSON.parse(source('package.json')) as { scripts?: Record<string, string> };

describe('search pagination and compound portion architecture', () => {
  it('uses one fixed twenty-result page authority with a non-rendered look-ahead', () => {
    expect(pagination).toContain('CATALOG_SEARCH_PAGE_SIZE = 20');
    expect(pagination).toContain('CATALOG_SEARCH_LOOKAHEAD_SIZE = CATALOG_SEARCH_PAGE_SIZE + 1');
    expect(client).toContain('CATALOG_SEARCH_LOOKAHEAD_SIZE');
    expect(worker).toContain('CATALOG_SEARCH_LOOKAHEAD_SIZE');
    expect(controller).toContain('planCatalogSearchPage');
    expect(controller).toContain('finishCatalogSearchPage');
    expect(controller).toContain('paginateLocalCatalogResults');
  });

  it('does not treat the former settings field as a total search-result cap', () => {
    expect(controller).not.toContain('settings.searchResultLimit');
    expect(settings).not.toContain('Maximale Suchtreffer');
    expect(settings).toContain('20 Treffer pro Seite');
    expect(calculator).toContain('data-page-size={CATALOG_SEARCH_PAGE_SIZE}');
    expect(calculator).toContain('c.searchPage * CATALOG_SEARCH_PAGE_SIZE + index + 1');
  });

  it('parses compound input once and infers a required portion generically', () => {
    expect(parser).toContain("implicitUnit: 'portion'");
    expect(parser).toContain('requireImplicitUnit: true');
    expect(parser).toContain('export function parseCatalogInputParts');
    expect(controller).toContain('parseCatalogInputParts(input)');
    expect(smartController).toContain('parseCatalogInputParts(input)');
    expect(controller).not.toContain('parseProductList(input)');
    expect(smartController).not.toContain('parseProductList(input)');
  });

  it('keeps missing portions on the shared smart calibration path', () => {
    expect(smartController).toContain('resolveCatalogUnitRuntime(candidate, request, \'smart\')');
    expect(smartController).toContain('pendingSmartUnitItems');
    expect(parser).not.toMatch(/Brötchen|Nutella/);
  });

  it('keeps targeted unit and real browser regressions in package scripts', () => {
    const unit = packageJson.scripts?.['test:semantic-input'] ?? '';
    const browser = packageJson.scripts?.['test:e2e:semantic-input'] ?? '';
    for (const file of [
      'src/app/catalogSearchPagination.test.ts',
      'src/app/queryParser.compoundPortions.test.ts',
      'src/app/compoundPortionResolution.test.ts',
      'scripts/search-pagination-portion.architecture.test.ts'
    ]) expect(unit).toContain(file);
    expect(browser).toContain('e2e/search-pagination.spec.ts');
    expect(browser).toContain('e2e/compound-portion-semantics.spec.ts');
  });
});
