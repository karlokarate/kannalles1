import { describe, expect, it } from 'vitest';
import type { CalculationResult, ParsedFoodRequest } from '../types';
import {
  createSearchWorkflowState,
  currentWorkflowIssue,
  restoreSearchWorkflowState,
  searchWorkflowReducer
} from './searchState';

const request = {
  status: 'parsed',
  rawInput: 'Test',
  product: { name: 'Test', brand: null, variant: null },
  amount: { value: 1, unit: 'piece' },
  resolutionMode: 'exact_product',
  barcode: null,
  clarificationQuestion: null,
  parser: 'local'
} satisfies ParsedFoodRequest;

describe('typed search/result state machine', () => {
  it('uses atomic candidate transitions with a non-empty tuple', () => {
    let state = searchWorkflowReducer(createSearchWorkflowState(), { type: 'start', operation: 'search' });
    state = searchWorkflowReducer(state, {
      type: 'show-candidates',
      request,
      hits: [{ code: '1' }]
    });
    state = searchWorkflowReducer(state, { type: 'finish' });
    expect(state).toMatchObject({ screen: { view: 'candidates', hits: [{ code: '1' }] }, activity: { status: 'idle' } });
  });

  it('never restores result/candidate views without their required payload', () => {
    expect(restoreSearchWorkflowState({ view: 'result', result: null }).screen.view).toBe('home');
    expect(restoreSearchWorkflowState({ view: 'candidates', request, hits: [] }).screen.view).toBe('home');
  });

  it('updates a result only while the result screen exists', () => {
    const fake = { id: 'result' } as CalculationResult;
    const home = searchWorkflowReducer(createSearchWorkflowState(), { type: 'update-result', result: fake });
    expect(home.screen.view).toBe('home');
    const result = searchWorkflowReducer(home, { type: 'show-result', result: fake });
    expect(result.screen.view).toBe('result');
  });

  it('represents configuration states explicitly and can recover', () => {
    const issue = {
      kind: 'configuration' as const,
      title: 'Gateway fehlt',
      message: 'Konfigurieren',
      technical: 'missing',
      attempts: [],
      occurredAt: new Date().toISOString(),
      retryLabel: 'Prüfen'
    };
    let state = searchWorkflowReducer(createSearchWorkflowState(), { type: 'issue', issue });
    expect(currentWorkflowIssue(state)?.kind).toBe('configuration');
    state = searchWorkflowReducer(state, { type: 'clear-issue' });
    expect(state.activity.status).toBe('idle');
  });
});
