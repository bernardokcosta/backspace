import { randomUUID } from 'node:crypto';
import type { DesktopCapturerSource, Display, IpcMain, IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { createSdrCaptureAuthorization, normalizeSdrCaptureConstraints, sdrCaptureCapability } from './sdrCapturePolicy';
import type { NativeSdrFrame, NativeSdrModule, NativeSdrSource, SdrCaptureCapability, SdrCaptureEnded, SdrCaptureEndedReason } from './sdrCaptureTypes';

export function resolveNativeSdrSource(
  source: Pick<DesktopCapturerSource, 'id' | 'display_id'>,
  displays: ReadonlyArray<Pick<Display, 'id' | 'nativeOrigin'>>,
): NativeSdrSource | null {
  const windowId = /^window:([1-9]\d{0,19}):0$/.exec(source.id);
  if (windowId) {
    return BigInt(windowId[1]!) <= 0xffffffffffffffffn ? { kind: 'window', id: source.id } : null;
  }
  if (!/^screen:\d+:\d+$/.test(source.id) || !source.display_id) return null;
  const matches = displays.filter((display) => String(display.id) === source.display_id);
  if (matches.length !== 1) return null;
  const origin = matches[0]!.nativeOrigin;
  if (!origin || ![origin.x, origin.y].every((coordinate) => Number.isInteger(coordinate) && coordinate >= -2147483648 && coordinate <= 2147483647)) return null;
  return { kind: 'screen', id: source.id, displayId: source.display_id, nativeOrigin: { ...origin } };
}

interface Dependencies {
  platform: NodeJS.Platform;
  systemVersion: string;
  transportAvailable: boolean;
  loadModule: () => NativeSdrModule;
  /** Takes ownership of each supplied frame even when its promise rejects. */
  sendFrame: (owner: WebFrameMain, sessionId: string, frame: NativeSdrFrame) => Promise<void>;
  isTargetAllowed: (owner: WebFrameMain) => boolean;
  isFocused: () => boolean;
  now: () => number;
  onEnded: (owner: WebFrameMain, ended: SdrCaptureEnded) => void;
}

interface ActiveCapture {
  owner: WebFrameMain;
  sessionId: string;
  nativeId: string | null;
}

const NATIVE_REASONS: ReadonlySet<string> = new Set([
  'source-closed', 'source-unavailable', 'source-color-unsupported', 'capture-unavailable',
  'device-lost', 'frame-timeout', 'invalid-frame', 'capture-failed', 'callback-failed',
]);

export function createSdrCaptureController(dependencies: Dependencies): {
  capability: () => SdrCaptureCapability;
  grant: (owner: WebFrameMain, source: NativeSdrSource) => boolean;
  revokeGrant: () => void;
  start: (owner: WebFrameMain, constraints: unknown) => { sessionId: string };
  configure: (owner: WebFrameMain, sessionId: string, constraints: unknown) => void;
  stop: (owner: WebFrameMain, sessionId: string) => void;
  transportFailed: (owner: WebFrameMain, sessionId: string) => void;
  invalidate: (reason: 'navigation' | 'renderer-gone' | 'shutdown') => void;
} {
  const authorization = createSdrCaptureAuthorization<NativeSdrSource>();
  let native: NativeSdrModule | null = null;
  let probed = false;
  let generation = 0;
  let active: ActiveCapture | null = null;

  function capability(): SdrCaptureCapability {
    const environment = sdrCaptureCapability({ ...dependencies, moduleAvailable: true });
    if (!environment.supported) return environment;
    try { native ??= dependencies.loadModule(); }
    catch { return { supported: false, reason: 'module' }; }
    if (!probed) {
      try { if (!native.isCaptureSupported()) return { supported: false, reason: 'system' }; }
      catch { return { supported: false, reason: 'system' }; }
      probed = true;
    }
    return { supported: true };
  }

  function end(record: ActiveCapture, reason: SdrCaptureEndedReason): void {
    if (active !== record) return;
    active = null;
    try { if (record.nativeId) native!.stopCapture(record.nativeId); }
    catch (error) { reason = 'capture-failed'; console.warn('[SDR] Native stop failed', error); }
    finally {
      try { dependencies.onEnded(record.owner, { sessionId: record.sessionId, reason }); }
      catch { /* A vanished renderer must not interrupt worker teardown. */ }
    }
  }

  function owned(owner: WebFrameMain, sessionId: string): ActiveCapture | null {
    return active && active.owner === owner && active.sessionId === sessionId
      && dependencies.isTargetAllowed(owner) ? active : null;
  }

  return {
    capability,
    grant(owner, source) {
      authorization.revoke();
      if (active || !dependencies.isTargetAllowed(owner) || !dependencies.isFocused()) return false;
      const snapshot = source.kind === 'screen' ? { ...source, nativeOrigin: { ...source.nativeOrigin } } : { ...source };
      authorization.grant(snapshot, owner, generation, dependencies.now());
      return true;
    },
    revokeGrant: () => authorization.revoke(),
    start(owner, value) {
      if (!dependencies.isTargetAllowed(owner)) throw new Error('SDR target is not authorized');
      if (active) throw new Error('SDR capture is already active');
      const source = authorization.consume({ owner, navigationGeneration: generation, focused: dependencies.isFocused(), now: dependencies.now() });
      if (!source) throw new Error('SDR capture authorization is missing or expired');
      const constraints = normalizeSdrCaptureConstraints(value);
      if (!constraints) throw new Error('SDR capture constraints are invalid');
      if (!capability().supported) throw new Error('SDR capture is unavailable');
      const module = native!;
      const record: ActiveCapture = { owner, sessionId: randomUUID(), nativeId: null };
      active = record;
      try {
        record.nativeId = module.startCapture(source, constraints, (frame) => {
          if (active !== record) { module.releaseFrame(frame.frameId); return; }
          if (!dependencies.isTargetAllowed(owner)) {
            module.releaseFrame(frame.frameId);
            end(record, 'renderer-gone');
            return;
          }
          try {
            void dependencies.sendFrame(owner, record.sessionId, frame).catch(() => end(record, 'transport-failed'));
          } catch {
            module.releaseFrame(frame.frameId);
            end(record, 'transport-failed');
          }
        }, (reason) => end(record, NATIVE_REASONS.has(reason) ? reason as SdrCaptureEndedReason : 'capture-failed'));
        if (active !== record) {
          module.stopCapture(record.nativeId);
          throw new Error('SDR capture ended during start');
        }
        return { sessionId: record.sessionId };
      } catch (error) {
        if (active === record) active = null;
        throw error;
      }
    },
    configure(owner, sessionId, value) {
      const record = owned(owner, sessionId);
      if (!record) throw new Error('SDR target/session is not authorized');
      const constraints = normalizeSdrCaptureConstraints(value);
      if (!constraints) throw new Error('SDR capture constraints are invalid');
      try { native!.configureCapture(record.nativeId!, constraints); }
      catch (error) { end(record, 'capture-failed'); throw error; }
    },
    stop(owner, sessionId) {
      const record = owned(owner, sessionId);
      if (record) end(record, 'stopped');
    },
    transportFailed(owner, sessionId) {
      const record = owned(owner, sessionId);
      if (record) end(record, 'transport-failed');
    },
    invalidate(reason) {
      generation++;
      authorization.revoke();
      if (active) end(active, reason);
    },
  };
}

/** The production and isolated smoke use the same narrow IPC registration. */
export function registerSdrCaptureIpc(
  ipc: Pick<IpcMain, 'handle'>,
  controller: ReturnType<typeof createSdrCaptureController>,
  isSenderAllowed: (event: IpcMainInvokeEvent) => boolean,
): void {
  function owner(event: IpcMainInvokeEvent): WebFrameMain {
    if (!event.senderFrame || !isSenderAllowed(event)) throw new Error('SDR sender/frame is not authorized');
    return event.senderFrame;
  }
  ipc.handle('get-sdr-capture-capability', (event) => { owner(event); return controller.capability(); });
  ipc.handle('sdr-capture-start', (event, constraints: unknown) => controller.start(owner(event), constraints));
  ipc.handle('sdr-capture-configure', (event, id: unknown, constraints: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid SDR session');
    controller.configure(owner(event), id, constraints);
  });
  ipc.handle('sdr-capture-stop', (event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid SDR session');
    controller.stop(owner(event), id);
  });
  ipc.handle('sdr-capture-transport-error', (event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid SDR session');
    controller.transportFailed(owner(event), id);
  });
}
