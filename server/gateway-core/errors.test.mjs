import { describe, expect, it } from 'vitest';
import { MAX_RETRY_AFTER_MS, parseRetryAfter } from './errors.mjs';

describe('Retry-After boundary', () => {
  it('preserves ordinary delta-seconds within the circuit window', () => {
    expect(parseRetryAfter('120')).toBe(120_000);
  });

  it('caps absurd numeric and date values at the 24-hour circuit TTL', () => {
    const now = Date.parse('2026-07-12T00:00:00.000Z');
    expect(parseRetryAfter('9999999999999', now)).toBe(MAX_RETRY_AFTER_MS);
    expect(parseRetryAfter('Fri, 12 Jul 2126 00:00:00 GMT', now)).toBe(MAX_RETRY_AFTER_MS);
  });
});
