import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Friend, FriendRequest, User } from '@veyvox/shared';
const { social } = vi.hoisted(() => ({ social: {
  friends: vi.fn<() => Promise<Friend[]>>(async () => []),
  requests: vi.fn<() => Promise<FriendRequest[]>>(async () => []),
  search: vi.fn<(query: string) => Promise<User[]>>(async () => []),
  removeFriend: vi.fn<(id: string) => Promise<{ success: boolean }>>(async () => ({ success: true })),
  updateRequest: vi.fn<(id: string, status: string) => Promise<{ success: boolean }>>(async () => ({ success: true })),
  cancelRequest: vi.fn<(id: string) => Promise<{ success: boolean }>>(async () => ({ success: true })),
} }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { social } }));
import { useSocialStore } from './socialStore';
const bob: User = { id: 'bob', username: 'legacy@old.invalid', displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 };
const carol = { ...bob, id: 'carol', username: 'carol' };
const friend = (row: User): Friend => ({ ...row, addedAt: 1 });
const request = (row: User): FriendRequest => ({ id: `r-${row.id}`, fromId: row.id, toId: 'me', user: row, status: 'pending', createdAt: 1 });
beforeEach(() => { vi.clearAllMocks(); useSocialStore.getState().reset(); useSocialStore.setState({ friends: [friend(bob), friend(carol)], requests: [request(bob), request(carol)] }); });
describe('retained native social events and actions', () => {
  it('removes only the named friend', () => {
    useSocialStore.getState().removeFriendLocally('bob'); expect(useSocialStore.getState().friends).toEqual([friend(carol)]);
  });
  it('matches a request removal by either local request id or its other party', () => {
    useSocialStore.getState().removeRequestById('unknown', 'bob'); expect(useSocialStore.getState().requests).toEqual([request(carol)]);
  });
  it('declines only the selected native request', async () => {
    await useSocialStore.getState().updateFriendRequest('r-bob', 'declined'); expect(social.updateRequest).toHaveBeenCalledExactlyOnceWith('r-bob', 'declined');
    expect(useSocialStore.getState().requests).toEqual([request(carol)]); expect(social.friends).not.toHaveBeenCalled();
  });
  it('cancels by native request id', async () => {
    await useSocialStore.getState().cancelFriendRequest('r-bob'); expect(social.cancelRequest).toHaveBeenCalledExactlyOnceWith('r-bob');
    expect(useSocialStore.getState().requests).toEqual([request(carol)]);
  });
  it('removes a friendship through the current API and keeps the unrelated friend', async () => {
    await useSocialStore.getState().removeFriend('bob'); expect(social.removeFriend).toHaveBeenCalledExactlyOnceWith('bob'); expect(useSocialStore.getState().friends).toEqual([friend(carol)]);
  });
  it('replaces a repeated request row rather than duplicating it', () => {
    const changed = { ...request(bob), createdAt: 2 }; useSocialStore.getState().addIncomingRequest(changed);
    expect(useSocialStore.getState().requests).toEqual([changed, request(carol)]);
  });
  it('clears both incoming/outgoing requests when a user is deleted', () => {
    useSocialStore.setState({ requests: [request(bob), { ...request(bob), id: 'out', fromId: 'me', toId: 'bob' }, request(carol)] });
    useSocialStore.getState().removeDeletedUser('bob'); expect(useSocialStore.getState().requests).toEqual([request(carol)]);
  });
  it('keeps list identities and does not notify subscribers on a removal that matches nothing', () => {
    const before = useSocialStore.getState(), listener = vi.fn(); const stop = useSocialStore.subscribe(listener);
    try {
      before.removeFriendLocally('absent'); before.removeRequestById('absent'); before.removeDeletedUser('absent');
      expect(useSocialStore.getState().friends).toBe(before.friends); expect(useSocialStore.getState().requests).toBe(before.requests); expect(listener).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it('does not apply a late cancel to an equal-id request of the next session', async () => {
    let finish!: (result: { success: boolean }) => void;
    social.cancelRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useSocialStore.getState().cancelFriendRequest('r-bob'); useSocialStore.getState().reset(); useSocialStore.setState({ requests: [request(bob)] });
    finish({ success: true }); await pending; expect(useSocialStore.getState().requests).toEqual([request(bob)]);
  });
  it('does not return a late search result after reset', async () => {
    let finish!: (rows: User[]) => void; social.search.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = useSocialStore.getState().searchUsers('bob'); useSocialStore.getState().reset(); finish([bob]); expect(await pending).toEqual([]);
  });
});
