import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AiParseCore } from './ai.mjs';
import { MemoryCoordinator } from './redis-port.mjs';

const responseSchema = z.object({ status: z.literal('parsed') });

describe('AiParseCore', () => {
  it('keeps OpenAI optional and lazy', async () => {
    const clientFactory = vi.fn();
    const core = new AiParseCore({
      env: {},
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory
    });
    await expect(core.parse('100 g Reis')).rejects.toMatchObject({ status: 503, code: 'AI_DISABLED' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('uses responses.parse with developer prompt and output_parsed', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-5.6' },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'developer prompt',
      responseSchema,
      clientFactory: () => ({
        client: { responses: { parse } },
        zodTextFormat: () => ({ type: 'fixture' })
      })
    });
    await expect(core.parse('1234567', { safetyIdentifier: 'kh_fixture' })).resolves.toEqual({ status: 'parsed' });
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6',
      store: false,
      max_output_tokens: 512,
      reasoning: { effort: 'none' },
      safety_identifier: 'kh_fixture',
      input: [
        { role: 'developer', content: 'developer prompt' },
        { role: 'user', content: '1234567' }
      ]
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('uses the cost-efficient GPT-5.6 tier and bounded output by default', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: { OPENAI_API_KEY: 'test', OPENAI_MAX_OUTPUT_TOKENS: '99999', OPENAI_REASONING_EFFORT: 'low' },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({
        client: { responses: { parse } },
        zodTextFormat: () => ({ type: 'fixture' })
      })
    });
    await core.parse('100 g Reis', { safetyIdentifier: 'kh_fixture' });
    expect(parse).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6-luna',
      max_output_tokens: 2_048,
      reasoning: { effort: 'low' }
    }), expect.any(Object));
  });

  it('does not send GPT-5.6-only reasoning controls to an explicitly different model family', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'gpt-4.1' },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({ client: { responses: { parse } }, zodTextFormat: () => ({}) })
    });
    await core.parse('100 g Reis', { safetyIdentifier: 'kh_fixture' });
    expect(parse.mock.calls[0][0]).not.toHaveProperty('reasoning');
  });

  it.each(['', 'too-short-for-production']) (
    'fails closed in production when the safety salt is weak (%j)',
    async (safetySalt) => {
      const clientFactory = vi.fn();
      const core = new AiParseCore({
        env: {
          NODE_ENV: 'production',
          OPENAI_API_KEY: 'paid-key-is-present',
          AI_SAFETY_SALT: safetySalt
        },
        coordinator: new MemoryCoordinator(),
        promptProvider: () => 'prompt',
        responseSchema,
        clientFactory
      });
      expect(core.configured).toBe(false);
      await expect(core.parse('100 g Reis')).rejects.toMatchObject({
        status: 503,
        code: 'AI_SAFETY_CONFIGURATION_REQUIRED'
      });
      expect(clientFactory).not.toHaveBeenCalled();
    }
  );

  it('enables production AI only with an explicit strong safety salt', () => {
    const core = new AiParseCore({
      env: {
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'paid-key-is-present',
        AI_SAFETY_SALT: '0123456789abcdef0123456789abcdef',
        REDIS_URL: 'redis://cache.example:6379'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: vi.fn()
    });
    expect(core.configured).toBe(true);
  });

  it('keeps production AI disabled without a distributed cost budget', async () => {
    const clientFactory = vi.fn();
    const core = new AiParseCore({
      env: {
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'paid-key-is-present',
        AI_SAFETY_SALT: '0123456789abcdef0123456789abcdef'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory
    });
    expect(core.configured).toBe(false);
    expect(core.configuration.reasonCode).toBe('DISTRIBUTED_COORDINATION_REQUIRED');
    await expect(core.parse('100 g Reis')).rejects.toMatchObject({
      status: 503,
      code: 'DISTRIBUTED_COORDINATION_REQUIRED'
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('requires the privacy-safe user budget on every production AI call', async () => {
    const clientFactory = vi.fn();
    const core = new AiParseCore({
      env: {
        NODE_ENV: 'production',
        OPENAI_API_KEY: 'paid-key-is-present',
        AI_SAFETY_SALT: '0123456789abcdef0123456789abcdef',
        REDIS_URL: 'redis://cache.example:6379'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory
    });
    await expect(core.parse('100 g Reis')).rejects.toMatchObject({
      status: 503,
      code: 'AI_SAFETY_IDENTIFIER_REQUIRED'
    });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('distinguishes caller aborts from the absolute deadline', async () => {
    const parse = vi.fn((_body, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const core = new AiParseCore({
      env: { OPENAI_API_KEY: 'test' },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({ client: { responses: { parse } }, zodTextFormat: () => ({}) })
    });
    const controller = new AbortController();
    const aborted = core.parse('caller abort', { signal: controller.signal, deadlineMs: 500 });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ status: 499, code: 'ABORTED' });
    await expect(core.parse('deadline abort', { deadlineMs: 20 }))
      .rejects.toMatchObject({ status: 504, code: 'DEADLINE_EXCEEDED' });
  });

  it('enforces a separate privacy-safe per-user cost budget', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: {
        OPENAI_API_KEY: 'test',
        AI_PARSE_PER_USER_RATE_LIMIT_PER_MINUTE: '1',
        AI_PARSE_GLOBAL_RATE_LIMIT_PER_MINUTE: '10'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({ client: { responses: { parse } }, zodTextFormat: () => ({}) })
    });
    await expect(core.parse('first', { safetyIdentifier: 'kh_user_a' })).resolves.toEqual({ status: 'parsed' });
    await expect(core.parse('second', { safetyIdentifier: 'kh_user_a' }))
      .rejects.toMatchObject({ status: 429, code: 'USER_RATE_LIMIT' });
    await expect(core.parse('other user', { safetyIdentifier: 'kh_user_b' })).resolves.toEqual({ status: 'parsed' });
  });

  it('enforces a rolling 24-hour global paid-AI budget', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: {
        OPENAI_API_KEY: 'test',
        AI_PARSE_GLOBAL_RATE_LIMIT_PER_MINUTE: '10',
        AI_PARSE_GLOBAL_RATE_LIMIT_PER_DAY: '1',
        AI_PARSE_PER_USER_RATE_LIMIT_PER_DAY: '10'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({ client: { responses: { parse } }, zodTextFormat: () => ({}) })
    });
    await expect(core.parse('first', { safetyIdentifier: 'kh_user_a' })).resolves.toEqual({ status: 'parsed' });
    await expect(core.parse('second', { safetyIdentifier: 'kh_user_b' }))
      .rejects.toMatchObject({ status: 429, code: 'DAILY_COST_BUDGET' });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('enforces a rolling 24-hour per-client paid-AI budget', async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { status: 'parsed' } });
    const core = new AiParseCore({
      env: {
        OPENAI_API_KEY: 'test',
        AI_PARSE_GLOBAL_RATE_LIMIT_PER_MINUTE: '10',
        AI_PARSE_GLOBAL_RATE_LIMIT_PER_DAY: '10',
        AI_PARSE_PER_USER_RATE_LIMIT_PER_MINUTE: '10',
        AI_PARSE_PER_USER_RATE_LIMIT_PER_DAY: '1'
      },
      coordinator: new MemoryCoordinator(),
      promptProvider: () => 'prompt',
      responseSchema,
      clientFactory: () => ({ client: { responses: { parse } }, zodTextFormat: () => ({}) })
    });
    await expect(core.parse('first', { safetyIdentifier: 'kh_user_a' })).resolves.toEqual({ status: 'parsed' });
    await expect(core.parse('second', { safetyIdentifier: 'kh_user_a' }))
      .rejects.toMatchObject({ status: 429, code: 'USER_DAILY_COST_BUDGET' });
    await expect(core.parse('other', { safetyIdentifier: 'kh_user_b' })).resolves.toEqual({ status: 'parsed' });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('documents 7-to-14 digit barcode recognition in the canonical prompt', async () => {
    const prompt = await fs.readFile(new URL('../prompts/food-request-parser.v1.md', import.meta.url), 'utf8');
    expect(prompt).toContain('7 to 14 digit barcode');
  });
});
