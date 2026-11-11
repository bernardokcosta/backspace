import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./ssrf.js', () => ({ safeFetch: vi.fn() }));
import { safeFetch } from './ssrf.js';
import { fetchUrlMetadata } from './metadataFetcher.js';
const url = 'https://public.example:8443/article';
beforeEach(() => { vi.useFakeTimers(); vi.mocked(safeFetch).mockReset(); });
afterEach(() => { vi.useRealTimers(); });
function stream(body: Uint8Array | null, status = 200, headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { if (body) { controller.enqueue(body); controller.close(); } }, cancel }), { status, headers });
  vi.mocked(safeFetch).mockResolvedValue(response); return { response, cancel };
}
describe('metadata body lifetime and decoded byte budget', () => {
  it('keeps its 5s deadline after headers until a stalled body is released', async () => {
    let signal: AbortSignal | null | undefined; let stalled: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.mocked(safeFetch).mockImplementation(async (_url, init) => {
      signal = init?.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stalled = controller; signal?.addEventListener('abort', () => controller.error(new Error('synthetic abort')), { once: true });
      } }));
    });
    const pending = fetchUrlMetadata(url);
    try {
      await vi.advanceTimersByTimeAsync(5000); expect(signal?.aborted).toBe(true); expect(await pending).toBeNull();
    } finally { stalled?.error(new Error('test cleanup')); await pending; }
  });
  it.each([512_000, 512_001])('accepts only a complete body inside the 512000-byte cap: %i', async length => {
    const html = Buffer.from('<title>Native title</title>' + ' '.repeat(length - 27));
    expect(html.length).toBe(length); stream(html);
    const result = await fetchUrlMetadata(url);
    if (length === 512_000) expect(result).toMatchObject({ title: 'Native title', url });
    else expect(result).toBeNull();
  });
  it.each([
    [404, {}], [200, { 'content-type': 'image/png' }], [200, { 'content-type': 'video/mp4' }],
    [200, { 'content-length': '512001' }],
  ] as const)('cancels early-return bodies at status %i with %j', async (status, headers) => {
    const { cancel } = stream(null, status, headers); await fetchUrlMetadata(url); expect(cancel).toHaveBeenCalledOnce();
  });
  it('returns null without a body and parses ordinary OG metadata with native URL/port', async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce(new Response(null, { status: 204 })); expect(await fetchUrlMetadata(url)).toBeNull();
    stream(Buffer.from('<meta property="og:title" content="Native"><meta property="og:image:width" content="640"><meta property="og:image:height" content="480">'));
    expect(await fetchUrlMetadata(url)).toMatchObject({ title: 'Native', imageWidth: 640, imageHeight: 480, url });
    expect(safeFetch).toHaveBeenCalledWith(url, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
