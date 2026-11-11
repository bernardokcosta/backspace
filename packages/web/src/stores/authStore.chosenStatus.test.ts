import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ connectInstance: vi.fn(), disconnectInstance: vi.fn(), disconnectAllRemote: vi.fn() }));
import { selectMyChosenStatus, useAuthStore } from './authStore';
import { api } from '../api/client';
const native: User = {
  id: 'native', username: 'native', displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
  bio: null, status: 'idle', customStatus: null, isAdmin: false, createdAt: 1,
};
afterEach(() => { useAuthStore.getState().logout(); localStorage.clear(); vi.restoreAllMocks(); });
describe('chosen status belongs only to the loaded native account', () => {
  it('is unknown before bootstrap, ignores any old cached report, then uses the current server response', async () => {
    localStorage.setItem('backspace_true_home_status:old.invalid:native', JSON.stringify({ status: 'dnd', reportedAt: Date.now() }));
    useAuthStore.setState({ token: 'native-token', user: null });
    expect(selectMyChosenStatus(useAuthStore.getState())).toBeNull();
    vi.spyOn(api.users, 'me').mockResolvedValue(native); await useAuthStore.getState().loadUser();
    expect(selectMyChosenStatus(useAuthStore.getState())).toBe('idle');
  });
  it('takes only the new account choice after session replacement and clears it on logout', () => {
    useAuthStore.getState().initSession('old-token', { ...native, status: 'dnd' });
    useAuthStore.getState().initSession('new-token', { ...native, id: 'other', status: 'online' });
    expect(selectMyChosenStatus(useAuthStore.getState())).toBe('online');
    useAuthStore.getState().logout(); expect(selectMyChosenStatus(useAuthStore.getState())).toBeNull();
  });
  it('does not reinterpret offline as a chosen status or seed timers/storage', () => {
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    useAuthStore.setState({ user: { ...native, status: 'offline' } });
    expect(selectMyChosenStatus(useAuthStore.getState())).toBeNull(); expect(timeout).not.toHaveBeenCalled();
    expect(localStorage.getItem('backspace_true_home_status:old.invalid:native')).toBeNull();
  });
});
