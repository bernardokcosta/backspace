export type RateLimitScope = 'http' | 'action' | 'resource' | 'transport';

export function isRateLimitScope(value: unknown): value is RateLimitScope {
  return value === 'http' || value === 'action' || value === 'resource' || value === 'transport';
}

/** Retry metadata is untrusted, including when sent by an older federated peer. */
export function parseRetryAfterSeconds(
  body: unknown,
  header: string | null,
  now = Date.now(),
  fallback = 60,
): number {
  const bounded = (seconds: number) => Math.max(1, Math.min(3600, Math.ceil(seconds)));
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const seconds = (body as { retryAfter?: unknown }).retryAfter;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) return bounded(seconds);
  }
  if (typeof header === 'string') {
    const value = header.trim();
    if (/^[0-9]+$/.test(value) && Number.isFinite(Number(value))) return bounded(Number(value));
    // Date.parse accepts numeric prefixes such as "-5" as dates: require a weekday.
    if (/^[A-Za-z]{3,9}(?:,| )/.test(value)) {
      const date = Date.parse(value);
      if (Number.isFinite(date)) return bounded((date - now) / 1000);
    }
  }
  return bounded(Number.isFinite(fallback) && fallback >= 0 ? fallback : 60);
}
