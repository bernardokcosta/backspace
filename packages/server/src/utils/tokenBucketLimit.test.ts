import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenBucketLimit } from './tokenBucketLimit.js';

afterEach(() => vi.unstubAllEnvs());

describe('bounded token buckets', () => {
  it('admits a natural burst and gradually replenishes without extending a refusal', () => {
    const limit = createTokenBucketLimit({ capacity: 12, refillPerSecond: 2 });
    for (let i = 0; i < 12; i++) expect(limit.consume('alice', 0)).toBe(0);
    expect(limit.consume('alice', 0)).toBe(500);
    expect(limit.consume('alice', 499)).toBe(1);
    expect(limit.consume('alice', 500)).toBe(0);
    expect(limit.consume('bob', 500)).toBe(0);
  });

  it('does not grant capacity when the wall clock moves backward', () => {
    const limit = createTokenBucketLimit({ capacity: 1, refillPerSecond: 1 });
    expect(limit.consume('a', 10_000)).toBe(0);
    expect(limit.consume('a', 5_000)).toBe(1_000);
    expect(limit.consume('a', 5_999)).toBe(1);
    expect(limit.consume('a', 6_000)).toBe(0);
  });

  it('bounds keys without evicting exhausted clients to grant a fresh budget', () => {
    const limit = createTokenBucketLimit({ capacity: 1, refillPerSecond: 1, maxKeys: 2 });
    expect(limit.consume('a', 0)).toBe(0);
    expect(limit.consume('b', 0)).toBe(0);
    expect(limit.consume('c', 0)).toBeGreaterThan(0);
    expect(limit.consume('a', 0)).toBeGreaterThan(0);
    expect(limit.consume('c', 1_000)).toBe(0);
  });

  it('refunds a successful reservation once, but never into a reset generation', () => {
    const limit = createTokenBucketLimit({ capacity: 2, refillPerSecond: 1 });
    const reservation = limit.reserve('a', 0);
    expect(reservation.retryAfterMs).toBe(0);
    expect(limit.consume('a', 0)).toBe(0);
    reservation.refund();
    reservation.refund();
    expect(limit.consume('a', 0)).toBe(0);
    expect(limit.consume('a', 0)).toBeGreaterThan(0);
    limit.reset();
    const stale = limit.reserve('a', 0);
    limit.reset();
    expect(limit.consume('a', 0)).toBe(0);
    expect(limit.consume('a', 0)).toBe(0);
    stale.refund();
    expect(limit.consume('a', 0)).toBeGreaterThan(0);
  });

  it('honors the explicit test bypass', () => {
    vi.stubEnv('DISABLE_RATE_LIMITS', 'true');
    const limit = createTokenBucketLimit({ capacity: 1, refillPerSecond: 1 });
    for (let i = 0; i < 50; i++) expect(limit.consume('a', 0)).toBe(0);
  });
});
