import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ getElectronAPI: vi.fn() }));
vi.mock('../platform/platform', () => platform);

const SESSION = '8dfd1bcd-7b0d-4a1c-9031-40d830256b67';
const OTHER = 'd46b0cf7-7e10-4506-bd86-f90d2b7e086d';
const constraints = { width: 1920, height: 1080, frameRate: 60 };
let acquire: typeof import('./sdrScreenCapture').acquireSdrScreenCapture;
let configure: typeof import('./sdrScreenCapture').configureSdrScreenCapture;
let dispose: typeof import('./sdrScreenCapture').disposeSdrScreenCapture;
let capability: typeof import('./sdrScreenCapture').getSdrCaptureCapability;

class FakeTrack extends EventTarget {
  readonly id = crypto.randomUUID();
  readyState = 'live';
  contentHint = '';
  constructor(readonly kind: string) { super(); }
  stop = vi.fn(() => { this.readyState = 'ended'; }); // Direct stop deliberately emits no ended.
  getSettings = (): MediaTrackSettings => ({ width: 1920, height: 1080, frameRate: 60 });
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks = () => [...this.tracks];
  getVideoTracks = () => this.tracks.filter((track) => track.kind === 'video');
  getAudioTracks = () => this.tracks.filter((track) => track.kind === 'audio');
}

class FakeFrame {
  displayWidth = 1920;
  displayHeight = 1080;
  timestamp = 1000;
  close = vi.fn();
}

const writes = vi.fn<(frame: VideoFrame) => Promise<void>>();
const abortWriter = vi.fn();
const generators: FakeTrack[] = [];
class FakeGenerator extends FakeTrack {
  constructor() { super('video'); generators.push(this); }
  writable = new WritableStream<VideoFrame>({ write: (frame) => writes(frame), abort: abortWriter });
  getSettings = (): MediaTrackSettings => ({ deviceId: 'generated' });
}

const api = {
  platform: 'win32',
  getSdrCaptureCapability: vi.fn(),
  startSdrCapture: vi.fn(),
  configureSdrCapture: vi.fn(),
  stopSdrCapture: vi.fn(),
  onSdrCaptureEnded: vi.fn(),
};
let onEnded: (ended: { sessionId: string; reason: string }) => void;
const unsubscribe = vi.fn();
const streams: MediaStream[] = [];

function rawStream() {
  const video = new FakeTrack('video'); const audio = new FakeTrack('audio');
  const stream = new FakeStream([video, audio]) as unknown as MediaStream;
  streams.push(stream);
  return { video, audio, stream };
}

function send(frame = new FakeFrame(), sessionId = SESSION, origin = window.location.origin) {
  window.dispatchEvent(new MessageEvent('message', {
    source: window, origin, data: { type: 'backspace-sdr-frame', sessionId, frame },
  }));
  return frame;
}

async function start(stream: MediaStream) {
  const pending = acquire(stream, constraints);
  await vi.waitFor(() => expect(api.startSdrCapture).toHaveBeenCalled());
  await Promise.resolve();
  const frame = send();
  const corrected = await pending;
  streams.push(corrected);
  return { corrected, frame };
}

beforeEach(async () => {
  vi.resetModules();
  ({ acquireSdrScreenCapture: acquire, configureSdrScreenCapture: configure,
    disposeSdrScreenCapture: dispose, getSdrCaptureCapability: capability } = await import('./sdrScreenCapture'));
  generators.length = 0; streams.length = 0;
  vi.stubGlobal('MediaStream', FakeStream);
  vi.stubGlobal('MediaStreamTrackGenerator', FakeGenerator);
  vi.stubGlobal('VideoFrame', FakeFrame);
  writes.mockReset().mockResolvedValue(undefined);
  abortWriter.mockReset(); unsubscribe.mockReset();
  api.getSdrCaptureCapability.mockReset().mockResolvedValue({ supported: true, borderless: true });
  api.startSdrCapture.mockReset().mockResolvedValue({ sessionId: SESSION });
  api.configureSdrCapture.mockReset().mockResolvedValue(undefined);
  api.stopSdrCapture.mockReset().mockResolvedValue(undefined);
  api.onSdrCaptureEnded.mockReset().mockImplementation((callback) => { onEnded = callback; return unsubscribe; });
  platform.getElectronAPI.mockReset().mockReturnValue(api);
});

afterEach(() => {
  for (const stream of streams) dispose?.(stream);
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('native SDR video track adapter', () => {
  it('returns the corrected track only after a valid first frame, keeping the original audio identity', async () => {
    const raw = rawStream();
    const { corrected, frame } = await start(raw.stream);
    expect(corrected.getVideoTracks()[0]).toBe(generators[0]);
    expect(corrected.getVideoTracks()[0]).not.toBe(raw.video);
    expect(corrected.getAudioTracks()).toEqual([raw.audio]);
    expect(raw.video.stop).toHaveBeenCalledOnce();
    expect(raw.audio.stop).not.toHaveBeenCalled();
    expect(frame.close).toHaveBeenCalledOnce();
    expect(writes).toHaveBeenCalledExactlyOnceWith(frame);
    expect(corrected.getVideoTracks()[0]!.getSettings()).toMatchObject({ width: 1920, height: 1080, frameRate: 60 });
  });

  it('closes stale/foreign frames without writing or adopting them', async () => {
    const raw = rawStream();
    const pending = acquire(raw.stream, constraints);
    await vi.waitFor(() => expect(api.startSdrCapture).toHaveBeenCalled());
    const foreign = send(new FakeFrame(), SESSION, 'https://foreign.test');
    const stale = send(new FakeFrame(), OTHER);
    expect(writes).not.toHaveBeenCalled();
    expect(foreign.close).toHaveBeenCalledOnce();
    expect(stale.close).toHaveBeenCalledOnce();
    send(); streams.push(await pending);
  });

  it('bounds writer backpressure and closes superseded frames', async () => {
    const raw = rawStream();
    const { corrected } = await start(raw.stream);
    let releaseWrite: () => void = () => {};
    writes.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseWrite = resolve; }));
    const held = send();
    await vi.waitFor(() => expect(writes).toHaveBeenCalledTimes(2));
    const dropped = send();
    expect(writes).toHaveBeenCalledTimes(2);
    expect(dropped.close).toHaveBeenCalledOnce();
    expect(held.close).not.toHaveBeenCalled();
    releaseWrite();
    await vi.waitFor(() => expect(held.close).toHaveBeenCalledOnce());
    dispose(corrected);
  });

  it('stops the host when the returned video track is stopped directly, without relying on ended', async () => {
    const raw = rawStream();
    const { corrected } = await start(raw.stream);
    corrected.getVideoTracks()[0]!.stop();
    dispose(corrected); dispose(raw.stream);
    expect(api.stopSdrCapture).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(raw.audio.stop).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('routes owned geometry changes to native capture even when a stream is re-housed for republish', async () => {
    const raw = rawStream();
    const { corrected } = await start(raw.stream);
    const republished = new FakeStream(corrected.getTracks() as unknown as FakeTrack[]) as unknown as MediaStream;
    expect(await configure(republished, { width: 1280, height: 720, frameRate: 30 })).toBe(true);
    expect(api.configureSdrCapture).toHaveBeenCalledWith(SESSION, { width: 1280, height: 720, frameRate: 30 });
    expect(await configure(new FakeStream() as unknown as MediaStream, constraints)).toBe(false);
  });

  it('rejects native failure and stops every acquired track without returning the raw capture', async () => {
    const raw = rawStream();
    api.startSdrCapture.mockRejectedValueOnce(new Error('source-color-unsupported'));
    await expect(acquire(raw.stream, constraints)).rejects.toThrow();
    expect(raw.video.stop).toHaveBeenCalledOnce(); expect(raw.audio.stop).toHaveBeenCalledOnce();
    expect(generators[0]!.readyState).toBe('ended');
  });

  it('stops a generated track if its writer cannot be acquired', async () => {
    class BrokenGenerator extends FakeGenerator {
      writable = { getWriter: () => { throw new Error('writer unavailable'); } } as unknown as WritableStream<VideoFrame>;
    }
    vi.stubGlobal('MediaStreamTrackGenerator', BrokenGenerator);
    const raw = rawStream();
    await expect(acquire(raw.stream, constraints)).rejects.toThrow();
    expect(generators[0]!.readyState).toBe('ended');
    expect(api.startSdrCapture).not.toHaveBeenCalled();
  });

  it('rejects a malformed start reply immediately rather than leaking until the first-frame timeout', async () => {
    const raw = rawStream();
    api.startSdrCapture.mockResolvedValueOnce(null);
    await expect(acquire(raw.stream, constraints)).rejects.toMatchObject({ reason: 'invalid-session' });
    expect(raw.video.stop).toHaveBeenCalledOnce(); expect(raw.audio.stop).toHaveBeenCalledOnce();
  });

  it('cancels before a late native-start reply and stops that late session once it arrives', async () => {
    const raw = rawStream();
    let resolveStart: (value: { sessionId: string }) => void = () => {};
    api.startSdrCapture.mockImplementationOnce(() => new Promise((resolve) => { resolveStart = resolve; }));
    const abort = new AbortController();
    const pending = acquire(raw.stream, constraints, abort.signal);
    await vi.waitFor(() => expect(api.startSdrCapture).toHaveBeenCalled());
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(raw.video.stop).toHaveBeenCalledOnce(); expect(raw.audio.stop).toHaveBeenCalledOnce();
    resolveStart({ sessionId: SESSION });
    await vi.waitFor(() => expect(api.stopSdrCapture).toHaveBeenCalledExactlyOnceWith(SESSION));
  });

  it('emits ended and disposes an established corrected stream on host source/device failure', async () => {
    const raw = rawStream(); const { corrected } = await start(raw.stream);
    const ended = vi.fn(); corrected.getVideoTracks()[0]!.addEventListener('ended', ended);
    onEnded({ sessionId: SESSION, reason: 'device-lost' });
    expect(ended).toHaveBeenCalledOnce();
    expect(raw.audio.stop).toHaveBeenCalledOnce();
    expect(api.stopSdrCapture).toHaveBeenCalledExactlyOnceWith(SESSION);
  });
});

describe('truthful SDR capability', () => {
  it('keeps browsers, other platforms and older/missing bridges unavailable', async () => {
    platform.getElectronAPI.mockReturnValue(undefined);
    expect(await capability()).toMatchObject({ supported: false });
    platform.getElectronAPI.mockReturnValue({ ...api, platform: 'linux' });
    expect(await capability()).toMatchObject({ supported: false });
    platform.getElectronAPI.mockReturnValue({ platform: 'win32' });
    expect(await capability()).toMatchObject({ supported: false });
    expect(api.getSdrCaptureCapability).not.toHaveBeenCalled();
  });

  it('requires a supported generator and validates the host capability response', async () => {
    expect(await capability()).toEqual({ supported: true, borderless: true });
    api.getSdrCaptureCapability.mockResolvedValueOnce({ supported: true });
    expect(await capability()).toEqual({ supported: false, reason: 'bridge' });
    api.getSdrCaptureCapability.mockResolvedValueOnce({ supported: false, reason: 'module' });
    expect(await capability()).toEqual({ supported: false, reason: 'module' });
    api.getSdrCaptureCapability.mockResolvedValueOnce({ supported: 'yes' });
    expect(await capability()).toMatchObject({ supported: false });
    vi.stubGlobal('MediaStreamTrackGenerator', undefined);
    expect(await capability()).toMatchObject({ supported: false });
  });
});
