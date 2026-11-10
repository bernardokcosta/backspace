import { describe, expect, it } from 'vitest';
import type { DetailedError, UploadOptions } from 'tus-js-client';
import { isPermanentUploadError, shouldRetryTusUpload } from './tusRetry';

function error(status: number, retryAfter = '3'): DetailedError {
  return Object.assign(new Error(`HTTP ${status}`), {
    originalRequest: {}, originalResponse: { getStatus: () => status, getHeader: () => retryAfter,
      getBody: () => JSON.stringify({ retryAfter: Number(retryAfter) }) },
  }) as unknown as DetailedError;
}

describe('bounded tus backpressure', () => {
  it('waits for Retry-After within the existing finite retry schedule', () => {
    const options: UploadOptions = { retryDelays: [0, 1000, 3000] };
    expect(shouldRetryTusUpload(error(429), 0, options)).toBe(true);
    expect(options.retryDelays?.[0]).toBe(3000);
    expect(shouldRetryTusUpload(error(429), 3, options)).toBe(false);
    expect(options.retryDelays).toHaveLength(3);
    expect(isPermanentUploadError(error(429))).toBe(false);
  });

  it('keeps ownership/validation failures permanent and transient failures resumable', () => {
    expect(isPermanentUploadError(error(403))).toBe(true);
    expect(isPermanentUploadError(error(400))).toBe(true);
    expect(isPermanentUploadError(error(408))).toBe(false);
    expect(isPermanentUploadError(error(502))).toBe(false);
    expect(shouldRetryTusUpload(error(403), 0, { retryDelays: [0] })).toBe(false);
    expect(shouldRetryTusUpload(error(423), 0, { retryDelays: [0] })).toBe(true);
  });
});
