import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ connectInstance: vi.fn(), disconnectInstance: vi.fn(), disconnectAllRemote: vi.fn() }));
import { selectMyChosenStatus, useAuthStore } from './authStore';
import { api } from '../api/client';
const native: User = {
  id: 'native', username: 'retained@old.invalid', displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'idle', customStatus: null, isAdmin: false, createdAt: 1,
};
afterEach(() => { useAuthStore.getState().logout(); vi.restoreAllMocks(); localStorage.clear(); });
describe('native profile/status ownership', () => {
  it('sends status and profile together to the current account, including a retained legacy handle', async () => {
    useAuthStore.getState().initSession('native-token', native);
    const update = vi.spyOn(api.users, 'update').mockResolvedValue({ ...native, status: 'dnd', bio: 'hi' });
    await useAuthStore.getState().updateProfile({ status: 'dnd', bio: 'hi' });
    expect(update).toHaveBeenCalledExactlyOnceWith({ status: 'dnd', bio: 'hi' });
    expect(selectMyChosenStatus(useAuthStore.getState())).toBe('dnd'); expect(useAuthStore.getState().user?.bio).toBe('hi');
  });
  it('keeps the chosen status if the authoritative update fails', async () => {
    useAuthStore.getState().initSession('native-token', native);
    vi.spyOn(api.users, 'update').mockRejectedValue(new Error('synthetic refusal'));
    await expect(useAuthStore.getState().updateProfile({ status: 'dnd' })).rejects.toThrow('synthetic refusal');
    expect(selectMyChosenStatus(useAuthStore.getState())).toBe('idle');
  });
});
