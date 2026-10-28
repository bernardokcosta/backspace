import { describe, expect, it } from 'vitest';
import { getPublishedMediaStreamTracks } from './livekitInternals';

describe('publication media-track identities', () => {
  it('includes the cloned backup media track and deduplicates shared processed tracks', () => {
    const primary = { id: 'primary' };
    const backup = { id: 'backup' };
    expect(getPublishedMediaStreamTracks({
      mediaStreamTrack: primary,
      simulcastCodecs: new Map([
        ['h264', { mediaStreamTrack: backup }],
        ['vp8', { mediaStreamTrack: primary }],
      ]),
    })).toEqual([primary, backup]);
  });

  it('accepts an ordinary publication and absent tracks', () => {
    const primary = { id: 'primary' };
    expect(getPublishedMediaStreamTracks({ mediaStreamTrack: primary })).toEqual([primary]);
    expect(getPublishedMediaStreamTracks(undefined)).toEqual([]);
    expect(getPublishedMediaStreamTracks({})).toEqual([]);
  });
});
