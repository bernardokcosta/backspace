import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ isElectron: vi.fn() }));
vi.mock('../platform/platform', () => platform);
let store: typeof import('./desktopCompatibilityStore').useDesktopCompatibilityStore;
let dispose: (() => void) | undefined;
const getVersion = vi.fn();
function policy(value: unknown = '1.15.1') { return new Response(JSON.stringify({ minimumDesktopVersion: value }), { status: 200 }); }
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); platform.isElectron.mockReturnValue(true);
  getVersion.mockReset().mockResolvedValue('1.15.0');
  window.backspace = { getVersion } as unknown as BackspaceElectronAPI;
  vi.stubGlobal('fetch', vi.fn(async () => policy()));
  store = (await import('./desktopCompatibilityStore')).useDesktopCompatibilityStore;
});
afterEach(() => { dispose?.(); dispose = undefined; delete window.backspace; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function begin() { dispose = store.getState().initialize(); await vi.advanceTimersByTimeAsync(0); }
describe('serving-instance desktop compatibility lifecycle', () => {
  it('allows browsers without any IPC or policy fetch', async () => {
    platform.isElectron.mockReturnValue(false); await begin();
    expect(store.getState().phase).toBe('allowed'); expect(fetch).not.toHaveBeenCalled(); expect(getVersion).not.toHaveBeenCalled();
  });
  it.each([null, undefined])('allows disabled/missing policy %s without requiring a host version', async (value) => {
    vi.mocked(fetch).mockResolvedValueOnce(value === undefined ? new Response('{}') : policy(value));
    delete window.backspace; await begin(); expect(store.getState().phase).toBe('allowed');
  });
  it.each([['1.15.0', 'required'], ['1.15.1-beta.1', 'required'], ['1.15.1', 'allowed'], ['1.16.0+build', 'allowed']])('handles installed %s as %s', async (version, phase) => {
    getVersion.mockResolvedValueOnce(version); await begin(); expect(store.getState()).toMatchObject({ phase, currentVersion: version, minimumVersion: '1.15.1' });
  });
  it('keeps unavailable or invalid installed versions blocked', async () => {
    getVersion.mockResolvedValueOnce('not-a-version'); await begin();
    expect(store.getState().phase).not.toBe('allowed');
    getVersion.mockRejectedValueOnce(new Error('IPC unavailable')); store.getState().retry(); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().phase).not.toBe('allowed');
  });
  it('fails closed on initial timeout and ignores its late disabled-policy response', async () => {
    let reply: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    await begin(); expect(store.getState().phase).toBe('checking');
    await vi.advanceTimersByTimeAsync(8001); expect(store.getState().phase).toBe('failed');
    reply(policy(null)); await vi.advanceTimersByTimeAsync(0); expect(store.getState().phase).toBe('failed');
  });
  it('preserves a known required floor across failure and unlocks only after fresh successful policy removal', async () => {
    await begin(); expect(store.getState().phase).toBe('required');
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline')); store.getState().retry(); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ phase: 'required', minimumVersion: '1.15.1' });
    vi.mocked(fetch).mockResolvedValueOnce(policy(null)); store.getState().retry(); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ phase: 'allowed', minimumVersion: null });
  });
  it.each(['', '1.15.1-beta.1', 1151, 'v1.15.1'])('rejects malformed policy %s rather than treating it as disabled', async (minimum) => {
    vi.mocked(fetch).mockResolvedValueOnce(policy(minimum)); await begin(); expect(store.getState().phase).toBe('failed');
  });
  it('does not unmount an allowed app just to poll, but revokes allow when the floor rises', async () => {
    getVersion.mockResolvedValue('1.15.1'); await begin(); expect(store.getState().phase).toBe('allowed');
    let reply: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    await vi.advanceTimersByTimeAsync(60_000); expect(store.getState().phase).toBe('allowed');
    reply(policy('1.15.2')); await vi.advanceTimersByTimeAsync(0); expect(store.getState().phase).toBe('required');
  });
  it('rejects stale responses after retry and disposal', async () => {
    let late: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
    await begin(); store.getState().retry(); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().phase).toBe('required'); late(policy(null)); await vi.advanceTimersByTimeAsync(0);
    expect(store.getState().phase).toBe('required');
    dispose!(); dispose = undefined;
    await vi.advanceTimersByTimeAsync(120_000); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('only serving-origin refusals recheck policy and reference-counts StrictMode subscriptions', async () => {
    await begin(); const second = store.getState().initialize();
    const { noteDesktopPolicyRefused } = await import('../utils/desktopPolicyEvents');
    noteDesktopPolicyRefused('https://peer.test'); await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(1);
    noteDesktopPolicyRefused(''); await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(2);
    second(); second();
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(0); expect(fetch).toHaveBeenCalledTimes(3);
    dispose!(); dispose = undefined;
    window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(60_000); expect(fetch).toHaveBeenCalledTimes(3);
  });
});
