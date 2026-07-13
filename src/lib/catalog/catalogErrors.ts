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

function errorTechnical(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return typeof error === 'string' ? error : 'Unknown catalog failure';
}

/** Typed, serializable catalog failure that never exposes raw runtime objects. */
export class CatalogFailure extends Error {
  readonly code: CatalogFailureCode;
  readonly diagnostics: CatalogDiagnostics;

  constructor(code: CatalogFailureCode, message: string, options: CatalogFailureOptions) {
    super(message);
    this.name = 'CatalogFailure';
    this.code = code;
    this.diagnostics = {
      code,
      operation: options.operation,
      message,
      technical: options.technical ?? errorTechnical(options.cause),
      occurredAt: options.occurredAt ?? new Date().toISOString(),
      retryAllowedImmediately: true,
      activeSlot: options.activeSlot ?? null,
      attemptedSlot: options.attemptedSlot ?? null,
      catalogVersion: options.catalogVersion ?? null,
      details: options.details ?? {}
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
