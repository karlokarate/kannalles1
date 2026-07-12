import { describe, expect, it } from 'vitest';
import { createNavigationHistoryState, decodeSessionSnapshot } from './App';

const request = {
  status: 'parsed',
  rawInput: 'Test',
  product: { name: 'Test', brand: null, variant: null },
  amount: { value: 1, unit: 'piece' },
  resolutionMode: 'exact_product',
  barcode: null,
  clarificationQuestion: null,
  parser: 'local'
};

function envelope(value: Record<string, unknown>) {
  return JSON.stringify({ schemaVersion: 3, consent: true, value });
}

describe('versioned session decoder', () => {
  it('keeps browser history payloads free of query, product and result data', () => {
    const state = createNavigationHistoryState('search', 'result', 'navigation-1');
    expect(state).toEqual({ khChecker: true, tab: 'search', view: 'result', entryId: 'navigation-1' });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('"query"');
    expect(serialized).not.toContain('"product"');
    expect(serialized).not.toContain('"hits"');
    expect(serialized).not.toContain('"result":');
  });

  it('downgrades impossible candidate/result snapshots to a safe home state', () => {
    const candidate = decodeSessionSnapshot(envelope({
      tab: 'search', searchView: 'candidates', query: 'Test', manualMode: false,
      manualValues: {}, request: null, hits: [], result: null
    }));
    expect(candidate?.searchView).toBe('home');
    const result = decodeSessionSnapshot(envelope({
      tab: 'search', searchView: 'result', query: 'Test', manualMode: false,
      manualValues: {}, request, hits: [], result: { id: 'corrupt' }
    }));
    expect(result?.searchView).toBe('home');
    expect(result?.result).toBeNull();
  });

  it('keeps valid hits while discarding corrupt entries independently', () => {
    const decoded = decodeSessionSnapshot(envelope({
      tab: 'search', searchView: 'candidates', query: 'Test', manualMode: false,
      manualValues: {}, request, hits: [{ code: '4000000000001' }, { code: 42 }], result: null
    }));
    expect(decoded?.searchView).toBe('candidates');
    expect(decoded?.hits).toEqual([{ code: '4000000000001' }]);
  });

  it('rejects missing consent and unsupported schema versions', () => {
    expect(decodeSessionSnapshot(JSON.stringify({ schemaVersion: 2, consent: true, value: {} }))).toBeNull();
    expect(decodeSessionSnapshot(JSON.stringify({ schemaVersion: 3, consent: false, value: {} }))).toBeNull();
  });
});
