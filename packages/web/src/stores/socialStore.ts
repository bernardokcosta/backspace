import { create } from 'zustand';
import type { Friend, FriendRequest, SendFriendRequest, User } from '@veyvox/shared';
import { api } from '../api/client';
import { describeError } from '../i18n/errors';

/** The request carries the other party's native profile. */
export function isIncomingRequest(request: FriendRequest): boolean {
  return request.user?.id === request.fromId;
}
export function isOutgoingRequest(request: FriendRequest): boolean {
  return request.user?.id === request.toId;
}

let generation = 0;
let friendsFlight: Promise<void> | null = null;
let requestsFlight: Promise<void> | null = null;

interface SocialState {
  friends: Friend[];
  requests: FriendRequest[];
  isLoading: boolean;
  error: string | null;
  loadFriends: () => Promise<void>;
  loadRequests: () => Promise<void>;
  sendFriendRequest: (target: SendFriendRequest) => Promise<string | undefined>;
  updateFriendRequest: (id: string, status: 'accepted' | 'declined') => Promise<void>;
  cancelFriendRequest: (id: string) => Promise<void>;
  removeFriend: (userId: string) => Promise<void>;
  searchUsers: (query: string) => Promise<User[]>;
  addIncomingRequest: (request: FriendRequest) => void;
  addOutboundRequest: (request: FriendRequest) => void;
  addFriendFromAccepted: (friend: Friend, requestId: string) => void;
  updateFriendPresence: (userId: string, status: User['status']) => void;
  updateFriendProfile: (user: User) => void;
  removeFriendLocally: (userId: string) => void;
  removeRequestById: (requestId: string, userId?: string) => void;
  removeDeletedUser: (userId: string) => void;
  reset: () => void;
}

function upsert<R extends { id: string }>(rows: R[], row: R): R[] {
  return rows.some(existing => existing.id === row.id) ? rows.map(existing => existing.id === row.id ? row : existing) : [...rows, row];
}

function without<R>(rows: R[], remove: (row: R) => boolean): R[] {
  const kept = rows.filter(row => !remove(row));
  return kept.length === rows.length ? rows : kept;
}

export const useSocialStore = create<SocialState>((set, get) => ({
  friends: [], requests: [], isLoading: false, error: null,

  loadFriends: () => {
    if (friendsFlight) return friendsFlight;
    const current = generation;
    set({ isLoading: true, error: null });
    friendsFlight = (async () => {
      try {
        const friends = await api.social.friends();
        if (current === generation) set({ friends, isLoading: false });
      } catch (error) {
        if (current === generation) set({ error: describeError(error), isLoading: false });
      } finally { if (current === generation) friendsFlight = null; }
    })();
    return friendsFlight;
  },
  loadRequests: () => {
    if (requestsFlight) return requestsFlight;
    const current = generation;
    set({ isLoading: true, error: null });
    requestsFlight = (async () => {
      try {
        const requests = await api.social.requests();
        if (current === generation) set({ requests, isLoading: false });
      } catch (error) {
        if (current === generation) set({ error: describeError(error), isLoading: false });
      } finally { if (current === generation) requestsFlight = null; }
    })();
    return requestsFlight;
  },

  sendFriendRequest: async target => {
    const current = generation;
    set({ isLoading: true, error: null });
    try {
      const result = await api.social.sendRequest({ username: target.username.trim() });
      if (current !== generation) return;
      set({ isLoading: false });
      // WS sends the new request too; refresh covers a tab racing that event.
      await get().loadRequests();
      return current === generation ? result.requestId : undefined;
    } catch (error) {
      if (current === generation) set({ error: describeError(error), isLoading: false });
      throw error;
    }
  },
  updateFriendRequest: async (id, status) => {
    const current = generation;
    set({ isLoading: true, error: null });
    try {
      await api.social.updateRequest(id, status);
      if (current !== generation) return;
      set(state => ({ requests: state.requests.filter(row => row.id !== id), isLoading: false }));
      if (status === 'accepted') await get().loadFriends();
    } catch (error) {
      if (current === generation) set({ error: describeError(error), isLoading: false });
      throw error;
    }
  },
  cancelFriendRequest: async id => {
    const current = generation;
    set({ isLoading: true, error: null });
    try {
      await api.social.cancelRequest(id);
      if (current === generation) set(state => ({ requests: state.requests.filter(row => row.id !== id), isLoading: false }));
    } catch (error) {
      if (current === generation) set({ error: describeError(error), isLoading: false });
      throw error;
    }
  },
  removeFriend: async userId => {
    const current = generation;
    set({ isLoading: true, error: null });
    try {
      await api.social.removeFriend(userId);
      if (current === generation) set(state => ({ friends: state.friends.filter(row => row.id !== userId), isLoading: false }));
    } catch (error) {
      if (current === generation) set({ error: describeError(error), isLoading: false });
      throw error;
    }
  },
  searchUsers: async query => {
    const current = generation;
    try {
      const users = await api.social.search(query);
      return current === generation ? users : [];
    } catch (error) {
      if (current === generation) console.error('Failed to search users:', error);
      return [];
    }
  },

  addIncomingRequest: request => set(state => ({ requests: upsert(state.requests, request) })),
  addOutboundRequest: request => set(state => ({ requests: upsert(state.requests, request) })),
  addFriendFromAccepted: (friend, requestId) => set(state => ({
    friends: upsert(state.friends, friend), requests: state.requests.filter(row => row.id !== requestId && row.user?.id !== friend.id),
  })),
  removeFriendLocally: userId => set(state => {
    const friends = without(state.friends, row => row.id === userId);
    return friends === state.friends ? state : { friends };
  }),
  removeRequestById: (requestId, userId) => set(state => {
    const requests = without(state.requests, row => row.id === requestId || (userId !== undefined && row.user?.id === userId));
    return requests === state.requests ? state : { requests };
  }),
  removeDeletedUser: userId => set(state => {
    const friends = without(state.friends, row => row.id === userId);
    const requests = without(state.requests, row => row.fromId === userId || row.toId === userId || row.user?.id === userId);
    return friends === state.friends && requests === state.requests ? state : { friends, requests };
  }),
  updateFriendPresence: (userId, status) => set(state => ({
    friends: state.friends.map(row => row.id === userId ? { ...row, status } : row),
  })),
  updateFriendProfile: user => set(state => ({ friends: state.friends.map(row => row.id === user.id ? {
    ...row, username: user.username, displayName: user.displayName, avatar: user.avatar, banner: user.banner,
    accentColor: user.accentColor, avatarColor: user.avatarColor, bio: user.bio, customStatus: user.customStatus,
    status: user.status, ...(user.isBot === undefined ? {} : { isBot: user.isBot }),
  } : row) })),
  reset: () => {
    generation++; friendsFlight = null; requestsFlight = null;
    set({ friends: [], requests: [], isLoading: false, error: null });
  },
}));
