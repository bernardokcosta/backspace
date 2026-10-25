import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import type { User } from '@backspace/shared';
import { api, createApiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useInstanceStore, type ConnectedInstance } from '../stores/instanceStore';
import { NotConnectedError } from '../stores/spaceStore';
import { setDesktopSessionAllowed } from './desktopSessionAccess';
import { sendInviteJoinRequest } from './inviteJoinRequest';

const REMOTE = 'https://orbit.example';
const OTHER = 'https://nova.example';
const user = { id: 'me', username: 'mira' } as User;
function remote(origin: string, status: ConnectedInstance['status'] = 'connected'): ConnectedInstance {
  return { origin, label: origin, status, token: 'remote-token', username: 'mira', user,
    api: createApiClient(origin, () => 'remote-token') };
}
function answer(status = 201, body: unknown = { id: 'r1', spaceId: 'same-id', status: 'pending' }) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  setDesktopSessionAllowed(true);
  useAuthStore.setState({ token: 'account-a', user });
  localStorage.setItem('backspace_token', 'account-a');
  useInstanceStore.setState({ instances: [remote(REMOTE), remote(OTHER)] });
  vi.stubGlobal('fetch', vi.fn(async () => answer()));
});
afterEach(() => { vi.unstubAllGlobals(); setDesktopSessionAllowed(true); useInstanceStore.setState({ instances: [] }); });

describe('retained invitation join requests', () => {
  it.each(['', REMOTE, OTHER])('sends same-id only to its connected origin %s without discovery', async (origin) => {
    expect(await sendInviteJoinRequest('same-id', origin, 'hello')).toBe('sent');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${origin}/api/spaces/same-id/request-join`, expect.objectContaining({
      method: 'POST', body: JSON.stringify({ message: 'hello' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${origin ? 'remote-token' : 'account-a'}` }),
    }));
  });

  it('normalizes an explicit page origin to home', async () => {
    await sendInviteJoinRequest('same-id', window.location.origin);
    expect(fetch).toHaveBeenCalledWith('/api/spaces/same-id/request-join', expect.anything());
  });

  it.each(['missing', 'disconnected', 'connecting', 'error'] as const)('sends nothing for a %s remote session', async (status) => {
    useInstanceStore.setState({ instances: status === 'missing' ? [] : [remote(REMOTE, status)] });
    await expect(sendInviteJoinRequest('same-id', REMOTE)).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports an already-pending request without listing requests or discovery', async () => {
    vi.mocked(fetch).mockResolvedValue(answer(409, { code: 'join_request_pending', error: 'pending' }));
    expect(await sendInviteJoinRequest('same-id', REMOTE)).toBe('pending');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['user_banned', 'space_not_requestable', 'missing_permission'])('preserves %s refusals', async (code) => {
    vi.mocked(fetch).mockResolvedValue(answer(403, { code, error: 'refused' }));
    await expect(sendInviteJoinRequest('same-id', REMOTE)).rejects.toMatchObject({ code, status: 403 });
  });

  it.each(['account', 'desktop'] as const)('rejects a reply made obsolete by %s lifecycle changes', async (change) => {
    let release!: (value: Response) => void;
    const started = new Promise<void>((resolve) => {
      vi.mocked(fetch).mockImplementationOnce(() => { resolve(); return new Promise<Response>(r => { release = r; }); });
    });
    const result = sendInviteJoinRequest('same-id', REMOTE).catch((error: unknown) => error);
    await started;
    if (change === 'account') useAuthStore.setState({ token: 'account-b', user: { ...user, id: 'other' } });
    else setDesktopSessionAllowed(false);
    release(answer());
    expect(await result).toMatchObject({ name: 'AbortError' });
  });

  it('exposes retained manager/list/mine paths independently of Explore', async () => {
    await api.joinRequests.list('same-id', 'pending');
    await api.joinRequests.decide('same-id', 'r1', 'accept');
    await api.joinRequests.mine('declined');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/spaces/same-id/join-requests?status=pending',
      '/api/spaces/same-id/join-requests/r1',
      '/api/users/@me/join-requests?status=declined',
    ]);
  });
});
