import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, ChannelCategory } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useWebSocket } from './useWebSocket';
import { useSpaceStore, getChannelKind } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
import { junoUser } from '../components/games/junoTestFixtures';
const SPACE = 'native-space';
const channel = (id: string, fields: Partial<Channel> = {}): Channel => ({ id, spaceId: SPACE, name: id, type: 'text', topic: null,
  position: 0, categoryId: null, createdAt: 1, myPermissions: '1', ...fields });
const category = (id: string): ChannelCategory => ({ id, spaceId: SPACE, name: id, position: 0, createdAt: 1 });
beforeEach(() => { installSocketHarness(); useSpaceStore.getState().reset(); useAuthStore.setState({ token: 'native-token', user: junoUser('me') }); });
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open(channels: Channel[], currentSpaceId = 'other-space'): TestWebSocket {
  renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; ws.open();
  useSpaceStore.getState().populateFromReady([{ id: SPACE, name: 'Native', ownerId: 'owner', ownerTitle: null, icon: null, banner: null,
    avatarColor: null, inviteCode: null, visibility: 'private', description: null, createdAt: 1, channels, categories: [], members: [], roles: [], myPermissions: '1' }]);
  useSpaceStore.setState({ currentSpaceId }); return ws;
}
describe('native channel events and unopened spaces', () => {
  it('reindexes a channel when channel_updated restores access while another space is open', () => {
    const ws = open([channel('c1')]); expect(getChannelKind('c1')).toBe('space');
    ws.deliver({ type: 'channel_deleted', channelId: 'c1', spaceId: SPACE }); expect(getChannelKind('c1')).toBe('unknown');
    ws.deliver({ type: 'channel_updated', channel: channel('c1', { myPermissions: '3' }), spaceId: SPACE });
    const state = useSpaceStore.getState(); expect(state.spaceChannelIndex.get('c1')).toEqual({ spaceId: SPACE, type: 'text' });
    expect(state.channelToSpaceMap.get('c1')).toBe(SPACE); expect(state.channelPermissions.get('c1')).toBe('3');
  });
  it('replaces native lookup map references when updating permissions', () => {
    const ws = open([channel('c1')]); const before = useSpaceStore.getState();
    ws.deliver({ type: 'channel_updated', channel: channel('c1', { myPermissions: '7' }), spaceId: SPACE });
    const after = useSpaceStore.getState(); expect(after.channelPermissions).not.toBe(before.channelPermissions);
    expect(after.spaceChannelIndex).not.toBe(before.spaceChannelIndex); expect(after.channelPermissions.get('c1')).toBe('7');
  });
  it('forgets a deleted native voice channel and replaces its lookup maps', () => {
    const ws = open([channel('v1', { type: 'voice' })]); const before = useSpaceStore.getState();
    expect(before.voiceChannelIds.has('v1')).toBe(true); ws.deliver({ type: 'channel_deleted', channelId: 'v1', spaceId: SPACE });
    const after = useSpaceStore.getState();
    for (const key of ['channelToSpaceMap', 'spaceChannelIndex', 'channelPermissions', 'voiceChannelIds'] as const) {
      expect(after[key]).not.toBe(before[key]); expect(after[key].has('v1')).toBe(false);
    }
  });
  it('treats channel_layout_updated as the full visible set and sorts the open channel list', () => {
    const ws = open([channel('c1'), channel('c2')], SPACE); const before = useSpaceStore.getState();
    ws.deliver({ type: 'channel_layout_updated', spaceId: SPACE, channels: [channel('c1', { position: 1 }), channel('c3', { type: 'voice' })], categories: [category('cat1')] });
    const after = useSpaceStore.getState(); expect(after.channelToSpaceMap).not.toBe(before.channelToSpaceMap);
    expect([...after.channelToSpaceMap.keys()].sort()).toEqual(['c1', 'c3']); expect(after.voiceChannelIds.has('c3')).toBe(true);
    expect(after.channels.map(row => row.id)).toEqual(['c3', 'c1']); expect(after.categories.map(row => row.id)).toEqual(['cat1']);
  });
  it('updates the index without populating the other open space channel list', () => {
    const ws = open([channel('c1')]); ws.deliver({ type: 'channel_layout_updated', spaceId: SPACE, channels: [channel('c1'), channel('c2')], categories: [] });
    expect(useSpaceStore.getState().spaceChannelIndex.get('c2')).toEqual({ spaceId: SPACE, type: 'text' }); expect(useSpaceStore.getState().channels).toEqual([]);
  });
  it('creates and deletes categories in the open native space with new array references', () => {
    const ws = open([], SPACE); const before = useSpaceStore.getState().categories;
    ws.deliver({ type: 'category_created', category: category('cat1'), spaceId: SPACE }); const created = useSpaceStore.getState().categories;
    expect(created).not.toBe(before); expect(created).toEqual([category('cat1')]);
    ws.deliver({ type: 'category_deleted', categoryId: 'cat1', spaceId: SPACE }); expect(useSpaceStore.getState().categories).not.toBe(created);
    expect(useSpaceStore.getState().categories).toEqual([]);
  });
});
