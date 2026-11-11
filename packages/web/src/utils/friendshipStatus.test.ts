import { describe, expect, it } from 'vitest';
import type { User, FriendRequest, Friend } from '@veyvox/shared';
import { getFriendshipStatus } from './friendshipStatus';
const user = { id: 'target', username: 'same@retained.test' } as User;
const friend = { ...user, addedAt: 1 } as Friend;
const request: FriendRequest = { id: 'r', fromId: 'me', toId: user.id, status: 'pending', createdAt: 1, user };
describe('native friendship state', () => {
  const status = (friends: Friend[] = [], requests: FriendRequest[] = [], selfUserId: string | null = 'me') =>
    getFriendshipStatus({ viewedUser: user, selfUserId, friends, requests });
  it('matches self and friends only by exact account IDs', () => {
    expect(status([], [], user.id).state).toBe('self'); expect(status([friend]).state).toBe('friends');
    expect(status([{ ...friend, id: 'different' }]).state).toBe('none'); expect(status([friend], [], null).state).toBe('none');
  });
  it('finds incoming and outgoing pending requests, not other pairs or completed requests', () => {
    expect(status([], [request])).toEqual({ state: 'outbound_pending', request });
    expect(status([], [{ ...request, fromId: user.id, toId: 'me' }]).state).toBe('inbound_pending');
    expect(status([], [{ ...request, status: 'declined' }]).state).toBe('none');
    expect(status([], [{ ...request, fromId: 'someone-else' }]).state).toBe('none');
  });
});
