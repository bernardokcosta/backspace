/** Native pointers never cross the privileged desktop process boundary. */
export interface NativeSdrFrame {
  readonly frameId: string;
  readonly ntHandle: Buffer;
  readonly width: number;
  readonly height: number;
  readonly timestampUs: number;
}

export type SdrCaptureCapability =
  | { supported: true }
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
