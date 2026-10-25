/** Native pointers never cross the privileged desktop process boundary. */
export interface NativeSdrFrame {
  readonly frameId: string;
  readonly ntHandle: Buffer;
  readonly width: number;
  readonly height: number;
  readonly timestampUs: number;
}

export type SdrCaptureCapability =
  | { supported: true; borderless: true }
  | { supported: false; reason: 'platform' | 'system' | 'module' | 'transport' };

export interface SdrCaptureConstraints {
  width: number;
  height: number;
  frameRate: number;
}

/** Only main may construct this from an accepted display-media selection. */
export type AuthorizedSdrSource =
  | { kind: 'screen'; id: string; displayId: string }
  | { kind: 'window'; id: string };

/** Resolved only from main's enumeration and Electron's native display origin. */
export type NativeSdrSource =
  | { kind: 'window'; id: string }
  | { kind: 'screen'; id: string; displayId: string; nativeOrigin: { x: number; y: number } };

export interface NativeSdrModule {
  requestBorderlessAccess?: (requestId: string, onComplete: (result: NativeBorderlessAccessResult) => void) => void;
  cancelBorderlessAccess?: (requestId: string) => void;
  isCaptureSupported: () => boolean;
  startCapture: (source: NativeSdrSource, constraints: SdrCaptureConstraints,
    onFrame: (frame: NativeSdrFrame) => void, onError: (reason: string) => void, borderlessRequestId?: string) => string;
  configureCapture: (sessionId: string, constraints: SdrCaptureConstraints) => void;
  stopCapture: (sessionId: string) => void;
  releaseFrame: (frameId: string) => void;
}

export interface NativeBorderlessAccessResult {
  status: 'allowed' | 'denied-user' | 'denied-system' | 'not-declared' | 'unsupported' | 'cancelled' | 'timeout' | 'failed';
}

export type SdrCapturePreselectionResult = { ok: true }
  | { ok: false; reason: Exclude<NativeBorderlessAccessResult['status'], 'allowed'> };

export type SdrCaptureEndedReason = 'stopped' | 'navigation' | 'renderer-gone' | 'shutdown'
  | 'source-closed' | 'source-unavailable' | 'source-color-unsupported' | 'capture-unavailable'
  | 'device-lost' | 'frame-timeout' | 'invalid-frame' | 'capture-failed' | 'callback-failed' | 'transport-failed'
  | 'borderless-unsupported' | 'borderless-configuration-failed';

export interface SdrCaptureEnded {
  sessionId: string;
  reason: SdrCaptureEndedReason;
}
