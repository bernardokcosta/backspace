import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./ssrf.js', () => ({ safeFetch: vi.fn() }));
vi.mock('../db/index.js', () => ({ getDb: vi.fn(), schema: {} }));
vi.mock('../ws/handler.js', () => ({ connectionManager: {} }));
const sharpMock = vi.hoisted(() => vi.fn<(input: Buffer) => { metadata: () => Promise<{ width: number; height: number }> }>(
  () => ({ metadata: async () => ({ width: 640, height: 480 }) })));
vi.mock('sharp', () => ({ default: sharpMock }));
import { safeFetch } from './ssrf.js';
import { probeRemoteImageDimensions } from './embedResolver.js';
const url = 'https://public.example:8443/image.png';
beforeEach(() => { vi.useFakeTimers(); vi.mocked(safeFetch).mockReset(); sharpMock.mockClear(); });
afterEach(() => { vi.useRealTimers(); });
describe('range image body lifetime and retained probe bytes', () => {
  it('slices an ignored-Range oversized first chunk before retaining it or calling sharp', async () => {
    const cancel = vi.fn();
    vi.mocked(safeFetch).mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(Buffer.alloc(100_000, 1)); }, cancel })));
    expect(await probeRemoteImageDimensions(url)).toEqual({ width: 640, height: 480 });
    expect(sharpMock.mock.calls[0]?.[0].byteLength).toBe(32_768); expect(cancel).toHaveBeenCalledOnce();
    expect(safeFetch).toHaveBeenCalledWith(url, expect.objectContaining({ headers: expect.objectContaining({ Range: 'bytes=0-32767' }) }));
  });
  it('keeps the 3s deadline through a stalled body and does not invoke sharp', async () => {
    let signal: AbortSignal | null | undefined; let stalled: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.mocked(safeFetch).mockImplementation(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { stalled = c; signal?.addEventListener('abort', () => c.error(new Error('synthetic abort')), { once: true }); } }));
    });
    const pending = probeRemoteImageDimensions(url);
    try { await vi.advanceTimersByTimeAsync(3000); expect(signal?.aborted).toBe(true); expect(await pending).toBeNull(); expect(sharpMock).not.toHaveBeenCalled(); }
    finally { stalled?.error(new Error('test cleanup')); await pending; }
  });
  it('cancels a rejected response body before returning the normal null preview', async () => {
    const cancel = vi.fn(); vi.mocked(safeFetch).mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 404 }));
    expect(await probeRemoteImageDimensions(url)).toBeNull(); expect(cancel).toHaveBeenCalledOnce(); expect(sharpMock).not.toHaveBeenCalled();
  });
});
