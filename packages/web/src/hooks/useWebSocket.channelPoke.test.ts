import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelCategory, MessageWithUser, ServerEvent, User } from '@veyvox/shared';
import { cleanup, renderHook } from '@testing-library/react';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';

// jsdom has no AudioWorkletNode; the handler's imports reach the voice stack.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      playSound: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));

const { useWebSocket } = await import('./useWebSocket');
const { useSpaceStore } = await import('../stores/spaceStore');
const { useAuthStore } = await import('../stores/authStore');
const { useChatStore } = await import('../stores/chatStore');
const { useChannelPokeStore } = await import('../stores/channelPokeStore');

const SPACE = 'native-space';

function channel(id: string, fields: Partial<Channel> = {}): Channel {
  return {
    id,
    spaceId: SPACE,
    name: id,
    type: 'text',
    topic: null,
    position: 0,
    categoryId: null,
    createdAt: 1,
    myPermissions: '1',
    ...fields,
  };
}

function me(id: string): User {
  return {
    id,
    username: id,
    displayName: null,
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 1,
  } as User;
}

function ready(channels: Channel[], categories: ChannelCategory[] = [], fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'ready',
    user: me('me'),
    spaces: [{
      id: SPACE,
      name: 'Native space',
      icon: null,
      ownerId: 'owner',
      inviteCode: 'x',
      visibility: 'private',
      createdAt: 1,
      channels,
      categories,
      members: [],
      myPermissions: '1',
    }],
    dmChannels: [],
    folders: [],
    spaceLayout: null,
    layoutUpdatedAt: null,
    voiceStates: {},
    voiceChannelElapsedSeconds: {},
    voiceUserStates: {},
    spaceVoiceStates: {},
    readStates: [],
    activeCalls: [],
    userActivities: {},
    ...fields,
  } satisfies Partial<Record<keyof Extract<ServerEvent, { type: 'ready' }> | 'type', unknown>>;
}

function socketFor(): TestWebSocket {
  renderHook(() => useWebSocket());
  const ws = TestWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

function pokeRow(id: string): MessageWithUser {
  return {
    id, channelId: 'c1', userId: 'actor', type: 'system', replyToId: null, editedAt: null, createdAt: 1,
    content: JSON.stringify({ event: 'channel_poke', targetUserId: 'me', targetDisplayName: 'Me' }),
    mentionEveryone: false, mentionRoleIds: [],
    user: { ...me('actor'), displayName: 'Actor' }, attachments: [], embeds: [], reactions: [],
  };
}

beforeEach(() => {
  installSocketHarness();
  useSpaceStore.getState().reset();
  useChannelPokeStore.getState().reset();
  useChatStore.setState({ messages: new Map(), detachedChannels: new Map(), realtimeMessageEvents: [], unreadChannels: new Set(), currentChannelId: null });
  useAuthStore.setState({ user: me('me'), token: 'native-token' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup(); useAuthStore.setState({ user: null, token: null }); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the native poke capability', () => {
  it('uses the current ready capability and clears an omitted value on refresh', () => {
    const nova = socketFor();
    nova.deliver(ready([channel('c1')], [], { supportsPoke: true }));
    expect(useChannelPokeStore.getState().supported).toBe(true);
    nova.deliver(ready([channel('c2')]));
    expect(useChannelPokeStore.getState().supported).toBe(false);
  });
});

describe('a channel_poke event', () => {
  it('adds the stored row to its channel without an alert or an unread dot', () => {
    const nova = socketFor();
    nova.deliver(ready([channel('c1')], [], { supportsPoke: true }));
    nova.deliver({ type: 'channel_poke', message: pokeRow('900') });
    nova.deliver({ type: 'channel_poke', message: pokeRow('900') });
    const chat = useChatStore.getState();
    expect(chat.messages.get('c1')?.map(m => m.id)).toEqual(['900']);
    expect(chat.realtimeMessageEvents).toEqual([]);
    expect(chat.unreadChannels.has('c1')).toBe(false);
  });
});
