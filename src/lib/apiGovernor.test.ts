import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearApiGovernor,
  getApiUsageSnapshot,
  parseRetryAfter,
  recordApiRequest,
  recordApiResponse
} from './apiGovernor';

beforeEach(() => clearApiGovernor());
afterEach(() => clearApiGovernor());

describe('non-blocking API telemetry', () => {
  it('records public-search usage without creating a local lock', () => {
    const start = 1_700_000_000_000;
    for (let index = 0; index < 12; index += 1) {
      expect(() => recordApiRequest('search', start + index * 100)).not.toThrow();
    }

    const snapshot = getApiUsageSnapshot(start + 1_200);
    expect(snapshot.search.used).toBe(12);
    expect(snapshot.search).not.toHaveProperty('limit');
    expect(snapshot.search).not.toHaveProperty('remaining');
    expect(snapshot.search.blocking).toBe(false);

    expect(() => recordApiRequest('search', start + 1_300)).not.toThrow();
    expect(getApiUsageSnapshot(start + 1_301).search.used).toBe(13);
  });

  it('keeps a server Retry-After value as diagnostics only', () => {
    const start = 1_700_000_000_000;
    recordApiResponse('product', 503, 12_000, start);

    const snapshot = getApiUsageSnapshot(start + 1_000);
    expect(snapshot.product.lastStatus).toBe(503);
    expect(snapshot.product.retryAfterMs).toBe(11_000);
    expect(snapshot.product.blocking).toBe(false);
    expect(() => recordApiRequest('product', start + 1_000)).not.toThrow();
  });

  it('prunes request timestamps after the rolling one-minute window', () => {
    const start = 1_700_000_000_000;
    recordApiRequest('search', start);
    recordApiRequest('search', start + 1_000);

    expect(getApiUsageSnapshot(start + 59_999).search.used).toBe(2);
    expect(getApiUsageSnapshot(start + 60_001).search.used).toBe(1);
    expect(getApiUsageSnapshot(start + 61_001).search.used).toBe(0);
  });

  it('parses Retry-After in seconds and HTTP-date format', () => {
    const start = Date.parse('2026-07-10T10:00:00Z');
    expect(parseRetryAfter('15', start)).toBe(15_000);
    expect(parseRetryAfter('Fri, 10 Jul 2026 10:00:20 GMT', start)).toBe(20_000);
    expect(parseRetryAfter('invalid', start)).toBeNull();
  });
});
