import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SpaceWithChannelsAndMembers } from '@backspace/shared';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));

vi.mock('./instanceStore', () => ({
  useInstanceStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ instances: [], _autoConnectDone: true }),
    {
      getState: () => ({ instances: [], _autoConnectDone: true }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock('./authStore', async () => {
  const state = { user: null, token: null };
  return (await import('../test/authStoreMock')).authStoreMock(() => state);
});

import { useSpaceStore } from './spaceStore';

function space(id: string, afk?: { afkChannelId?: string | null; afkTimeoutSeconds?: number }): SpaceWithChannelsAndMembers {
  return {
    id, name: id, icon: null, banner: null, avatarColor: null, ownerId: 'o', inviteCode: null,
    visibility: 'private', directoryListed: false, description: null, createdAt: 1,
    channels: [], categories: [], members: [], roles: [], myPermissions: '1',
    ...afk,
  };
}

beforeEach(() => {
  useSpaceStore.getState().reset();
});

describe('populateFromReady AFK preservation', () => {
  it('keeps the configured channel and timeout across ready/reconnect', () => {
    useSpaceStore.getState().populateFromReady('', [space('a', { afkChannelId: 'voice-1', afkTimeoutSeconds: 900 })]);
    const kept = useSpaceStore.getState().spaces.find((s) => s.id === 'a');
    expect(kept?.afkChannelId).toBe('voice-1');
    expect(kept?.afkTimeoutSeconds).toBe(900);

    // A reconnect re-populates from the same payload: still there.
    useSpaceStore.getState().populateFromReady('', [space('a', { afkChannelId: 'voice-1', afkTimeoutSeconds: 900 })]);
    const again = useSpaceStore.getState().spaces.find((s) => s.id === 'a');
    expect(again?.afkChannelId).toBe('voice-1');
    expect(again?.afkTimeoutSeconds).toBe(900);
  });

  it('defaults old servers without the fields to off with a 300s timeout', () => {
    useSpaceStore.getState().populateFromReady('', [space('b')]);
    const kept = useSpaceStore.getState().spaces.find((s) => s.id === 'b');
    expect(kept?.afkChannelId).toBeNull();
    expect(kept?.afkTimeoutSeconds).toBe(300);
  });
});
