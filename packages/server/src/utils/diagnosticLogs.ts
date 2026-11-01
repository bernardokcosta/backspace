import fs from 'node:fs';
import path from 'node:path';
import { diagnosticError, diagnosticRoute, normalizeDiagnostic, type DiagnosticEvent } from '@backspace/shared/src/diagnostics';

export const DIAGNOSTIC_LOG_MAX_BYTES = 4_500_000_000;
const SEGMENT_BYTES = 25_000_000;
const MAX_RECORD_BYTES = 16_384;
const SEGMENT_NAME = /^diagnostics-\d{15}\.jsonl$/;
interface Segment { name: string; size: number }

/** Single-process log directory; no handles/timers remain open across writes. */
export class DiagnosticLogStore {
  private segments: Segment[] = [];
  private bytes = 0;
  private dropped = 0;
  private writeFailures = 0;
  private available = false;
  private next = 0;
  private readonly maxBytes: number;
  private readonly segmentBytes: number;

  constructor(private readonly directory: string, options: { maxBytes?: number; segmentBytes?: number } = {}) {
    this.maxBytes = Math.min(DIAGNOSTIC_LOG_MAX_BYTES, options.maxBytes ?? DIAGNOSTIC_LOG_MAX_BYTES);
    this.segmentBytes = Math.min(this.maxBytes, options.segmentBytes ?? SEGMENT_BYTES);
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1 || !Number.isSafeInteger(this.segmentBytes) || this.segmentBytes < 1) return;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) return;
      for (const name of fs.readdirSync(directory).sort()) {
        if (!SEGMENT_NAME.test(name)) continue;
        const stat = fs.lstatSync(path.join(directory, name));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return;
        this.segments.push({ name, size: stat.size }); this.bytes += stat.size;
        this.next = Math.max(this.next, Number(name.slice(12, 27)) + 1);
      }
      this.prune(0);
      this.available = true;
    } catch { this.writeFailures++; }
  }

  private prune(incoming: number): void {
    while (this.bytes + incoming > this.maxBytes && this.segments.length) {
      const oldest = this.segments[0]!;
      fs.unlinkSync(path.join(this.directory, oldest.name));
      this.bytes -= oldest.size; this.segments.shift();
    }
  }

  append(record: object): boolean {
    let line: string;
    try { line = `${JSON.stringify(record)}\n`; } catch { this.dropped++; return false; }
    const size = Buffer.byteLength(line);
    if (!this.available || size > MAX_RECORD_BYTES || size > this.segmentBytes) { this.dropped++; return false; }
    try {
      this.prune(size);
      let segment = this.segments.at(-1);
      if (!segment || segment.size + size > this.segmentBytes) {
        if (this.next > 999_999_999_999_999) throw new Error('Log sequence exhausted');
        segment = { name: `diagnostics-${String(this.next++).padStart(15, '0')}.jsonl`, size: 0 };
        // Exclusive creation prevents accidentally following a planted link.
        fs.closeSync(fs.openSync(path.join(this.directory, segment.name), 'wx', 0o600));
        this.segments.push(segment);
      }
      const filename = path.join(this.directory, segment.name);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== segment.size) throw new Error('Log directory changed');
      fs.appendFileSync(filename, line, { encoding: 'utf8', flag: 'a' });
      segment.size += size; this.bytes += size;
      return true;
    } catch {
      this.writeFailures++; this.dropped++;
      // A partial disk write must not leave accounting behind the actual size.
      this.available = false;
      return false;
    }
  }

  stats() { return { bytes: this.bytes, maxBytes: this.maxBytes, files: this.segments.length,
    dropped: this.dropped, writeFailures: this.writeFailures, available: this.available }; }
}

export function writeDiagnostic(store: DiagnosticLogStore, source: 'client' | 'server', event: DiagnosticEvent): void {
  const safe = normalizeDiagnostic(event);
  if (safe) store.append({ receivedAt: Date.now(), source, ...safe });
}

/** Pino's existing stream seam; never persist free-text messages or objects. */
export function diagnosticLoggerStream(store: DiagnosticLogStore, output = (line: string) => { process.stdout.write(line); }) {
  return { write(line: string): void {
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const req = raw.req as { method?: unknown; url?: unknown } | undefined;
      const res = raw.res as { statusCode?: unknown } | undefined;
      let directive: unknown;
      if (typeof raw.csp === 'string') {
        try {
          const report = JSON.parse(raw.csp) as Record<string, unknown> | Array<{ body?: Record<string, unknown> }>;
          const details = Array.isArray(report) ? report[0]?.body : report['csp-report'] as Record<string, unknown> | undefined;
          const value = details?.effectiveDirective ?? details?.['violated-directive'];
          if (typeof value === 'string') directive = value.split(' ', 1)[0];
        } catch { /* An invalid CSP report still records its event, never its text. */ }
      }
      const safe = normalizeDiagnostic({ event: typeof raw.csp === 'string' ? 'csp-violation' : 'server-log',
        subsystem: typeof raw.csp === 'string' ? 'security' : 'server', version: raw.version, directive,
        level: typeof raw.level === 'number' && raw.level >= 50 ? 'error' : typeof raw.level === 'number' && raw.level >= 40 ? 'warning' : 'info',
        method: req?.method, route: diagnosticRoute(req?.url), status: res?.statusCode,
        durationMs: typeof raw.responseTime === 'number' ? Math.round(raw.responseTime) : undefined,
        ...diagnosticError(raw.err) });
      if (!safe) return;
      const record = { receivedAt: Date.now(), source: 'server', ...safe,
        ...(typeof raw.reqId === 'string' && /^req-[a-z0-9]{1,16}$/.test(raw.reqId) ? { requestId: raw.reqId } : {}) };
      store.append(record); output(`${JSON.stringify(record)}\n`);
    } catch { /* Diagnostics must never turn logging into an application failure. */ }
  } };
}

/** Existing console output gets safe call-site metadata, never its arguments. */
export function captureServerConsole(store: DiagnosticLogStore, version?: string): () => void {
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    console[method] = (...args: unknown[]) => {
      const error = args.find(arg => arg instanceof Error);
      const details = diagnosticError(error ?? new Error());
      if (!error) delete details.errorName;
      const event: DiagnosticEvent = { event: 'server-console', subsystem: 'server', version,
        level: method === 'warn' ? 'warning' : method === 'error' ? 'error' : 'info', ...details };
      writeDiagnostic(store, 'server', event);
      process.stderr.write(`${JSON.stringify({ source: 'server', ...event })}\n`);
    };
  }
  return () => { console.log = originals.log; console.info = originals.info; console.warn = originals.warn; console.error = originals.error; };
}

/** A monitor alone leaves Node's raw exception printer active. Handle fatal
 * errors synchronously and exit: never resume execution after an uncaught error.
 * Default fatal unhandled rejections enter this same uncaught-exception path. */
export function installFatalDiagnostics(store: DiagnosticLogStore, version?: string): () => void {
  const onFatal = (error: unknown) => {
    const event: DiagnosticEvent = { event: 'server-log', subsystem: 'server', level: 'error', version };
    try {
      Object.assign(event, diagnosticError(error));
      writeDiagnostic(store, 'server', event);
      fs.writeSync(2, `${JSON.stringify({ receivedAt: Date.now(), source: 'server', ...event })}\n`);
    } catch {
      // Even an invalid error object or full disk cannot re-enable raw output.
      try { fs.writeSync(2, '{"source":"server","event":"server-log","subsystem":"server","level":"error"}\n'); } catch { /* Exit regardless. */ }
    } finally {
      process.exit(1);
    }
  };
  process.prependListener('uncaughtException', onFatal);
  return () => { process.removeListener('uncaughtException', onFatal); };
}
