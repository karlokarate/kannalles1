import { describe, expect, it } from 'vitest';
import { validateAppVersion } from './public-config.mjs';

describe('public build configuration', () => {
  it('accepts only safe semantic versions', () => {
    expect(validateAppVersion('2.2.4')).toBe('2.2.4');
    expect(validateAppVersion('3.0.0-rc.1')).toBe('3.0.0-rc.1');
    expect(() => validateAppVersion("2.2.4';alert(1)//")).toThrow();
  });
});
