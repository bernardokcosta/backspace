import type { Friend, FriendRequest, User } from '@veyvox/shared';

export type FriendshipStatus =
  | { state: 'self' }
  | { state: 'friends'; friend: Friend }
  | { state: 'outbound_pending'; request: FriendRequest }
  | { state: 'inbound_pending'; request: FriendRequest }
  | { state: 'none' };

/** Resolve the current native graph by account IDs, never by display handles. */
export function getFriendshipStatus({ viewedUser, selfUserId, friends, requests }: {
  viewedUser: Pick<User, 'id'>; selfUserId: string | null | undefined; friends: Friend[]; requests: FriendRequest[];
}): FriendshipStatus {
  if (!selfUserId) return { state: 'none' };
  if (viewedUser.id === selfUserId) return { state: 'self' };
  const friend = friends.find(row => row.id === viewedUser.id);
  if (friend) return { state: 'friends', friend };
  for (const request of requests) {
    if (request.status !== 'pending') continue;
    if (request.fromId === selfUserId && request.toId === viewedUser.id) return { state: 'outbound_pending', request };
    if (request.fromId === viewedUser.id && request.toId === selfUserId) return { state: 'inbound_pending', request };
  }
  return { state: 'none' };
}
