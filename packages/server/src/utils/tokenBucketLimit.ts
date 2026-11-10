export interface Reservation {
  readonly retryAfterMs: number;
  /** Refund a confirmed success once, only into the generation that admitted it. */
  refund(): void;
}

export interface TokenBucketLimit {
  /** Zero admits; otherwise milliseconds until capacity is available. */
  consume(key: string, now?: number): number;
  reserve(key: string, now?: number): Reservation;
  reset(): void;
}

export function rateLimitsDisabled(): boolean {
  return process.env.DISABLE_RATE_LIMITS === '1' || process.env.DISABLE_RATE_LIMITS === 'true';
}

/** The existing WS token-bucket arithmetic, shared across transports and bounded in memory. */
export function createTokenBucketLimit(options: {
  capacity: number;
  refillPerSecond: number;
  maxKeys?: number;
}): TokenBucketLimit {
  const { capacity, refillPerSecond, maxKeys = 10_000 } = options;
  if (!Number.isFinite(capacity) || capacity < 1 || !Number.isFinite(refillPerSecond)
      || refillPerSecond <= 0 || !Number.isSafeInteger(maxKeys) || maxKeys < 1) {
    throw new RangeError('Invalid token bucket configuration');
  }
  const refillPerMs = refillPerSecond / 1000;
  const entries = new Map<string, { tokens: number; at: number }>();
  let lastSweep = -Infinity;

  function sweep(now: number): void {
    if (now >= lastSweep && now - lastSweep < 1000) return;
    lastSweep = now;
    for (const [key, entry] of entries) {
      if (entry.tokens + Math.max(0, now - entry.at) * refillPerMs >= capacity) entries.delete(key);
    }
  }

  function reserve(key: string, now = Date.now()): Reservation {
    if (rateLimitsDisabled()) return { retryAfterMs: 0, refund() {} };
    let entry = entries.get(key);
    if (!entry) {
      sweep(now);
      if (entries.size >= maxKeys) return { retryAfterMs: 1000, refund() {} };
      entry = { tokens: capacity, at: now };
      entries.set(key, entry);
    }
    entry.tokens = Math.min(capacity, entry.tokens + Math.max(0, now - entry.at) * refillPerMs);
    // Reset the reference on a backwards clock jump without granting tokens.
    entry.at = now;
    if (entry.tokens < 1 - 1e-12) {
      // Floating point refill must not round an exact one-millisecond wait to two.
      return { retryAfterMs: Math.max(1, Math.ceil((1 - entry.tokens) / refillPerMs - 1e-9)), refund() {} };
    }
    entry.tokens -= 1;
    const admitted = entry;
    let refunded = false;
    return {
      retryAfterMs: 0,
      refund() {
        if (refunded) return;
        refunded = true;
        if (entries.get(key) === admitted) admitted.tokens = Math.min(capacity, admitted.tokens + 1);
      },
    };
  }

  return {
    consume: (key, now) => reserve(key, now).retryAfterMs,
    reserve,
    reset() { entries.clear(); lastSweep = -Infinity; },
  };
}
