import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPinned } from './safeFetchTransport.js';
const lookup = vi.hoisted(() => vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]));
vi.mock('dns', () => ({ default: { promises: { lookup } } }));
import { safeFetch } from './ssrf.js';
let server: http.Server, port: number, closed: number;
let seen: Array<{ url: string; headers: http.IncomingHttpHeaders }>;
let optionsSeen: http.RequestOptions[];
let destinationsSeen: Array<URL | http.RequestOptions>;
const realHttpRequest = http.request;
const publicAddress = { address: '93.184.216.34', family: 4 as const };
beforeEach(async () => {
  lookup.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  closed = 0; seen = []; optionsSeen = []; destinationsSeen = [];
  server = http.createServer((req, res) => {
    seen.push({ url: req.url!, headers: req.headers }); res.once('close', () => { closed++; });
    const body = Buffer.from('<title>Native transport</title>');
    const encoding = req.url?.slice(1);
    if (encoding === 'stall') { res.writeHead(200); res.flushHeaders(); return; }
    if (encoding === 'headers-stall') return;
    if (encoding === 'decoder-stall') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.write(gzipSync(body).subarray(0, 10)); return; }
    if (encoding === 'wire-overflow') { res.writeHead(200); res.end(Buffer.alloc(512_001)); return; }
    if (encoding === 'bomb') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync(Buffer.alloc(512_001))); return; }
    if (encoding === 'broken') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end('not gzip'); return; }
    if (encoding === 'unknown') { res.writeHead(200, { 'content-encoding': 'invented' }); res.end(body); return; }
    if (encoding === 'no-content') { res.writeHead(204); res.end(); return; }
    if (encoding === 'not-modified') { res.writeHead(304); res.end(); return; }
    if (encoding === 'invalid-status') { res.writeHead(600); res.end(); return; }
    const compressors = { gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync };
    const compress = Object.hasOwn(compressors, encoding ?? '') ? compressors[encoding as keyof typeof compressors] : undefined;
    const bytes = compress ? compress(body) : body;
    res.writeHead(req.headers.range ? 206 : 200, { 'content-type': 'text/html', 'content-length': bytes.length,
      ...(compress ? { 'content-encoding': encoding! } : {}), ...(req.headers.range ? { 'content-range': 'bytes 0-29/30' } : {}) });
    res.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); port = (server.address() as AddressInfo).port;
  // Test-only connector substitution: production code still receives a public
  // URL/pin. There is no runtime private-address bypass or injected factory.
  vi.spyOn(http, 'request').mockImplementation(((destination: URL | http.RequestOptions, optionsOrCallback: http.RequestOptions | ((response: http.IncomingMessage) => void), callback?: (response: http.IncomingMessage) => void) => {
    const options = destination instanceof URL ? optionsOrCallback as http.RequestOptions : destination;
    const respond = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    destinationsSeen.push(destination);
    optionsSeen.push(options);
    return realHttpRequest({
      ...options, protocol: 'http:', hostname: '127.0.0.1', port, lookup: undefined, family: 4,
      path: destination instanceof URL ? destination.pathname + destination.search : options.path,
      headers: { ...options.headers, ...(destination instanceof URL ? { host: destination.host } : {}) },
    }, respond);
  }) as typeof http.request);
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const get = (path: string, signal = new AbortController().signal, method: 'GET' | 'HEAD' = 'GET') =>
  requestPinned(new URL(`http://public.example:8443${path}`), publicAddress, { method, headers: new Headers(), signal });
describe('private Node transport uses the validated destination and native response streams', () => {
  it.each([
    ['http://public.example:8443/path?query=a%20b', publicAddress, 'public.example:8443'],
    ['http://[2606:4700::1111]:8443/path?query=a%20b', { address: '2606:4700::1111', family: 6 as const }, '[2606:4700::1111]:8443'],
  ] as const)('gives the native client only the validated IP as its network destination for %s', async (value, pin, host) => {
    const response = await requestPinned(new URL(value), pin, { method: 'GET', headers: new Headers(), signal: new AbortController().signal });
    expect(await response.text()).toBe('<title>Native transport</title>');
    expect(destinationsSeen[0]).not.toBeInstanceOf(URL);
    expect(optionsSeen[0]).toMatchObject({ hostname: pin.address, port: 8443, path: '/path?query=a%20b', headers: { host } });
    expect(seen[0]).toMatchObject({ url: '/path?query=a%20b', headers: { host } });
  });
  it('retains logical Host/port and uses only the pinned lookup answer without pooled sockets', async () => {
    const response = await get('/plain'); expect(await response.text()).toBe('<title>Native transport</title>');
    expect(seen[0]?.headers.host).toBe('public.example:8443'); const options = optionsSeen[0]!;
    expect(options).toMatchObject({ agent: false, family: 4, autoSelectFamily: false });
    const answer = await new Promise<string>((resolve, reject) => options.lookup!('public.example', {}, (err, address) => err ? reject(err) : typeof address === 'string' ? resolve(address) : reject(new Error('Expected one pinned answer'))));
    expect(answer).toBe(publicAddress.address);
  });
  it.each(['gzip', 'deflate', 'br'])('streams bounded %s decoding and normalizes encoded headers', async encoding => {
    const response = await get(`/${encoding}`); expect(response.headers.get('content-encoding')).toBeNull(); expect(response.headers.get('content-length')).toBeNull();
    expect(await response.text()).toBe('<title>Native transport</title>');
  });
  it.each(['wire-overflow', 'bomb', 'broken'])('rejects %s during body consumption and releases its socket', async endpoint => {
    const response = await get(`/${endpoint}`); await expect(response.arrayBuffer()).rejects.toThrow(); await vi.waitFor(() => expect(closed).toBe(1));
  });
  it('rejects unsupported content encoding without exposing an unbounded raw body', async () => {
    await expect(get('/unknown')).rejects.toThrow(); await vi.waitFor(() => expect(closed).toBe(1));
  });
  it.each([['/no-content', 'GET', 204], ['/not-modified', 'GET', 304], ['/plain', 'HEAD', 200]] as const)('keeps %s %s bodyless response semantics', async (path, method, status) => {
    const response = await get(path, undefined, method); expect(response.status).toBe(status); expect(response.body).toBeNull();
  });
  it('preserves ordinary range request headers and partial response status', async () => {
    const response = await requestPinned(new URL('http://public.example/image'), publicAddress,
      { method: 'GET', headers: new Headers({ Range: 'bytes=0-32767' }), signal: new AbortController().signal });
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('bytes 0-29/30');
    expect(seen[0]?.headers.range).toBe('bytes=0-32767'); await response.body?.cancel();
  });
  it.each(['/stall', '/decoder-stall'])('honors caller abort after headers at %s even if decoding cannot finish', async endpoint => {
    const controller = new AbortController(), response = await get(endpoint, controller.signal);
    const pending = expect(response.text()).rejects.toThrow(); controller.abort(); await pending; await vi.waitFor(() => expect(closed).toBe(1));
  });
  it('honors caller abort before headers and destroys the pending request', async () => {
    const controller = new AbortController(); const pending = expect(get('/headers-stall', controller.signal)).rejects.toThrow();
    await vi.waitFor(() => expect(seen).toHaveLength(1)); controller.abort(); await pending; await vi.waitFor(() => expect(closed).toBe(1));
  });
  it('body.cancel destroys the stalled source instead of keeping its socket alive', async () => {
    const response = await get('/stall'); await response.body?.cancel(); await vi.waitFor(() => expect(closed).toBe(1));
  });
  it.each(['GET', 'HEAD'] as const)('refuses an invalid response status on %s without an uncaught exception', async method => {
    await expect(get('/invalid-status', undefined, method)).rejects.toThrow();
    await vi.waitFor(() => expect(closed).toBe(1));
  });
  it('keeps the logical TLS name and normal certificate verification, propagating a certificate refusal', async () => {
    let tlsOptions: https.RequestOptions | undefined;
    vi.spyOn(https, 'request').mockImplementation(((destination: URL | https.RequestOptions, optionsOrCallback: https.RequestOptions | ((response: http.IncomingMessage) => void), callback?: (response: http.IncomingMessage) => void) => {
      const options = destination instanceof URL ? optionsOrCallback as https.RequestOptions : destination;
      const respond = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
      tlsOptions = options;
      const request = realHttpRequest(`http://127.0.0.1:${port}`, respond);
      queueMicrotask(() => request.destroy(Object.assign(new Error('synthetic certificate refusal'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })));
      return request;
    }) as typeof https.request);
    await expect(requestPinned(new URL('https://public.example:8443/image'), publicAddress,
      { method: 'GET', headers: new Headers(), signal: new AbortController().signal })).rejects.toThrow('certificate refusal');
    expect(tlsOptions?.servername).toBe('public.example'); expect(tlsOptions?.rejectUnauthorized).not.toBe(false);
    expect(tlsOptions?.checkServerIdentity).toBeUndefined(); expect(tlsOptions?.agent).toBe(false);
    expect(tlsOptions).toMatchObject({ hostname: publicAddress.address, port: 8443, path: '/image', headers: { host: 'public.example:8443' } });
  });
  it('uses the real adapter through safeFetch without consulting a rebinding second DNS answer', async () => {
    lookup.mockResolvedValueOnce([publicAddress]).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const response = await safeFetch('http://public.example:8443/gzip'); expect(await response.text()).toBe('<title>Native transport</title>');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('public.example', { all: true });
    expect(seen[0]?.headers.host).toBe('public.example:8443');
    const answer = await new Promise<string>((resolve, reject) => optionsSeen[0]!.lookup!('public.example', {}, (error, address) =>
      error ? reject(error) : typeof address === 'string' ? resolve(address) : reject(new Error('Expected one pin'))));
    expect(answer).toBe(publicAddress.address);
  });
  it('propagates the overall 5s safeFetch body deadline to the real stalled socket', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const response = await safeFetch('http://public.example/stall'); const pending = expect(response.text()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000); await pending; vi.useRealTimers(); await vi.waitFor(() => expect(closed).toBe(1));
  });
});
