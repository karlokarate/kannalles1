import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFoodRequestWithAi } from './aiClient';

afterEach(() => vi.unstubAllGlobals());

describe('offline parser adapter', () => {
  it('uses the deterministic local parser without issuing a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const parsed = await parseFoodRequestWithAi('2 Riegel Kinder Bueno', 'https://retired.example/');
    expect(parsed.parser).toBe('local');
    expect(parsed.rawInput).toBe('2 Riegel Kinder Bueno');
    expect(parsed.amount).toMatchObject({ value: 2, unit: 'bar', valueExplicit: true, unitExplicit: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves local barcode evidence', async () => {
    const parsed = await parseFoodRequestWithAi('EAN (3017.6204.2200.3)', '');
    expect(parsed.barcode).toBe('3017620422003');
    expect(parsed.resolutionMode).toBe('barcode');
  });

  it('keeps local validation for nonpositive amounts', async () => {
    const parsed = await parseFoodRequestWithAi('0g Apfel', '');
    expect(parsed.status).toBe('needs_clarification');
    expect(parsed.clarificationQuestion).toMatch(/größer als 0/);
  });

  it('honours an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Abgebrochen', 'AbortError'));
    await expect(parseFoodRequestWithAi('Apfel', '', controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    });
  });
});
