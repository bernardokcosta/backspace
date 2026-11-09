import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { getDeepLinkRoute, useDeepLinkHandler } from './deepLink';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
afterEach(() => { cleanup(); delete window.veyvox; delete window.backspace; vi.clearAllMocks(); });

describe('dual-scheme in-app routing', () => {
  it.each(['veyvox', 'backspace'])('maps %s only to supported bounded routes', scheme => {
    expect(getDeepLinkRoute(`${scheme}://join/abc@peer.example`)).toBe('/join/abc@peer.example');
    expect(getDeepLinkRoute(`${scheme}://channel/space/channel`)).toBe('/channels/space/channel');
    expect(getDeepLinkRoute(`${scheme}://channel/@me/dm`)).toBe('/channels/@me/dm');
  });
  it.each(['veyvox://join/%2e%2e', 'veyvox://join/abc/extra', 'veyvox://join/abc@user@host', 'veyvox://join/abc@host:99999', 'veyvox://channel/a%2fb/c', 'veyvox://user@join/abc', 'veyvox://join:80/abc', 'veyvox://join/abc#', 'veyvox://join/abc?x=1', 'file://join/abc'])('rejects %j without navigation', input => {
    expect(getDeepLinkRoute(input)).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
  it.each(['veyvox', 'backspace'] as const)('subscribes with %s bridge and cleans up both listeners', name => {
    let listener: ((url: string) => void) | undefined;
    const offDeep = vi.fn(), offInternal = vi.fn();
    window[name] = { platform: 'win32', onDeepLink: callback => { listener = callback; return offDeep; }, onOpenInternalRoute: () => offInternal } as BackspaceElectronAPI;
    const hook = renderHook(() => useDeepLinkHandler());
    listener?.('veyvox://join/abc');
    expect(navigate).toHaveBeenCalledWith('/join/abc');
    hook.unmount();
    expect(offDeep).toHaveBeenCalledOnce(); expect(offInternal).toHaveBeenCalledOnce();
  });
});
