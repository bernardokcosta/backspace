const cancelled = () => new DOMException('', 'AbortError');

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Per-client, per-target single flight; no global queue or mutation replay. */
export function createReadRecovery(
  getSession: () => string | null,
  retrySeconds: (error: unknown) => number | null,
) {
  let epoch = 0;
  const flights = new Map<string, { session: string | null; controller: AbortController; promise: Promise<unknown> }>();

  function run<T>(key: string, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const session = getSession();
    const existing = flights.get(key);
    if (existing?.session === session) return existing.promise as Promise<T>;
    if (existing) { existing.controller.abort(); flights.delete(key); }
    if (flights.size >= 1000) return Promise.reject(cancelled());
    const generation = epoch;
    const controller = new AbortController();
    const alive = () => !controller.signal.aborted && epoch === generation && getSession() === session;
    const promise = (async () => {
      for (let attempt = 0; ; attempt++) {
        if (!alive()) throw cancelled();
        try {
          const value = await abortable(read(controller.signal), controller.signal);
          if (!alive()) throw cancelled();
          return value;
        } catch (error) {
          if (!alive()) throw cancelled();
          const seconds = retrySeconds(error);
          if (attempt !== 0 || seconds === null || !Number.isFinite(seconds) || seconds < 1 || seconds > 60) throw error;
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await abortable(new Promise<void>(resolve => {
              timer = setTimeout(resolve, seconds * 1000 + Math.floor(Math.random() * 251));
            }), controller.signal);
          } finally { clearTimeout(timer); }
        }
      }
    })().finally(() => { if (flights.get(key)?.promise === promise) flights.delete(key); });
    flights.set(key, { session, controller, promise });
    return promise;
  }

  return { run, cancel() { epoch++; for (const entry of flights.values()) entry.controller.abort(); flights.clear(); } };
}
