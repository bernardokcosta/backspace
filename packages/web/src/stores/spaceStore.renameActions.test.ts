import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Channel, ChannelCategory } from '@veyvox/shared';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const mockChannelUpdate = vi.fn();
const mockCategoryUpdate = vi.fn();
vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/client')>()),
  api: {
      channels: { update: (...args: unknown[]) => mockChannelUpdate(...args) },
      categories: { update: (...args: unknown[]) => mockCategoryUpdate(...args) },
  },
}));

import { useSpaceStore, type SpaceWithMyRoles } from './spaceStore';

const space: SpaceWithMyRoles = {
  id: 'space-1',
  name: 'Native',
  icon: null,
  banner: null,
  avatarColor: 'lavender',
  ownerId: 'owner',
  ownerTitle: null,
  inviteCode: null,
  visibility: 'public',
  description: '',
  createdAt: 1,
};

const channel: Channel = {
  id: 'channel-1', spaceId: 'space-1', name: 'general', type: 'text',
  topic: null, position: 0, categoryId: null, createdAt: 1,
};

const category: ChannelCategory = { id: 'cat-1', spaceId: 'space-1', name: 'Text', position: 0, createdAt: 1 };

beforeEach(() => {
  mockChannelUpdate.mockReset();
  mockCategoryUpdate.mockReset();
  useSpaceStore.setState({
    spaces: [space],
    currentSpaceId: 'space-1',
    channels: [channel],
    categories: [category],
  });
});

describe('rename actions', () => {
  it('updateChannel uses the primary API and applies the stored native row', async () => {
    mockChannelUpdate.mockResolvedValue({ ...channel, name: 'game-night' });
    const saved = await useSpaceStore.getState().updateChannel('channel-1', { name: 'Game Night' });
    expect(mockChannelUpdate).toHaveBeenCalledWith('channel-1', { name: 'Game Night' });
    expect(saved.name).toBe('game-night');
    expect(useSpaceStore.getState().channels[0].name).toBe('game-night');
  });

  it('updateCategory uses the primary API and applies the stored native row', async () => {
    mockCategoryUpdate.mockResolvedValue({ ...category, name: 'Voice Rooms' });
    const saved = await useSpaceStore.getState().updateCategory('cat-1', { name: 'Voice Rooms' });
    expect(mockCategoryUpdate).toHaveBeenCalledWith('cat-1', { name: 'Voice Rooms' });
    expect(saved.name).toBe('Voice Rooms');
    expect(useSpaceStore.getState().categories[0].name).toBe('Voice Rooms');
  });

  it('leaves the store untouched when the server refuses', async () => {
    mockChannelUpdate.mockRejectedValue(new Error('refused'));
    await expect(useSpaceStore.getState().updateChannel('channel-1', { name: 'x' })).rejects.toThrow('refused');
    expect(useSpaceStore.getState().channels[0].name).toBe('general');
  });
});
