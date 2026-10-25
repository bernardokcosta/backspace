import { getElectronAPI } from '../platform/platform';

interface GeneratedVideoTrack extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}
type GeneratorConstructor = new (options: { kind: 'video' }) => GeneratedVideoTrack;
type SdrBridge = Required<Pick<BackspaceElectronAPI, 'getSdrCaptureCapability' | 'startSdrCapture'
  | 'configureSdrCapture' | 'stopSdrCapture' | 'onSdrCaptureEnded'>>;

interface CaptureOwner {
  disposed: boolean;
  dispose: (error?: Error, ended?: boolean) => void;
  configure: (constraints: DesktopSdrCaptureConstraints) => Promise<void>;
}

const byStream = new WeakMap<MediaStream, CaptureOwner>();
const byTrack = new WeakMap<MediaStreamTrack, CaptureOwner>();
let retiredHostCleanup: Promise<void> = Promise.resolve();
export const SDR_FIRST_FRAME_TIMEOUT_MS = 10_000;

export class SdrCaptureError extends Error {
  constructor(readonly reason: string, cause?: unknown) {
    super(`SDR capture failed (${reason})`, { cause });
    this.name = 'SdrCaptureError';
  }
}

function generatorConstructor(): GeneratorConstructor | null {
  const candidate = (globalThis as typeof globalThis & { MediaStreamTrackGenerator?: GeneratorConstructor }).MediaStreamTrackGenerator;
  return typeof candidate === 'function' ? candidate : null;
}

function createVideoWriter(Generator: GeneratorConstructor): {
  generator: GeneratedVideoTrack;
  writer: WritableStreamDefaultWriter<VideoFrame>;
} {
  const generator = new Generator({ kind: 'video' });
  try { return { generator, writer: generator.writable.getWriter() }; }
  catch (error) { generator.stop(); throw error; }
}

function bridge(): SdrBridge | null {
  const api = getElectronAPI();
  if (api?.platform !== 'win32' || ![
    api.getSdrCaptureCapability, api.startSdrCapture, api.configureSdrCapture,
    api.stopSdrCapture, api.onSdrCaptureEnded,
  ].every((method) => typeof method === 'function')) return null;
  return api as SdrBridge;
}

export async function getSdrCaptureCapability(): Promise<DesktopSdrCaptureCapability> {
  if (getElectronAPI()?.platform !== 'win32') return { supported: false, reason: 'platform' };
  const api = bridge();
  if (!api) return { supported: false, reason: 'bridge' };
  if (!generatorConstructor() || typeof VideoFrame !== 'function') return { supported: false, reason: 'transport' };
  try {
    const answer: unknown = await api.getSdrCaptureCapability();
    if (typeof answer !== 'object' || answer === null) return { supported: false, reason: 'bridge' };
    const value = answer as Record<string, unknown>;
    if (value.supported === true && value.borderless === true) return { supported: true, borderless: true };
    if (value.supported === false && ['platform', 'system', 'module', 'transport', 'bridge'].includes(String(value.reason))) {
      return { supported: false, reason: value.reason as Extract<DesktopSdrCaptureCapability, { supported: false }>['reason'] };
    }
  } catch { /* Missing/incompatible host support is not a working toggle. */ }
  return { supported: false, reason: 'bridge' };
}

function ownerOf(capture: MediaStream | MediaStreamTrack): CaptureOwner | undefined {
  if ('getVideoTracks' in capture && typeof capture.getVideoTracks === 'function') {
    return byStream.get(capture) ?? capture.getVideoTracks().map((track) => byTrack.get(track)).find((owner) => owner !== undefined);
  }
  return byTrack.get(capture as MediaStreamTrack);
}

/** A new MediaStream wrapping the same track (e.g. codec republish) keeps ownership. */
export async function configureSdrScreenCapture(stream: MediaStream | MediaStreamTrack, constraints: DesktopSdrCaptureConstraints): Promise<boolean> {
  const owner = ownerOf(stream);
  if (!owner || owner.disposed) return false;
  await owner.configure(constraints);
  return true;
}

export function disposeSdrScreenCapture(stream: MediaStream | MediaStreamTrack | null | undefined): void {
  if (stream) ownerOf(stream)?.dispose();
}

export function isSdrScreenCapture(stream: MediaStream | MediaStreamTrack | null | undefined): boolean {
  const owner = stream ? ownerOf(stream) : undefined;
  return !!owner && !owner.disposed;
}

/** Replaces video only after a corrected first frame; audio tracks are never reacquired. */
export function acquireSdrScreenCapture(
  raw: MediaStream,
  constraints: DesktopSdrCaptureConstraints,
  signal?: AbortSignal,
): Promise<MediaStream> {
  const api = bridge();
  const Generator = generatorConstructor();
  const rawVideo = raw.getVideoTracks();
  function stopRaw(): void { for (const track of raw.getTracks()) if (track.readyState !== 'ended') track.stop(); }
  if (!api || !Generator || typeof VideoFrame !== 'function' || !rawVideo.some((track) => track.readyState === 'live')) {
    stopRaw();
    return Promise.reject(new SdrCaptureError('unsupported'));
  }
  if (signal?.aborted) { stopRaw(); return Promise.reject(new DOMException('Capture cancelled', 'AbortError')); }
  let video: ReturnType<typeof createVideoWriter>;
  try { video = createVideoWriter(Generator); }
  catch (error) { stopRaw(); return Promise.reject(new SdrCaptureError('transport', error)); }
  const { generator, writer } = video;
  const originalStop = generator.stop.bind(generator);
  const originalSettings = generator.getSettings.bind(generator);
  let configuredRate = constraints.frameRate;
  let writtenSize: { width: number; height: number } | null = null;
  let sessionId: string | null = null;
  let early: { sessionId: string; frame: VideoFrame } | null = null;
  let earlyEnd: DesktopSdrCaptureEnded | null = null;
  let output: MediaStream | null = null;
  let writing = false;
  let unsubscribe: (() => void) | undefined;
  let stopRequest: Promise<void> | null = null;
  let resolveReady: (stream: MediaStream) => void = () => {};
  let rejectReady: (error: Error) => void = () => {};
  const ready = new Promise<MediaStream>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const predecessor = retiredHostCleanup;
  const start = predecessor.then(() => {
    if (owner.disposed) throw new DOMException('Capture cancelled', 'AbortError');
    return api.startSdrCapture(constraints);
  }).then((answer: unknown) => {
    if (typeof answer !== 'object' || answer === null) throw new SdrCaptureError('invalid-session');
    const id = (answer as Record<string, unknown>).sessionId;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new SdrCaptureError('invalid-session');
    return { sessionId: id };
  });

  function requestStop(id: string): Promise<void> {
    if (!stopRequest) {
      try { stopRequest = Promise.resolve(api!.stopSdrCapture(id)).catch((error: unknown) => { console.warn('[SDR] Host stop failed', error); }); }
      catch (error) { console.warn('[SDR] Host stop failed', error); stopRequest = Promise.resolve(); }
    }
    return stopRequest;
  }

  const onRawEnded = () => owner.dispose(new SdrCaptureError('source-ended'), true);
  const onAbort = () => owner.dispose(new DOMException('Capture cancelled', 'AbortError'));
  const timeout = setTimeout(() => owner.dispose(new SdrCaptureError('first-frame-timeout'), true), SDR_FIRST_FRAME_TIMEOUT_MS);
  const owner: CaptureOwner = {
    disposed: false,
    dispose(error = new DOMException('Capture cancelled', 'AbortError'), ended = false) {
      if (owner.disposed) return;
      owner.disposed = true;
      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      for (const track of rawVideo) track.removeEventListener('ended', onRawEnded);
      try { unsubscribe?.(); } catch { /* A broken listener remover cannot retain capture. */ }
      early?.frame.close(); early = null;
      originalStop();
      void writer.abort(error).catch(() => {});
      stopRaw();
      const cleanup = sessionId ? requestStop(sessionId) : start.then((result) => requestStop(result.sessionId), () => {});
      retiredHostCleanup = Promise.all([predecessor, cleanup]).then(() => {});
      rejectReady(error);
      if (ended && output) generator.dispatchEvent(new Event('ended'));
    },
    async configure(next) {
      const result = await start;
      if (owner.disposed) return;
      try { await api.configureSdrCapture(result.sessionId, next); configuredRate = next.frameRate; }
      catch (error) { const failure = new SdrCaptureError('configure-failed', error); owner.dispose(failure, true); throw failure; }
    },
  };
  byStream.set(raw, owner);
  byTrack.set(generator, owner);
  generator.stop = () => owner.dispose(); // Local stop() does not dispatch ended.
  // Chromium's generator reports only a deviceId, not video geometry. Keep
  // native-mode bitrate/quality logic grounded in the last frame actually
  // written, not the requested bounding box. frameRate remains the configured
  // capture ceiling, not a claim about measured throughput.
  generator.getSettings = () => ({ ...originalSettings(), ...(!owner.disposed && writtenSize
    ? { ...writtenSize, frameRate: configuredRate } : {}) });

  async function consume(frame: VideoFrame): Promise<void> {
    if (writing || owner.disposed) { frame.close(); return; }
    if (!Number.isInteger(frame.displayWidth) || !Number.isInteger(frame.displayHeight)
        || frame.displayWidth < 1 || frame.displayHeight < 1 || frame.displayWidth > 16384 || frame.displayHeight > 16384
        || frame.displayWidth * frame.displayHeight > 33_554_432) {
      frame.close(); owner.dispose(new SdrCaptureError('invalid-frame'), true); return;
    }
    writing = true;
    const size = { width: frame.displayWidth, height: frame.displayHeight };
    let written = false;
    try { await writer.write(frame); writtenSize = size; written = true; }
    catch (error) { owner.dispose(new SdrCaptureError('writer-failed', error), true); }
    finally { frame.close(); writing = false; }
    if (!written || owner.disposed || output) return;
    for (const track of rawVideo) track.removeEventListener('ended', onRawEnded);
    for (const track of rawVideo) if (track.readyState !== 'ended') track.stop();
    output = new MediaStream([generator, ...raw.getAudioTracks()]);
    byStream.set(output, owner);
    clearTimeout(timeout);
    resolveReady(output);
  }

  function onMessage(event: MessageEvent<unknown>): void {
    if (typeof event.data !== 'object' || event.data === null) return;
    const packet = event.data as Record<string, unknown>;
    if (packet.type !== 'backspace-sdr-frame' || !(packet.frame instanceof VideoFrame)) return;
    const frame = packet.frame;
    if (event.source !== window || event.origin !== window.location.origin || owner.disposed
        || typeof packet.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(packet.sessionId)) { frame.close(); return; }
    if (!sessionId) {
      early?.frame.close(); early = { sessionId: packet.sessionId, frame };
    } else if (sessionId !== packet.sessionId) frame.close();
    else void consume(frame);
  }

  window.addEventListener('message', onMessage);
  signal?.addEventListener('abort', onAbort, { once: true });
  for (const track of rawVideo) track.addEventListener('ended', onRawEnded);
  try {
    unsubscribe = api.onSdrCaptureEnded((ended) => {
      if (!sessionId) earlyEnd = ended;
      else if (ended.sessionId === sessionId) owner.dispose(new SdrCaptureError(ended.reason), true);
    });
  } catch (error) { owner.dispose(new SdrCaptureError('bridge', error)); }
  void start.then((result) => {
    sessionId = result.sessionId;
    if (owner.disposed) { void requestStop(sessionId); return; }
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) { owner.dispose(new SdrCaptureError('invalid-session')); return; }
    if (earlyEnd?.sessionId === sessionId) { owner.dispose(new SdrCaptureError(earlyEnd.reason), true); return; }
    if (early) {
      const buffered = early; early = null;
      if (buffered.sessionId === sessionId) void consume(buffered.frame);
      else buffered.frame.close();
    }
  }, (error: unknown) => owner.dispose(error instanceof SdrCaptureError ? error : new SdrCaptureError('start-failed', error)));
  return ready;
}
