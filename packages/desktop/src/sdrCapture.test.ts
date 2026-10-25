import { describe, expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { createSdrCaptureController, registerSdrCaptureIpc, resolveNativeSdrSource } from './sdrCapture';
import type { NativeSdrFrame, NativeSdrModule, NativeSdrSource } from './sdrCaptureTypes';

const source: NativeSdrSource = { kind: 'window', id: 'window:123:0' };
const constraints = { width: 1920, height: 1080, frameRate: 60 };
function nativeFrame(id = 'one'): NativeSdrFrame {
  const ntHandle = Buffer.alloc(8); ntHandle.writeBigUInt64LE(42n);
  return { frameId: id, ntHandle, width: 1920, height: 1080, timestampUs: 1000 };
}

function setup() {
  const owner = { isDestroyed: () => false } as WebFrameMain;
  let focused = true;
  let now = 1000;
  const callbacks: Array<{ frame: (frame: NativeSdrFrame) => void; error: (reason: string) => void }> = [];
  const module: NativeSdrModule = {
    isCaptureSupported: vi.fn(() => true),
    startCapture: vi.fn((_source, _constraints, frame, error) => { callbacks.push({ frame, error }); return `native-${callbacks.length}`; }),
    configureCapture: vi.fn(), stopCapture: vi.fn(), releaseFrame: vi.fn(),
  };
  const sendFrame = vi.fn(async () => {});
  const onEnded = vi.fn();
  const loadModule = vi.fn(() => module);
  const dependencies = {
    platform: 'win32' as NodeJS.Platform, systemVersion: '10.0.26300', transportAvailable: true,
    loadModule, sendFrame, onEnded,
    isTargetAllowed: (candidate: WebFrameMain) => candidate === owner && !candidate.isDestroyed(),
    isFocused: () => focused, now: () => now,
  };
  const controller = createSdrCaptureController(dependencies);
  return { owner, module, callbacks, sendFrame, onEnded, loadModule, dependencies, controller,
    setFocused: (value: boolean) => { focused = value; }, setNow: (value: number) => { now = value; } };
}

describe('SDR source mapping', () => {
  it('maps only a trusted window id or a uniquely matched native display origin', () => {
    expect(resolveNativeSdrSource({ id: 'window:123:0', display_id: '' }, [])).toEqual(source);
    expect(resolveNativeSdrSource({ id: 'screen:88:0', display_id: '22' }, [
      { id: 22, nativeOrigin: { x: -3840, y: 0 } },
    ])).toEqual({ kind: 'screen', id: 'screen:88:0', displayId: '22', nativeOrigin: { x: -3840, y: 0 } });
  });

  it('does not guess a display from a screen id or accept invalid handles/origins', () => {
    expect(resolveNativeSdrSource({ id: 'screen:22:0', display_id: '' }, [{ id: 22, nativeOrigin: { x: 0, y: 0 } }])).toBeNull();
    for (const id of ['window:0:0', 'window:-1:0', 'window:18446744073709551616:0', 'window:123:0/path', 'unknown:1:0']) {
      expect(resolveNativeSdrSource({ id, display_id: '' }, [])).toBeNull();
    }
    const screen = { id: 'screen:1:0', display_id: '22' };
    expect(resolveNativeSdrSource(screen, [{ id: 22, nativeOrigin: { x: NaN, y: 0 } }])).toBeNull();
    expect(resolveNativeSdrSource(screen, [{ id: 22, nativeOrigin: { x: 0, y: 0 } }, { id: 22, nativeOrigin: { x: 1920, y: 0 } }])).toBeNull();
  });
});

describe('SDR capture host controller', () => {
  it('does not load Windows native code on unsupported platforms or old systems', () => {
    const s = setup();
    expect(createSdrCaptureController({ ...s.dependencies, platform: 'linux' }).capability()).toEqual({ supported: false, reason: 'platform' });
    expect(createSdrCaptureController({ ...s.dependencies, systemVersion: '10.0.17763' }).capability()).toEqual({ supported: false, reason: 'system' });
    expect(s.loadModule).not.toHaveBeenCalled();
  });

  it('reports module/API/transport failures explicitly and caches a successful native probe', () => {
    const s = setup();
    expect(createSdrCaptureController({ ...s.dependencies, transportAvailable: false }).capability()).toEqual({ supported: false, reason: 'transport' });
    expect(createSdrCaptureController({ ...s.dependencies, loadModule: () => { throw new Error('missing'); } }).capability()).toEqual({ supported: false, reason: 'module' });
    vi.mocked(s.module.isCaptureSupported).mockReturnValueOnce(false);
    expect(s.controller.capability()).toEqual({ supported: false, reason: 'system' });
    expect(s.controller.capability()).toEqual({ supported: true });
    expect(s.controller.capability()).toEqual({ supported: true });
    expect(s.module.isCaptureSupported).toHaveBeenCalledTimes(2);
  });

  it('requires a fresh accepted selection and permits exactly one native acquisition', () => {
    const s = setup();
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
    expect(s.controller.grant(s.owner, source)).toBe(true);
    const result = s.controller.start(s.owner, { ...constraints, handle: 42 });
    expect(s.module.startCapture).toHaveBeenCalledWith(source, constraints, expect.any(Function), expect.any(Function));
    expect(result.sessionId).toBeTruthy();
    expect(() => s.controller.start(s.owner, constraints)).toThrow();
    s.controller.stop(s.owner, result.sessionId);
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
  });

  it('rejects subframes/foreign owners, expired grants and lost focus before start', () => {
    const s = setup();
    const foreign = { isDestroyed: () => false } as WebFrameMain;
    expect(s.controller.grant(foreign, source)).toBe(false);
    expect(() => s.controller.start(foreign, constraints)).toThrow('target');
    s.controller.grant(s.owner, source); s.setNow(31_001);
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
    s.controller.grant(s.owner, source); s.setFocused(false);
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
    expect(s.module.startCapture).not.toHaveBeenCalled();
  });

  it('keeps authorized capture/configuration running on alt-tab, but not foreign commands', () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    const { sessionId } = s.controller.start(s.owner, constraints);
    s.setFocused(false);
    s.controller.configure(s.owner, sessionId, { width: 1280, height: 720, frameRate: 30 });
    expect(s.module.configureCapture).toHaveBeenCalledWith('native-1', { width: 1280, height: 720, frameRate: 30 });
    expect(() => s.controller.configure({} as WebFrameMain, sessionId, constraints)).toThrow();
    s.controller.stop({} as WebFrameMain, sessionId);
    expect(s.module.stopCapture).not.toHaveBeenCalled();
    s.controller.stop(s.owner, sessionId); s.controller.stop(s.owner, sessionId);
    expect(s.module.stopCapture).toHaveBeenCalledExactlyOnceWith('native-1');
  });

  it('revokes grants/stops on navigation and refuses late frames/errors from retired sessions', async () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    const first = s.controller.start(s.owner, constraints);
    s.callbacks[0]!.frame(nativeFrame());
    expect(s.sendFrame).toHaveBeenCalledWith(s.owner, first.sessionId, nativeFrame());
    s.controller.invalidate('navigation');
    expect(s.onEnded).toHaveBeenCalledWith(s.owner, { sessionId: first.sessionId, reason: 'navigation' });
    s.controller.grant(s.owner, source); s.controller.start(s.owner, constraints);
    s.callbacks[0]!.frame(nativeFrame('late')); s.callbacks[0]!.error('device-lost');
    expect(s.module.releaseFrame).toHaveBeenCalledExactlyOnceWith('late');
    expect(s.module.stopCapture).toHaveBeenCalledTimes(1);
    s.controller.invalidate('navigation');
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
    await Promise.resolve();
  });

  it('ends on device/transport failure without publishing a raw fallback', async () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    const first = s.controller.start(s.owner, constraints);
    s.callbacks[0]!.error('device-lost');
    expect(s.module.stopCapture).toHaveBeenCalledWith('native-1');
    expect(s.onEnded).toHaveBeenCalledWith(s.owner, { sessionId: first.sessionId, reason: 'device-lost' });
    s.controller.grant(s.owner, source);
    const second = s.controller.start(s.owner, constraints);
    s.sendFrame.mockRejectedValueOnce(new Error('GPU receiver lost'));
    s.callbacks[1]!.frame(nativeFrame());
    await vi.waitFor(() => expect(s.onEnded).toHaveBeenCalledWith(s.owner, { sessionId: second.sessionId, reason: 'transport-failed' }));
    expect(s.module.startCapture).toHaveBeenCalledTimes(2);
  });

  it('cleans up a destroyed renderer and isolates ended-listener exceptions', () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    s.controller.start(s.owner, constraints);
    s.onEnded.mockImplementationOnce(() => { throw new Error('renderer is gone'); });
    s.owner.isDestroyed = () => true;
    expect(() => s.callbacks[0]!.frame(nativeFrame())).not.toThrow();
    expect(s.module.releaseFrame).toHaveBeenCalledExactlyOnceWith('one');
    expect(s.module.stopCapture).toHaveBeenCalledExactlyOnceWith('native-1');
    expect(s.sendFrame).not.toHaveBeenCalled();
  });

  it('rejects invalid geometry and failed native starts without retaining an authorization', () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    expect(() => s.controller.start(s.owner, { ...constraints, width: -1 })).toThrow('constraints');
    expect(s.module.startCapture).not.toHaveBeenCalled();
    s.controller.grant(s.owner, source);
    vi.mocked(s.module.startCapture).mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => s.controller.start(s.owner, constraints)).toThrow('unavailable');
    expect(() => s.controller.start(s.owner, constraints)).toThrow('authorization');
  });

  it('stops a native start that ends synchronously before returning its host id', () => {
    const s = setup();
    s.controller.grant(s.owner, source);
    vi.mocked(s.module.startCapture).mockImplementationOnce((_source, _constraints, _frame, error) => {
      error('source-unavailable');
      return 'ended-during-start';
    });
    expect(() => s.controller.start(s.owner, constraints)).toThrow('ended during start');
    expect(s.module.stopCapture).toHaveBeenCalledExactlyOnceWith('ended-during-start');
  });

  it('does not stop a new capture when an old in-flight transport rejects late', async () => {
    const s = setup();
    let rejectSend: (error: Error) => void = () => { throw new Error('No send pending'); };
    s.sendFrame.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSend = reject; }));
    s.controller.grant(s.owner, source);
    const first = s.controller.start(s.owner, constraints);
    s.callbacks[0]!.frame(nativeFrame());
    s.controller.stop(s.owner, first.sessionId);
    s.controller.grant(s.owner, source); s.controller.start(s.owner, constraints);
    rejectSend(new Error('Old renderer disappeared'));
    await Promise.resolve(); await Promise.resolve();
    expect(s.module.stopCapture).toHaveBeenCalledExactlyOnceWith('native-1');
  });
});

describe('native SDR IPC boundary', () => {
  it('rejects foreign senders/subframes before capability or acquisition and accepts only owned commands', () => {
    const s = setup();
    const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>();
    const ipc = { handle: vi.fn((name: string, handler: Parameters<IpcMain['handle']>[1]) => { handlers.set(name, handler); }) };
    const sender = {};
    registerSdrCaptureIpc(ipc, s.controller, (event) => event.sender === sender && event.senderFrame === s.owner);
    const event = { sender, senderFrame: s.owner } as unknown as IpcMainInvokeEvent;
    const capability = handlers.get('get-sdr-capture-capability')!;
    expect(() => capability({ ...event, sender: {} } as IpcMainInvokeEvent)).toThrow('sender/frame');
    expect(() => capability({ ...event, senderFrame: {} } as IpcMainInvokeEvent)).toThrow('sender/frame');
    expect(s.loadModule).not.toHaveBeenCalled();
    expect(capability(event)).toEqual({ supported: true });
    s.controller.grant(s.owner, source);
    const result = handlers.get('sdr-capture-start')!(event, constraints) as { sessionId: string };
    expect(() => handlers.get('sdr-capture-stop')!(event, 42)).toThrow('Invalid');
    expect(() => handlers.get('sdr-capture-configure')!({ ...event, senderFrame: {} } as IpcMainInvokeEvent, result.sessionId, constraints)).toThrow('sender/frame');
    handlers.get('sdr-capture-transport-error')!(event, result.sessionId);
    expect(s.module.stopCapture).toHaveBeenCalledExactlyOnceWith('native-1');
  });
});
