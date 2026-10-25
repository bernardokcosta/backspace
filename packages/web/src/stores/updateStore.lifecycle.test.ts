import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../platform/platform', () => ({ isElectron: () => true }));
let store: typeof import('./updateStore').useUpdateStore;
let event: (snapshot: unknown) => void;
let reply: (snapshot: unknown) => void;
const unsub = vi.fn();
const stops: Array<() => void> = [];
const ready = { capability: 'auto', dismissedVersion: null, status: { phase: 'ready', version: '1.15.1' } };
beforeEach(async () => {
  vi.resetModules(); unsub.mockClear();
  window.backspace = { getVersion: async () => '1.15.0',
    getUpdateStatus: () => new Promise((resolve) => { reply = resolve; }),
    onUpdateStatusChanged: (listener: typeof event) => { event = listener; return unsub; },
  } as unknown as BackspaceElectronAPI;
  store = (await import('./updateStore')).useUpdateStore;
});
afterEach(() => { for (const stop of stops.splice(0)) stop(); delete window.backspace; });
describe('mandatory updater bridge lifecycle', () => {
  it('does not reuse ready state from a retired bridge while its replacement is loading', () => {
    const stop = store.getState().initialize(); stops.push(stop); event(ready); stop();
    stops.push(store.getState().initialize()); expect(store.getState().snapshot).toBeNull();
  });
  it('never lets a stale initial ready snapshot override a newer failure event', async () => {
    stops.push(store.getState().initialize());
    event({ ...ready, status: { phase: 'failed', version: '1.15.1', message: 'install failed' } });
    reply(ready); await Promise.resolve();
    expect(store.getState().snapshot?.status.phase).toBe('failed');
  });
  it('ignores snapshots after teardown and makes cleanup idempotent across subscribers', async () => {
    const one = store.getState().initialize(); const two = store.getState().initialize(); stops.push(one, two);
    one(); one(); expect(unsub).not.toHaveBeenCalled();
    two(); expect(unsub).toHaveBeenCalledOnce();
    event(ready); reply(ready); await Promise.resolve();
    expect(store.getState().snapshot).toBeNull();
  });
});
