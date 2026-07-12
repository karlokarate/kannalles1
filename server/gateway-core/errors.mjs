export class GatewayError extends Error {
  constructor(message, { status, attempts, retryAt, code, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GatewayError';
    this.status = Number.isInteger(status) ? status : undefined;
    this.attempts = Array.isArray(attempts) ? attempts : [];
    this.retryAt = Number.isFinite(Number(retryAt)) ? Number(retryAt) : undefined;
    this.code = code;
  }
}

export class DeadlineExceededError extends GatewayError {
  constructor(message = 'Die Gateway-Gesamtdeadline wurde überschritten.', options = {}) {
    super(message, { ...options, status: options.status ?? 504, code: 'DEADLINE_EXCEEDED' });
    this.name = 'DeadlineExceededError';
  }
}

export function errorName(error) {
  return error instanceof Error ? error.name || 'Error' : typeof error;
}

export function errorMessage(error) {
  return error instanceof Error ? error.message || String(error) : String(error);
}

export function cleanPreview(value, maxLength = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1_000;

export function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.round(seconds * 1_000));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - now))
    : null;
}

export function isTransientGatewayError(error) {
  if (!(error instanceof GatewayError)) return true;
  if (['DEADLINE_EXCEEDED', 'NETWORK_ERROR', 'INVALID_JSON'].includes(error.code)) return true;
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(error.status));
}

export function fallbackReasonForError(error) {
  const outcomes = error instanceof GatewayError ? error.attempts.map((attempt) => attempt.outcome) : [];
  if (outcomes.includes('rate-limit') || Number(error?.status) === 429) return 'rate-limit';
  if (outcomes.includes('timeout') || error?.code === 'DEADLINE_EXCEEDED') return 'timeout';
  if (outcomes.includes('parse-error') || error?.code === 'INVALID_JSON') return 'parse';
  if (outcomes.includes('network-error') || error?.code === 'NETWORK_ERROR') return 'network';
  return 'http';
}
