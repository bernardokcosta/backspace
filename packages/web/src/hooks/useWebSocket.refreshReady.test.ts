import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { MessageWithUser, SpaceWithChannelsAndMembers } from '@veyvox/shared';
import { getActiveRoom } from './useLiveKit';
vi.mock('./useLiveKit', () => ({ getActiveRoom: vi.fn(() => null) }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useChatStore } from '../stores/chatStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useSocialStore } from '../stores/socialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { junoUser } from '../components/games/junoTestFixtures';
import { wireDm } from '../test/dmWireShape';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
const me = junoUser('me');
const cached = [{ id: '41', channelId: 'channel', userId: 'bob', content: 'hello' }] as MessageWithUser[];
const space: SpaceWithChannelsAndMembers = { id: 'space', name: 'Native', ownerId: 'owner', ownerTitle: null, icon: null, banner: null, avatarColor: null,
  inviteCode: null, description: null, visibility: 'private', createdAt: 1, channels: [{ id: 'channel', spaceId: 'space', name: 'general', type: 'text', topic: null,
    position: 0, categoryId: null, createdAt: 1 }], categories: [], members: [], roles: [], myPermissions: '0' };
const ready = () => ({ type: 'ready', user: me, spaces: [space], folders: [], dmChannels: [wireDm({ id: 'dm', createdAt: 1, members: [me] })],
  voiceStates: {}, voiceUserStates: {}, spaceVoiceStates: {}, userActivities: {}, readStates: [], activeCalls: [] });
beforeEach(() => {
  installSocketHarness(); vi.useFakeTimers(); useSpaceStore.getState().reset(); useAuthStore.setState({ token: 'native-token', user: me });
  useVoiceStore.setState(useVoiceStore.getInitialState()); vi.mocked(getActiveRoom).mockReturnValue(null);
  vi.spyOn(useChatStore.getState(), 'loadMessages').mockResolvedValue(true);
  vi.spyOn(useSpaceStore.getState(), 'loadSpaceDetail').mockResolvedValue(undefined);
  for (const name of ['loadFriends', 'loadRequests'] as const) vi.spyOn(useSocialStore.getState(), name).mockResolvedValue(undefined);
  for (const name of ['fetchStreamingLimits', 'fetchGifEnabled'] as const) vi.spyOn(useSettingsStore.getState(), name).mockResolvedValue(undefined);
  vi.spyOn(useNotificationSettingsStore.getState(), 'load').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); useChatStore.getState().clearAllMessages(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function open(): TestWebSocket { renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; act(() => ws.open()); return ws; }
function cache(channelId: string): void { useChatStore.setState({ currentChannelId: channelId, messages: new Map([[channelId, cached]]), hasMore: new Map([[channelId, false]]) }); }
describe.each(['dm', 'channel'])('native %s ready cache behavior', channelId => {
  it('refetches the message cache on the first ready which may have missed messages', () => {
    cache(channelId); if (channelId === 'channel') useSpaceStore.setState({ currentSpaceId: space.id });
    open().deliver(ready()); expect(useChatStore.getState().messages.get(channelId)).not.toBe(cached);
    expect(useChatStore.getState().loadMessages).toHaveBeenCalledExactlyOnceWith(channelId, true);
    if (channelId === 'channel') expect(useSpaceStore.getState().loadSpaceDetail).toHaveBeenCalledWith(space.id);
  });
  it('preserves messages and hasMore on a later ready of the same socket', () => {
    const ws = open(); ws.deliver(ready()); cache(channelId); vi.mocked(useChatStore.getState().loadMessages).mockClear();
    ws.deliver(ready()); expect(useChatStore.getState().messages.get(channelId)).toBe(cached);
    expect(useChatStore.getState().hasMore.get(channelId)).toBe(false); expect(useChatStore.getState().loadMessages).not.toHaveBeenCalled();
  });
  it('reloads again on the replacement socket after a reconnect', () => {
    const first = open(); first.deliver(ready()); cache(channelId); vi.mocked(useChatStore.getState().loadMessages).mockClear();
    act(() => first.fail()); act(() => vi.advanceTimersByTime(1000)); const next = TestWebSocket.all.at(-1)!;
    act(() => next.open()); next.deliver(ready()); expect(useChatStore.getState().messages.get(channelId)).not.toBe(cached);
    expect(useChatStore.getState().loadMessages).toHaveBeenCalledExactlyOnceWith(channelId, true);
  });
});
describe('native voice ownership after ready', () => {
  function liveVoice(): TestWebSocket {
    useVoiceStore.setState({ currentVoiceChannelId: 'voice', voiceConnectionStatus: 'connected', isLiveKitConnected: true });
    vi.mocked(getActiveRoom).mockReturnValue({ state: 'connected' } as never); return open();
  }
  it.each([true, false])('reclaims a live space voice connection with grace presence=%s', inGrace => {
    const ws = liveVoice(); ws.deliver({ ...ready(), voiceStates: inGrace ? { voice: [me.id] } : {} });
    expect(ws.sent.filter(event => event.type === 'voice_join')).toEqual([{ type: 'voice_join', channelId: 'voice' }]);
    expect(ws.sent.some(event => event.type === 'voice_status')).toBe(true); expect(useVoiceStore.getState().currentVoiceChannelId).toBe('voice');
  });
  it('does not reclaim voice on a permission-refresh ready from the same socket', () => {
    const ws = liveVoice(); ws.deliver(ready()); ws.sent = []; ws.deliver(ready()); expect(ws.sent.some(event => event.type === 'voice_join')).toBe(false);
  });
  it('does not rejoin a disconnected Retry intent', () => {
    const ws = liveVoice(); useVoiceStore.setState({ voiceConnectionStatus: 'disconnected', isLiveKitConnected: false }); vi.mocked(getActiveRoom).mockReturnValue(null);
    ws.deliver(ready()); expect(ws.sent.some(event => event.type === 'voice_join')).toBe(false);
  });
});
