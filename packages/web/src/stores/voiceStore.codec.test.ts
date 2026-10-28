import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from './voiceStore';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

const KEY = 'backspace-voice-settings';

beforeEach(() => {
  localStorage.clear();
  useVoiceStore.setState(useVoiceStore.getInitialState());
});

describe('screen-share codec persistence', () => {
  it('persists HEVC without changing the VP9 default', async () => {
    expect(useVoiceStore.getInitialState().screenShareConfig.codec).toBe('vp9');
    useVoiceStore.getState().setScreenShareConfig({ codec: 'h265' });
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    expect(saved.version).toBe(16);
    expect(saved.state.screenShareConfig.codec).toBe('h265');
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig.codec).toBe('h265');
  });

  it.each(['vp9', 'h264', 'h265'] as const)('preserves saved %s and unrelated settings from version 15', async (codec) => {
    const previous = {
      ...useVoiceStore.getInitialState().screenShareConfig,
      height: 1080, fps: 120, customBitrateKbps: 9500, shareAudio: true, forceSdr: true, codec,
    };
    localStorage.setItem(KEY, JSON.stringify({ version: 15, state: { screenShareConfig: previous, outputVolume: 75 } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual(previous);
    expect(useVoiceStore.getState().outputVolume).toBe(75);
  });

  it.each([15, 16])('normalizes invalid codec in version %s while preserving other preferences', async (version) => {
    const config = { ...useVoiceStore.getInitialState().screenShareConfig, fps: 120, codec: 'invalid' };
    localStorage.setItem(KEY, JSON.stringify({ version, state: { screenShareConfig: config } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual({ ...config, codec: 'vp9' });
  });

  it('fills missing codec/config fields without losing a stored frame rate', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 15, state: { screenShareConfig: { fps: 120 } } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual({
      ...useVoiceStore.getInitialState().screenShareConfig, fps: 120,
    });
  });
});
