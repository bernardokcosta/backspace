/**
 * A fixed-window counter for limits on WebSocket events, which the HTTP rate
 * limiter (`@fastify/rate-limit`) does not see: a window starts at a key's
 * first event and admits `max` events until `windowMs` has passed. It counts
 * the way the plugin's in-memory store does. `DISABLE_RATE_LIMITS=1` (or
 * `true`) turns it off, as it turns off the plugin (api.md, "Rate limiting").
 *
 * Windows live in memory and go away when they end, swept at most once per
 * window length.
 */
export interface FixedWindowLimit {
  /** Count one event for `key`. True when it is within the limit, false when it is refused. */
  consume(key: string, now?: number): boolean;
  /** Atomically consume all keys; 0 admits, otherwise the remaining wait in ms. */
  consumeAll(keys: readonly string[], now?: number): number;
  /** Tests only: forget every window. */
  reset(): void;
}

function rateLimitsDisabled(): boolean {
  const value = process.env.DISABLE_RATE_LIMITS;
  return value === '1' || value === 'true';
}

export function createFixedWindowLimit(limit: { readonly max: number; readonly windowMs: number }): FixedWindowLimit {
  const windows: Map<string, { count: number; startedAt: number }> = new Map();
  let lastSweepAt = 0;

  function sweep(now: number): void {
    if (now - lastSweepAt < limit.windowMs) return;
    lastSweepAt = now;
    for (const [key, window] of windows) {
      if (now - window.startedAt >= limit.windowMs) windows.delete(key);
    }
  }

  function consumeAll(keys: readonly string[], now: number = Date.now()): number {
    if (rateLimitsDisabled()) return 0;
    sweep(now);
    const unique = [...new Set(keys)];
    let retryAfter = 0;
    for (const key of unique) {
      const window = windows.get(key);
      if (window && now - window.startedAt < limit.windowMs && window.count >= limit.max) {
        retryAfter = Math.max(retryAfter, limit.windowMs - (now - window.startedAt));
      }
    }
    if (retryAfter > 0) return retryAfter;
    for (const key of unique) {
      const window = windows.get(key);
      if (!window || now - window.startedAt >= limit.windowMs) windows.set(key, { count: 1, startedAt: now });
      else window.count++;
    }
    return 0;
  }

  return {
    consume: (key, now) => consumeAll([key], now) === 0,
    consumeAll,
    reset(): void {
      windows.clear();
      lastSweepAt = 0;
    },
  };
}
