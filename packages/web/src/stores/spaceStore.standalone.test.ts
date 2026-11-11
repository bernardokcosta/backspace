import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, DmChannel, SpaceWithChannelsAndMembers, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
import { useSpaceStore, getChannelKind } from './spaceStore';
import { useAuthStore } from './authStore';
import { api } from '../api/client';
const user = (id: string): User => ({ id, username: id, displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 });
const channel = (id: string, spaceId = 's'): Channel => ({ id, spaceId, name: id, type: 'text', position: 0, topic: null, categoryId: null, createdAt: 1, myPermissions: '1' });
const space = (name = 'Native'): SpaceWithChannelsAndMembers => ({ id: 's', name, icon: null, banner: null, avatarColor: null, ownerId: 'me', inviteCode: null,
  visibility: 'private', description: null, createdAt: 1, channels: [channel('c')], categories: [], members: [], roles: [], myPermissions: '1' });
const pair = (id = 'd'): DmChannel => ({ id, ownerId: null, name: null, icon: null, createdAt: 1, members: [user('me'), user('bob')] });
beforeEach(() => { useAuthStore.getState().logout(); useAuthStore.setState({ user: user('me'), token: 'synthetic-token' }); useSpaceStore.getState().reset(); });
afterEach(() => vi.restoreAllMocks());
describe('native space/DM state without origin copies', () => {
  it('uses native ready listings and local IDs, with no merged-copy/origin state', () => {
    useSpaceStore.getState().populateFromReady([space()], [], [pair()]);
    expect(getChannelKind('c')).toBe('space'); expect(getChannelKind('d')).toBe('dm'); expect(getChannelKind('absent')).toBe('unknown');
    expect(useSpaceStore.getState().spaces[0]).not.toHaveProperty('_instanceOrigin');
    for (const field of ['dmConversations', 'dmAlternatives', 'channelOriginMap', 'categoryOriginMap', 'setDmOriginAvailable', 'removeInstanceSpaces']) expect(useSpaceStore.getState()).not.toHaveProperty(field);
  });
  it('upserts and patches one native DM, retaining unread/last-message index semantics', () => {
    const state = useSpaceStore.getState(); state.upsertDmChannel(pair()); state.upsertDmChannel(pair());
    state.updateDmOwner('d', 'bob'); state.updateDmMetadata('d', { name: 'Group' }); state.addDmMember('d', user('carol')); state.addDmMember('d', user('carol'));
    expect(useSpaceStore.getState().dmChannels).toHaveLength(1);
    expect(useSpaceStore.getState().dmChannels[0]).toMatchObject({ ownerId: 'bob', name: 'Group' });
    expect(useSpaceStore.getState().dmChannels[0]?.members.map(row => row.id)).toEqual(['me', 'bob', 'carol']);
    state.removeDmMember('d', 'carol'); expect(useSpaceStore.getState().dmChannels[0]?.members.map(row => row.id)).toEqual(['me', 'bob']);
  });
  it('does not mistake a two-member owned group for an existing 1-on-1', () => {
    useSpaceStore.getState().upsertDmChannel({ ...pair('g'), ownerId: 'me' });
    expect(useSpaceStore.getState().findExistingDmForUser('bob')).toBeNull();
    useSpaceStore.getState().upsertDmChannel(pair()); expect(useSpaceStore.getState().findExistingDmForUser('bob')?.id).toBe('d');
  });
  it('a new ready replaces the full native listing without retaining stale channel or DM entries', () => {
    useSpaceStore.getState().populateFromReady([space()], [], [pair()]);
    useSpaceStore.getState().populateFromReady([], [], []);
    expect(useSpaceStore.getState().spaces).toEqual([]); expect(useSpaceStore.getState().dmChannels).toEqual([]);
    expect(useSpaceStore.getState().spaceChannelIndex.size).toBe(0); expect(useSpaceStore.getState().channelLastMessageIds.size).toBe(0);
  });
  it('an old detail load cannot change an equal-id space of a new session', async () => {
    let finish!: (value: SpaceWithChannelsAndMembers) => void;
    useSpaceStore.getState().setSpaces([space()]); useSpaceStore.getState().setCurrentSpace('s');
    vi.spyOn(api.spaces, 'get').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = useSpaceStore.getState().loadSpaceDetail('s');
    useSpaceStore.getState().reset(); useSpaceStore.getState().setSpaces([space('New session')]); useSpaceStore.getState().setCurrentSpace('s');
    finish({ ...space('Stale'), channels: [channel('old')] }); expect(await old).toBeUndefined();
    expect(useSpaceStore.getState().spaces[0]?.name).toBe('New session'); expect(useSpaceStore.getState().channels).toEqual([]);
  });
  it('an old DM reload cannot repopulate the next session', async () => {
    let finish!: (value: DmChannel[]) => void;
    vi.spyOn(api.dm, 'list').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = useSpaceStore.getState().reloadDms(); useSpaceStore.getState().reset(); finish([pair()]); await old;
    expect(useSpaceStore.getState().dmChannels).toEqual([]);
  });
  it('keeps omitted native group fields but applies explicit null metadata', () => {
    const store = useSpaceStore.getState(); store.upsertDmChannel({ ...pair(), ownerId: 'me', name: 'Crew', icon: 'group.png' });
    store.updateDmMetadata('d', {}); expect(useSpaceStore.getState().dmChannels[0]).toMatchObject({ name: 'Crew', icon: 'group.png', ownerId: 'me' });
    store.updateDmMetadata('d', { name: null, icon: null }); expect(useSpaceStore.getState().dmChannels[0]).toMatchObject({ name: null, icon: null, ownerId: 'me' });
  });
  it('does not patch unknown native IDs, or another DM during closure', () => {
    const store = useSpaceStore.getState(); store.upsertDmChannel(pair('bob')); store.upsertDmChannel(pair('carol'));
    const rows = useSpaceStore.getState().dmChannels;
    store.patchDmChannel('unknown', dm => ({ ...dm, name: 'wrong' })); expect(useSpaceStore.getState().dmChannels).toBe(rows);
    store.removeDmChannel('bob'); expect(useSpaceStore.getState().dmChannels.map(dm => dm.id)).toEqual(['carol']);
  });
});
