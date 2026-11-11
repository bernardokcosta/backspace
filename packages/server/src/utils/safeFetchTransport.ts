import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { Transform, pipeline } from 'node:stream';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';

export interface PinnedAddress { address: string; family: 4 | 6 }
interface PinnedRequest { method: 'GET' | 'HEAD'; headers: Headers; signal: AbortSignal }
const MAX_BYTES = 512_000;

function byteLimit(): Transform {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.byteLength;
    callback(bytes > MAX_BYTES ? new Error('External response byte limit exceeded') : null, bytes <= MAX_BYTES ? chunk : undefined);
  } });
}

/** Private to ssrf.ts: the URL and pin must already have passed its validation.
 * No second resolver, proxy, pooled socket or TLS identity override is allowed.
 */
export function requestPinned(url: URL, address: PinnedAddress, init: PinnedRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === 'https:', hostname = url.hostname.replace(/^\[|\]$/g, '');
    const options: https.RequestOptions & { autoSelectFamily: false } = {
      // The validated IP, never the original user URL, is socket authority.
      // The logical origin remains only HTTP Host/TLS identity and path data.
      hostname: address.address, port: Number(url.port || (secure ? 443 : 80)),
      path: url.pathname + url.search,
      method: init.method, headers: { ...Object.fromEntries(init.headers), host: url.host }, signal: init.signal,
      agent: false, family: address.family, autoSelectFamily: false, maxHeaderSize: 16_384,
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      ...(secure && !isIP(hostname) ? { servername: hostname } : {}),
    };
    let source: http.IncomingMessage | undefined, output: Transform | undefined;
    const request = (secure ? https : http).request(options, incoming => {
      source = incoming;
      const status = incoming.statusCode ?? 0;
      if (status < 200 || status > 599) { incoming.destroy(); reject(new Error('Invalid external response status')); return; }
      const headers = new Headers();
      try {
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
      } catch (error) { incoming.destroy(); reject(error); return; }
      const responseInit = { status, statusText: incoming.statusMessage, headers };
      if (init.method === 'HEAD' || [204, 205, 304].includes(status)) {
        incoming.destroy(); resolve(new Response(null, responseInit)); return;
      }
      const encoding = headers.get('content-encoding')?.trim().toLowerCase();
      const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate()
        : encoding === 'br' ? createBrotliDecompress() : undefined;
      if (encoding && encoding !== 'identity' && !decoder) {
        incoming.destroy(); reject(new Error('Unsupported response content encoding')); return;
      }
      if (decoder) { headers.delete('content-encoding'); headers.delete('content-length'); }
      const wire = byteLimit(); output = byteLimit();
      const abort = () => {
        const error = init.signal.reason instanceof Error ? init.signal.reason : new Error('External request aborted');
        request.destroy(error); incoming.destroy(error); wire.destroy(error); decoder?.destroy(error); output?.destroy(error);
      };
      const detach = () => init.signal.removeEventListener('abort', abort);
      init.signal.addEventListener('abort', abort, { once: true });
      output.once('close', detach); output.once('end', detach);
      const iterator = output[Symbol.asyncIterator]();
      let released = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(stream) {
          try {
            const next = await iterator.next();
            if (released) return;
            if (next.done) { released = true; stream.close(); }
            else stream.enqueue(next.value as Uint8Array);
          } catch (error) { if (!released) { released = true; stream.error(error); } }
        },
        async cancel() {
          released = true; output?.destroy(); incoming.destroy(); request.destroy();
          try { await iterator.return?.(); } catch { /* Cancellation can reject a pending iterator read. */ }
        },
      }, { highWaterMark: 0 });
      // pipeline couples backpressure, errors and cancellation all the way to
      // the socket, bounding encoded input as well as decompressed output.
      const completed = (error: NodeJS.ErrnoException | null) => { if (error) request.destroy(); detach(); };
      if (decoder) pipeline(incoming, wire, decoder, output, completed);
      else pipeline(incoming, wire, output, completed);
      try { resolve(new Response(body, responseInit)); }
      catch (error) { output.destroy(); incoming.destroy(); reject(error); }
      if (init.signal.aborted) abort();
    });
    request.on('error', error => { source?.destroy(error); output?.destroy(error); reject(error); });
    request.on('upgrade', (_incoming, socket) => { socket.destroy(); reject(new Error('External protocol upgrade refused')); });
    request.end();
  });
}
