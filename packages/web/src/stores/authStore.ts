import { create } from 'zustand';
import { isChosenUserStatus, type ChosenUserStatus, type User } from '@veyvox/shared';
import { api } from '../api/client';
import { describeError } from '../i18n/errors';
import { useChatStore } from './chatStore';
import { useSpaceStore } from './spaceStore';
import { useSocialStore } from './socialStore';
import { useDiscoverStore } from './discoverStore';
import { useVoiceStore } from './voiceStore';
import { useActivityStore } from './activityStore';
import { useDeveloperModeStore } from './developerModeStore';
import { useSettingsStore } from './settingsStore';
import { useNotificationSettingsStore } from './notificationSettingsStore';
import { useChannelPokeStore } from './channelPokeStore';
import { useEphemeralReplyStore } from './ephemeralReplyStore';
import { useSoundboardStore } from './soundboardStore';
import { useJunoStore } from './junoStore';
import { useUnreadCountStore } from './unreadCountStore';
import { useTransferStore } from './transferStore';

interface AuthState {
  /** In-memory lifecycle revision; distinct sessions may reuse the same JWT bytes. */
  sessionRevision: number;
  token: string | null;
  user: User | null;
  isLoading: boolean;
  error: string | null;
  /** A refused bootstrap settles until explicit retry. */
  userLoadError: string | null;
  initSession: (token: string, user: User) => void;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, displayName?: string, avatarColor?: string) => Promise<void>;
  logout: () => void;
  loadUser: () => Promise<void>;
  updateProfile: (data: { displayName?: string; avatar?: string; banner?: string; accentColor?: string; avatarColor?: string; bio?: string; customStatus?: string; status?: ChosenUserStatus }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string, username: string) => Promise<void>;
  setUser: (user: User) => void;
  clearError: () => void;
}

/** Invalidate responses even if a later session reuses the same JWT/account ID. */
let sessionGeneration = 0;

/** Reset only in-memory user state, never device preferences, drafts or transfers. */
function resetUserStores(): void {
  api.cancelPendingReads();
  useTransferStore.getState().pauseSession();
  useChatStore.getState().clearAllMessages();
  useSpaceStore.getState().reset();
  useChannelPokeStore.getState().reset();
  useEphemeralReplyStore.getState().reset();
  useSoundboardStore.getState().reset();
  useJunoStore.getState().reset();
  useUnreadCountStore.getState().reset();
  useSocialStore.getState().reset();
  useDiscoverStore.getState().reset();
  useVoiceStore.getState().resetSession();
  useActivityStore.getState().reset();
  useNotificationSettingsStore.getState().reset();
  useSettingsStore.getState().resetUpdateState();
  useDeveloperModeStore.getState().reset();
}

function readSessionToken(): string | null {
  try { return localStorage.getItem('backspace_token'); } catch { return null; }
}

/** Persist the JWT, not a cleartext password (web-security.md §6). */
function persistSessionToken(jwtToken: string): string {
  const codes: number[] = [];
  for (let i = 0; i < jwtToken.length; i++) codes.push(jwtToken.charCodeAt(i) & 0xffff);
  const sessionJwt = String.fromCharCode(...codes);
  localStorage.setItem('backspace_token', sessionJwt);
  return sessionJwt;
}

/** The signed-in native account owns its chosen status. Offline is not a choice. */
export function selectMyChosenStatus(state: Pick<AuthState, 'user'>): ChosenUserStatus | null {
  return isChosenUserStatus(state.user?.status) ? state.user.status : null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  sessionRevision: 0,
  token: readSessionToken(),
  user: null,
  isLoading: false,
  error: null,
  userLoadError: null,

  initSession: (token, user) => {
    sessionGeneration++;
    resetUserStores();
    const sessionJwt = persistSessionToken(token);
    set({ token: sessionJwt, user, sessionRevision: sessionGeneration, isLoading: false, error: null, userLoadError: null });
    void useTransferStore.getState().restoreSession();
  },

  login: async (username, password) => {
    const generation = ++sessionGeneration;
    set({ isLoading: true, error: null });
    try {
      const response = await api.auth.login({ username, password });
      if (generation !== sessionGeneration) return;
      get().initSession(response.token, response.user);
    } catch (error) {
      if (generation === sessionGeneration) set({ isLoading: false, error: describeError(error) });
      throw error;
    }
  },

  register: async (username, password, displayName, avatarColor) => {
    const generation = ++sessionGeneration;
    set({ isLoading: true, error: null });
    try {
      const response = await api.auth.register({ username, password, displayName, avatarColor });
      if (generation !== sessionGeneration) return;
      get().initSession(response.token, response.user);
    } catch (error) {
      if (generation === sessionGeneration) set({ isLoading: false, error: describeError(error) });
      throw error;
    }
  },

  logout: () => {
    sessionGeneration++;
    try { localStorage.removeItem('backspace_token'); } catch { /* In-memory logout still applies. */ }
    resetUserStores();
    set({ token: null, user: null, sessionRevision: sessionGeneration, isLoading: false, error: null, userLoadError: null });
  },

  loadUser: async () => {
    const token = get().token;
    if (!token) return;
    const generation = sessionGeneration;
    const current = () => generation === sessionGeneration && get().token === token;
    set({ isLoading: true, userLoadError: null });
    try {
      const user = await api.users.me();
      if (!current()) return;
      get().setUser(user);
      set({ isLoading: false, error: null, userLoadError: null });
    } catch (error) {
      if (!current()) return;
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 401) {
        get().logout();
      } else {
        const message = describeError(error);
        set({ isLoading: false, error: message, userLoadError: message });
      }
    }
  },

  updateProfile: async data => {
    const generation = sessionGeneration;
    try {
      const user = await api.users.update(data);
      if (generation === sessionGeneration) set({ user });
    } catch (error) {
      if (generation === sessionGeneration) set({ error: describeError(error) });
      throw error;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const generation = sessionGeneration;
    const response = await api.users.changePassword({ currentPassword, newPassword });
    if (generation !== sessionGeneration) return;
    sessionGeneration++;
    api.cancelPendingReads();
    useTransferStore.getState().pauseSession();
    const sessionJwt = persistSessionToken(response.token);
    set({ token: sessionJwt, sessionRevision: sessionGeneration, isLoading: false });
  },

  deleteAccount: async (password, username) => {
    const generation = sessionGeneration;
    await api.users.deleteAccount({ password, username });
    if (generation === sessionGeneration) get().logout();
  },

  setUser: user => {
    set({ user, userLoadError: null });
    void useTransferStore.getState().restoreSession();
  },
  clearError: () => set({ error: null }),
}));
