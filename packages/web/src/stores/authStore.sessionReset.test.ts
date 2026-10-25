import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectoryEntry, User } from '@backspace/shared';

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
import { useExploreStore } from './exploreStore';
import { useDirectoryStore } from './directoryStore';
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

function directoryEntry(id: string): DirectoryEntry {
  return {
    origin: 'https://orbit.example',
    id,
    name: `Space ${id}`,
    description: null,
    icon: null,
    banner: null,
    avatarColor: null,
    visibility: 'public',
    memberCount: 3,
    createdAt: 1,
    instanceName: 'Orbit',
    federatedRegistrationOpen: true,
  };
}

/** What one account leaves in the two Explore stores. */
function populate(): void {
  useExploreStore.setState({
    spaces: [{
      id: 's1', name: 'Design', icon: null, banner: null, avatarColor: null, description: null,
      visibility: 'public', memberCount: 2, createdAt: 1, joined: false, _instanceOrigin: '',
    }],
    myRequests: [{
      id: 'r1', spaceId: 's2', userId: 'u1', message: null, status: 'pending',
      decidedBy: null, createdAt: 1, decidedAt: null, _instanceOrigin: '',
    }],
    searchQuery: 'design',
    resultsQuery: 'design',
  });
  useDirectoryStore.setState({
    entries: [directoryEntry('d1')],
    status: 'ok',
    query: 'design',
    offset: 50,
    hasMore: true,
  });
}

function isEmpty(): boolean {
  const explore = useExploreStore.getState();
  const directory = useDirectoryStore.getState();
  return explore.spaces.length === 0
    && explore.myRequests.length === 0
    && explore.searchQuery === ''
    && explore.resultsQuery === ''
    && directory.entries.length === 0
    && directory.status === 'idle'
    && directory.query === ''
    && directory.offset === 0
    && directory.hasMore === false;
}

beforeEach(() => {
  useExploreStore.getState().reset();
  useDirectoryStore.getState().reset();
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
  it('clears the Explore stores on sign-out', () => {
    populate();
    expect(isEmpty()).toBe(false);

    useAuthStore.getState().logout();

    // `myRequests` is the one that matters: those rows are the signed-in
    // user's own pending join requests, and a card reads "Request Pending"
    // off them. Left behind, they are one account's rows under another
    // account's session until a fan-out replaces them.
    expect(useExploreStore.getState().myRequests).toEqual([]);
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
