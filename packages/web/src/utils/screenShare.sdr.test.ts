import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoiceStore } from '../stores/voiceStore';
import { stageScreenCapture, stopStagedCapture, applyStagedCaptureConfig, publishScreenShare, stopScreenShare,
  disposeActiveScreenShareCapture, handleScreenShareUnpublished, settleScreenShareAfterReconnect } from './screenShare';

const sdr = vi.hoisted(() => ({
  acquireSdrScreenCapture: vi.fn(), configureSdrScreenCapture: vi.fn(), disposeSdrScreenCapture: vi.fn(),
  getSdrCaptureCapability: vi.fn(), isSdrScreenCapture: vi.fn(),
}));
vi.mock('./sdrScreenCapture', async (original) => ({ ...await original<typeof import('./sdrScreenCapture')>(), ...sdr }));
vi.mock('./systemAudioSource', () => ({ acquireAppExcludedSystemAudio: vi.fn(async () => null) }));
vi.mock('./hwOverdrive', () => ({ activate: vi.fn(), deactivate: vi.fn() }));
vi.mock('./voice', () => ({ broadcastVoiceStatus: vi.fn() }));
vi.mock('./livekitInternals', () => ({ getPublisherPC: vi.fn(() => null), getMediaStreamTrack: vi.fn() }));
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));

function stream(kind: 'raw' | 'sdr') {
  const video = { kind: 'video', id: kind, readyState: 'live', contentHint: '',
    stop: vi.fn(() => { video.readyState = 'ended'; }), applyConstraints: vi.fn(), addEventListener: vi.fn(), getSettings: () => ({ width: 1920, height: 1080 }) };
  const audio = { kind: 'audio', readyState: 'live', stop: vi.fn(() => { audio.readyState = 'ended'; }) };
  const value = { getVideoTracks: () => [video], getAudioTracks: () => [audio], getTracks: () => [video, audio] } as unknown as MediaStream;
  return { value, video, audio };
}

let raw: ReturnType<typeof stream>;
let corrected: ReturnType<typeof stream>;
let getDisplayMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  raw = stream('raw'); corrected = stream('sdr');
  sdr.acquireSdrScreenCapture.mockReset().mockResolvedValue(corrected.value);
  sdr.configureSdrScreenCapture.mockReset().mockResolvedValue(false);
  sdr.disposeSdrScreenCapture.mockReset();
  sdr.getSdrCaptureCapability.mockReset().mockResolvedValue({ supported: true });
  sdr.isSdrScreenCapture.mockReset().mockImplementation((value) => value === corrected.value);
  getDisplayMedia = vi.fn(async () => raw.value);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } });
  useVoiceStore.setState({ isScreenSharing: false, screenShareSdr: false, livekitHostOrigin: '', screenShareConfig: {
    height: 1080, fps: 60, mode: 'gaming', customBitrateKbps: null, shareAudio: true, codec: 'vp9', forceSdr: true,
  } });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Force SDR screen-share lifecycle wiring', () => {
  it('blocks a saved Windows SDR choice on an old host before raw video or audio acquisition', async () => {
    const previous = window.backspace;
    window.backspace = { platform: 'win32' } as BackspaceElectronAPI;
    sdr.getSdrCaptureCapability.mockResolvedValueOnce({ supported: false, reason: 'bridge' });
    try {
      await expect(stageScreenCapture()).rejects.toMatchObject({ reason: 'unsupported' });
      expect(getDisplayMedia).not.toHaveBeenCalled();
      expect(sdr.acquireSdrScreenCapture).not.toHaveBeenCalled();
      expect(useVoiceStore.getState().screenShareConfig.forceSdr).toBe(true);
    } finally { if (previous) window.backspace = previous; else delete window.backspace; }
  });
  it('stages only corrected video and forwards capture constraints/cancellation without another microphone capture', async () => {
    const abort = new AbortController();
    expect(await stageScreenCapture({ forceSdr: true, signal: abort.signal })).toBe(corrected.value);
    expect(sdr.acquireSdrScreenCapture).toHaveBeenCalledWith(raw.value, { width: 1920, height: 1080, frameRate: 60 }, abort.signal);
    expect(corrected.video.contentHint).toBe('motion');
    expect(getDisplayMedia).toHaveBeenCalledOnce();
  });

  it('keeps ordinary capture unchanged when disabled or unavailable without overwriting the saved preference', async () => {
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: false });
    expect(await stageScreenCapture()).toBe(raw.value);
    expect(sdr.acquireSdrScreenCapture).not.toHaveBeenCalled();
    useVoiceStore.getState().setScreenShareConfig({ forceSdr: true });
    sdr.getSdrCaptureCapability.mockResolvedValueOnce({ supported: false, reason: 'platform' });
    expect(await stageScreenCapture()).toBe(raw.value);
    expect(useVoiceStore.getState().screenShareConfig.forceSdr).toBe(true);
  });

  it('never returns a raw-video fallback when an explicitly enabled conversion fails', async () => {
    const { SdrCaptureError } = await import('./sdrScreenCapture');
    sdr.acquireSdrScreenCapture.mockRejectedValueOnce(new SdrCaptureError('source-color-unsupported'));
    await expect(stageScreenCapture({ forceSdr: true })).rejects.toThrow();
    expect(raw.video.stop).toHaveBeenCalledOnce(); expect(raw.audio.stop).toHaveBeenCalledOnce();
  });

  it('routes staged settings through the owning native adapter instead of browser constraints', async () => {
    sdr.configureSdrScreenCapture.mockResolvedValueOnce(true);
    await applyStagedCaptureConfig(corrected.value);
    expect(sdr.configureSdrScreenCapture).toHaveBeenCalledWith(corrected.value, { width: 1920, height: 1080, frameRate: 60 });
    expect(corrected.video.applyConstraints).not.toHaveBeenCalled();
  });

  it('explicitly disposes native ownership on a cancelled staged preview', () => {
    stopStagedCapture(corrected.value);
    expect(sdr.disposeSdrScreenCapture).toHaveBeenCalledWith(corrected.value);
    expect(corrected.video.stop).toHaveBeenCalledOnce(); expect(corrected.audio.stop).toHaveBeenCalledOnce();
  });

  it('publishes the same corrected preview track, records actual mode and disposes before live unpublish', async () => {
    const { Track, ConnectionState } = await import('livekit-client');
    const videoPublication = { track: { mediaStreamTrack: corrected.video } };
    const participant = {
      publishTrack: vi.fn(async () => videoPublication), publishData: vi.fn(async () => {}),
      getTrackPublications: () => [],
      getTrackPublication: (source: string) => source === Track.Source.ScreenShare ? videoPublication : undefined,
      unpublishTrack: vi.fn(async () => {}),
    };
    const room = { localParticipant: participant, state: ConnectionState.Connected } as unknown as import('livekit-client').Room;
    expect(await publishScreenShare(room, corrected.value)).toBe(true);
    expect(participant.publishTrack.mock.calls[0]?.[0]).toBe(corrected.video);
    expect(useVoiceStore.getState().screenShareSdr).toBe(true);
    await stopScreenShare(room);
    expect(sdr.disposeSdrScreenCapture).toHaveBeenCalledWith(corrected.value);
    expect(useVoiceStore.getState().screenShareSdr).toBe(false);
  });

  it('retires a pending native publication on room teardown and never marks its late publish live', async () => {
    let resolvePublish: () => void = () => {};
    const participant = { publishTrack: vi.fn(() => new Promise<void>((resolve) => { resolvePublish = resolve; })),
      unpublishTrack: vi.fn(async () => {}), getTrackPublication: vi.fn(), publishData: vi.fn() };
    const room = { localParticipant: participant, state: 'connected' } as unknown as import('livekit-client').Room;
    const pending = publishScreenShare(room, corrected.value);
    disposeActiveScreenShareCapture(room);
    expect(sdr.disposeSdrScreenCapture).toHaveBeenCalledWith(corrected.value);
    resolvePublish();
    expect(await pending).toBe(false);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
    expect(participant.unpublishTrack).toHaveBeenCalledWith(corrected.video, false);
    expect(participant.publishTrack).toHaveBeenCalledTimes(1); // No late audio publication.
  });

  it('rolls back publication when setup cancels during negotiation', async () => {
    let resolvePublish: () => void = () => {};
    const participant = { publishTrack: vi.fn(() => new Promise<void>((resolve) => { resolvePublish = resolve; })),
      unpublishTrack: vi.fn(async () => {}), getTrackPublication: vi.fn(), publishData: vi.fn() };
    const room = { localParticipant: participant, state: 'connected' } as unknown as import('livekit-client').Room;
    const pending = publishScreenShare(room, corrected.value);
    corrected.video.stop();
    resolvePublish();
    expect(await pending).toBe(false);
    expect(useVoiceStore.getState().isScreenSharing).toBe(false);
    expect(participant.unpublishTrack).toHaveBeenCalledWith(corrected.video, false);
  });

  it('keeps native capture through a transient reconnect but disposes a terminal reconnect without video', async () => {
    const { Track } = await import('livekit-client');
    let hasVideo = true;
    const videoPublication = { track: { mediaStreamTrack: corrected.video } };
    const participant = { publishTrack: vi.fn(async () => videoPublication), getTrackPublications: () => [],
      getTrackPublication: (source: string) => hasVideo && source === Track.Source.ScreenShare ? videoPublication : undefined,
      publishData: vi.fn(async () => {}), unpublishTrack: vi.fn(async () => {}) };
    const room = { localParticipant: participant, state: 'connected' } as unknown as import('livekit-client').Room;
    await publishScreenShare(room, corrected.value);
    room.state = 'reconnecting' as import('livekit-client').ConnectionState;
    handleScreenShareUnpublished(room);
    expect(sdr.disposeSdrScreenCapture).not.toHaveBeenCalled();
    room.state = 'connected' as import('livekit-client').ConnectionState;
    settleScreenShareAfterReconnect(room);
    expect(sdr.disposeSdrScreenCapture).not.toHaveBeenCalled();
    room.state = 'reconnecting' as import('livekit-client').ConnectionState;
    handleScreenShareUnpublished(room);
    room.state = 'connected' as import('livekit-client').ConnectionState;
    hasVideo = false;
    settleScreenShareAfterReconnect(room);
    expect(sdr.disposeSdrScreenCapture).toHaveBeenCalledWith(corrected.value);
    expect(useVoiceStore.getState().screenShareSdr).toBe(false);
  });
});
