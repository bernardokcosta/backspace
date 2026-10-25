import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederationRegistryEntry, User } from '@backspace/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
class Socket {
  static OPEN = 1; static CONNECTING = 0; static all: Socket[] = [];
  readyState = 1; onopen = null; onclose = null; onmessage = null; onerror = null;
  constructor(readonly url: string) { Socket.all.push(this); }
  close() { this.readyState = 3; } send() {}
}
vi.stubGlobal('WebSocket', Socket);
const { useInstanceStore } = await import('./instanceStore');
const { useAuthStore } = await import('./authStore');
const { createApiClient } = await import('../api/client');
const { connectInstance, disconnectAllRemote, wsSend } = await import('../hooks/useWebSocket');
const { setDesktopSessionAllowed } = await import('../utils/desktopSessionAccess');
const PEER = 'https://resume.test'; const MANUAL = 'https://manual.test';
beforeEach(() => {
  localStorage.clear(); setDesktopSessionAllowed(true);
  useInstanceStore.setState({ instances: [], registry: new Map(), _autoConnectDone: false, _registrySyncReady: false });
});
afterEach(() => { useAuthStore.setState({ user: null, token: null }); setDesktopSessionAllowed(false); setDesktopSessionAllowed(true); disconnectAllRemote(); Socket.all = []; vi.restoreAllMocks(); });
describe('real remote store/socket suspension and recovery', () => {
  it.each([['registry', false], ['remote-verification', false], ['remote-verification', true]])('resumes interrupted bootstrap at %s (disconnect during pause: %s) without duplicate attempts', async (pauseAt, disconnectWhilePaused) => {
    const user = { id: 'bootstrap', username: 'user', homeInstance: null, homeUserId: null,
      replicatedInstances: [PEER, MANUAL].map((origin) => ({ origin, domain: new URL(origin).host, username: 'user' })) } as unknown as User;
    useAuthStore.setState({ token: 'home-token', user }); localStorage.setItem('backspace_token', 'home-token');
    localStorage.setItem('backspace_instances_bootstrap', JSON.stringify(Object.fromEntries([PEER, MANUAL].map((origin) => [origin, { token: 'remote-token', label: 'Peer', username: 'user' }]))));
    const registry: FederationRegistryEntry[] = [PEER, MANUAL].map((origin) => ({ origin, label: 'Peer', username: 'user', remoteUserId: 'user',
      status: origin === MANUAL ? 'disconnected' : 'connected', addedAt: 1, lastConnectedAt: 1, disconnectedAt: origin === MANUAL ? 1 : null, errorMessage: null }));
    let finish: (value: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => { finish = resolve; });
    let registryReads = 0; let remoteReads = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith('/federation-registry') && options?.method === 'GET') {
        if (++registryReads === 1 && pauseAt === 'registry') return held;
        return new Response(JSON.stringify({ registry, updatedAt: 1 }));
      }
      if (url === `${PEER}/api/users/@me`) {
        if (++remoteReads === 1 && pauseAt === 'remote-verification') return held;
        return new Response(JSON.stringify(user));
      }
      return new Response(JSON.stringify(url.endsWith('/instance/info') ? { name: 'Peer' } : { ok: true, updatedAt: 1, peeringStatus: 'active' }));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = useInstanceStore.getState().autoConnectAll();
    const duplicate = useInstanceStore.getState().autoConnectAll();
    await vi.waitFor(() => expect(pauseAt === 'registry' ? registryReads : remoteReads).toBeGreaterThan(0));
    setDesktopSessionAllowed(false);
    if (disconnectWhilePaused) useInstanceStore.getState().disconnectInstance(PEER);
    setDesktopSessionAllowed(true);
    finish(new Response(JSON.stringify(pauseAt === 'registry' ? { registry, updatedAt: 1 } : user)));
    await Promise.all([first, duplicate]);
    await vi.waitFor(() => expect(useInstanceStore.getState()._autoConnectDone).toBe(true));
    expect(registryReads).toBe(2); expect(remoteReads).toBe(pauseAt === 'registry' || disconnectWhilePaused ? 1 : 2);
    expect(Socket.all).toHaveLength(disconnectWhilePaused ? 0 : 1); expect(wsSend({ type: 'ping' }, PEER)).toBe(!disconnectWhilePaused);
    if (disconnectWhilePaused) expect(useInstanceStore.getState().registry.get(PEER)?.status).toBe('disconnected');
    expect(fetcher.mock.calls.some(([url]) => String(url).startsWith(MANUAL))).toBe(false);
    expect(useInstanceStore.getState().registry.get(MANUAL)?.status).toBe('disconnected');
    expect(useAuthStore.getState().user?.id).toBe('bootstrap');
  });
  it('does not resume an interrupted initialization for a different account', async () => {
    const user = { id: 'old-user', username: 'old', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
    useAuthStore.setState({ token: 'old-token', user });
    let finish: (response: Response) => void = () => {};
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const initialization = useInstanceStore.getState().autoConnectAll();
    setDesktopSessionAllowed(false);
    useAuthStore.setState({ token: 'new-token', user: { ...user, id: 'different-user' } });
    setDesktopSessionAllowed(true); finish(new Response(JSON.stringify({ registry: [], updatedAt: 1 })));
    await initialization;
    expect(fetcher).toHaveBeenCalledOnce(); expect(Socket.all).toHaveLength(0);
    expect(useInstanceStore.getState()._autoConnectDone).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('different-user');
  });
  it('does not strand initialization when the same account refreshes its token', async () => {
    const user = { id: 'same-user', username: 'same', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
    useAuthStore.setState({ token: 'old-token', user });
    let finish: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const initialization = useInstanceStore.getState().autoConnectAll();
    useAuthStore.setState({ token: 'refreshed-token' });
    finish(new Response(JSON.stringify({ registry: [], updatedAt: 1 }))); await initialization;
    expect(useInstanceStore.getState()._autoConnectDone).toBe(true);
    expect(useAuthStore.getState().token).toBe('refreshed-token');
  });
  it('does not let an attempt from before a store reset complete the new lifecycle', async () => {
    const user = { id: 'same-user', username: 'same', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
    useAuthStore.setState({ token: 'token', user });
    let finish: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const initialization = useInstanceStore.getState().autoConnectAll();
    useInstanceStore.getState().reset();
    finish(new Response(JSON.stringify({ registry: [], updatedAt: 1 }))); await initialization;
    expect(useInstanceStore.getState()._autoConnectDone).toBe(false);
  });
  it('keeps the latest interrupted bootstrap when an older reply arrives during another pause', async () => {
    const user = { id: 'repeat-user', username: 'same', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
    useAuthStore.setState({ token: 'token', user });
    let firstReply: (response: Response) => void = () => {};
    let secondReply: (response: Response) => void = () => {};
    const empty = () => new Response(JSON.stringify({ registry: [], updatedAt: 1 }));
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => { firstReply = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { secondReply = resolve; }))
      .mockResolvedValueOnce(empty());
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = useInstanceStore.getState().autoConnectAll();
    setDesktopSessionAllowed(false); setDesktopSessionAllowed(true);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    setDesktopSessionAllowed(false); firstReply(empty()); await first;
    setDesktopSessionAllowed(true); secondReply(empty());
    await vi.waitFor(() => expect(useInstanceStore.getState()._autoConnectDone).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('restores eligible sockets after allow without restoring a voluntary disconnect', async () => {
    setDesktopSessionAllowed(true);
    const user = { id: 'user', username: 'user', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
    useAuthStore.setState({ token: 'home-token', user });
    const registry = new Map([[MANUAL, { origin: MANUAL, label: 'Manual', username: 'user', remoteUserId: 'user', status: 'disconnected' as const, addedAt: 1, lastConnectedAt: 1, disconnectedAt: 1, errorMessage: null }]]);
    useInstanceStore.setState({ instances: [
      { origin: PEER, label: 'Resume', username: 'user', token: 'remote-token', user, status: 'connected', api: createApiClient(PEER, () => 'remote-token') },
      { origin: MANUAL, label: 'Manual', username: 'user', token: 'manual-token', user, status: 'disconnected', api: createApiClient(MANUAL, () => 'manual-token') },
    ], registry });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith('/users/@me') ? user : String(url).endsWith('/instance/info') ? { name: 'Resume' } : { peeringStatus: 'active' })));
    connectInstance(PEER, 'remote-token'); expect(Socket.all).toHaveLength(1);
    setDesktopSessionAllowed(false); expect(Socket.all[0]!.readyState).toBe(3);
    setDesktopSessionAllowed(true);
    await vi.waitFor(() => expect(Socket.all).toHaveLength(2));
    expect(wsSend({ type: 'ping' }, PEER)).toBe(true);
    expect(useInstanceStore.getState().instances.find((entry) => entry.origin === MANUAL)?.status).toBe('disconnected');
    expect(useInstanceStore.getState().registry.get(MANUAL)?.status).toBe('disconnected');
    expect(useInstanceStore.getState().instances.find((entry) => entry.origin === PEER)?.token).toBe('remote-token');
  });
});
