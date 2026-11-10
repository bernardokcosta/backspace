import { describe, expect, it } from 'vitest';
import { parseRetryAfterSeconds } from '@veyvox/shared/src/retryAfter';

describe('bounded retry metadata', () => {
  it('prefers finite numeric JSON seconds and rounds up', () => {
    expect(parseRetryAfterSeconds({ retryAfter: 1.2 }, '30')).toBe(2);
    expect(parseRetryAfterSeconds({ retryAfter: 9_000 }, null)).toBe(3_600);
    expect(parseRetryAfterSeconds({ retryAfter: 0 }, null)).toBe(1);
  });

  it.each(['5', -1, Number.NaN, Number.POSITIVE_INFINITY, {}, null])('rejects unsafe body wait %j', retryAfter => {
    expect(parseRetryAfterSeconds({ retryAfter }, '7')).toBe(7);
  });

  it('supports whole header seconds and HTTP dates, not numeric prefixes', () => {
    const now = Date.UTC(2026, 10, 10);
    expect(parseRetryAfterSeconds(null, '42', now)).toBe(42);
    expect(parseRetryAfterSeconds(null, new Date(now + 5_000).toUTCString(), now)).toBe(5);
    expect(parseRetryAfterSeconds(null, new Date(now - 1_000).toUTCString(), now)).toBe(1);
    expect(parseRetryAfterSeconds(null, '42oops', now)).toBe(60);
    expect(parseRetryAfterSeconds(null, '-5', now)).toBe(60);
    expect(parseRetryAfterSeconds(null, null, now, 30)).toBe(30);
  });
});
