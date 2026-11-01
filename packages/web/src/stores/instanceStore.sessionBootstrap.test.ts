import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@backspace/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ connectInstance: vi.fn(), disconnectInstance: vi.fn(), disconnectAllRemote: vi.fn() }));
import { useAuthStore } from './authStore';
import { useInstanceStore } from './instanceStore';

const user = { id: 'user', username: 'user', homeInstance: null, homeUserId: null, replicatedInstances: [] } as unknown as User;
beforeEach(() => {
  useInstanceStore.getState().reset();
  useAuthStore.setState({ token: 'token', user });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('federation bootstrap session ownership', () => {
  it.each(['account', 'reset', 'refresh', 'duplicate'] as const)('handles %s changes while registry lookup is pending', async (change) => {
    let finish!: (response: Response) => void;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const initialization = useInstanceStore.getState().autoConnectAll();
    let duplicate: Promise<void> | undefined;
    if (change === 'account') useAuthStore.setState({ token: 'other', user: { ...user, id: 'other' } });
    if (change === 'reset') useInstanceStore.getState().reset();
    if (change === 'refresh') useAuthStore.setState({ token: 'refreshed' });
    if (change === 'duplicate') duplicate = useInstanceStore.getState().autoConnectAll();
    finish(new Response(JSON.stringify({ registry: [], updatedAt: 1 })));
    await Promise.all([initialization, duplicate]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(useInstanceStore.getState()._autoConnectDone).toBe(change === 'refresh' || change === 'duplicate');
  });
});
