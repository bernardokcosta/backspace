import dns from 'dns';
import { isIP } from 'node:net';
import { classifyAddress } from './ipClass.js';
import { requestPinned, type PinnedAddress } from './safeFetchTransport.js';

export function isPrivateIp(ip: string): boolean { return classifyAddress(ip) !== 'public'; }
const MAX_REDIRECTS = 5, TIMEOUT_MS = 5_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function aborted(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('External request aborted');
}

/** dns.lookup itself cannot be canceled; never connect when its answer is late. */
async function during<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(aborted(signal));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

async function destination(value: string, signal: AbortSignal): Promise<{ url: URL; address: PinnedAddress }> {
  if (signal.aborted) throw aborted(signal);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Invalid URL scheme');
  if (url.username || url.password) throw new Error('URL credentials not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const answers = literal ? [{ address: hostname, family: literal }] : await during(dns.promises.lookup(hostname, { all: true }), signal);
  if (!answers.length) throw new Error('DNS lookup failed');
  for (const answer of answers) {
    if ((answer.family !== 4 && answer.family !== 6) || isIP(answer.address) !== answer.family || isPrivateIp(answer.address)) {
      throw new Error('Private IP not allowed');
    }
  }
  if (signal.aborted) throw aborted(signal);
  const first = answers[0]!;
  return { url, address: { address: first.address, family: first.family as 4 | 6 } };
}

/** Validation alone is not connection authority; safeFetch also pins its result. */
export async function validateExternalUrl(url: string): Promise<void> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(new Error('External request timed out')), TIMEOUT_MS);
  try { await destination(url, controller.signal); } finally { clearTimeout(timeout); }
}

function requestOptions(init: RequestInit): { method: 'GET' | 'HEAD'; headers: Headers } {
  for (const key of Object.keys(init)) if (!['method', 'headers', 'signal'].includes(key)) throw new Error('Unsupported external request option');
  const method = init.method?.toUpperCase() ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') throw new Error('Unsupported external request method');
  const headers = new Headers(init.headers);
  for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-connection']) {
    if (headers.has(name)) throw new Error('Unsupported external request header');
  }
  return { method, headers };
}

/** One 5s lifetime across DNS, redirects, headers and the final streaming body. */
export async function safeFetch(value: string, init: RequestInit = {}): Promise<Response> {
  const { method, headers: initialHeaders } = requestOptions(init);
  const controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abort, { once: true });
  if (init.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('External request timed out')), TIMEOUT_MS);
  const cleanup = () => { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); };
  let current = value, headers = initialHeaders;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = await destination(current, signal);
      const response = await during(requestPinned(target.url, target.address, { method, headers, signal }), signal);
      const location = response.headers.get('location');
      if (REDIRECTS.has(response.status) && location) {
        await response.body?.cancel();
        if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
        const next = new URL(location, target.url);
        if (next.origin !== target.url.origin) {
          // Only public static preview vocabulary crosses an origin boundary.
          const forwarded = new Headers();
          for (const name of ['accept', 'accept-language', 'accept-encoding', 'user-agent', 'range']) {
            const header = headers.get(name); if (header !== null) forwarded.set(name, header);
          }
          headers = forwarded;
        }
        current = next.href; continue;
      }
      if (!response.body) { cleanup(); return response; }
      const reader = response.body.getReader();
      let finished = false;
      const finish = () => {
        if (finished) return; finished = true;
        signal.removeEventListener('abort', abortBody); cleanup();
      };
      let abortBody: () => void;
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          abortBody = () => {
            if (finished) return; stream.error(aborted(signal));
            void reader.cancel().catch(() => {}).finally(() => reader.releaseLock()); finish();
          };
          signal.addEventListener('abort', abortBody, { once: true });
          if (signal.aborted) abortBody();
        },
        async pull(stream) {
          try {
            const chunk = await reader.read(); if (finished) return;
            if (chunk.done) { stream.close(); finish(); reader.releaseLock(); }
            else stream.enqueue(chunk.value);
          } catch (error) { if (!finished) { stream.error(error); finish(); reader.releaseLock(); } }
        },
        async cancel(reason) { finish(); await reader.cancel(reason); reader.releaseLock(); },
      }, { highWaterMark: 0 });
      const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperties(result, { url: { value: target.url.href }, redirected: { value: hop > 0 } });
      return result;
    }
    throw new Error('Too many redirects');
  } catch (error) { controller.abort(error); cleanup(); throw error; }
}
