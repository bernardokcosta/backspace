import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from '../stores/voiceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';
import { useSoundboardPreferences } from '../stores/soundboardStore';
import { receiveSoundboardPlay, stopSoundboardPlayback, updateSoundboardVolume } from './soundboardPlayback';

const audio = vi.hoisted(() => ({
  source: { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), buffer: null, onended: null },
  gain: { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() },
  decode: vi.fn(), resume: vi.fn(),
}));
vi.mock('./AudioManager', () => ({ AudioManager: { getInstance: () => ({
  resumeContext: audio.resume,
  ensureContext: () => ({ decodeAudioData: audio.decode, createBufferSource: () => audio.source, createGain: () => audio.gain }),
  getMasterOutput: () => 'master-bus',
}) } }));
const sound = { id: '1', spaceId: 'space', uploaderId: 'me', name: 'Clip', emoji: '🔊', filename: '1.wav', durationSeconds: 1, createdAt: 1 };
beforeEach(() => {
  stopSoundboardPlayback(); vi.clearAllMocks();
  useVoiceStore.setState({ currentVoiceChannelId: 'voice', isLiveKitConnected: true, isDeafened: false, spaceDeafenedUserIds: new Set(), outputVolume: 50 });
  useSpaceStore.setState({ channelToSpaceMap: new Map([['voice', 'space']]) });
  useAuthStore.setState({ user: { id: 'me' } as never });
  useSoundboardPreferences.setState({ volume: 70 });
  audio.resume.mockResolvedValue(undefined); audio.decode.mockResolvedValue({ duration: 1 });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))));
});
afterEach(() => { stopSoundboardPlayback(); vi.unstubAllGlobals(); });

describe('voice-scoped soundboard playback', () => {
  it('uses the current asset and shared output bus with independent and master volume', async () => {
    await receiveSoundboardPlay('voice', 'space', sound);
    expect(fetch).toHaveBeenCalledWith('/api/uploads/1.wav', expect.anything());
    expect(audio.gain.connect).toHaveBeenCalledWith('master-bus');
    expect(audio.gain.gain.value).toBeCloseTo(0.35);
    expect(audio.source.start).toHaveBeenCalledOnce();
    useSoundboardPreferences.setState({ volume: 40 }); updateSoundboardVolume();
    expect(audio.gain.gain.value).toBeCloseTo(0.2);
  });
  it('ignores other rooms/spaces, disconnected and deafened sessions', async () => {
    await receiveSoundboardPlay('voice', 'other', sound);
    await receiveSoundboardPlay('other', 'space', sound);
    useVoiceStore.setState({ isDeafened: true });
    await receiveSoundboardPlay('voice', 'space', sound);
    useVoiceStore.setState({ isDeafened: false, isLiveKitConnected: false });
    await receiveSoundboardPlay('voice', 'space', sound);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cannot start a pending decode after Stop, a channel switch or deafen', async () => {
    let finish!: (value: { duration: number }) => void;
    audio.decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const play = receiveSoundboardPlay('voice', 'space', sound);
    await vi.waitFor(() => expect(audio.decode).toHaveBeenCalledOnce());
    stopSoundboardPlayback(); useVoiceStore.setState({ currentVoiceChannelId: 'other' });
    finish({ duration: 1 }); await play;
    expect(audio.source.start).not.toHaveBeenCalled();
  });
  it('rejects filenames outside the canonical asset form', async () => {
    await receiveSoundboardPlay('voice', 'space', { ...sound, filename: '../../private' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a late decoded clip after equal-ID session replacement', async () => {
    let finish!: (value: { duration: number }) => void;
    audio.decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = receiveSoundboardPlay('voice', 'space', sound); await vi.waitFor(() => expect(audio.decode).toHaveBeenCalledOnce());
    useAuthStore.setState(state => ({ sessionRevision: state.sessionRevision + 1 })); finish({ duration: 1 }); await pending;
    expect(audio.source.start).not.toHaveBeenCalled();
  });
});
