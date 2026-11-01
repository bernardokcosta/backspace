import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagnosticReporter, recordDiagnostic, startDiagnosticCapture } from './diagnostics';

let dispose: (() => void) | undefined;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { dispose?.(); dispose = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const event = { event: 'runtime-error', subsystem: 'app', level: 'error' } as const;

describe('memory-only diagnostic reporting', () => {
  it('deduplicates safe events and sends no credentials, content or local persistence', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = createDiagnosticReporter({ send, version: '1.15.9' }); dispose = reporter.dispose;
    reporter.record({ ...event, message: 'private chat', token: 'secret' }); reporter.record(event);
    expect(reporter.pending()).toBe(1); await reporter.flush();
    const [url, options] = send.mock.calls[0]!;
    expect(url).toBe('/api/diagnostics'); expect(options).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(String(options?.body)).not.toMatch(/secret|private chat/);
    expect(JSON.parse(String(options?.body)).events[0]).toMatchObject({ version: '1.15.9', count: 2 });
    expect(storage).not.toHaveBeenCalled(); expect(reporter.pending()).toBe(0);
  });
  it('bounds pending memory to 100 records and expires offline events', async () => {
    const send = vi.fn<typeof fetch>(); let now = 10;
    const reporter = createDiagnosticReporter({ send, version: '1.15.9', now: () => now }); dispose = reporter.dispose;
    for (let i = 0; i < 200; i++) reporter.record({ ...event, reason: i });
    expect(reporter.pending()).toBe(100); now += 300_001;
    await reporter.flush(); expect(send).not.toHaveBeenCalled(); expect(reporter.pending()).toBe(0);
  });
  it('keeps even maximum-sized normalized batches under the server body limit', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const reporter = createDiagnosticReporter({ send, version: '999999.999999.999999-prerelease',
      context: () => ({ client: 'desktop', desktopVersion: '999999.999999.999999-prerelease' }) }); dispose = reporter.dispose;
    for (let reason = 0; reason < 10; reason++) reporter.record({ ...event, reason,
      route: '/' + Array(16).fill('federation-credential').join('/'),
      frames: Array(8).fill(`${'x'.repeat(100)}.tsx:99999999:99999999`),
      errorName: 'OverconstrainedError', errorCode: 'ERR_INTERNET_DISCONNECTED',
      state: 'signalReconnecting', directive: 'script-src-elem', status: 599,
      attempt: 10_000, durationMs: 86_400_000, method: 'OPTIONS' });
    await reporter.flush();
    expect(new TextEncoder().encode(String(send.mock.calls[0]?.[1]?.body)).byteLength).toBeLessThanOrEqual(16_384);
    expect(reporter.pending()).toBeGreaterThan(0);
    await reporter.flush(); expect(reporter.pending()).toBe(0);
  });
  it('retries failures only three times, without recursively logging them', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline token=secret'));
    const reporter = createDiagnosticReporter({ send, version: '1.15.9' }); dispose = reporter.dispose;
    reporter.record(event); await reporter.flush(); await reporter.flush(); await reporter.flush();
    expect(send).toHaveBeenCalledTimes(3); expect(reporter.pending()).toBe(0);
  });
  it('disables collection for older servers and ignores later events', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const reporter = createDiagnosticReporter({ send, version: '1.15.9' }); dispose = reporter.dispose;
    reporter.record(event); await reporter.flush(); reporter.record(event); await reporter.flush();
    expect(send).toHaveBeenCalledOnce(); expect(reporter.pending()).toBe(0);
  });
  it('aborts a stuck send and prevents further work after disposal', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const reporter = createDiagnosticReporter({ send, version: '1.15.9' }); dispose = reporter.dispose;
    reporter.record(event); const sending = reporter.flush(); reporter.dispose(); await sending;
    reporter.record(event); await vi.advanceTimersByTimeAsync(120_000);
    expect(send).toHaveBeenCalledOnce(); expect(reporter.pending()).toBe(0);
  });
  it('captures runtime and console failures using only metadata, and tears down listeners', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', send); vi.spyOn(console, 'error').mockImplementation(() => {});
    dispose = startDiagnosticCapture();
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('secret private chat') }));
    console.error('token=secret', new Error('private message'));
    recordDiagnostic({ event: 'voice-state', subsystem: 'voice', level: 'warning', state: 'reconnecting' });
    await vi.advanceTimersByTimeAsync(5000);
    const body = String(send.mock.calls[0]?.[1]?.body);
    expect(body).toContain('runtime-error'); expect(body).toContain('console-error'); expect(body).toContain('voice-state');
    expect(body).not.toMatch(/secret|private chat|private message/);
    dispose(); recordDiagnostic(event);
    await vi.advanceTimersByTimeAsync(10_000); expect(send).toHaveBeenCalledOnce();
  });
});
