import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteDesktopPolicyRefused, onDesktopPolicyRefused } from './desktopPolicyEvents';
import { BackspaceApiClient } from '../api/client';
afterEach(() => vi.restoreAllMocks());
describe('origin-scoped desktop policy refusal', () => {
  it('canonicalizes home/peer origins and ignores unsafe notification input', () => {
    const listener = vi.fn(); const remove = onDesktopPolicyRefused(listener);
    noteDesktopPolicyRefused(''); noteDesktopPolicyRefused('https://peer.test');
    noteDesktopPolicyRefused('javascript:alert(1)'); noteDesktopPolicyRefused('https://peer.test/path?token=secret');
    expect(listener.mock.calls).toEqual([[''], ['https://peer.test']]);
    remove(); noteDesktopPolicyRefused(''); expect(listener).toHaveBeenCalledTimes(2);
  });
  it('does not let a subscriber exception break other subscribers or the request', () => {
    const bad = onDesktopPolicyRefused(() => { throw new Error('unmounted'); });
    const good = vi.fn(); const remove = onDesktopPolicyRefused(good);
    expect(() => noteDesktopPolicyRefused('')).not.toThrow(); expect(good).toHaveBeenCalledWith('');
    bad(); remove();
  });
  it('signals the refusing API origin without accepting a peer-selected global minimum', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'desktop_update_required', error: 'Update', details: { minimumVersion: '99.0.0' } }), { status: 426 }));
    const listener = vi.fn(); const remove = onDesktopPolicyRefused(listener);
    try {
      const peer = new BackspaceApiClient('https://peer.test', () => 'token');
      await expect(peer.users.me()).rejects.toMatchObject({ status: 426, code: 'desktop_update_required' });
      expect(listener).toHaveBeenCalledExactlyOnceWith('https://peer.test');
    } finally { remove(); }
  });
});
