import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CatalogFailure } from '../../../src/lib/catalog/catalogErrors';

const suite = JSON.parse(readFileSync(new URL('./acceptance-cases.json', import.meta.url), 'utf8')) as {
  suite: string;
  version: string;
  cases: Array<{ id: string; given: Record<string, unknown>; expect: Record<string, unknown> }>;
};

const requiredIds = [
  'catalog-first-install',
  'catalog-reopen-offline',
  'catalog-corrupt-inactive-update-rolls-back',
  'catalog-no-valid-slot-unavailable',
  'catalog-image-reference-without-url',
  'kinder-bueno-default-single-bar',
  'explicit-unit-never-replaced',
  'group-weighing-derivation',
  'saved-calibration-reused',
  'current-nutrition-replaces-snapshot',
  'calibration-does-not-cross-package-boundary',
  'nutella-not-forced-to-piece'
] as const;

describe('offline hard-cutover acceptance contract', () => {
  it('contains every required case exactly once', () => {
    const ids = suite.cases.map((entry) => entry.id);
    expect(suite.suite).toBe('kh-checker-offline-hard-cutover-acceptance');
    expect(suite.version).toBe('3.1.0');
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...requiredIds].sort());
  });

  it('requires a catalog image key and forbids prebuilt projection URLs', () => {
    const fixture = suite.cases.find((entry) => entry.id === 'catalog-image-reference-without-url');
    expect(fixture?.expect.imageReference).toEqual({
      keyId: 1,
      key: 'front_de',
      revision: 17,
      resolution: 200
    });
    expect(fixture?.expect.prebuiltUrlPresent).toBe(false);
  });

  it('requires zero remote product requests for every catalog availability case', () => {
    const availabilityCases = suite.cases.filter((entry) => entry.id.startsWith('catalog-'));
    for (const entry of availabilityCases) {
      if ('productNetworkRequests' in entry.expect) {
        expect(entry.expect.productNetworkRequests).toBe(0);
      }
    }
  });

  it('represents catalog failures with redacted typed diagnostics and immediate retry', () => {
    const failure = new CatalogFailure('CATALOG_HASH_MISMATCH', 'Katalogprüfung fehlgeschlagen.', {
      operation: 'validate',
      activeSlot: 'a',
      attemptedSlot: 'b',
      rollbackSlot: 'a',
      catalogVersion: '2026-07-13',
      technical: 'sha256 mismatch',
      details: { expectedBytes: 25227264 }
    });

    expect(failure.diagnostics).toMatchObject({
      code: 'CATALOG_HASH_MISMATCH',
      operation: 'validate',
      activeSlot: 'a',
      attemptedSlot: 'b',
      rollbackSlot: 'a',
      retryAllowedImmediately: true
    });
    expect(failure.diagnostics).not.toHaveProperty('password');
    expect(failure.diagnostics).not.toHaveProperty('url');
  });
});
