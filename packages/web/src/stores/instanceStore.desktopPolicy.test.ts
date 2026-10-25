import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@backspace/shared';
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
afterEach(() => { useAuthStore.setState({ user: null, token: null }); setDesktopSessionAllowed(false); setDesktopSessionAllowed(true); disconnectAllRemote(); Socket.all = []; vi.restoreAllMocks(); });
describe('real remote store/socket suspension and recovery', () => {
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
