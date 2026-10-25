import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SharedTexture } from 'electron';
import type { SdrCaptureConstraints } from './sdrCaptureTypes';

const SESSION = '8dfd1bcd-7b0d-4a1c-9031-40d830256b67';
const OTHER = 'd46b0cf7-7e10-4506-bd86-f90d2b7e086d';
const constraints: SdrCaptureConstraints = { width: 60, height: 30, frameRate: 30 };
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;

interface Bridge {
  startSdrCapture: (constraints: SdrCaptureConstraints) => Promise<{ sessionId: string }>;
  stopSdrCapture: (id: string) => Promise<void>;
}

afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllGlobals();
  vi.doUnmock('electron');
  vi.resetModules();
});

async function setup() {
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  let api: Bridge | undefined;
  let receiver: Parameters<SharedTexture['setSharedTextureReceiver']>[0] | undefined;
  let ended: ((event: unknown, payload: unknown) => void) | undefined;
  let resolveStart: (value: unknown) => void = () => { throw new Error('No pending start'); };
  const invoke = vi.fn((channel: string) => channel === 'sdr-capture-start'
    ? new Promise<unknown>((resolve) => { resolveStart = resolve; }) : Promise.resolve());
  const postMessage = vi.fn();
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://instance.test' }, postMessage });
  vi.doMock('electron', () => ({
    contextBridge: { exposeInMainWorld: (_name: string, value: Bridge) => { api = value; } },
    ipcRenderer: { invoke, on: (name: string, callback: typeof ended) => { if (name === 'sdr-capture-ended') ended = callback; } },
    sharedTexture: { setSharedTextureReceiver: (callback: typeof receiver) => { receiver = callback; } },
  }));
  await import('./preload');
  if (!api || !receiver || !ended) throw new Error('Production preload did not register its SDR bridge');
  function texture(patch: Partial<VideoFrame> = {}) {
    const close = vi.fn();
    const frame = { displayWidth: 60, displayHeight: 30, timestamp: 1000, close, ...patch } as unknown as VideoFrame;
    const release = vi.fn();
    const getVideoFrame = vi.fn(() => frame);
    return { frame, close, release, getVideoFrame,
      packet: { importedSharedTexture: { getVideoFrame, release } } as unknown as Parameters<NonNullable<typeof receiver>>[0] };
  }
  return { api, receiver, ended, invoke, postMessage, texture, resolve: (value: unknown) => resolveStart(value) };
}

describe('production SDR preload', () => {
  it('buffers one early frame privately until the start reply proves its session', async () => {
    const s = await setup();
    const start = s.api.startSdrCapture(constraints);
    const first = s.texture(); const latest = s.texture();
    await s.receiver(first.packet, { sessionId: SESSION });
    await s.receiver(latest.packet, { sessionId: SESSION });
    expect(first.close).toHaveBeenCalledOnce();
    expect(first.release).toHaveBeenCalledOnce();
    expect(latest.release).toHaveBeenCalledOnce();
    expect(s.postMessage).not.toHaveBeenCalled();
    s.resolve({ sessionId: SESSION });
    await start;
    expect(s.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'backspace-sdr-frame', sessionId: SESSION, frame: latest.frame }, 'https://instance.test', [latest.frame]);
    expect(latest.close).not.toHaveBeenCalled();
  });

  it('discards stale-session frames rather than exposing another document/session', async () => {
    const s = await setup();
    const before = s.texture();
    await s.receiver(before.packet, { sessionId: OTHER });
    expect(before.getVideoFrame).not.toHaveBeenCalled();
    expect(before.release).toHaveBeenCalledOnce();
    const start = s.api.startSdrCapture(constraints);
    const early = s.texture();
    await s.receiver(early.packet, { sessionId: OTHER });
    s.resolve({ sessionId: SESSION }); await start;
    expect(early.close).toHaveBeenCalledOnce();
    expect(s.postMessage).not.toHaveBeenCalled();
    const valid = s.texture();
    await s.receiver(valid.packet, { sessionId: SESSION });
    expect(s.postMessage).toHaveBeenCalledOnce();
    await s.api.stopSdrCapture(SESSION);
    const late = s.texture();
    await s.receiver(late.packet, { sessionId: SESSION });
    expect(late.getVideoFrame).not.toHaveBeenCalled();
    expect(late.release).toHaveBeenCalledOnce();
  });

  it('rejects an ended-before-start-reply race and closes its buffered frame', async () => {
    const s = await setup();
    const start = s.api.startSdrCapture(constraints);
    const frame = s.texture();
    await s.receiver(frame.packet, { sessionId: SESSION });
    s.ended({}, { sessionId: SESSION, reason: 'device-lost' });
    s.resolve({ sessionId: SESSION });
    await expect(start).rejects.toThrow('ended');
    expect(frame.close).toHaveBeenCalledOnce();
    expect(s.postMessage).not.toHaveBeenCalled();
  });

  it('closes invalid frames and asks the owning host session to end', async () => {
    const s = await setup();
    const start = s.api.startSdrCapture(constraints); s.resolve({ sessionId: SESSION }); await start;
    const invalid = s.texture({ displayWidth: 0 });
    await s.receiver(invalid.packet, { sessionId: SESSION });
    expect(invalid.close).toHaveBeenCalledOnce();
    expect(invalid.release).toHaveBeenCalledOnce();
    expect(s.invoke).toHaveBeenCalledWith('sdr-capture-transport-error', SESSION);
    expect(s.postMessage).not.toHaveBeenCalled();
  });

  it('closes an untransferred frame when postMessage throws and rejects parallel starts', async () => {
    const s = await setup();
    const start = s.api.startSdrCapture(constraints);
    await expect(s.api.startSdrCapture(constraints)).rejects.toThrow('already');
    s.resolve({ sessionId: SESSION }); await start;
    s.postMessage.mockImplementationOnce(() => { throw new Error('transfer failed'); });
    const frame = s.texture();
    await s.receiver(frame.packet, { sessionId: SESSION });
    expect(frame.close).toHaveBeenCalledOnce();
    expect(frame.release).toHaveBeenCalledOnce();
    expect(s.invoke).toHaveBeenCalledWith('sdr-capture-transport-error', SESSION);
  });
});
