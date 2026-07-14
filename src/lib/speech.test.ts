import { describe, expect, it, vi } from 'vitest';
import { isAppleMobileSpeechClient, speechRecognitionErrorMessage, startSpeechRecognitionSafely, unavailableSpeechMessage } from './speech';

describe('safe speech recognition startup', () => {
  it('resets listening and reports a synchronous start failure', () => {
    const states: boolean[] = [];
    const error = new DOMException('permission denied', 'NotAllowedError');
    const onError = vi.fn();
    expect(startSpeechRecognitionSafely({ start: () => { throw error; } }, (value) => states.push(value), onError)).toBe(false);
    expect(states).toEqual([true, false]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('detects iPhone and touch-based iPad clients', () => {
    expect(isAppleMobileSpeechClient({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)' })).toBe(true);
    expect(isAppleMobileSpeechClient({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobileSpeechClient({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 })).toBe(false);
  });

  it('provides actionable Safari permission and Siri guidance', () => {
    expect(speechRecognitionErrorMessage('not-allowed', true)).toContain('Website-Einstellungen');
    expect(speechRecognitionErrorMessage('service-not-allowed', true)).toContain('Siri');
    expect(unavailableSpeechMessage(true)).toContain('Diktierfunktion');
  });
});
