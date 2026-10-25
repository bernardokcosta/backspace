import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from './voiceStore';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
const KEY = 'backspace-voice-settings';
afterEach(() => {
  localStorage.removeItem(KEY);
  useVoiceStore.setState(useVoiceStore.getInitialState(), true);
});

describe('Force SDR device preference', () => {
  it('defaults off and persists an explicit choice', () => {
    expect(useVoiceStore.getInitialState().screenShareConfig.forceSdr).toBe(false);
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.state.screenShareConfig.forceSdr).toBe(true);
  });

  it('migrates a pre-SDR configuration to off without changing its other choices', async () => {
    const previous = { height: 1080, fps: 120, mode: 'text', customBitrateKbps: 8000, shareAudio: true, codec: 'h264' };
    localStorage.setItem(KEY, JSON.stringify({ version: 14, state: { screenShareConfig: previous } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual({ ...previous, forceSdr: false });
  });

  it('keeps complete defaults when older storage has no capture configuration', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 14, state: { outputVolume: 60 } }));
    await useVoiceStore.persist.rehydrate();
    expect(useVoiceStore.getState().screenShareConfig).toEqual(useVoiceStore.getInitialState().screenShareConfig);
    expect(useVoiceStore.getState().screenShareConfig.forceSdr).toBe(false);
  });
});
