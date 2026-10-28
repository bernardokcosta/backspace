import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Track } from 'livekit-client';
import { useTrackStats } from './useTrackStats';

const mocks = vi.hoisted(() => ({ getActiveRoom: vi.fn(), discoverPeerConnections: vi.fn() }));
vi.mock('./useLiveKit', () => ({ getActiveRoom: mocks.getActiveRoom }));
vi.mock('../utils/livekitInternals', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/livekitInternals')>(),
  discoverPeerConnections: mocks.discoverPeerConnections,
}));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe('screen-share fallback stats', () => {
  it('reports the active cloned H.264 encoder under screen share and omits a paused HEVC primary', async () => {
    vi.useFakeTimers();
    const primary = {
      track: { id: 'hevc', kind: 'video' },
      getParameters: () => ({ encodings: [{ active: false }] }),
      getStats: vi.fn().mockResolvedValue(new Map()),
    };
    const backup = {
      track: { id: 'h264-backup', kind: 'video' },
      getParameters: () => ({ encodings: [{ active: true }] }),
      getStats: vi.fn().mockResolvedValue(new Map([
        ['codec', { id: 'codec', type: 'codec', mimeType: 'video/H264' }],
        ['outbound', {
          type: 'outbound-rtp', kind: 'video', ssrc: 2, codecId: 'codec', bytesSent: 1000,
          frameWidth: 1280, frameHeight: 720, framesEncoded: 60, encoderImplementation: 'PlatformEncoder',
        }],
      ])),
    };
    mocks.getActiveRoom.mockReturnValue({
      localParticipant: { trackPublications: new Map([['screen', {
        source: Track.Source.ScreenShare,
        track: {
          mediaStreamTrack: primary.track,
          simulcastCodecs: new Map([['h264', { mediaStreamTrack: backup.track }]]),
        },
      }]]) },
      remoteParticipants: new Map(),
    });
    mocks.discoverPeerConnections.mockReturnValue([{
      getStats: async () => new Map(), getSenders: () => [primary, backup], getReceivers: () => [],
    }]);

    const { result, unmount } = renderHook(() => useTrackStats(true));
    await act(async () => {});

    expect(result.current?.videoTracks).toEqual([expect.objectContaining({
      source: 'screen_share', direction: 'send', codec: 'H264', encoderImpl: 'PlatformEncoder',
    })]);
    expect(primary.getStats).not.toHaveBeenCalled();
    unmount();
  });
});
