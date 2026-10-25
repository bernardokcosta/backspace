import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import type { JoinRequest, User } from '@backspace/shared';
import { createApiClient } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useInstanceStore, type ConnectedInstance } from '../../stores/instanceStore';
import { JoinRequestsSection } from './SpaceSettings';

const ORBIT = 'https://orbit.example';
const NOVA = 'https://nova.example';
const user = { id: 'me', username: 'mira' } as User;
function connection(origin: string): ConnectedInstance {
  return { origin, status: 'connected', label: origin, token: 'remote-token', username: 'mira', user,
    api: createApiClient(origin, () => 'remote-token') };
}
function response(name: string) {
  const req: JoinRequest = { id: 'same-request', spaceId: 'same-space', userId: 'requester', message: name,
    status: 'pending', decidedBy: null, createdAt: 1, decidedAt: null };
  return new Response(JSON.stringify({ requests: [req] }), { status: 200, headers: { 'content-type': 'application/json' } });
}
beforeEach(() => {
  useAuthStore.setState({ token: 'account-a', user });
  useInstanceStore.setState({ instances: [connection(ORBIT), connection(NOVA)] });
  vi.stubGlobal('fetch', vi.fn(async () => response('Orbit request')));
});
afterEach(() => { vi.unstubAllGlobals(); useInstanceStore.setState({ instances: [] }); });

describe('space-manager join requests', () => {
  it('lists and decides on the space’s origin, not home or a same-ID peer', async () => {
    render(<JoinRequestsSection spaceId="same-space" origin={ORBIT} />);
    await screen.findByText('Orbit request');
    fireEvent.click(screen.getByTitle('Accept'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Orbit request')).toBeNull());
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      `${ORBIT}/api/spaces/same-space/join-requests?status=pending`,
      `${ORBIT}/api/spaces/same-space/join-requests/same-request`,
    ]);
    expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }));
  });
  it('does not fall back to home when the owning origin is disconnected', async () => {
    useInstanceStore.setState({ instances: [] });
    render(<JoinRequestsSection spaceId="same-space" origin={ORBIT} />);
    await screen.findByText(/Not connected to/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not replace the current origin’s list with a late same-ID answer', async () => {
    let release!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(r => { release = r; }))
      .mockResolvedValueOnce(response('Nova request'));
    const view = render(<JoinRequestsSection spaceId="same-space" origin={ORBIT} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(<JoinRequestsSection spaceId="same-space" origin={NOVA} />);
    await screen.findByText('Nova request');
    await act(async () => { release(response('Stale Orbit')); });
    expect(screen.queryByText('Stale Orbit')).toBeNull();
    expect(screen.getByText('Nova request')).toBeInTheDocument();
  });
  it('a decision answered after an account switch cannot remove the new account’s request', async () => {
    let release!: (value: Response) => void;
    vi.mocked(fetch).mockResolvedValueOnce(response('Old request'))
      .mockImplementationOnce(() => new Promise<Response>(r => { release = r; }))
      .mockResolvedValueOnce(response('New account request'));
    render(<JoinRequestsSection spaceId="same-space" origin={ORBIT} />);
    await screen.findByText('Old request'); fireEvent.click(screen.getByTitle('Accept'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    act(() => { useAuthStore.setState({ token: 'account-b' }); });
    await screen.findByText('New account request');
    await act(async () => { release(response('Old decision')); });
    expect(screen.getByText('New account request')).toBeInTheDocument();
  });
});
