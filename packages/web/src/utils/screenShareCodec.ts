import { supportsH265 } from 'livekit-client';

export type ScreenShareCodec = 'vp9' | 'h264' | 'h265';

/** WebRTC availability only; this does not identify a hardware encoder/vendor. */
export function supportsScreenShareH265(): boolean {
  try {
    return typeof RTCRtpSender !== 'undefined'
      && typeof RTCRtpSender.getCapabilities === 'function'
      && supportsH265();
  } catch {
    return false;
  }
}

export function normalizeScreenShareCodec(value: unknown): ScreenShareCodec {
  return value === 'h264' || value === 'h265' ? value : 'vp9';
}

/** Fit the device-local preference without overwriting it on a different host. */
export function resolveScreenShareCodec(codec: ScreenShareCodec): ScreenShareCodec {
  return codec === 'h265' && !supportsScreenShareH265() ? 'h264' : codec;
}
