import { diagnosticError, diagnosticLocation, normalizeDiagnostic, type DiagnosticEvent } from '@backspace/shared/src/diagnostics';
import { version } from '../../package.json';

interface Entry { event: DiagnosticEvent; key: string; createdAt: number; attempts: number }
interface ReporterOptions {
  send: typeof fetch;
  version: string;
  context?: () => Pick<DiagnosticEvent, 'client' | 'desktopVersion'>;
  now?: () => number;
}

/** No stores, tokens, persistence, third-party origins or application imports. */
export function createDiagnosticReporter(options: ReporterOptions) {
  let queue: Entry[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sending = false;
  let disposed = false;
  let controller: AbortController | null = null;
  let inFlight = new Set<Entry>();
  const now = options.now ?? Date.now;
  const expire = () => { queue = queue.filter(entry => now() - entry.createdAt < 300_000 && now() >= entry.createdAt); };
  const schedule = (delay = 5000) => {
    if (disposed || timer !== undefined || !queue.length) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, delay);
  };

  function record(value: unknown): void {
    if (disposed) return;
    const safe = normalizeDiagnostic(value);
    if (!safe) return;
    const event = normalizeDiagnostic({ ...safe, version: options.version, ...options.context?.(), at: now(), count: 1 });
    if (!event) return;
    expire();
    const key = JSON.stringify({ ...event, at: undefined, count: undefined });
    const duplicate = queue.find(entry => !inFlight.has(entry) && entry.key === key && now() - entry.createdAt < 60_000);
    if (duplicate) duplicate.event.count = Math.min(10_000, (duplicate.event.count ?? 1) + 1);
    else if (queue.length < 100) queue.push({ event, key, createdAt: now(), attempts: 0 });
    schedule();
  }

  async function flush(keepalive = false): Promise<void> {
    if (disposed || sending) return;
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    expire();
    if (!queue.length) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) { schedule(30_000); return; }
    const batch = queue.slice(0, 10);
    let body = JSON.stringify({ events: batch.map(entry => entry.event) });
    while (batch.length && new TextEncoder().encode(body).byteLength > 16_384) {
      batch.pop(); body = JSON.stringify({ events: batch.map(entry => entry.event) });
    }
    if (!batch.length) { queue.shift(); schedule(); return; }
    inFlight = new Set(batch); sending = true;
    const abort = new AbortController(); controller = abort;
    const timeout = setTimeout(() => abort.abort(), 5000);
    let retryDelay = 5000;
    try {
      const response = await options.send('/api/diagnostics', { method: 'POST', credentials: 'omit',
        redirect: 'error', cache: 'no-store', keepalive, signal: abort.signal,
        headers: { 'Content-Type': 'application/json' }, body });
      if (response.status === 404 || response.status === 410) { dispose(); return; }
      if (response.ok || response.status === 400 || response.status === 413) queue = queue.filter(entry => !inFlight.has(entry));
      else {
        for (const entry of batch) entry.attempts++;
        retryDelay = response.status === 429 ? 60_000 : 30_000;
      }
      void response.body?.cancel().catch(() => {});
    } catch {
      for (const entry of batch) entry.attempts++;
      retryDelay = 30_000;
      // Reporting failures are deliberately silent: never report the reporter.
    } finally {
      clearTimeout(timeout); controller = null; sending = false; inFlight.clear();
      queue = queue.filter(entry => entry.attempts < 3);
      schedule(retryDelay);
    }
  }

  function dispose(): void {
    disposed = true; queue = []; controller?.abort();
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  return { record, flush, dispose, pending: () => queue.length };
}

let reporter: ReturnType<typeof createDiagnosticReporter> | null = null;
export function recordDiagnostic(event: DiagnosticEvent): void { reporter?.record(event); }

/** Install before ordinary application modules; teardown is also HMR-safe. */
export function startDiagnosticCapture(): () => void {
  if (typeof window === 'undefined' || reporter) return () => {};
  let desktopVersion: string | undefined;
  const current = createDiagnosticReporter({ send: (...args) => fetch(...args), version,
    context: () => ({ client: typeof window.backspace === 'undefined' ? 'web' : 'desktop', desktopVersion }) });
  reporter = current;
  const disposers: Array<() => void> = [];
  const report = (event: DiagnosticEvent['event'], error: unknown) => current.record({ event, subsystem: 'app', level: 'error', ...diagnosticError(error) });
  const onError = (event: ErrorEvent) => {
    const details = diagnosticError(event.error);
    current.record({ event: 'runtime-error', subsystem: 'app', level: 'error',
      ...details, ...(!details.frames ? diagnosticLocation(event.filename, event.lineno, event.colno) : {}) });
  };
  const onRejection = (event: PromiseRejectionEvent) => report('unhandled-rejection', event.reason);
  const onOnline = () => { void current.flush(); };
  const onPageHide = () => { void current.flush(true); };
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('online', onOnline); window.addEventListener('pagehide', onPageHide);
  disposers.push(() => {
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('online', onOnline); window.removeEventListener('pagehide', onPageHide);
  });
  for (const method of ['warn', 'error'] as const) {
    const original = console[method];
    const wrapped = (...args: unknown[]) => {
      try {
        const error = args.find(arg => arg instanceof Error || arg instanceof DOMException) ?? new Error();
        current.record({ event: method === 'warn' ? 'console-warning' : 'console-error', subsystem: 'app',
          level: method === 'warn' ? 'warning' : 'error', ...diagnosticError(error) });
      } catch { /* Never interfere with the original console operation. */ }
      original.apply(console, args);
    };
    console[method] = wrapped;
    disposers.push(() => { if (console[method] === wrapped) console[method] = original; });
  }
  const desktop = window.backspace;
  if (desktop) {
    let alive = true;
    disposers.push(() => { alive = false; });
    Promise.resolve().then(() => desktop.getVersion?.()).then(value => {
      if (alive && typeof value === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) desktopVersion = value;
    }).catch(() => {});
    const recovery = (value: RecoveryState) => {
      if (value?.reason) current.record({ event: 'desktop-recovery', subsystem: 'desktop', level: 'error', state: value.reason.code });
    };
    const update = (value: unknown) => {
      if (typeof value !== 'object' || value === null) return;
      const status = (value as { status?: { phase?: unknown } }).status;
      if (status?.phase === 'failed' || status?.phase === 'ready') current.record({ event: 'desktop-update', subsystem: 'desktop',
        level: status.phase === 'failed' ? 'warning' : 'info', state: status.phase });
    };
    // Feature detection preserves old installed shells; no extra privileged IPC.
    try {
      if (typeof desktop.onRecoveryStateChanged === 'function') disposers.push(desktop.onRecoveryStateChanged(recovery));
      if (typeof desktop.getRecoveryState === 'function') void desktop.getRecoveryState().then(value => { if (alive) recovery(value); }).catch(() => {});
      if (typeof desktop.onUpdateStatusChanged === 'function') disposers.push(desktop.onUpdateStatusChanged(update));
      if (typeof desktop.getUpdateStatus === 'function') void desktop.getUpdateStatus().then(value => { if (alive) update(value); }).catch(() => {});
      // Legacy callback has no unsubscribe. Its closure is inert after disposal.
      if (typeof desktop.onKeybindHookError === 'function') desktop.onKeybindHookError(() => {
        if (alive) current.record({ event: 'desktop-keybind', subsystem: 'desktop', level: 'error' });
      });
    } catch { /* An unavailable bridge must never block startup. */ }
  }
  return () => {
    for (const dispose of disposers) { try { dispose(); } catch { /* Best effort. */ } }
    current.dispose(); if (reporter === current) reporter = null;
  };
}
