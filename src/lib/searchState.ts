import type {
  CatalogDiagnostics,
  CatalogProduct,
  CatalogSearchHit
} from './catalog/catalogDomain';
import type { CatalogInputIntent } from './input/catalogInput';

export type CatalogSearchPhase =
  | 'idle'
  | 'searching'
  | 'needs_product_choice'
  | 'resolved'
  | 'needs_unit_calibration'
  | 'not_found'
  | 'temporarily_unavailable';

export interface CatalogSearchState {
  phase: CatalogSearchPhase;
  query: string;
  /** Original parsed amount/unit semantics for the active user search. */
  input: CatalogInputIntent | null;
  candidates: readonly CatalogSearchHit[];
  selectedProduct: CatalogProduct | null;
  diagnostics: CatalogDiagnostics | null;
  validationMessage: string | null;
  requestStartedAt: string | null;
}

export type CatalogSearchAction =
  | { type: 'start'; query: string; input: CatalogInputIntent }
  | { type: 'show-choice'; query: string; candidates: readonly CatalogSearchHit[] }
  | {
      type: 'resolve';
      query: string;
      product: CatalogProduct;
      candidates?: readonly CatalogSearchHit[];
      /** `null` explicitly marks a programmatic resolution without user input. */
      input: CatalogInputIntent | null;
    }
  | { type: 'needs-calibration'; product: CatalogProduct }
  | { type: 'not-found'; query: string }
  | { type: 'failed'; query: string; diagnostics: CatalogDiagnostics }
  | { type: 'validation'; message: string }
  | { type: 'clear-message' }
  | { type: 'reset' };

export function createCatalogSearchState(): CatalogSearchState {
  return {
    phase: 'idle',
    query: '',
    input: null,
    candidates: [],
    selectedProduct: null,
    diagnostics: null,
    validationMessage: null,
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
        input: action.input,
        candidates: [],
        selectedProduct: null,
        diagnostics: null,
        validationMessage: null,
        requestStartedAt: new Date().toISOString()
      };
    case 'show-choice':
      return {
        ...state,
        phase: 'needs_product_choice',
        query: action.query,
        candidates: action.candidates,
        selectedProduct: null,
        diagnostics: null,
        validationMessage: null,
        requestStartedAt: null
      };
    case 'resolve':
      return {
        ...state,
        phase: 'resolved',
        query: action.query,
        input: action.input,
        candidates: action.candidates ?? state.candidates,
        selectedProduct: action.product,
        diagnostics: null,
        validationMessage: null,
        requestStartedAt: null
      };
    case 'needs-calibration':
      return {
        ...state,
        phase: 'needs_unit_calibration',
        selectedProduct: action.product,
        diagnostics: null,
        validationMessage: null,
        requestStartedAt: null
      };
    case 'not-found':
      return {
        ...state,
        phase: 'not_found',
        query: action.query,
        candidates: [],
        selectedProduct: null,
        diagnostics: null,
        validationMessage: null,
        requestStartedAt: null
      };
    case 'failed':
      return {
        ...state,
        phase: 'temporarily_unavailable',
        query: action.query,
        candidates: [],
        selectedProduct: null,
        diagnostics: action.diagnostics,
        validationMessage: null,
        requestStartedAt: null
      };
    case 'validation':
      return {
        ...state,
        validationMessage: action.message,
        diagnostics: null,
        requestStartedAt: null,
        phase: state.selectedProduct ? state.phase : 'idle'
      };
    case 'clear-message':
      return { ...state, diagnostics: null, validationMessage: null };
    case 'reset':
      return createCatalogSearchState();
  }
}
