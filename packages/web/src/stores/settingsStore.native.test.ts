import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { DEFAULT_STREAMING_LIMITS, getStreamingLimits, useSettingsStore } from './settingsStore';
import type { InstanceUpdateStatus } from '@veyvox/shared';
afterEach(() => { useSettingsStore.getState().resetUpdateState(); vi.restoreAllMocks(); vi.useRealTimers(); });
describe('current instance settings only', () => {
  it('uses the single policy with bounded defaults while loading, never a remote-host document', () => {
    useSettingsStore.setState({ streamingLimits: null }); expect(getStreamingLimits()).toEqual(DEFAULT_STREAMING_LIMITS);
    const limits = { ...DEFAULT_STREAMING_LIMITS, maxBitrateKbps: 1234 }; useSettingsStore.setState({ streamingLimits: limits });
    expect(getStreamingLimits()).toBe(limits);
    expect(useSettingsStore.getState()).not.toHaveProperty('streamingLimitsByOrigin'); expect(useSettingsStore.getState()).not.toHaveProperty('fetchStreamingLimitsFor');
  });
  it('does not restore old admin release data or rearm its timer after session reset', async () => {
    vi.useFakeTimers(); let finish!: (value: InstanceUpdateStatus) => void;
    vi.spyOn(api.admin, 'updateStatus').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const old = useSettingsStore.getState().fetchUpdateStatus(); useSettingsStore.getState().resetUpdateState();
    finish({ latestVersion: 'synthetic-old' } as unknown as InstanceUpdateStatus); await old;
    expect(useSettingsStore.getState().updateStatus).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
