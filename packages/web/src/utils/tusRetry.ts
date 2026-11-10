import type { DetailedError, UploadOptions } from 'tus-js-client';
import { parseRetryAfterSeconds } from '@veyvox/shared/src/retryAfter';

function statusOf(error: Error): number | undefined {
  return (error as Partial<DetailedError>).originalResponse?.getStatus();
}

export function isPermanentUploadError(error: Error): boolean {
  const status = statusOf(error);
  if (status !== undefined) return status >= 400 && status < 500 && status !== 408 && status !== 429;
  // Compatibility with older tus errors lacking a structured HTTP response.
  const match = /\b(4\d\d)\b/.exec(error.message);
  return match !== null && Number(match[1]) !== 408 && Number(match[1]) !== 429;
}

/** Uses tus's own finite retry chain; never adds a second upload or message queue. */
export const shouldRetryTusUpload: NonNullable<UploadOptions['onShouldRetry']> = (error, attempt, options) => {
  if (!options.retryDelays || attempt < 0 || attempt >= options.retryDelays.length
      || (typeof navigator !== 'undefined' && !navigator.onLine)) return false;
  const response = error.originalResponse;
  const status = response?.getStatus() ?? 0;
  if (status === 429) {
    let body: unknown;
    try {
      const text = response?.getBody() ?? '';
      if (text.length <= 16_384) body = JSON.parse(text);
    } catch { /* Header or bounded legacy fallback. */ }
    const seconds = parseRetryAfterSeconds(body, response?.getHeader('Retry-After') ?? null);
    options.retryDelays[attempt] = Math.max(options.retryDelays[attempt] ?? 0, seconds * 1000);
    return true;
  }
  return status < 400 || status >= 500 || status === 408 || status === 409 || status === 423;
};
