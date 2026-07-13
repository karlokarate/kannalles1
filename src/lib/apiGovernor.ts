export type ApiBucket = 'search' | 'product';

interface BucketConfig {
  windowMs: number;
  label: string;
}

interface BucketState {
  timestamps: number[];
  lastStatus: number | null;
  lastRetryAt: number;
}

interface GovernorState {
  search: BucketState;
  product: BucketState;
}

export interface ApiUsageBucketSnapshot {
  used: number;
  windowMs: number;
  retryAfterMs: number;
  lastStatus: number | null;
  label: string;
  blocking: false;
}

export interface ApiUsageSnapshot {
  search: ApiUsageBucketSnapshot;
  product: ApiUsageBucketSnapshot;
}

const STORAGE_KEY = 'kh-checker-v2.2-api-telemetry';

// This is intentionally an observation window, not a claimed quota. OFF,
// Search-a-licious or an optional gateway own the effective remote limits.
const CONFIG: Record<ApiBucket, BucketConfig> = {
  search: { windowMs: 60_000, label: 'Produktsuche' },
  product: { windowMs: 60_000, label: 'Produktdetails' }
};

const emptyBucket = (): BucketState => ({ timestamps: [], lastStatus: null, lastRetryAt: 0 });
let memoryState: GovernorState = { search: emptyBucket(), product: emptyBucket() };

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function sanitizeBucket(value: unknown): BucketState {
  const raw = (value ?? {}) as Partial<BucketState>;
  return {
    timestamps: Array.isArray(raw.timestamps)
      ? raw.timestamps.filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
      : [],
    lastStatus: typeof raw.lastStatus === 'number' && Number.isFinite(raw.lastStatus)
      ? raw.lastStatus
      : null,
    lastRetryAt: typeof raw.lastRetryAt === 'number' && Number.isFinite(raw.lastRetryAt)
      ? raw.lastRetryAt
      : 0
  };
}

function readState(): GovernorState {
  if (!storageAvailable()) return memoryState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return memoryState;
    const parsed = JSON.parse(raw) as Partial<GovernorState>;
    memoryState = {
      search: sanitizeBucket(parsed.search),
      product: sanitizeBucket(parsed.product)
    };
  } catch {
    // Keep the in-memory telemetry when browser storage is unavailable/corrupt.
  }
  return memoryState;
}

function writeState(state: GovernorState): void {
  memoryState = state;
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Telemetry is optional; the request path must remain usable.
  }
}

function prune(bucket: ApiBucket, state: BucketState, now: number): BucketState {
  const config = CONFIG[bucket];
  return {
    ...state,
    timestamps: state.timestamps.filter((timestamp) => timestamp > now - config.windowMs),
    lastRetryAt: state.lastRetryAt > now ? state.lastRetryAt : 0
  };
}

/** Record an actual network request. This function intentionally never throws. */
export function recordApiRequest(bucket: ApiBucket, now = Date.now()): void {
  const state = readState();
  const current = prune(bucket, state[bucket], now);
  current.timestamps.push(now);
  state[bucket] = current;
  writeState(state);
}

/** Store an upstream status/retry hint for diagnostics only; it is never a lock. */
export function recordApiResponse(
  bucket: ApiBucket,
  status: number,
  retryAfterMs?: number | null,
  now = Date.now()
): void {
  const state = readState();
  const current = prune(bucket, state[bucket], now);
  current.lastStatus = status;
  current.lastRetryAt = retryAfterMs && retryAfterMs > 0 ? now + retryAfterMs : 0;
  state[bucket] = current;
  writeState(state);
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

function snapshotBucket(bucket: ApiBucket, now: number): ApiUsageBucketSnapshot {
  const state = readState();
  const current = prune(bucket, state[bucket], now);
  // A read-only diagnostics render must not create local persistence before
  // the user has opted into API caching/telemetry.
  memoryState = { ...state, [bucket]: current };
  const config = CONFIG[bucket];
  return {
    used: current.timestamps.length,
    windowMs: config.windowMs,
    retryAfterMs: Math.max(0, current.lastRetryAt - now),
    lastStatus: current.lastStatus,
    label: config.label,
    blocking: false
  };
}

export function getApiUsageSnapshot(now = Date.now()): ApiUsageSnapshot {
  return {
    search: snapshotBucket('search', now),
    product: snapshotBucket('product', now)
  };
}

export function clearApiGovernor(): void {
  memoryState = { search: emptyBucket(), product: emptyBucket() };
  if (!storageAvailable()) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to do.
  }
}
