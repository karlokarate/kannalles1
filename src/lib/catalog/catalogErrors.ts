import type {
  CatalogDiagnosticValue,
  CatalogDiagnostics,
  CatalogFailureCode,
  CatalogOperation,
  CatalogSlotId
} from './catalogDomain';

export interface CatalogFailureOptions {
  readonly operation: CatalogOperation;
  readonly technical?: string;
  readonly activeSlot?: CatalogSlotId | null;
  readonly attemptedSlot?: CatalogSlotId | null;
  readonly catalogVersion?: string | null;
  readonly details?: Readonly<Record<string, CatalogDiagnosticValue>>;
  readonly cause?: unknown;
  readonly occurredAt?: string;
}

const SENSITIVE_DETAIL_KEY = /(?:pass(?:word)?|token|secret|authorization|cookie|credential|api[-_]?key|user[-_]?id)/i;
const SENSITIVE_ASSIGNMENT = /((?:pass(?:word)?|token|secret|authorization|cookie|credential|api[-_]?key|user[-_]?id)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

function redactText(value: string): string {
  return value
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(SENSITIVE_ASSIGNMENT, '$1[redacted]');
}

function redactDetails(
  details: Readonly<Record<string, CatalogDiagnosticValue>> | undefined
): Readonly<Record<string, CatalogDiagnosticValue>> {
  if (!details) {
    return {};
  }

  const redacted: Record<string, CatalogDiagnosticValue> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEY.test(key)) {
      continue;
    }
    redacted[key] = typeof value === 'string' ? redactText(value) : value;
  }
  return redacted;
}

function errorTechnical(error: unknown): string {
  if (error instanceof Error) {
    return redactText(`${error.name}: ${error.message}`);
  }
  return redactText(typeof error === 'string' ? error : 'Unknown catalog failure');
}

/** Typed, serializable catalog failure that never exposes raw runtime objects. */
export class CatalogFailure extends Error {
  readonly code: CatalogFailureCode;
  readonly diagnostics: CatalogDiagnostics;

  constructor(code: CatalogFailureCode, message: string, options: CatalogFailureOptions) {
    const safeMessage = redactText(message);
    super(safeMessage);
    this.name = 'CatalogFailure';
    this.code = code;
    this.diagnostics = {
      code,
      operation: options.operation,
      message: safeMessage,
      technical: redactText(options.technical ?? errorTechnical(options.cause)),
      occurredAt: options.occurredAt ?? new Date().toISOString(),
      retryAllowedImmediately: true,
      activeSlot: options.activeSlot ?? null,
      attemptedSlot: options.attemptedSlot ?? null,
      catalogVersion: options.catalogVersion ?? null,
      details: redactDetails(options.details)
    };

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isCatalogFailure(error: unknown): error is CatalogFailure {
  return error instanceof CatalogFailure;
}

export function toCatalogFailure(
  error: unknown,
  code: CatalogFailureCode,
  message: string,
  options: Omit<CatalogFailureOptions, 'cause'>
): CatalogFailure {
  if (isCatalogFailure(error)) {
    return error;
  }
  return new CatalogFailure(code, message, { ...options, cause: error });
}

export function catalogDiagnostics(error: unknown): CatalogDiagnostics | null {
  return isCatalogFailure(error) ? error.diagnostics : null;
}
