import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookup = vi.fn<(host: string) => Promise<{ address: string; family: number }>>();
vi.mock('dns', () => ({ default: { promises: { lookup: async (h: string, options?: { all: boolean }) => {
  const answer = await lookup(h); return options?.all ? [answer] : answer;
} } } }));

const { validateExternalUrl, isPrivateIp } = await import('./ssrf.js');

describe('isPrivateIp', () => {
  it('still answers the addresses it always answered', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.1.2.3')).toBe(true);
    expect(isPrivateIp('8.8.8.8')).toBe(false);
  });

  it('answers the ones it used to miss', () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:127.0.0.1', '::', '100.64.0.1', 'fe9a::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
});

describe('validateExternalUrl', () => {
  // Block bodies, not concise arrows: a hook that RETURNS a function has that
  // function registered as a teardown callback and invoked with no arguments at
  // the end of the test. `mockReset()` returns the mock, so `() => m.mockReset()`
  // silently calls the mock once per test — which an implementation that reads
  // its argument then trips over.
  beforeEach(() => {
    lookup.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a hostname whose AAAA record is a v4-mapped loopback', async () => {
    lookup.mockResolvedValue({ address: '::ffff:7f00:1', family: 6 });
    await expect(validateExternalUrl('https://rebind.example/x')).rejects.toThrow('Private IP not allowed');
  });

  it('rejects a hostname resolving into CGNAT', async () => {
    lookup.mockResolvedValue({ address: '100.64.9.9', family: 4 });
    await expect(validateExternalUrl('https://cgnat.example/x')).rejects.toThrow('Private IP not allowed');
  });

  it('accepts a public address', async () => {
    lookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(validateExternalUrl('https://example.com/x')).resolves.toBeUndefined();
  });

  it('classifies an IPv6 loopback literal directly instead of relying on a resolver error', async () => {
    await expect(validateExternalUrl('http://[::1]/x')).rejects.toThrow('Private IP not allowed');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('lets a public IPv6 literal through, which it could not before', async () => {
    await expect(validateExternalUrl('https://[2606:4700::1111]/x')).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses non-http schemes before touching DNS', async () => {
    await expect(validateExternalUrl('file:///etc/passwd')).rejects.toThrow('Invalid URL scheme');
    expect(lookup).not.toHaveBeenCalled();
  });

  // Transport, redirect refusal/resource release and connection-time authority
  // are exercised at the stronger native seam in ssrf.pinned/Transport suites.
});
