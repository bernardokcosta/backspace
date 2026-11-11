import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';
const lookup = vi.hoisted(() => vi.fn<(hostname: string, options?: { all?: boolean }) => Promise<LookupAddress | LookupAddress[]>>());
vi.mock('dns', () => ({ default: { promises: { lookup } } }));
const pinned = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<Response>>());
vi.mock('./safeFetchTransport.js', () => ({ requestPinned: pinned }));
import { safeFetch, validateExternalUrl } from './ssrf.js';
const publicV4 = { address: '93.184.216.34', family: 4 };
const publicV6 = { address: '2606:4700::1111', family: 6 };
const ok = () => new Response('native public preview');
beforeEach(() => {
  lookup.mockReset().mockImplementation(async (_host, options) => options?.all ? [publicV4] : publicV4);
  pinned.mockReset().mockImplementation(async () => ok());
  vi.stubGlobal('fetch', vi.fn(async () => ok()));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('connection-time SSRF boundary', () => {
  it('pins the first validated public answer instead of resolving again in global fetch', async () => {
    lookup.mockImplementation(async (_host, options) => {
      const answer = lookup.mock.calls.length === 1 ? publicV4 : { address: '127.0.0.1', family: 4 };
      return options?.all ? [answer] : answer;
    });
    const response = await safeFetch('https://public.example:8443/path?native=1');
    expect(await response.text()).toBe('native public preview'); expect(global.fetch).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledExactlyOnceWith('public.example', { all: true });
    expect(pinned).toHaveBeenCalledWith(expect.any(URL), publicV4, expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
  });
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fe80::1', '::ffff:127.0.0.1', 'garbage'])('rejects a mixed public/private DNS answer containing %s before opening a socket', async address => {
    lookup.mockResolvedValue([publicV4, { address, family: address.includes(':') ? 6 : 4 }]);
    await expect(safeFetch('https://mixed.example')).rejects.toThrow(); expect(pinned).not.toHaveBeenCalled(); expect(global.fetch).not.toHaveBeenCalled();
  });
  it.each(['http://127.0.0.1', 'http://[::1]', 'http://[::ffff:7f00:1]', 'http://169.254.169.254'])('refuses literal %s without DNS or transport', async url => {
    await expect(safeFetch(url)).rejects.toThrow(); expect(lookup).not.toHaveBeenCalled(); expect(pinned).not.toHaveBeenCalled();
  });
  it.each(['file:///etc/passwd', 'https://alice:synthetic@public.example', 'not a URL'])('refuses malformed/credential/scheme input %s', async url => {
    await expect(safeFetch(url)).rejects.toThrow(); expect(lookup).not.toHaveBeenCalled(); expect(pinned).not.toHaveBeenCalled();
  });
  it.each(['https://8.8.8.8/image', 'https://[2606:4700::1111]/image'])('supports validated public literal %s without DNS', async url => {
    const response = await safeFetch(url); await response.body?.cancel(); expect(lookup).not.toHaveBeenCalled(); expect(pinned).toHaveBeenCalledOnce();
  });
  it('keeps ordinary public A/AAAA addresses available and preserves HEAD/range headers', async () => {
    lookup.mockResolvedValue([publicV6, publicV4]);
    const response = await safeFetch('https://public.example:8443/image', { method: 'HEAD', headers: { Range: 'bytes=0-32767' } });
    await response.body?.cancel(); expect(pinned).toHaveBeenCalledWith(expect.any(URL), publicV6,
      expect.objectContaining({ method: 'HEAD', headers: expect.any(Headers) }));
    const headers = pinned.mock.calls[0]?.[2] as { headers: Headers }; expect(headers.headers.get('range')).toBe('bytes=0-32767');
  });
  it.each([{ method: 'POST' }, { body: 'secret' }, { credentials: 'include' }, { redirect: 'manual' }, { headers: { Host: 'internal' } }])('refuses unsupported request semantics %j rather than silently ignoring them', async init => {
    await expect(safeFetch('https://public.example', init as RequestInit)).rejects.toThrow(); expect(pinned).not.toHaveBeenCalled(); expect(lookup).not.toHaveBeenCalled();
  });
  it('keeps the public validator void and refuses unsafe literals without DNS', async () => {
    await expect(validateExternalUrl('https://public.example')).resolves.toBeUndefined();
    await expect(validateExternalUrl('http://[::1]')).rejects.toThrow();
  });
});
describe('manual redirect authority and resource release', () => {
  it('cancels a redirect body before validating a relative next hop and strips secrets across origins', async () => {
    const canceled = vi.fn();
    pinned.mockResolvedValueOnce(new Response(new ReadableStream({ cancel: canceled }), { status: 302, headers: { location: '/next' } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://other.example/final' } }));
    const response = await safeFetch('https://public.example/start', { headers: { Authorization: 'Bearer synthetic', Cookie: 'session=synthetic', 'X-Api-Key': 'synthetic', Range: 'bytes=0-32767' } });
    await response.body?.cancel(); expect(canceled).toHaveBeenCalledOnce();
    expect((pinned.mock.calls[1]?.[0] as URL).href).toBe('https://public.example/next');
    const second = (pinned.mock.calls[1]?.[2] as { headers: Headers }).headers;
    const last = (pinned.mock.calls[2]?.[2] as { headers: Headers }).headers;
    expect(second.get('authorization')).toBe('Bearer synthetic');
    for (const key of ['authorization', 'cookie', 'x-api-key']) expect(last.has(key)).toBe(false);
    expect(last.get('range')).toBe('bytes=0-32767');
  });
  it.each([5, 6])('follows at most five redirects: %i', async redirects => {
    const canceled: ReturnType<typeof vi.fn>[] = [];
    pinned.mockImplementation(async () => {
      if (pinned.mock.calls.length > redirects) return ok();
      const cancel = vi.fn(); canceled.push(cancel);
      return new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: '/again' } });
    });
    if (redirects === 5) expect(await (await safeFetch('https://public.example')).text()).toBe('native public preview');
    else await expect(safeFetch('https://public.example')).rejects.toThrow('Too many redirects');
    expect(pinned).toHaveBeenCalledTimes(6); for (const cancel of canceled) expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['http://[::1]/x', 'http://169.254.169.254/x', 'https://user:synthetic@public.example/x'])('never connects to rejected redirect %s and cancels its previous body', async location => {
    const cancel = vi.fn(); pinned.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 302, headers: { location } }));
    await expect(safeFetch('https://public.example')).rejects.toThrow(); expect(pinned).toHaveBeenCalledOnce(); expect(cancel).toHaveBeenCalledOnce();
  });
});
describe('overall fetch deadline and abort ownership', () => {
  it('bounds a stalled resolver and never opens a socket after it resolves late', async () => {
    vi.useFakeTimers(); let resolve!: (value: LookupAddress[]) => void;
    lookup.mockReturnValue(new Promise<LookupAddress[]>(done => { resolve = done; }));
    const pending = expect(safeFetch('https://public.example')).rejects.toThrow(); await vi.advanceTimersByTimeAsync(5000); await pending;
    resolve([publicV4]); await Promise.resolve(); expect(pinned).not.toHaveBeenCalled();
  });
  it('honors a caller abort during resolution without waiting for DNS', async () => {
    const controller = new AbortController(); lookup.mockReturnValue(new Promise(() => {}));
    const pending = expect(safeFetch('https://public.example', { signal: controller.signal })).rejects.toThrow(); controller.abort(); await pending; expect(pinned).not.toHaveBeenCalled();
  });
  it('keeps its own deadline until an unread final body is canceled', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    pinned.mockImplementation(async (_url, _address, init) => { signal = (init as { signal: AbortSignal }).signal; return new Response(new ReadableStream()); });
    const response = await safeFetch('https://public.example'); await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(true); await expect(response.text()).rejects.toThrow();
  });
});
