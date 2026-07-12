import { describe, expect, it, vi } from 'vitest';
import { startSpeechRecognitionSafely } from './speech';

describe('safe speech recognition startup', () => {
  it('resets listening and reports a synchronous start failure', () => {
    const states: boolean[] = [];
    const error = new DOMException('permission denied', 'NotAllowedError');
    const onError = vi.fn();
    const started = startSpeechRecognitionSafely(
      { start: () => { throw error; } },
      (value) => states.push(value),
      onError
    );
    expect(started).toBe(false);
    expect(states).toEqual([true, false]);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
