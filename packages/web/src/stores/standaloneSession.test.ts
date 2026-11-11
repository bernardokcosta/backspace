import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoverUser, Friend, FriendRequest, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ connectInstance: vi.fn(), disconnectInstance: vi.fn(), disconnectAllRemote: vi.fn() }));
import { api } from '../api/client';
import { useSocialStore, isIncomingRequest, isOutgoingRequest } from './socialStore';
import { useDiscoverStore } from './discoverStore';

function user(id: string): User {
  return { id, username: id === 'bob' ? 'legacy@old.invalid' : id, displayName: null, avatar: null, banner: null, accentColor: null,
    avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 };
}
const friend = (id: string): Friend => ({ ...user(id), addedAt: 1 });
const request = (id: string): FriendRequest => ({ id, fromId: 'bob', toId: 'me', status: 'pending', createdAt: 1, user: user('bob') });
const discover = (id: string): DiscoverUser => ({ ...user(id), relationship: 'none', mutualFriendCount: 0, mutualSpaceCount: 0 });
beforeEach(() => { useSocialStore.getState().reset(); useDiscoverStore.getState().reset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('native social/discovery session ownership', () => {
  it('loads only the current API without tagging or merging copies, and fetches concurrent lists once', async () => {
    const friends = vi.spyOn(api.social, 'friends').mockResolvedValue([friend('bob'), friend('carol')]);
    const requests = vi.spyOn(api.social, 'requests').mockResolvedValue([request('req')]);
    await Promise.all([useSocialStore.getState().loadFriends(), useSocialStore.getState().loadFriends(), useSocialStore.getState().loadRequests()]);
    expect(friends).toHaveBeenCalledTimes(1); expect(requests).toHaveBeenCalledTimes(1);
    expect(useSocialStore.getState().friends).toEqual([friend('bob'), friend('carol')]);
    expect(useSocialStore.getState().requests).toEqual([request('req')]);
  });
  it('cannot repopulate the next session when old friends/requests resolve, including equal IDs', async () => {
    let finishFriends!: (value: Friend[]) => void, finishRequests!: (value: FriendRequest[]) => void;
    vi.spyOn(api.social, 'friends').mockImplementationOnce(() => new Promise(resolve => { finishFriends = resolve; })).mockResolvedValue([{ ...friend('bob'), displayName: 'new server' }]);
    vi.spyOn(api.social, 'requests').mockImplementationOnce(() => new Promise(resolve => { finishRequests = resolve; })).mockResolvedValue([]);
    const oldFriends = useSocialStore.getState().loadFriends(), oldRequests = useSocialStore.getState().loadRequests();
    useSocialStore.getState().reset(); await useSocialStore.getState().loadFriends();
    finishFriends([{ ...friend('bob'), displayName: 'old server' }]); finishRequests([request('old')]); await Promise.all([oldFriends, oldRequests]);
    expect(useSocialStore.getState().friends).toEqual([{ ...friend('bob'), displayName: 'new server' }]);
    expect(useSocialStore.getState().requests).toEqual([]);
  });
  it('uses the exact local username for requests, preserving a sovereign @ handle', async () => {
    const send = vi.spyOn(api.social, 'sendRequest').mockResolvedValue({ success: true, requestId: 'req' });
    vi.spyOn(api.social, 'requests').mockResolvedValue([request('req')]);
    expect(await useSocialStore.getState().sendFriendRequest({ username: '  legacy@old.invalid  ' })).toBe('req');
    expect(send).toHaveBeenCalledExactlyOnceWith({ username: 'legacy@old.invalid' });
  });
  it('applies request acceptance/removal by local ID only, keeping unrelated requests', async () => {
    const update = vi.spyOn(api.social, 'updateRequest').mockResolvedValue({ success: true });
    vi.spyOn(api.social, 'friends').mockResolvedValue([friend('bob')]);
    useSocialStore.setState({ requests: [request('req'), { ...request('other'), fromId: 'carol', user: user('carol') }] });
    await useSocialStore.getState().updateFriendRequest('req', 'accepted');
    expect(update).toHaveBeenCalledExactlyOnceWith('req', 'accepted'); expect(useSocialStore.getState().requests.map(row => row.id)).toEqual(['other']);
    expect(useSocialStore.getState().friends).toEqual([friend('bob')]);
  });
  it('deduplicates local WS request/friend events, updates only the named account and removes deleted users', () => {
    const store = useSocialStore.getState(); store.addIncomingRequest(request('req')); store.addIncomingRequest(request('req'));
    expect(isIncomingRequest(request('req'))).toBe(true); expect(isOutgoingRequest({ ...request('req'), user: user('me') })).toBe(true);
    store.addFriendFromAccepted(friend('bob'), 'req'); store.addFriendFromAccepted(friend('bob'), 'req');
    store.addFriendFromAccepted(friend('carol'), 'other'); store.updateFriendPresence('bob', 'dnd');
    expect(useSocialStore.getState().friends.map(row => [row.id, row.status])).toEqual([['bob', 'dnd'], ['carol', 'online']]);
    store.updateFriendProfile({ ...user('bob'), displayName: 'Changed' });
    expect(useSocialStore.getState().friends[0]?.displayName).toBe('Changed');
    store.removeDeletedUser('bob'); expect(useSocialStore.getState().friends.map(row => row.id)).toEqual(['carol']);
    expect(useSocialStore.getState().requests).toEqual([]);
  });
  it('preserves an authoritative local error instead of treating partial remote fanout as success', async () => {
    vi.spyOn(api.social, 'friends').mockRejectedValue(new Error('synthetic local refusal'));
    await useSocialStore.getState().loadFriends(); expect(useSocialStore.getState()).toMatchObject({ isLoading: false, error: 'synthetic local refusal', friends: [] });
  });
  it('discovery ignores late/reordered searches and can fetch again immediately after session reset', async () => {
    let finish!: (value: { users: DiscoverUser[]; total: number }) => void;
    vi.spyOn(api.social, 'discover').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ users: [discover('bob')], total: 1 });
    const old = useDiscoverStore.getState().fetchUsers('old'); useDiscoverStore.getState().reset();
    await useDiscoverStore.getState().fetchUsers('new'); finish({ users: [discover('carol')], total: 1 }); await old;
    expect(useDiscoverStore.getState().users).toEqual([discover('bob')]); expect(useDiscoverStore.getState().total).toBe(1);
  });
});
