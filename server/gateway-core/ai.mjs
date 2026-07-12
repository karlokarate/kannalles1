import { GatewayError } from './errors.mjs';
import { Deadline } from './resilience.mjs';
import { resolveAiConfiguration } from './ai-config.mjs';

function positiveInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

const GPT_56_REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

function reasoningEffort(value, model) {
  const configured = String(value ?? '').trim().toLocaleLowerCase('en-US');
  if (configured) return GPT_56_REASONING_EFFORTS.has(configured) ? configured : 'none';
  return /^gpt-5\.6(?:-|$)/u.test(model) ? 'none' : '';
}

export class AiParseCore {
  constructor({ env = process.env, coordinator, promptProvider, responseSchema, clientFactory } = {}) {
    this.configuration = resolveAiConfiguration(env);
    this.apiKey = String(env.OPENAI_API_KEY || '').trim();
    this.model = String(env.OPENAI_MODEL || 'gpt-5.6-luna').trim();
    this.maxOutputTokens = positiveInteger(env.OPENAI_MAX_OUTPUT_TOKENS, 512, 256, 2_048);
    this.reasoningEffort = reasoningEffort(env.OPENAI_REASONING_EFFORT, this.model);
    this.deadlineMs = positiveInteger(env.OPENAI_DEADLINE_MS, 12_000, 1_000, 14_000);
    this.rateLimitPerMinute = positiveInteger(
      env.AI_PARSE_GLOBAL_RATE_LIMIT_PER_MINUTE ?? env.AI_PARSE_RATE_LIMIT_PER_MINUTE,
      30,
      1,
      1_000
    );
    this.perUserRateLimitPerMinute = positiveInteger(
      env.AI_PARSE_PER_USER_RATE_LIMIT_PER_MINUTE,
      6,
      1,
      120
    );
    this.dailyRateLimit = positiveInteger(
      env.AI_PARSE_GLOBAL_RATE_LIMIT_PER_DAY,
      300,
      1,
      10_000
    );
    this.perUserDailyRateLimit = positiveInteger(
      env.AI_PARSE_PER_USER_RATE_LIMIT_PER_DAY,
      30,
      1,
      1_000
    );
    this.coordinator = coordinator;
    this.promptProvider = promptProvider;
    this.responseSchema = responseSchema;
    this.clientFactory = clientFactory;
    this.clientPromise = null;
    this.promptPromise = null;
  }

  get configured() {
    return this.configuration.configured;
  }

  async #prompt() {
    this.promptPromise ??= Promise.resolve().then(() => this.promptProvider());
    return this.promptPromise;
  }

  async #client() {
    if (!this.clientPromise) {
      this.clientPromise = this.clientFactory
        ? Promise.resolve().then(() => this.clientFactory({ apiKey: this.apiKey, timeout: this.deadlineMs }))
        : Promise.all([import('openai'), import('openai/helpers/zod')]).then(([openaiModule, helpers]) => ({
            client: new openaiModule.default({
              apiKey: this.apiKey,
              timeout: this.deadlineMs,
              maxRetries: 0
            }),
            zodTextFormat: helpers.zodTextFormat
          }));
    }
    return this.clientPromise;
  }

  async parse(rawInput, options = {}) {
    if (!this.configured) {
      const safetyConfigurationRequired = this.configuration.reasonCode === 'AI_SAFETY_SALT_MISSING_OR_WEAK';
      const distributedCoordinationRequired = this.configuration.reasonCode === 'DISTRIBUTED_COORDINATION_REQUIRED';
      throw new GatewayError(
        safetyConfigurationRequired
          ? 'Der kostenpflichtige KI-Parser ist wegen unvollständiger Safety-Konfiguration deaktiviert.'
          : distributedCoordinationRequired
            ? 'Der kostenpflichtige KI-Parser benötigt verteilte Produktionskoordination.'
          : 'OpenAI ist auf diesem Gateway nicht konfiguriert.',
        {
          status: 503,
          code: safetyConfigurationRequired
            ? 'AI_SAFETY_CONFIGURATION_REQUIRED'
            : distributedCoordinationRequired
              ? 'DISTRIBUTED_COORDINATION_REQUIRED'
              : 'AI_DISABLED'
        }
      );
    }
    if (this.configuration.production && !options.safetyIdentifier) {
      throw new GatewayError('Für den kostenpflichtigen KI-Parser konnte kein sicheres Nutzerbudget gebildet werden.', {
        status: 503,
        code: 'AI_SAFETY_IDENTIFIER_REQUIRED'
      });
    }
    const input = String(rawInput || '').trim();
    if (!input || input.length > 200) {
      throw new GatewayError('Eingabe muss 1 bis 200 Zeichen lang sein.', {
        status: 400,
        code: 'INVALID_AI_INPUT'
      });
    }
    if (options.safetyIdentifier) {
      const userRate = await this.coordinator.takeToken(
        `ai-parse:user:${options.safetyIdentifier}`,
        this.perUserRateLimitPerMinute,
        60_000
      );
      if (!userRate.allowed) {
        throw new GatewayError('Zu viele KI-Anfragen. Bitte später erneut versuchen.', {
          status: 429,
          retryAt: Date.now() + userRate.retryAfterMs,
          code: 'USER_RATE_LIMIT'
        });
      }
      const userDailyRate = await this.coordinator.takeToken(
        `ai-parse:user-24h:${options.safetyIdentifier}`,
        this.perUserDailyRateLimit,
        24 * 60 * 60_000
      );
      if (!userDailyRate.allowed) {
        throw new GatewayError('Das tägliche KI-Kostenbudget dieses Clients ist ausgeschöpft.', {
          status: 429,
          retryAt: Date.now() + userDailyRate.retryAfterMs,
          code: 'USER_DAILY_COST_BUDGET'
        });
      }
    }
    const rate = await this.coordinator.takeToken('ai-parse:global', this.rateLimitPerMinute, 60_000);
    if (!rate.allowed) {
      throw new GatewayError('Zu viele KI-Anfragen. Bitte später erneut versuchen.', {
        status: 429,
        retryAt: Date.now() + rate.retryAfterMs,
        code: 'LOCAL_RATE_LIMIT'
      });
    }
    const dailyRate = await this.coordinator.takeToken(
      'ai-parse:global-24h',
      this.dailyRateLimit,
      24 * 60 * 60_000
    );
    if (!dailyRate.allowed) {
      throw new GatewayError('Das tägliche globale KI-Kostenbudget ist ausgeschöpft.', {
        status: 429,
        retryAt: Date.now() + dailyRate.retryAfterMs,
        code: 'DAILY_COST_BUDGET'
      });
    }

    const deadline = new Deadline(options.deadlineMs ?? this.deadlineMs, { signal: options.signal });
    const controller = new AbortController();
    let callerAborted = false;
    let deadlineTimedOut = false;
    const abortFromCaller = () => {
      callerAborted = true;
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => {
        deadlineTimedOut = true;
        controller.abort(new DOMException('Timeout', 'TimeoutError'));
      },
      Math.max(1, deadline.remaining())
    );
    try {
      const [{ client, zodTextFormat }, prompt] = await Promise.all([this.#client(), this.#prompt()]);
      deadline.throwIfExpired();
      const response = await client.responses.parse({
        model: this.model,
        store: false,
        max_output_tokens: this.maxOutputTokens,
        ...(this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {}),
        ...(options.safetyIdentifier ? { safety_identifier: options.safetyIdentifier } : {}),
        input: [
          { role: 'developer', content: prompt },
          { role: 'user', content: input }
        ],
        text: {
          format: zodTextFormat(this.responseSchema, 'food_request')
        }
      }, {
        signal: controller.signal,
        timeout: deadline.remaining()
      });
      if (!response.output_parsed) {
        throw new GatewayError('OpenAI lieferte kein strukturiertes Ergebnis.', {
          status: 502,
          code: 'AI_EMPTY_RESPONSE'
        });
      }
      return this.responseSchema.parse(response.output_parsed);
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      if (callerAborted) {
        throw new GatewayError('Die Anfrage wurde abgebrochen.', {
          status: 499,
          code: 'ABORTED',
          cause: error
        });
      }
      const timedOut = deadlineTimedOut || deadline.remaining() <= 0;
      throw new GatewayError(
        timedOut ? 'OpenAI-Parsing hat die Gesamtdeadline überschritten.' : 'OpenAI-Parsing fehlgeschlagen.',
        {
          status: timedOut ? 504 : 502,
          code: timedOut ? 'DEADLINE_EXCEEDED' : 'AI_UPSTREAM_ERROR',
          cause: error
        }
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
