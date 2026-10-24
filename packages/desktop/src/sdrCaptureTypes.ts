/** Native pointers never cross the privileged desktop process boundary. */
export interface NativeSdrFrame {
  readonly frameId: string;
  readonly ntHandle: Buffer;
  readonly width: number;
  readonly height: number;
  readonly timestampUs: number;
}
