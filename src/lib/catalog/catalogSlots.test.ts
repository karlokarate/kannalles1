import { describe, expect, it } from 'vitest';
import { CATALOG_SLOT_FILES, inactiveSlot, parseActivationRecord } from './catalogSlots';

describe('catalog activation record', () => {
  it('uses the exact A/B OPFS filenames', () => {
    expect(CATALOG_SLOT_FILES).toEqual({ a: 'catalog-a.sqlite', b: 'catalog-b.sqlite' });
    expect(inactiveSlot(null)).toBe('a');
    expect(inactiveSlot('a')).toBe('b');
    expect(inactiveSlot('b')).toBe('a');
  });

  it('accepts exactly one valid activation authority record', () => {
    expect(parseActivationRecord({
      activeSlot: 'a',
      catalogVersion: '2026-07-13',
      sha256: 'a'.repeat(64),
      validatedAt: '2026-07-13T19:00:00.000Z',
      previousSlot: null
    })).toMatchObject({ activeSlot: 'a', previousSlot: null });
  });

  it('rejects a previous slot equal to the active slot', () => {
    expect(() => parseActivationRecord({
      activeSlot: 'a',
      catalogVersion: '2026-07-13',
      sha256: 'a'.repeat(64),
      validatedAt: '2026-07-13T19:00:00.000Z',
      previousSlot: 'a'
    })).toThrow(/Aktivierungsdatensatz/);
  });
});
