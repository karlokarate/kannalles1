import { describe, expect, it } from 'vitest';
import { queryFingerprint } from './normalization.mjs';

function legacyFNV1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

describe('opaque query fingerprints', () => {
  it('separates a known equal-length FNV-1a collision', () => {
    const first = '003pwu';
    const second = '00a5fa';
    expect(`${first.length}-${legacyFNV1a(first)}`).toBe(`${second.length}-${legacyFNV1a(second)}`);
    expect(queryFingerprint(first)).not.toBe(queryFingerprint(second));
  });

  it('does not expose the canonical query in the fingerprint', () => {
    const query = 'Sensitive meal query';
    const fingerprint = queryFingerprint(query);
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(fingerprint.toLocaleLowerCase('de-DE')).not.toContain('sensitive');
  });
});
