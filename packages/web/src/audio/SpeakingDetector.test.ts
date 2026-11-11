import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParticipantInfo } from '../hooks/useLiveKit';
const audio = vi.hoisted(() => ({ sample: 140 }));
vi.mock('./AudioManager', () => ({ AudioManager: { getInstance: () => ({
  getAnalyserNode: () => ({ fftSize: 256, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(audio.sample) }),
}) } }));
import { SpeakingDetector } from './SpeakingDetector';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useVoiceStore } from '../stores/voiceStore';
import type { User } from '@veyvox/shared';
const identity = 'me:exact@retained.invalid';
beforeEach(() => {
  vi.useFakeTimers(); audio.sample = 140;
  useAuthStore.setState({ user: { id: 'me' } as User });
  useSpaceStore.setState({ channelToSpaceMap: new Map([['voice', 'space']]) });
  useVoiceStore.setState({ ...useVoiceStore.getInitialState(), currentVoiceChannelId: 'voice' });
  SpeakingDetector.getInstance().syncTracks([{ identity, userId: 'me', isLocal: true } as ParticipantInfo]);
});
afterEach(() => { SpeakingDetector.getInstance().clear(); vi.useRealTimers(); });
describe('native local speaking detection', () => {
  it('honors native moderator mute and deafen without a peer identity lookup', () => {
    vi.advanceTimersByTime(50); expect(useVoiceStore.getState().speakingParticipantIds.has(identity)).toBe(true);
    useVoiceStore.setState({ spaceMutedUserIds: new Set(['space:me']) }); vi.advanceTimersByTime(50);
    expect(useVoiceStore.getState().speakingParticipantIds.size).toBe(0);
    useVoiceStore.setState({ spaceMutedUserIds: new Set(), spaceDeafenedUserIds: new Set(['space:me']) }); vi.advanceTimersByTime(50);
    expect(useVoiceStore.getState().speakingParticipantIds.size).toBe(0);
    useVoiceStore.setState({ spaceDeafenedUserIds: new Set() }); vi.advanceTimersByTime(50);
    expect(useVoiceStore.getState().speakingParticipantIds.has(identity)).toBe(true);
  });
  it('keeps five silent hold frames and releases its polling timer on clear', () => {
    vi.advanceTimersByTime(50); audio.sample = 128; vi.advanceTimersByTime(250);
    expect(useVoiceStore.getState().speakingParticipantIds.has(identity)).toBe(true); vi.advanceTimersByTime(50);
    expect(useVoiceStore.getState().speakingParticipantIds.size).toBe(0); SpeakingDetector.getInstance().clear(); expect(vi.getTimerCount()).toBe(0);
  });
});
