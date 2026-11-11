import { create } from 'zustand';
import type { InstanceStreamingLimits, InstanceAdminSettings, InstanceUpdateStatus } from '@veyvox/shared';
import { api } from '../api/client';
import { describeError } from '../i18n/errors';
import { EMPTY_ACK, readUpdateAck, writeUpdateAck, pendingUpdateVersion, type UpdateAck } from '../utils/updateAck';
import { invalidateHomeInstanceInfo } from '../hooks/useHomeInstanceInfo';

interface SettingsState {
  /** Current instance streaming document and discovery flags. */
  streamingLimits: InstanceStreamingLimits | null;
  instanceSettings: InstanceAdminSettings | null;
  isAdmin: boolean;
  gifEnabled: boolean;
  fetchStreamingLimits: () => Promise<void>;
  updateStreamingLimits: (limits: Partial<InstanceStreamingLimits>) => Promise<void>;
  fetchInstanceSettings: () => Promise<void>;
  updateInstanceSettings: (data: Partial<InstanceAdminSettings>) => Promise<void>;
  fetchGifEnabled: () => Promise<void>;
  setIsAdmin: (isAdmin: boolean) => void;
  updateStatus: InstanceUpdateStatus | null;
  updateStatusLoading: boolean;
  updateStatusError: string;
  updateAck: UpdateAck;
  updateAckUserId: string | null;
  fetchUpdateStatus: (refresh?: boolean) => Promise<void>;
  markUpdateSeen: () => void;
  markUpdateToastShown: () => void;
  setUpdateAckUser: (userId: string | null) => void;
  stopUpdateStatusRefresh: () => void;
  resetUpdateState: () => void;
}

export const DEFAULT_STREAMING_LIMITS: InstanceStreamingLimits = {
  maxBitrateKbps: 20000,
  minBitrateKbps: 500,
  bitrateStepKbps: 500,
  allowedResolutions: [540, 720, 1080],
  allowedFramerates: [30, 45, 60],
  maxResolution: 1080,
  maxFramerate: 60,
  bitrateMatrixOverrides: null,
  allowCustomBitrate: true,
};

/** Numeric media defaults while the current instance's policy is not yet loaded. */
export function getStreamingLimits(): InstanceStreamingLimits {
  return useSettingsStore.getState().streamingLimits ?? DEFAULT_STREAMING_LIMITS;
}

/**
 * How often a live session re-asks for the update status.
 *
 * Matched to the server's own six-hour success cache, so a refresh that lands
 * inside the window costs nothing outbound. Without this, the admin the feature
 * exists for — the one who never opens settings and never reloads a long-lived
 * desktop window — would learn about a release only on their next sign-in.
 */
export const UPDATE_STATUS_REFRESH_MS = 6 * 60 * 60 * 1000;

let updateStatusTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesces concurrent callers (WS ready and a panel mount) into one request. */
let updateStatusInFlight: Promise<void> | null = null;
let sessionGeneration = 0;

export const useSettingsStore = create<SettingsState>((set) => ({
  streamingLimits: null,
  instanceSettings: null,
  isAdmin: false,
  gifEnabled: false,

  fetchStreamingLimits: async () => {
    try {
      const limits = await api.settings.getStreaming();
      set({ streamingLimits: limits });
    } catch (err) {
      // Keep an unknown document unknown. Screen-share configuration uses
      // getStreamingLimits() when it needs numeric defaults at read time.
      console.warn('[Settings] Failed to fetch streaming limits:', err);
    }
  },

  updateStreamingLimits: async (limits: Partial<InstanceStreamingLimits>) => {
    const updated = await api.settings.updateStreaming(limits);
    set({ streamingLimits: updated });
  },

  fetchInstanceSettings: async () => {
    try {
      const settings = await api.settings.getInstance();
      set({ instanceSettings: settings });
    } catch (err) {
      console.warn('[Settings] Failed to fetch instance settings:', err);
    }
  },

  updateInstanceSettings: async (data: Partial<InstanceAdminSettings>) => {
    const updated = await api.settings.updateInstance(data);
    set({ instanceSettings: updated });
    invalidateHomeInstanceInfo();
  },

  fetchGifEnabled: async () => {
    try {
      const { enabled } = await api.gif.enabled();
      set({ gifEnabled: enabled });
    } catch {
      set({ gifEnabled: false });
    }
  },

  setIsAdmin: (isAdmin: boolean) => set({ isAdmin }),

  updateStatus: null,
  updateStatusLoading: false,
  updateStatusError: '',
  updateAck: EMPTY_ACK,
  updateAckUserId: null,

  /**
   * Records whose acknowledgements to read and write, handed over by the
   * WebSocket `ready` handler. It lives here rather than being read from
   * `authStore` because importing that store into this one drags the audio
   * pipeline into every test that touches settings.
   */
  setUpdateAckUser: (userId) => {
    set({ updateAckUserId: userId, updateAck: readUpdateAck(localStorage, userId) });
  },

  /**
   * Asks the home instance whether a newer release exists.
   *
   * Admin-gated on the client as well as the server, so a non-admin session
   * never issues a request that could only 403. The reschedule happens on every
   * completed call, including an explicit panel refresh, which keeps exactly one
   * timer alive regardless of how many callers there are.
   */
  fetchUpdateStatus: async (refresh = false) => {
    const generation = sessionGeneration;
    // Deliberately NOT gated on `isAdmin` here. That flag is set only by the
    // WebSocket `ready` handler, so a panel rendered before `ready` lands (or
    // during a reconnect) would be permanently stuck on an empty error state
    // with a "Try again" button that also did nothing. Both call sites are
    // admin-only by construction: the `ready` handler checks the flag it just
    // received, and UpdatesPanel only renders inside the admin-gated Instance
    // settings tab.
    //
    // An explicit refresh never joins an in-flight cached fetch: doing so would
    // silently downgrade a "Check again" click to whatever the earlier call
    // asked for.
    if (!refresh && updateStatusInFlight !== null) return updateStatusInFlight;

    set({ updateStatusLoading: true, updateStatusError: '' });

    updateStatusInFlight = (async () => {
      try {
        const result = await api.admin.updateStatus(refresh);
        if (generation !== sessionGeneration) return;
        set({
          updateStatus: result,
          updateAck: readUpdateAck(localStorage, useSettingsStore.getState().updateAckUserId),
          updateStatusError: '',
        });
      } catch (err) {
        if (generation === sessionGeneration) set({ updateStatusError: describeError(err) });
      } finally {
        if (generation === sessionGeneration) {
          set({ updateStatusLoading: false });
          updateStatusInFlight = null;
          if (updateStatusTimer !== null) clearTimeout(updateStatusTimer);
          updateStatusTimer = setTimeout(() => {
            void useSettingsStore.getState().fetchUpdateStatus();
          }, UPDATE_STATUS_REFRESH_MS);
        }
      }
    })();

    return updateStatusInFlight;
  },

  markUpdateSeen: () => {
    const version = pendingUpdateVersion(useSettingsStore.getState().updateStatus);
    if (version === null) return;
    const userId = useSettingsStore.getState().updateAckUserId;
    const next: UpdateAck = { ...useSettingsStore.getState().updateAck, seenVersion: version };
    writeUpdateAck(localStorage, userId, next);
    set({ updateAck: next });
  },

  markUpdateToastShown: () => {
    const version = pendingUpdateVersion(useSettingsStore.getState().updateStatus);
    if (version === null) return;
    const userId = useSettingsStore.getState().updateAckUserId;
    const next: UpdateAck = { ...useSettingsStore.getState().updateAck, toastShownFor: version };
    writeUpdateAck(localStorage, userId, next);
    set({ updateAck: next });
  },

  /**
   * Called by `resetUpdateState` (itself called on logout, from `authStore`'s
   * `resetUserStores`) and directly by tests, so a dead session leaves no
   * timer behind.
   */
  stopUpdateStatusRefresh: () => {
    if (updateStatusTimer !== null) {
      clearTimeout(updateStatusTimer);
      updateStatusTimer = null;
    }
  },

  /**
   * Clears everything about instance-update state on logout.
   *
   * `isAdmin` and `updateStatus` are permission-scoped, not instance-scoped:
   * unlike `streamingLimits` or `instanceSettings`, which describe the
   * instance itself and stay valid for whoever signs in next, these describe
   * the PREVIOUS user's admin status. Left in place, a non-admin signing in
   * on the same tab would render an admin-only update dot until the next
   * WebSocket `ready` overwrites it, and the six-hour refresh timer would
   * keep hitting `/api/admin/instance/update-status` for the life of the tab
   * with no admin session behind it.
   *
   * Deliberately does not import `authStore` to know when to run — see the
   * comment on `setUpdateAckUser` above. `authStore.resetUserStores()` calls
   * this instead, keeping the import direction one-way.
   */
  resetUpdateState: () => {
    sessionGeneration++; updateStatusInFlight = null;
    useSettingsStore.getState().stopUpdateStatusRefresh();
    set({
      isAdmin: false,
      updateStatus: null,
      updateStatusLoading: false,
      updateStatusError: '',
      updateAck: EMPTY_ACK,
      updateAckUserId: null,
    });
  },
}));
