import type {
  ApiAttemptDiagnostic,
  CalculationResult,
  ParsedFoodRequest,
  SearchHit
} from '../types';

export type SearchView = 'home' | 'candidates' | 'result';
export type SearchOperation = 'search' | 'product' | 'manual' | 'voice' | 'restore';
export type SearchIssueKind = 'error' | 'empty' | 'offline' | 'configuration' | 'unsupported';
export type NonEmptyHits = readonly [SearchHit, ...SearchHit[]];

export interface WorkflowIssue {
  kind: SearchIssueKind;
  title: string;
  message: string;
  technical: string;
  attempts: ApiAttemptDiagnostic[];
  occurredAt: string;
  retryLabel: string;
}

export type SearchActivity =
  | { status: 'idle' }
  | { status: 'pending'; operation: SearchOperation; announcedAt: string }
  | { status: 'empty'; issue: WorkflowIssue }
  | { status: 'failed'; issue: WorkflowIssue };

export type SearchScreen =
  | {
      view: 'home';
      /** Parsed draft during an in-flight request; no result payload can exist here. */
      request: ParsedFoodRequest | null;
    }
  | {
      view: 'candidates';
      request: ParsedFoodRequest;
      hits: NonEmptyHits;
    }
  | {
      view: 'result';
      result: CalculationResult;
      hits: readonly SearchHit[];
    };

export interface SearchWorkflowState {
  screen: SearchScreen;
  activity: SearchActivity;
}

export type SearchWorkflowAction =
  | { type: 'start'; operation: SearchOperation }
  | { type: 'finish' }
  | { type: 'issue'; issue: WorkflowIssue }
  | { type: 'clear-issue' }
  | { type: 'begin-request'; request: ParsedFoodRequest }
  | { type: 'show-home'; request?: ParsedFoodRequest | null }
  | { type: 'show-candidates'; request: ParsedFoodRequest; hits: NonEmptyHits }
  | { type: 'show-result'; result: CalculationResult; hits?: readonly SearchHit[] }
  | { type: 'update-result'; result: CalculationResult }
  | { type: 'reset' };

export function createSearchWorkflowState(): SearchWorkflowState {
  return {
    screen: { view: 'home', request: null },
    activity: { status: 'idle' }
  };
}

export function restoreSearchWorkflowState(input: {
  view?: SearchView;
  request?: ParsedFoodRequest | null;
  hits?: SearchHit[];
  result?: CalculationResult | null;
}): SearchWorkflowState {
  if (input.view === 'result' && input.result) {
    return {
      screen: { view: 'result', result: input.result, hits: input.hits ?? input.result.candidates },
      activity: { status: 'idle' }
    };
  }
  if (input.view === 'candidates' && input.request && input.hits?.length) {
    return {
      screen: {
        view: 'candidates',
        request: input.request,
        hits: input.hits as [SearchHit, ...SearchHit[]]
      },
      activity: { status: 'idle' }
    };
  }
  return {
    screen: { view: 'home', request: input.request ?? null },
    activity: { status: 'idle' }
  };
}

export function searchWorkflowReducer(
  state: SearchWorkflowState,
  action: SearchWorkflowAction
): SearchWorkflowState {
  switch (action.type) {
    case 'start':
      return {
        ...state,
        activity: {
          status: 'pending',
          operation: action.operation,
          announcedAt: new Date().toISOString()
        }
      };
    case 'finish':
      return state.activity.status === 'pending'
        ? { ...state, activity: { status: 'idle' } }
        : state;
    case 'issue':
      return {
        ...state,
        activity: action.issue.kind === 'empty'
          ? { status: 'empty', issue: action.issue }
          : { status: 'failed', issue: action.issue }
      };
    case 'clear-issue':
      return state.activity.status === 'failed' || state.activity.status === 'empty'
        ? { ...state, activity: { status: 'idle' } }
        : state;
    case 'begin-request':
      return { ...state, screen: { view: 'home', request: action.request } };
    case 'show-home':
      return { ...state, screen: { view: 'home', request: action.request ?? null } };
    case 'show-candidates':
      return {
        ...state,
        screen: { view: 'candidates', request: action.request, hits: action.hits }
      };
    case 'show-result':
      return {
        ...state,
        screen: {
          view: 'result',
          result: action.result,
          hits: action.hits ?? action.result.candidates
        }
      };
    case 'update-result':
      return state.screen.view === 'result'
        ? { ...state, screen: { ...state.screen, result: action.result } }
        : state;
    case 'reset':
      return createSearchWorkflowState();
  }
}

export function currentWorkflowIssue(state: SearchWorkflowState): WorkflowIssue | null {
  return state.activity.status === 'failed' || state.activity.status === 'empty'
    ? state.activity.issue
    : null;
}

export function workflowRequest(state: SearchWorkflowState): ParsedFoodRequest | null {
  if (state.screen.view === 'result') return state.screen.result.request;
  return state.screen.request;
}

export function workflowHits(state: SearchWorkflowState): readonly SearchHit[] {
  return state.screen.view === 'home' ? [] : state.screen.hits;
}

export function workflowResult(state: SearchWorkflowState): CalculationResult | null {
  return state.screen.view === 'result' ? state.screen.result : null;
}
