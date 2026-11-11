import { create } from 'zustand';
import {
  resolveChannelNotificationPolicy,
  type ChannelNotificationPolicy,
  type NotificationSetting,
  type UpdateNotificationSettingRequest,
} from '@veyvox/shared';
import { api } from '../api/client';

/**
 * The native account's per-space/channel notification policy. Ready listings,
 * live pushes and mutation responses reconcile by server `updatedAt`.
 * Session reset invalidates old responses and clears timed mutes.
 */

export interface NotificationTarget {
  spaceId: string;
  /** null for the space-wide setting. */
  channelId: string | null;
}

/** Native spaces and channels have separate key namespaces. */
export function notificationSettingKey(target: NotificationTarget): string {
  return target.channelId === null
    ? `space\u0000${target.spaceId}`
    : `channel\u0000${target.channelId}`;
}

interface NotificationSettingsState {
  /** Keyed by `notificationSettingKey`. A cleared setting stays as an entry with nothing chosen. */
  settings: ReadonlyMap<string, NotificationSetting>;
  /**
   * Bumped when a timed mute ends, so components that show a mute re-render
   * at that moment. Read alongside `settings`; its value means nothing else.
   */
  clock: number;

  /** Replace this instance's settings with its listing. Errors are logged and leave the store as it was. */
  load: () => Promise<void>;
  /** A setting this instance pushed (`notification_settings_updated`). */
  apply: (setting: NotificationSetting) => void;
  /** Change one setting on the instance that hosts it. Rejects with the API error. */
  update: (target: NotificationTarget, change: UpdateNotificationSettingRequest) => Promise<NotificationSetting>;
  reset: () => void;
}

/**
 * Settings pushed while a `load` for the same origin is in flight. The
 * listing may have been read before or after they were written, so they are
 * merged over it by `updatedAt` instead of being overwritten by it.
 */
let pushedDuringLoad: Map<string, NotificationSetting> | null = null;
let loadSeq = 0;
/** Bumped by `reset`, so a response for the previous session is dropped. */
let sessionGeneration = 0;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** setTimeout's ceiling; a later end is re-checked when this one fires. */
const MAX_TIMER_MS = 2_147_483_647;

function newer(current: NotificationSetting | undefined, incoming: NotificationSetting): boolean {
  return !current || incoming.updatedAt >= current.updatedAt;
}

export const useNotificationSettingsStore = create<NotificationSettingsState>((set, get) => {
  /** Arms one timer for the nearest end of a timed mute still in the future. */
  function scheduleExpiry(settings: ReadonlyMap<string, NotificationSetting>): void {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    const now = Date.now();
    let nearest = Infinity;
    for (const setting of settings.values()) {
      if (setting.muted && setting.mutedUntil !== null && setting.mutedUntil > now) {
        nearest = Math.min(nearest, setting.mutedUntil);
      }
    }
    if (nearest === Infinity) return;
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      set({ clock: Date.now() });
      scheduleExpiry(get().settings);
    }, Math.min(nearest - now + 1, MAX_TIMER_MS));
  }

  function commit(settings: Map<string, NotificationSetting>): void {
    set({ settings });
    scheduleExpiry(settings);
  }

  function applyOne(setting: NotificationSetting): void {
    const key = notificationSettingKey(setting);
    const pending = pushedDuringLoad;
    if (pending && newer(pending.get(key), setting)) pending.set(key, setting);
    const current = get().settings.get(key);
    if (!newer(current, setting)) return;
    const settings = new Map(get().settings);
    settings.set(key, setting);
    commit(settings);
  }

  return {
    settings: new Map(),
    clock: 0,

    load: async () => {
      const seq = ++loadSeq;
      const generation = sessionGeneration;
      pushedDuringLoad = new Map();
      try {
        const { settings: listed } = await api.notificationSettings.list();
        if (generation !== sessionGeneration || loadSeq !== seq) return;
        const merged = new Map<string, NotificationSetting>();
        for (const setting of listed) merged.set(notificationSettingKey(setting), setting);
        for (const [key, pushed] of pushedDuringLoad ?? []) {
          if (newer(merged.get(key), pushed)) merged.set(key, pushed);
        }
        commit(merged);
      } catch (err) {
        if (generation === sessionGeneration) console.warn('[notificationSettings] Could not load native settings:', err);
      } finally {
        if (generation === sessionGeneration && loadSeq === seq) pushedDuringLoad = null;
      }
    },

    apply: setting => {
      applyOne(setting);
    },

    update: async (target, change) => {
      const client = api.notificationSettings;
      const generation = sessionGeneration;
      const setting = target.channelId === null
        ? await client.updateSpace(target.spaceId, change)
        : await client.updateChannel(target.channelId, change);
      if (generation === sessionGeneration) applyOne(setting);
      return setting;
    },

    reset: () => {
      sessionGeneration += 1;
      loadSeq++;
      pushedDuringLoad = null;
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
      set({ settings: new Map(), clock: 0 });
    },
  };
});

/** The stored setting for a space or channel on an instance, if any. */
export function selectNotificationSetting(
  state: Pick<NotificationSettingsState, 'settings'>,
  target: NotificationTarget,
): NotificationSetting | undefined {
  return state.settings.get(notificationSettingKey(target));
}

/**
 * What applies to a space channel at `now`: the inheritance and mute rules of
 * `resolveChannelNotificationPolicy`, over this store's entries. A space id
 * that is not known yet resolves to the defaults.
 */
export function selectChannelNotificationPolicy(
  state: Pick<NotificationSettingsState, 'settings'>,
  spaceId: string | undefined,
  channelId: string,
  now: number,
): ChannelNotificationPolicy {
  const spaceSetting = spaceId ? selectNotificationSetting(state, { spaceId, channelId: null }) : undefined;
  const channelSetting = selectNotificationSetting(state, { spaceId: spaceId ?? '', channelId });
  return resolveChannelNotificationPolicy(spaceSetting, channelSetting, now);
}
