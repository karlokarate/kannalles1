import type { CatalogProductRecord } from './catalog/catalogProtocol';

export type CatalogSearchOutcome =
  | 'resolved'
  | 'needs_product_choice'
  | 'needs_unit_calibration'
  | 'not_found'
  | 'temporarily_unavailable';

export type CatalogSearchPhase = 'idle' | 'searching' | CatalogSearchOutcome;

export interface CatalogIssue {
  kind: 'catalog' | 'query' | 'calibration';
  title: string;
  message: string;
  technical: string;
  occurredAt: string;
  retryAllowedImmediately: true;
}

export interface CatalogSearchState {
  phase: CatalogSearchPhase;
  query: string;
  candidates: readonly CatalogProductRecord[];
  selectedProduct: CatalogProductRecord | null;
  issue: CatalogIssue | null;
  requestStartedAt: string | null;
}

export type CatalogSearchAction =
  | { type: 'start'; query: string }
  | { type: 'resolve'; query: string; product: CatalogProductRecord }
  | { type: 'choose'; query: string; candidates: readonly CatalogProductRecord[] }
  | { type: 'select'; product: CatalogProductRecord }
  | { type: 'needs-calibration'; product: CatalogProductRecord; issue: CatalogIssue }
  | { type: 'not-found'; query: string; issue: CatalogIssue }
  | { type: 'failed'; query: string; issue: CatalogIssue }
  | { type: 'clear-issue' }
  | { type: 'reset' };

export function createCatalogSearchState(): CatalogSearchState {
  return {
    phase: 'idle',
    query: '',
    candidates: [],
    selectedProduct: null,
    issue: null,
    requestStartedAt: null
  };
}

export function catalogSearchReducer(
  state: CatalogSearchState,
  action: CatalogSearchAction
): CatalogSearchState {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        phase: 'searching',
        query: action.query,
        candidates: [],
        selectedProduct: null,
        issue: null,
        requestStartedAt: new Date().toISOString()
      };
    case 'resolve':
      return {
        ...state,
        phase: 'resolved',
        query: action.query,
        candidates: [action.product],
        selectedProduct: action.product,
        issue: null,
        requestStartedAt: null
      };
    case 'choose':
      return {
        ...state,
        phase: 'needs_product_choice',
        query: action.query,
        candidates: action.candidates,
        selectedProduct: null,
        issue: null,
        requestStartedAt: null
      };
    case 'select':
      return {
        ...state,
        phase: 'resolved',
        selectedProduct: action.product,
        issue: null,
        requestStartedAt: null
      };
    case 'needs-calibration':
      return {
        ...state,
        phase: 'needs_unit_calibration',
        selectedProduct: action.product,
        issue: action.issue,
        requestStartedAt: null
      };
    case 'not-found':
      return {
        ...state,
        phase: 'not_found',
        query: action.query,
        candidates: [],
        selectedProduct: null,
        issue: action.issue,
        requestStartedAt: null
      };
    case 'failed':
      return {
        ...state,
        phase: 'temporarily_unavailable',
        query: action.query,
        candidates: [],
        selectedProduct: null,
        issue: action.issue,
        requestStartedAt: null
      };
    case 'clear-issue':
      return { ...state, issue: null };
    case 'reset':
      return createCatalogSearchState();
  }
}

export function createCatalogIssue(
  kind: CatalogIssue['kind'],
  title: string,
  message: string,
  technical: string
): CatalogIssue {
  return {
    kind,
    title,
    message,
    technical,
    occurredAt: new Date().toISOString(),
    retryAllowedImmediately: true
  };
}
