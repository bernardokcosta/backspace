import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceAdminSettings } from '@backspace/shared';
import { api } from '../api/client';
import { DEFAULT_STREAMING_LIMITS, useSettingsStore } from './settingsStore';
const { invalidateHomeInstanceInfo } = vi.hoisted(() => ({ invalidateHomeInstanceInfo: vi.fn() }));
vi.mock('../hooks/useHomeInstanceInfo', () => ({ invalidateHomeInstanceInfo }));

const settings: InstanceAdminSettings = {
  instanceName: 'Workbench', registrationOpen: true, federatedRegistrationOpen: true,
  maxUploadSizeMb: 100, maxStickerSizeMb: 8, federationRelayEnabled: true,
  federationRelayTtlDays: 30, defaultAutoRotateIntervalDays: 90, autoAcceptPeering: true,
};
beforeEach(() => {
  invalidateHomeInstanceInfo.mockClear();
  useSettingsStore.setState({ streamingLimits: { ...DEFAULT_STREAMING_LIMITS }, instanceSettings: { ...settings } });
});
afterEach(() => { vi.restoreAllMocks(); });
describe('retained instance settings saves', () => {
  it('uses the server answer, invalidates shared info and never rewrites streaming policy', async () => {
    const limits = useSettingsStore.getState().streamingLimits;
    vi.spyOn(api.settings, 'updateInstance').mockResolvedValue({ ...settings, instanceName: 'Saved', maxStickerSizeMb: 42 });
    await useSettingsStore.getState().updateInstanceSettings({ instanceName: 'Sent' });
    expect(useSettingsStore.getState().instanceSettings).toMatchObject({ instanceName: 'Saved', maxStickerSizeMb: 42 });
    expect(useSettingsStore.getState().streamingLimits).toBe(limits);
    expect(invalidateHomeInstanceInfo).toHaveBeenCalledOnce();
  });
  it('leaves unknown streaming policy unknown', async () => {
    useSettingsStore.setState({ streamingLimits: null });
    vi.spyOn(api.settings, 'updateInstance').mockResolvedValue(settings);
    await useSettingsStore.getState().updateInstanceSettings({ instanceName: 'Workbench' });
    expect(useSettingsStore.getState().streamingLimits).toBeNull();
  });
  it('does not replace settings or invalidate info after a rejected save', async () => {
    const before = useSettingsStore.getState().instanceSettings;
    vi.spyOn(api.settings, 'updateInstance').mockRejectedValue(new Error('refused'));
    await expect(useSettingsStore.getState().updateInstanceSettings({ instanceName: 'New' })).rejects.toThrow('refused');
    expect(useSettingsStore.getState().instanceSettings).toBe(before);
    expect(invalidateHomeInstanceInfo).not.toHaveBeenCalled();
  });
});
