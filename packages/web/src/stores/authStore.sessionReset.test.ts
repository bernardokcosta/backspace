import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@veyvox/shared';

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
import { api, HttpError, RateLimitError } from '../api/client';

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
};

/** Retained memberships must not leak between accounts after discovery is gone. */
function populate(): void {
  useSpaceStore.setState({
    spaces: [{
      id: 's1', name: 'Private membership', icon: null, banner: null, avatarColor: null, description: null,
      visibility: 'private', ownerId: user.id, inviteCode: null, createdAt: 1, _instanceOrigin: '',
    }],
  });
}

function isEmpty(): boolean {
  return useSpaceStore.getState().spaces.length === 0;
}

beforeEach(() => {
  useAuthStore.getState().logout();
  useSpaceStore.getState().reset();
  useAuthStore.setState({ token: 'tok', user });
});
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('the session reset fan-out', () => {
  it.each([new RateLimitError(1), new HttpError(502, 'gateway')])('retains a valid session on temporary lookup failure', async error => {
    localStorage.setItem('backspace_token', 'tok');
    const me = vi.spyOn(api.users, 'me').mockRejectedValueOnce(error);
    try {
      await useAuthStore.getState().loadUser();
      expect(useAuthStore.getState().token).toBe('tok');
      expect(useAuthStore.getState().user?.id).toBe('u1');
      expect(localStorage.getItem('backspace_token')).toBe('tok');
      expect(useAuthStore.getState().isLoading).toBe(false);
    } finally { me.mockRestore(); }
  });

  it('cancels pending API reads when the session is reset', () => {
    const cancel = vi.spyOn(api, 'cancelPendingReads');
    try { useAuthStore.getState().logout(); expect(cancel).toHaveBeenCalled(); }
    finally { cancel.mockRestore(); }
  });
  it('ignores a late user lookup failure after the account changes', async () => {
    let reject: (error: Error) => void = () => {};
    const me = vi.spyOn(api.users, 'me').mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }));
    localStorage.setItem('backspace_token', 'tok');
    try {
      const lookup = useAuthStore.getState().loadUser();
      useAuthStore.setState({ token: 'new-token', user: { ...user, id: 'u2' } });
      localStorage.setItem('backspace_token', 'new-token');
      reject(new Error('late network result')); await lookup;
      expect(useAuthStore.getState().token).toBe('new-token'); expect(localStorage.getItem('backspace_token')).toBe('new-token');
      expect(useAuthStore.getState().user?.id).toBe('u2');
    } finally { me.mockRestore(); }
  });
  it('ignores a late successful lookup after sign-out', async () => {
    let resolve!: (value: User) => void;
    const me = vi.spyOn(api.users, 'me').mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    try {
      const lookup = useAuthStore.getState().loadUser();
      useAuthStore.getState().logout();
      resolve(user); await lookup;
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();
    } finally { me.mockRestore(); }
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

  it('persists the rotated session token on password change', async () => {
    const spy = vi.spyOn(api.users, 'changePassword').mockResolvedValueOnce({ token: 'rotated-jwt-token' });
    try {
      await useAuthStore.getState().changePassword('old-pass', 'new-pass');
      expect(useAuthStore.getState().token).toBe('rotated-jwt-token');
      expect(localStorage.getItem('backspace_token')).toBe('rotated-jwt-token');
    } finally {
      spy.mockRestore();
    }
  });

  it('has no alternate row/status fields or connection bootstrap, even with hostile old keys', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    localStorage.setItem('backspace_instances_u1', '[{"origin":"https://unused.invalid","token":"synthetic-peer"}]');
    useAuthStore.getState().initSession('native-token', user);
    await Promise.resolve();
    for (const field of ['trueHomeStatus', 'myRowIds', 'recordMyRow', 'forgetMyRow']) expect(useAuthStore.getState()).not.toHaveProperty(field);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores a late bootstrap success after a new session with the same token and local id', async () => {
    let resolve!: (value: User) => void;
    vi.spyOn(api.users, 'me').mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = useAuthStore.getState().loadUser();
    useAuthStore.getState().initSession('tok', { ...user, displayName: 'New session' });
    resolve({ ...user, displayName: 'Stale session' }); await pending;
    expect(useAuthStore.getState().user?.displayName).toBe('New session');
  });
  it('ignores a late 401 for the replaced session, even if token bytes were reused', async () => {
    let reject!: (error: Error) => void;
    vi.spyOn(api.users, 'me').mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    const pending = useAuthStore.getState().loadUser(); useAuthStore.getState().initSession('tok', { ...user, displayName: 'New session' });
    reject(new HttpError(401, 'old session')); await pending;
    expect(useAuthStore.getState().token).toBe('tok'); expect(localStorage.getItem('backspace_token')).toBe('tok');
    expect(useAuthStore.getState().user?.displayName).toBe('New session');
  });
  it.each([403, 404, 429])('does not expire the session on HTTP %s', async status => {
    localStorage.setItem('backspace_token', 'tok'); vi.spyOn(api.users, 'me').mockRejectedValueOnce(new HttpError(status, 'synthetic refusal'));
    await useAuthStore.getState().loadUser(); expect(useAuthStore.getState().token).toBe('tok'); expect(useAuthStore.getState().userLoadError).toBeTruthy();
  });
  it('clears all user-scoped stores on an authoritative bootstrap 401', async () => {
    populate(); localStorage.setItem('backspace_token', 'tok'); vi.spyOn(api.users, 'me').mockRejectedValueOnce(new HttpError(401, 'expired'));
    await useAuthStore.getState().loadUser(); expect(isEmpty()).toBe(true);
    expect(useAuthStore.getState().token).toBeNull(); expect(localStorage.getItem('backspace_token')).toBeNull();
  });
  it.each(['login', 'register'] as const)('a late %s cannot restore a signed-out session', async action => {
    let resolve!: (value: { token: string; user: User }) => void;
    vi.spyOn(api.auth, action).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = useAuthStore.getState()[action]('native', 'synthetic-password'); useAuthStore.getState().logout();
    resolve({ token: 'late-token', user }); await pending;
    expect(useAuthStore.getState().token).toBeNull(); expect(localStorage.getItem('backspace_token')).toBeNull();
  });
  it('an old profile response cannot overwrite a newly established session', async () => {
    let resolve!: (value: User) => void;
    vi.spyOn(api.users, 'update').mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = useAuthStore.getState().updateProfile({ bio: 'before replacement' });
    useAuthStore.getState().initSession('new-token', { ...user, displayName: 'New session' }); resolve({ ...user, bio: 'stale update' }); await pending;
    expect(useAuthStore.getState().user).toMatchObject({ displayName: 'New session', bio: null });
  });
  it('an old password rotation cannot install its credential into a new session', async () => {
    let resolve!: (value: { token: string }) => void;
    vi.spyOn(api.users, 'changePassword').mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = useAuthStore.getState().changePassword('old', 'new'); useAuthStore.getState().initSession('new-token', user);
    resolve({ token: 'stale-rotated-token' }); await pending;
    expect(useAuthStore.getState().token).toBe('new-token'); expect(localStorage.getItem('backspace_token')).toBe('new-token');
  });
});
