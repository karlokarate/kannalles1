import { afterEach, describe, expect, it } from 'vitest';
import { aiParseHandler, safetyIdentifierForRequest } from './ai-handler.js';

const originalSalt = process.env.AI_SAFETY_SALT;
const originalNodeEnv = process.env.NODE_ENV;
const originalApiKey = process.env.OPENAI_API_KEY;
const originalRedisUrl = process.env.REDIS_URL;
const originalSingleInstanceOverride = process.env.ALLOW_SINGLE_INSTANCE_COORDINATION;

afterEach(() => {
  if (originalSalt === undefined) delete process.env.AI_SAFETY_SALT;
  else process.env.AI_SAFETY_SALT = originalSalt;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
  if (originalSingleInstanceOverride === undefined) delete process.env.ALLOW_SINGLE_INSTANCE_COORDINATION;
  else process.env.ALLOW_SINGLE_INSTANCE_COORDINATION = originalSingleInstanceOverride;
});

describe('AI safety identifier', () => {
  it('HMACs the normalized client address and never returns the raw IP', () => {
    process.env.AI_SAFETY_SALT = 'test-only-secret-salt';
    const first = safetyIdentifierForRequest({
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': '198.51.100.77, 10.0.0.1' },
      socket: {}
    });
    const second = safetyIdentifierForRequest({
      ip: '203.0.113.9',
      headers: {},
      socket: {}
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^kh_[a-f0-9]{32}$/);
    expect(first).not.toContain('203.0.113.9');
  });

  it('omits the identifier when no private salt is configured', () => {
    delete process.env.AI_SAFETY_SALT;
    expect(safetyIdentifierForRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }))
      .toBeUndefined();
  });

  it('refuses a weak production salt instead of creating an enumerable user bucket', () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_SAFETY_SALT = 'weak';
    expect(safetyIdentifierForRequest({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    })).toBeUndefined();
  });

  it('rejects a no-Origin paid request before any upstream call when production salt is missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'paid-key-is-present';
    delete process.env.AI_SAFETY_SALT;
    const res = {
      headers: new Map(),
      statusCode: 200,
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; }
    };
    await aiParseHandler({
      method: 'POST',
      url: '/api/v1/ai/parse',
      headers: { host: 'gateway.example' },
      socket: { remoteAddress: '203.0.113.9' },
      body: { input: '100 g Reis' }
    }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/AI_SAFETY_SALT/i);
  });

  it('rejects paid production AI when no distributed cost budget is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'paid-key-is-present';
    process.env.AI_SAFETY_SALT = '0123456789abcdef0123456789abcdef';
    delete process.env.REDIS_URL;
    delete process.env.ALLOW_SINGLE_INSTANCE_COORDINATION;
    const res = {
      headers: new Map(),
      statusCode: 200,
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; }
    };
    await aiParseHandler({
      method: 'POST',
      url: '/api/v1/ai/parse',
      headers: { host: 'gateway.example' },
      socket: { remoteAddress: '203.0.113.9' },
      body: { input: '100 g Reis' }
    }, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/Redis/i);
  });

  it('ignores spoofed forwarding headers outside a trusted proxy context', () => {
    process.env.AI_SAFETY_SALT = 'test-only-secret-salt';
    const withSpoof = safetyIdentifierForRequest({
      headers: { 'x-forwarded-for': '198.51.100.99' },
      socket: { remoteAddress: '127.0.0.1' }
    });
    const withoutSpoof = safetyIdentifierForRequest({
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    });
    expect(withSpoof).toBe(withoutSpoof);
  });

  it('does not allow wildcard CORS to expose a configured paid AI parser', async () => {
    const previousOrigins = process.env.CORS_ORIGINS;
    const previousKey = process.env.OPENAI_API_KEY;
    process.env.CORS_ORIGINS = '*';
    process.env.OPENAI_API_KEY = 'configured-for-cors-test';
    const res = {
      headers: new Map(),
      statusCode: 200,
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)); },
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
      end() { return this; }
    };
    try {
      await aiParseHandler({
        method: 'POST',
        url: '/api/v1/ai/parse',
        headers: {
          host: 'gateway.example',
          origin: 'https://attacker.example',
          'x-forwarded-proto': 'https'
        },
        socket: {},
        body: { input: '100 g Reis' }
      }, res);
      expect(res.statusCode).toBe(403);
      expect(res.headers.has('access-control-allow-origin')).toBe(false);
      expect(res.body.traceId).toEqual(expect.any(String));
    } finally {
      if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = previousOrigins;
      if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousKey;
    }
  });
});
