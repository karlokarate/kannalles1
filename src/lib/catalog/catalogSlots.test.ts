import { describe, expect, it } from 'vitest';
import type { CatalogManifest } from './catalogProtocol';
import {
  activateCatalogSlot,
  catalogSlotDatabasePath,
  emptyCatalogSlotState,
  inactiveCatalogSlot,
  recordValidatedCatalogSlot,
  rollbackCatalogSlot,
  slotMetadataFromManifest
} from './catalogSlots';

const manifest: CatalogManifest = {
  contract: 'kh-checker-offline-catalog-production',
  contractVersion: '1.0.0',
  catalogVersion: '2026-07-13',
  generatedAtUtc: '2026-07-13T15:57:52.861271+00:00',
  filename: 'kh-checker-dach-v1.sqlite',
  sizeBytes: 12,
  sha256: 'a'.repeat(64),
  applicationId: 1263027011,
  userVersion: 1,
  pageSize: 4096,
  productCount: 317579,
  brandCount: 60682,
  codecFile: 'catalog-codecs.v1.json',
  runtimeTypescript: 'catalog-runtime.generated.ts',
  imageResolution: 200,
  imageDictionaryFile: 'catalog-image-keys.v2.json',
  imageDictionarySha256: 'b'.repeat(64),
  transportCompression: null,
  searchOrdering: 'exact display-name match, display-name prefix, display-name contains, then r DESC, n COLLATE NOCASE ASC, id ASC',
  resultLimitDefault: 20
};

describe('catalog A/B slot state', () => {
  it('selects the inactive slot and preserves the manifest filename inside each isolated pool', () => {
    expect(inactiveCatalogSlot(null)).toBe('a');
    expect(inactiveCatalogSlot('a')).toBe('b');
    expect(catalogSlotDatabasePath(manifest.filename)).toBe('/kh-checker-dach-v1.sqlite');
  });

  it('atomically activates a validated slot while retaining the previous active slot for rollback', () => {
    const a = slotMetadataFromManifest('a', manifest, '2026-07-13T18:00:00.000Z');
    const b = slotMetadataFromManifest('b', { ...manifest, catalogVersion: '2026-07-14', sha256: 'c'.repeat(64) }, '2026-07-14T18:00:00.000Z');
    let state = recordValidatedCatalogSlot(emptyCatalogSlotState(), a);
    state = activateCatalogSlot(state, 'a');
    state = recordValidatedCatalogSlot(state, b);
    state = activateCatalogSlot(state, 'b');
    expect(state.activeSlot).toBe('b');
    expect(state.rollbackSlot).toBe('a');
    expect(state.slots.a).toEqual(a);
  });

  it('rolls back to the preserved slot and invalidates the failed active slot', () => {
    const a = slotMetadataFromManifest('a', manifest, '2026-07-13T18:00:00.000Z');
    const b = slotMetadataFromManifest('b', { ...manifest, catalogVersion: '2026-07-14', sha256: 'c'.repeat(64) }, '2026-07-14T18:00:00.000Z');
    let state = recordValidatedCatalogSlot(emptyCatalogSlotState(), a);
    state = activateCatalogSlot(state, 'a');
    state = activateCatalogSlot(recordValidatedCatalogSlot(state, b), 'b');
    const rolledBack = rollbackCatalogSlot(state);
    expect(rolledBack.activeSlot).toBe('a');
    expect(rolledBack.rollbackSlot).toBeNull();
    expect(rolledBack.slots.b).toBeNull();
  });
});
