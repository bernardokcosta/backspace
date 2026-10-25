import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@backspace/shared';

// Stubbed for the same reason every store test stubs it: the fan-out below
// reaches the voice store, and jsdom has no AudioWorkletNode.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../hooks/useWebSocket', () => ({
  connectInstance: vi.fn(),
  disconnectInstance: vi.fn(),
  disconnectAllRemote: vi.fn(),
  connectWebSocket: vi.fn(),
  disconnectWebSocket: vi.fn(),
}));

import { useAuthStore } from './authStore';
import { useSpaceStore } from './spaceStore';
import { api, HttpError } from '../api/client';
import { setDesktopSessionAllowed } from '../utils/desktopSessionAccess';

const user: User = {
  id: 'u1',
  username: 'jannis',
  displayName: 'Jannis',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: null,
  bio: null,
  status: 'online',
  customStatus: null,
  isAdmin: false,
  createdAt: 1,
  homeInstance: null,
  homeUserId: null,
  replicatedInstances: [],
};

/** Retained memberships must not leak between accounts after discovery is gone. */
function populate(): void {
  useSpaceStore.setState({
    spaces: [{
      id: 's1', name: 'Private membership', icon: null, banner: null, avatarColor: null, description: null,
      visibility: 'private', directoryListed: false, ownerId: user.id, inviteCode: null, createdAt: 1, _instanceOrigin: '',
    }],
  });
}

function isEmpty(): boolean {
  return useSpaceStore.getState().spaces.length === 0;
}

beforeEach(() => {
  useSpaceStore.getState().reset();
  useAuthStore.setState({ token: 'tok', user });
});

describe('the session reset fan-out', () => {
  it('preserves the token and draft-bearing stores on a desktop policy refusal', async () => {
    populate(); localStorage.setItem('backspace_token', 'tok');
    const me = vi.spyOn(api.users, 'me').mockRejectedValueOnce(new HttpError(426, 'Update', undefined, 'desktop_update_required'));
    try {
      await useAuthStore.getState().loadUser();
      expect(useAuthStore.getState().token).toBe('tok'); expect(localStorage.getItem('backspace_token')).toBe('tok');
      expect(isEmpty()).toBe(false);
    } finally { me.mockRestore(); }
  });
  it('ignores a late user lookup failure across compatibility teardown/reallow', async () => {
    let reject: (error: Error) => void = () => {};
    const me = vi.spyOn(api.users, 'me').mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    localStorage.setItem('backspace_token', 'tok');
    try {
      const lookup = useAuthStore.getState().loadUser();
      setDesktopSessionAllowed(false); setDesktopSessionAllowed(true);
      reject(new Error('late network result')); await lookup;
      expect(useAuthStore.getState().token).toBe('tok'); expect(localStorage.getItem('backspace_token')).toBe('tok');
    } finally { setDesktopSessionAllowed(true); me.mockRestore(); }
  });
  it('clears retained memberships on sign-out', () => {
    populate();
    expect(isEmpty()).toBe(false);

    useAuthStore.getState().logout();

    expect(isEmpty()).toBe(true);
  });

  it('clears them when another account signs in without a reload', () => {
    populate();

    useAuthStore.getState().initSession('other-token', { ...user, id: 'u2', username: 'someone-else' });

    expect(isEmpty()).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe('u2');
  });

  it('clears them when the account is deleted', async () => {
    populate();

    // The delete path ends the session the same way; only the two calls that
    // reach the network are stood in for.
    const { api } = await import('../api/client');
    vi.spyOn(api.users, 'deleteAccount').mockResolvedValue({ success: true });

    await useAuthStore.getState().deleteAccount('hunter2', 'jannis');

    expect(isEmpty()).toBe(true);
  });
});
