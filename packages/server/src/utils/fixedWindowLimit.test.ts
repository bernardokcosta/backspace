import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixedWindowLimit } from './fixedWindowLimit.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('createFixedWindowLimit', () => {
  it('bounds new keys without partially spending an atomic multi-key admission', () => {
    const limit = createFixedWindowLimit({ max: 2, windowMs: 1000, maxKeys: 2 });
    expect(limit.consumeAll(['a', 'b'], 0)).toBe(0);
    expect(limit.consumeAll(['a', 'c'], 0)).toBeGreaterThan(0);
    expect(limit.consumeAll(['a', 'b'], 0)).toBe(0);
    expect(limit.consumeAll(['c'], 1000)).toBe(0);
  });
  it('admits max events per key until the window ends', () => {
    const limit = createFixedWindowLimit({ max: 2, windowMs: 1000 });
    expect([limit.consume('a', 0), limit.consume('a', 10), limit.consume('a', 20)]).toEqual([true, true, false]);
    expect(limit.consume('b', 20)).toBe(true);
    expect(limit.consume('a', 1000)).toBe(true);
  });

  it('admits everything when rate limits are disabled', () => {
    vi.stubEnv('DISABLE_RATE_LIMITS', '1');
    const limit = createFixedWindowLimit({ max: 1, windowMs: 1000 });
    expect([limit.consume('a', 0), limit.consume('a', 1)]).toEqual([true, true]);
  });

  it('forgets every window on reset', () => {
    const limit = createFixedWindowLimit({ max: 1, windowMs: 1000 });
    limit.consume('a', 0);
    limit.reset();
    expect(limit.consume('a', 1)).toBe(true);
  });
  it('checks several budgets atomically and reports the actual remaining delay', () => {
    const limit = createFixedWindowLimit({ max: 1, windowMs: 2000 });
    expect(limit.consumeAll(['user:alice', 'room:a'], 0)).toBe(0);
    expect(limit.consumeAll(['user:bob', 'room:a'], 1500)).toBe(500);
    // Bob's rejected attempt did not start a phantom personal cooldown.
    expect(limit.consumeAll(['user:bob', 'room:a'], 2000)).toBe(0);
    expect(limit.consumeAll(['user:bob', 'room:b'], 2500)).toBe(1500);
    expect(limit.consumeAll(['user:bob', 'user:bob'], 4000)).toBe(0);
  });
});
