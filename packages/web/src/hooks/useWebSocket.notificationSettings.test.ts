import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationSetting } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useNotificationSettingsStore, notificationSettingKey } from '../stores/notificationSettingsStore';
import { useSocialStore } from '../stores/socialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
import { junoUser } from '../components/games/junoTestFixtures';
beforeEach(() => {
  installSocketHarness(); useAuthStore.setState({ token: 'native-token', user: junoUser('me') }); useNotificationSettingsStore.getState().reset();
  vi.spyOn(useNotificationSettingsStore.getState(), 'load').mockResolvedValue(undefined);
  for (const name of ['fetchStreamingLimits', 'fetchGifEnabled'] as const) vi.spyOn(useSettingsStore.getState(), name).mockResolvedValue(undefined);
  for (const name of ['loadFriends', 'loadRequests'] as const) vi.spyOn(useSocialStore.getState(), name).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function open(): TestWebSocket { renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; ws.open(); return ws; }
describe('native notification settings socket', () => {
  it('loads current settings without alternate origin arguments when ready arrives', () => {
    open().deliver({ type: 'ready', user: junoUser('me'), spaces: [], dmChannels: [], folders: [], readStates: [], activeCalls: [] });
    expect(useNotificationSettingsStore.getState().load).toHaveBeenCalledExactlyOnceWith();
  });
  it('applies a pushed setting to its native target', () => {
    const setting: NotificationSetting = { spaceId: 'space-1', channelId: 'chan-1', level: 'nothing', muted: false, mutedUntil: null, updatedAt: 5 };
    open().deliver({ type: 'notification_settings_updated', setting });
    expect(useNotificationSettingsStore.getState().settings.get(notificationSettingKey({ spaceId: 'space-1', channelId: 'chan-1' }))).toEqual(setting);
    expect(useNotificationSettingsStore.getState().settings.size).toBe(1);
  });
});
