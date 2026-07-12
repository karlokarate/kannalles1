import { describe, expect, it } from 'vitest';
import { validateDeploymentProfile } from './deployment-profile.mjs';

describe('deployment profiles', () => {
  it('accepts a public HTTPS gateway only for full-app', () => {
    expect(validateDeploymentProfile('full-app', 'https://gateway.example.test/base/')).toEqual({
      profile: 'full-app',
      gatewayUrl: 'https://gateway.example.test/base'
    });
  });

  it.each([
    '',
    'http://gateway.example.test',
    'https://user:secret@gateway.example.test',
    'https://gateway.example.test?token=secret',
    'https://localhost'
  ])('rejects an unsafe or missing full-app gateway: %s', (gateway) => {
    expect(() => validateDeploymentProfile('full-app', gateway)).toThrow();
  });

  it('keeps manual-only explicit and gateway-free', () => {
    expect(validateDeploymentProfile('manual-only')).toEqual({ profile: 'manual-only', gatewayUrl: '' });
    expect(() => validateDeploymentProfile('manual-only', 'https://gateway.example.test')).toThrow();
  });
});
