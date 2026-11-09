import { describe, expect, it } from 'vitest';
import { normalizeDeepLink } from './deepLinks';

describe('bounded desktop deep links', () => {
  it.each(['veyvox', 'backspace'])('normalizes %s for older hosted clients', scheme => {
    expect(normalizeDeepLink(`${scheme}://join/abc`)).toBe('backspace://join/abc');
    expect(normalizeDeepLink(`${scheme}://join/abc@peer.example:443`)).toBe('backspace://join/abc@peer.example:443');
    expect(normalizeDeepLink(`${scheme}://channel/space/channel`)).toBe('backspace://channel/space/channel');
    expect(normalizeDeepLink(`${scheme}://channel/@me/dm`)).toBe('backspace://channel/@me/dm');
  });
  it.each(['https://join/abc', 'veyvox://join/', 'veyvox://unknown/abc', 'veyvox://join/abc/extra', 'veyvox://join:80/abc', 'veyvox://user@join/abc', 'veyvox://join/abc?q=1', 'veyvox://join/abc#', 'veyvox://channel/s/c/extra', 'veyvox://join/%2e%2e', 'veyvox://join/a%2fb', 'veyvox://join/abc@host/path', 'veyvox://join/abc@user@host', 'veyvox://join/abc@host:99999', 'veyvox://join/a\\b', ' veyvox://join/abc', 'veyvox://join/abc\n', 'veyvox://join/%zz'])('refuses %j', input => {
    expect(normalizeDeepLink(input)).toBeNull();
  });
});
