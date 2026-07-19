import { describe, expect, it } from 'vitest';
import {
  CATALOG_SEARCH_LOOKAHEAD_SIZE,
  CATALOG_SEARCH_PAGE_SIZE,
  finishCatalogSearchPage,
  paginateLocalCatalogResults,
  planCatalogSearchPage
} from '../lib/catalog/catalogPagination';

function values(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_value, index) => `${prefix}-${index + 1}`);
}

describe('catalog search pagination', () => {
  it('renders exactly twenty results and keeps the twenty-first only as look-ahead', () => {
    const page = paginateLocalCatalogResults(values(45, 'local'), 0);
    expect(page).toEqual({
      page: 0,
      pageSize: 20,
      offset: 0,
      items: values(20, 'local'),
      hasPrevious: false,
      hasNext: true
    });
    expect(CATALOG_SEARCH_PAGE_SIZE).toBe(20);
    expect(CATALOG_SEARCH_LOOKAHEAD_SIZE).toBe(21);
  });

  it('continues with pages two and three instead of capping the visible result set at twenty', () => {
    const source = values(45, 'result');
    const second = paginateLocalCatalogResults(source, 1);
    const third = paginateLocalCatalogResults(source, 2);

    expect(second.items).toEqual(source.slice(20, 40));
    expect(second).toMatchObject({
      page: 1,
      offset: 20,
      hasPrevious: true,
      hasNext: true
    });
    expect(third.items).toEqual(source.slice(40, 45));
    expect(third).toMatchObject({
      page: 2,
      offset: 40,
      hasPrevious: true,
      hasNext: false
    });
  });

  it('continues SQLite offsets after all local-first results', () => {
    const local = values(7, 'local');
    const plan = planCatalogSearchPage(local, 1);
    expect(plan).toMatchObject({
      page: 1,
      offset: 20,
      localLookahead: [],
      sourceOffset: 13,
      sourceLimit: 21
    });

    const sqlite = values(21, 'sqlite-page-2');
    const page = finishCatalogSearchPage(plan, sqlite);
    expect(page.items).toEqual(sqlite.slice(0, 20));
    expect(page.hasNext).toBe(true);
  });

  it('fills a page across the local-to-SQLite boundary without duplicates or gaps', () => {
    const local = values(25, 'local');
    const plan = planCatalogSearchPage(local, 1);
    expect(plan.localLookahead).toEqual(local.slice(20, 25));
    expect(plan.sourceOffset).toBe(0);
    expect(plan.sourceLimit).toBe(16);

    const sqlite = values(16, 'sqlite');
    const page = finishCatalogSearchPage(plan, sqlite);
    expect(page.items).toEqual([
      ...local.slice(20, 25),
      ...sqlite.slice(0, 15)
    ]);
    expect(page.hasNext).toBe(true);
  });

  it('does not expose a phantom next page when exactly twenty results remain', () => {
    const page = paginateLocalCatalogResults(values(40, 'result'), 1);
    expect(page.items).toHaveLength(20);
    expect(page.hasNext).toBe(false);
  });
});
