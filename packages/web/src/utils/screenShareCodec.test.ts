import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeScreenShareCodec, resolveScreenShareCodec, supportsScreenShareH265 } from './screenShareCodec';

afterEach(() => vi.unstubAllGlobals());

function capabilities(mimeTypes: string[]) {
  vi.stubGlobal('RTCRtpSender', {
    getCapabilities: vi.fn(() => ({ codecs: mimeTypes.map((mimeType) => ({ mimeType })) })),
  });
}

describe('screen-share codec capabilities', () => {
  it('offers H.265 only when the WebRTC sender advertises it', () => {
    capabilities(['video/VP8', 'video/H264']);
    expect(supportsScreenShareH265()).toBe(false);
    capabilities(['video/H265']);
    expect(supportsScreenShareH265()).toBe(true);
    capabilities(['video/h265']);
    expect(supportsScreenShareH265()).toBe(true);
  });

  it('treats missing, null and failing capability APIs as unavailable', () => {
    vi.stubGlobal('RTCRtpSender', undefined);
    expect(supportsScreenShareH265()).toBe(false);
    vi.stubGlobal('RTCRtpSender', {});
    expect(supportsScreenShareH265()).toBe(false);
    vi.stubGlobal('RTCRtpSender', { getCapabilities: () => null });
    expect(supportsScreenShareH265()).toBe(false);
    vi.stubGlobal('RTCRtpSender', { getCapabilities: () => { throw new Error('unavailable'); } });
    expect(supportsScreenShareH265()).toBe(false);
  });

  it('resolves an unsupported HEVC choice to H.264 without changing other codecs', () => {
    capabilities(['video/H264']);
    expect(resolveScreenShareCodec('h265')).toBe('h264');
    expect(resolveScreenShareCodec('h264')).toBe('h264');
    expect(resolveScreenShareCodec('vp9')).toBe('vp9');
    capabilities(['video/H265']);
    expect(resolveScreenShareCodec('h265')).toBe('h265');
  });
});

describe('stored screen-share codecs', () => {
  it.each(['vp9', 'h264', 'h265'] as const)('preserves %s', (codec) => {
    expect(normalizeScreenShareCodec(codec)).toBe(codec);
  });

  it.each([undefined, null, '', 'hevc', 'vp8', 'av1', 265, {}])('defaults invalid value %j to VP9', (value) => {
    expect(normalizeScreenShareCodec(value)).toBe('vp9');
  });
});
