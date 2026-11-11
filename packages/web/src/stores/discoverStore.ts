import { create } from 'zustand';
import type { DiscoverUser } from '@veyvox/shared';
import { api } from '../api/client';
import { describeError } from '../i18n/errors';

let requestGeneration = 0;
interface DiscoverState {
  users: DiscoverUser[];
  searchQuery: string;
  isLoading: boolean;
  total: number;
  error: string | null;
  fetchUsers: (query?: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  updateRelationship: (userId: string, relationship: DiscoverUser['relationship'], requestId?: string) => void;
  removeDeletedUser: (userId: string) => void;
  reset: () => void;
}
export const useDiscoverStore = create<DiscoverState>(set => ({
  users: [], searchQuery: '', isLoading: false, total: 0, error: null,
  fetchUsers: async query => {
    const request = ++requestGeneration;
    set({ isLoading: true, error: null });
    try {
      const result = await api.social.discover(query);
      if (request === requestGeneration) set({ users: result.users, total: result.total, isLoading: false });
    } catch (error) {
      if (request === requestGeneration) set({ isLoading: false, error: describeError(error) });
    }
  },
  setSearchQuery: searchQuery => set({ searchQuery }),
  updateRelationship: (userId, relationship, requestId) => set(state => ({
    users: state.users.map(user => user.id === userId ? { ...user, relationship, requestId } : user),
  })),
  removeDeletedUser: userId => set(state => {
    const users = state.users.filter(user => user.id !== userId);
    return users.length === state.users.length ? state : { users, total: Math.max(0, state.total - (state.users.length - users.length)) };
  }),
  reset: () => {
    requestGeneration++;
    set({ users: [], searchQuery: '', isLoading: false, total: 0, error: null });
  },
}));
