import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const fixture = fileURLToPath(new URL('./fixtures/desktop-compatibility/', import.meta.url));
const METHODS = ['getVersion', 'getUpdateStatus', 'getRecoveryState', 'checkForUpdates',
  'installUpdate', 'openReleasePage', 'openExternal', 'minimize', 'maximize', 'close'];

function validate({ listen, port, output }) {
  if (listen !== '127.0.0.1') throw new Error('Desktop probe is loopback-only (127.0.0.1)');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid probe port');
  if (typeof output !== 'string' || !path.isAbsolute(output)) throw new Error('Probe output must be an absolute new file path');
}

export function readProbeOptions(args) {
  const { values } = parseArgs({ args, options: {
    listen: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '3088' }, output: { type: 'string' },
  }, allowPositionals: false, strict: true });
  if (!/^\d{1,5}$/.test(values.port)) throw new Error('Invalid probe port');
  const options = { ...values, port: Number(values.port) };
  validate(options);
  if (!options.port) throw new Error('CLI probe port must not be zero');
  return options;
}

function clientMetadata(value) {
  const data = typeof value === 'object' && value !== null ? value : {};
  const version = typeof data.version === 'string' && data.version.length <= 128
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(data.version) ? data.version : null;
  return {
    version,
    platform: ['win32', 'darwin', 'linux'].includes(data.platform) ? data.platform : null,
    bridgeMethods: Object.fromEntries(METHODS.filter((name) => data.bridgeMethods?.[name] === true).map((name) => [name, true])),
    updateMode: ['auto', 'manual', 'external'].includes(data.updateMode) ? data.updateMode : null,
  };
}

/** Diagnostic only: no account, API proxy, media, service worker or updater download. */
export function createCompatibilityProbe(options) {
  validate(options);
  const evidence = fs.openSync(options.output, 'wx', 0o600);
  const sockets = new Set();
  let closed = false;
  let count = 0;
  let origin = '';
  function record(request, extra) {
    if (count >= 128 || closed) return;
    const ua = String(request.headers['user-agent'] ?? '').slice(0, 512).replace(/[^\x20-\x7e]/g, '')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
    fs.writeSync(evidence, JSON.stringify({ at: new Date().toISOString(), userAgent: ua, ...extra }) + '\n');
    count++;
  }
  function allowed(request) {
    return request.socket.remoteAddress === '127.0.0.1' && request.headers.host === new URL(origin).host;
  }
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), display-capture=()');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowed(request)) { response.writeHead(403).end(); return; }
    // Paths/queries, credentials, arbitrary headers and client content are
    // deliberately never written, including on malformed/unknown requests.
    let route;
    try { route = new URL(request.url, origin).pathname; }
    catch { response.writeHead(400).end(); return; }
    if (request.method === 'GET' && (route === '/' || route === '/probe.js')) {
      record(request, { transport: 'http', surface: route === '/' ? 'document' : 'script' });
      response.setHeader('Content-Type', route === '/' ? 'text/html; charset=utf-8' : 'text/javascript');
      response.end(fs.readFileSync(path.join(fixture, route === '/' ? 'index.html' : 'probe.js')));
      return;
    }
    if (request.method !== 'POST' || route !== '/probe/report') { response.writeHead(404).end(); return; }
    if (request.headers.origin !== origin) { response.writeHead(403).end(); return; }
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) { if (!response.writableEnded) response.writeHead(413).end(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (response.writableEnded) return;
      try {
        const client = clientMetadata(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        record(request, { transport: 'http', surface: 'bridge-report', client });
        response.writeHead(204).end();
      } catch { response.writeHead(400).end(); }
    });
    request.on('error', () => { if (!response.writableEnded) response.writeHead(400).end(); });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    if (!allowed(request) || (request.headers.origin && request.headers.origin !== origin)
        || request.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
      socket.destroy(); return;
    }
    record(request, { transport: 'websocket', clientFrames: 'not-read' });
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    // A clean diagnostic close, never read a token-bearing auth/data frame.
    socket.end(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
  });
  const instance = {
    server,
    get origin() { return origin; },
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.listen, () => {
          server.removeListener('error', reject);
          origin = `http://127.0.0.1:${server.address().port}`;
          resolve();
        });
      }).catch((error) => { fs.closeSync(evidence); closed = true; throw error; });
      return origin;
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      fs.closeSync(evidence);
    },
  };
  return instance;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = readProbeOptions(process.argv.slice(2));
  const probe = createCompatibilityProbe(options);
  await probe.start();
  console.log(`Loopback desktop probe: ${probe.origin} (no account/media). Evidence: ${options.output}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void probe.close().then(() => { process.exitCode = 0; }); });
}
