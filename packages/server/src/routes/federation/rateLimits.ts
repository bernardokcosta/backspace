import { rateLimitsDisabled } from '../../utils/tokenBucketLimit.js';

// ─── In-memory sliding-window rate limiters (federation S2S endpoints) ───────
//
// Each limiter keeps a per-key ring of request timestamps inside a fixed window.
// `limited(key)` prunes that key's expired entries, then returns true (without
// recording a hit) once the key is at capacity. `sweep()` prunes every key and
// drops emptied buckets to bound memory; it runs on a timer, not per request.

interface SlidingWindowLimiter {
  /** True if `key` is already at capacity for the current window; otherwise records the hit and returns false. */
  limited(key: string): boolean;
  retryAfterMs(key: string): number;
  /** Prune expired timestamps across all keys and drop now-empty buckets. */
  sweep(): void;
  /** Underlying buckets — exposed only so tests can reset state. */
  readonly buckets: Map<string, number[]>;
}

function createLimiter(windowMs: number, max: number): SlidingWindowLimiter {
  const buckets = new Map<string, number[]>();
  const prune = (timestamps: number[], cutoff: number): void => {
    while (timestamps.length > 0 && (timestamps[0] ?? Infinity) <= cutoff) {
      timestamps.shift();
    }
  };
  return {
    buckets,
    limited(key: string): boolean {
      if (rateLimitsDisabled()) return false;
      const now = Date.now();
      let timestamps = buckets.get(key);
      if (!timestamps) {
        if (buckets.size >= 10_000) return true;
        timestamps = [];
        buckets.set(key, timestamps);
      }
      prune(timestamps, now - windowMs);
      if (timestamps.length >= max) return true;
      timestamps.push(now);
      return false;
    },
    retryAfterMs(key: string): number {
      const timestamps = buckets.get(key);
      if (!timestamps) return windowMs;
      return Math.max(1, (timestamps[0] ?? Date.now()) + windowMs - Date.now());
    },
    sweep(): void {
      const cutoff = Date.now() - windowMs;
      for (const [key, timestamps] of buckets) {
        prune(timestamps, cutoff);
        if (timestamps.length === 0) buckets.delete(key);
      }
    },
  };
}

const RATE_WINDOW_MS = 60_000;
const ENSURE_WINDOW_MS = 15 * 60_000;

// accept: per source IP · relay & user-lookup: per peer origin · ensure: per user
const acceptLimiter = createLimiter(RATE_WINDOW_MS, 10);
const relayLimiter = createLimiter(RATE_WINDOW_MS, 90);
const lookupLimiter = createLimiter(RATE_WINDOW_MS, 60);
const ensureLimiter = createLimiter(ENSURE_WINDOW_MS, 3);

export const isAcceptRateLimited = (ip: string): boolean => acceptLimiter.limited(ip);
export const isRelayRateLimited = (peerOrigin: string): boolean => relayLimiter.limited(peerOrigin);
export const isLookupRateLimited = (peerOrigin: string): boolean => lookupLimiter.limited(peerOrigin);
export const isEnsureRateLimited = (userId: string): boolean => ensureLimiter.limited(userId);
export const acceptRetryAfterMs = (ip: string): number => acceptLimiter.retryAfterMs(ip);
export const relayRetryAfterMs = (origin: string): number => relayLimiter.retryAfterMs(origin);
export const lookupRetryAfterMs = (origin: string): number => lookupLimiter.retryAfterMs(origin);
export const ensureRetryAfterMs = (userId: string): number => ensureLimiter.retryAfterMs(userId);

// Test-only export — used by federation.userLookup.test.ts to reset between cases.
export function _resetLookupRateBuckets(): void {
  lookupLimiter.buckets.clear();
}

// ─── Nonce store for replay protection (per-peer) ────────────────────────────
// Maps peerOrigin → (nonce → insertion timestamp). Nonces are evicted after
// NONCE_MAX_AGE_MS (15 min) to match the HMAC timestamp window.
const NONCE_MAX_AGE_MS = 15 * 60 * 1000;
const nonceStore = new Map<string, Map<string, number>>();

/** Returns true if the nonce is a duplicate (already seen for this peer). */
export function isNonceDuplicate(peerOrigin: string, nonce: string, record = true): boolean {
  let peerNonces = nonceStore.get(peerOrigin);
  if (!peerNonces) {
    if (!record) return false;
    peerNonces = new Map();
    nonceStore.set(peerOrigin, peerNonces);
  }
  if (peerNonces.has(nonce)) return true;
  if (record) peerNonces.set(nonce, Date.now());
  return false;
}

// ─── Periodic cleanup to bound memory ────────────────────────────────────────
// Ensure buckets sweep on their own (long) window. Accept + relay buckets and
// nonce eviction and lookup cleanup share the short window.
setInterval(() => ensureLimiter.sweep(), ENSURE_WINDOW_MS).unref();

setInterval(() => {
  acceptLimiter.sweep();
  relayLimiter.sweep();
  lookupLimiter.sweep();
  const nonceCutoff = Date.now() - NONCE_MAX_AGE_MS;
  for (const [origin, nonces] of nonceStore) {
    for (const [nonce, ts] of nonces) {
      if (ts < nonceCutoff) nonces.delete(nonce);
    }
    if (nonces.size === 0) nonceStore.delete(origin);
  }
}, RATE_WINDOW_MS).unref();
