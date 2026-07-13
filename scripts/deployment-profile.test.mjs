import { describe, expect, it } from 'vitest';
import { validateDeploymentProfile } from './deployment-profile.mjs';

describe('deployment profiles', () => {
  it('accepts a public HTTPS gateway only for the gateway lane', () => {
    expect(validateDeploymentProfile('gateway', 'https://gateway.example.test/base/')).toEqual({
      profile: 'gateway',
      gatewayUrl: 'https://gateway.example.test/base'
    });
  });

  it.each([
    '',
    'http://gateway.example.test',
    'https://user:secret@gateway.example.test',
    'https://gateway.example.test?token=secret',
    'https://localhost'
  ])('rejects an unsafe or missing gateway-lane endpoint: %s', (gateway) => {
    expect(() => validateDeploymentProfile('gateway', gateway)).toThrow();
  });

  it('keeps direct-pages explicit and gateway-free', () => {
    expect(validateDeploymentProfile('direct-pages')).toEqual({ profile: 'direct-pages', gatewayUrl: '' });
    expect(() => validateDeploymentProfile('direct-pages', 'https://gateway.example.test')).toThrow();
  });
});
