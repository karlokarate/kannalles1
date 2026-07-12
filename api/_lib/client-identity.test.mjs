import { afterEach, describe, expect, it } from 'vitest';
import { clientBudgetIdentifierForRequest } from './client-identity.js';

const originalSalt = process.env.GATEWAY_CLIENT_SALT;

afterEach(() => {
  if (originalSalt === undefined) delete process.env.GATEWAY_CLIENT_SALT;
  else process.env.GATEWAY_CLIENT_SALT = originalSalt;
});

describe('privacy-safe gateway client budget identity', () => {
  it('HMACs the trusted Express address and ignores spoofed forwarding', () => {
    process.env.GATEWAY_CLIENT_SALT = '0123456789abcdef0123456789abcdef';
    const request = {
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': '198.51.100.77' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    const identifier = clientBudgetIdentifierForRequest(request);
    expect(identifier).toMatch(/^kh_client_[a-f0-9]{32}$/);
    expect(identifier).toBe(clientBudgetIdentifierForRequest({ ...request, headers: {} }));
    expect(identifier).not.toContain('203.0.113.9');
  });

  it('fails closed to no identifier when the salt is weak', () => {
    process.env.GATEWAY_CLIENT_SALT = 'weak';
    expect(clientBudgetIdentifierForRequest({ ip: '203.0.113.9', headers: {}, socket: {} }))
      .toBeUndefined();
  });
});
