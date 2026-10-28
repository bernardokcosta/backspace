import type { Room, TrackPublishOptions } from 'livekit-client';

/**
 * Discover all unique RTCPeerConnections from the LiveKit Room engine.
 * Different livekit-client versions expose the PC at different internal paths.
 */
export function discoverPeerConnections(room: Room): RTCPeerConnection[] {
  const engine = (room as any)?.engine;
  if (!engine) return [];

  const pcs: RTCPeerConnection[] = [];
  const seen = new WeakSet<object>();

  const tryAdd = (val: any) => {
    if (val && typeof val.getStats === 'function' && !seen.has(val)) {
      seen.add(val);
      pcs.push(val);
    }
  };

  // Current livekit-client (1.x+): engine.pcManager.{publisher,subscriber}.pc
  tryAdd(engine.pcManager?.publisher?.pc);
  tryAdd(engine.pcManager?.subscriber?.pc);
  // Private backing field fallback
  tryAdd(engine.pcManager?.publisher?._pc);
  tryAdd(engine.pcManager?.subscriber?._pc);
  // Older livekit-client paths
  tryAdd(engine.publisher?.pc);
  tryAdd(engine.subscriber?.pc);
  // Unified-plan single PC
  tryAdd(engine.pc);
  tryAdd((room as any).pc);

  return pcs;
}

/**
 * Get the publisher RTCPeerConnection from a LiveKit Room.
 * Used by overdrive to inject RTP sender parameters.
 */
export function getPublisherPC(room: Room): RTCPeerConnection | null {
  const engine = (room as any)?.engine;
  if (!engine) return null;

  return (
    engine.pcManager?.publisher?.pc ??
    engine.pcManager?.publisher?._pc ??
    engine.publisher?.pc ??
    engine.pc ??
    null
  );
}

/**
 * Safely extract the underlying MediaStreamTrack from a LiveKit track object.
 * Handles both public `.mediaStreamTrack` and private `._mediaStreamTrack`.
 */
export function getMediaStreamTrack(track: unknown): MediaStreamTrack | null {
  if (!track) return null;
  const t = track as any;
  return t.mediaStreamTrack ?? t._mediaStreamTrack ?? null;
}

interface VideoEncodingState {
  encodings?: RTCRtpEncodingParameters[];
  publishOptions?: TrackPublishOptions;
  simulcastCodecs?: Map<string, {
    mediaStreamTrack?: MediaStreamTrack;
    encodings?: RTCRtpEncodingParameters[];
  }>;
}

/** LiveKit's backup codec owns a cloned track and a different RTP sender. */
export function getPublishedMediaStreamTracks(track: unknown): MediaStreamTrack[] {
  if (!track || typeof track !== 'object') return [];
  const state = track as VideoEncodingState;
  const tracks = [getMediaStreamTrack(track)];
  if (state.simulcastCodecs instanceof Map) {
    for (const codec of state.simulcastCodecs.values()) tracks.push(getMediaStreamTrack(codec));
  }
  const seen = new Set<string>();
  return tracks.filter((candidate): candidate is MediaStreamTrack => {
    if (!candidate?.id || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

export function isRtpSenderActive(sender: RTCRtpSender): boolean {
  const encodings = sender.getParameters().encodings;
  return !encodings?.length || encodings.some((encoding) => encoding.active !== false);
}

/** Keep SDK 2.23's cached encodings/options aligned before a late H264 regression. */
export function syncSingleCodecVideoEncodingCeilings(
  track: unknown,
  encoding: { maxBitrate: number; maxFramerate: number; priority: RTCPriorityType },
  degradationPreference: RTCDegradationPreference,
): void {
  if (!track || typeof track !== 'object') return;
  const state = track as VideoEncodingState;
  if (state.publishOptions) {
    state.publishOptions.videoEncoding = { ...state.publishOptions.videoEncoding, ...encoding };
    state.publishOptions.screenShareEncoding = { ...state.publishOptions.screenShareEncoding, ...encoding };
    state.publishOptions.backupCodec = { codec: 'h264', encoding: { ...encoding } };
    state.publishOptions.degradationPreference = degradationPreference;
  }
  const update = (encodings: RTCRtpEncodingParameters[] | undefined) => {
    if (!encodings?.length) return;
    Object.assign(encodings[encodings.length - 1]!, {
      maxBitrate: encoding.maxBitrate, maxFramerate: encoding.maxFramerate,
    });
    encodings[0]!.priority = encoding.priority;
    encodings[0]!.networkPriority = encoding.priority;
  };
  update(state.encodings);
  if (state.simulcastCodecs instanceof Map) {
    for (const codec of state.simulcastCodecs.values()) update(codec.encodings);
  }
}
