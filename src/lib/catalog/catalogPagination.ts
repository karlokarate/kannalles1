export const CATALOG_SEARCH_PAGE_SIZE = 20;
export const CATALOG_SEARCH_LOOKAHEAD_SIZE = CATALOG_SEARCH_PAGE_SIZE + 1;

export interface CatalogSearchPagePlan<T> {
  readonly page: number;
  readonly offset: number;
  readonly localLookahead: readonly T[];
  readonly sourceOffset: number;
  readonly sourceLimit: number;
}

export interface CatalogSearchPage<T> {
  readonly page: number;
  readonly pageSize: typeof CATALOG_SEARCH_PAGE_SIZE;
  readonly offset: number;
  readonly items: readonly T[];
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * Plans a stable page across local-first results followed by SQLite results.
 * Twenty entries are displayable; the twenty-first entry is fetched only as a
 * look-ahead sentinel and is never rendered on the current page.
 */
export function planCatalogSearchPage<T>(
  localResults: readonly T[],
  requestedPage: number
): CatalogSearchPagePlan<T> {
  const page = Math.max(0, Math.trunc(requestedPage));
  const offset = page * CATALOG_SEARCH_PAGE_SIZE;
  const localLookahead = localResults.slice(
    offset,
    offset + CATALOG_SEARCH_LOOKAHEAD_SIZE
  );
  return {
    page,
    offset,
    localLookahead,
    sourceOffset: Math.max(0, offset - localResults.length),
    sourceLimit: Math.max(
      0,
      CATALOG_SEARCH_LOOKAHEAD_SIZE - localLookahead.length
    )
  };
}

export function finishCatalogSearchPage<T>(
  plan: CatalogSearchPagePlan<T>,
  sourceResults: readonly T[]
): CatalogSearchPage<T> {
  const combined = [...plan.localLookahead, ...sourceResults];
  return {
    page: plan.page,
    pageSize: CATALOG_SEARCH_PAGE_SIZE,
    offset: plan.offset,
    items: combined.slice(0, CATALOG_SEARCH_PAGE_SIZE),
    hasPrevious: plan.page > 0,
    hasNext: combined.length > CATALOG_SEARCH_PAGE_SIZE
  };
}

export function paginateLocalCatalogResults<T>(
  results: readonly T[],
  requestedPage: number
): CatalogSearchPage<T> {
  return finishCatalogSearchPage(
    planCatalogSearchPage(results, requestedPage),
    []
  );
}
