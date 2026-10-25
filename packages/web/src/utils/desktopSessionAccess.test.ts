import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureDesktopSessionWork, setDesktopSessionAllowed, isDesktopSessionAllowed } from './desktopSessionAccess';
import { BackspaceApiClient } from '../api/client';
afterEach(() => { setDesktopSessionAllowed(true); vi.restoreAllMocks(); });
describe('late desktop work guard', () => {
  it.each(['channel', 'dm'])('settles only a dispatched %s delivery receipt after blocking, not stale UI data', async (kind) => {
    let reply: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const api = new BackspaceApiClient('', () => 'token'); setDesktopSessionAllowed(true);
    const send = kind === 'dm' ? api.dm.sendMessageReceipt : api.channels.sendMessageReceipt;
    const pending = send('channel', { content: 'Once' });
    setDesktopSessionAllowed(false); reply(new Response('{}', { status: 200 }));
    await expect(pending).resolves.toBeUndefined();
    await expect(send('channel', { content: 'Blocked new send' })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('invalidates old work permanently across block and reallow', () => {
    setDesktopSessionAllowed(true); const work = captureDesktopSessionWork();
    setDesktopSessionAllowed(false);
    expect(isDesktopSessionAllowed()).toBe(false); expect(work.signal.aborted).toBe(true);
    setDesktopSessionAllowed(true);
    expect(work.isCurrent()).toBe(false); expect(() => work.assertCurrent()).toThrow();
    expect(captureDesktopSessionWork().isCurrent()).toBe(true);
  });
  it('prevents API dispatch when blocked, without logging out or deleting credentials', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch'); const logout = vi.fn();
    const api = new BackspaceApiClient('', () => 'preserved-token', logout);
    setDesktopSessionAllowed(false);
    await expect(api.users.me()).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled(); expect(logout).not.toHaveBeenCalled();
  });
  it('does not let a late 401 log out the account after blocking', async () => {
    let reply: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise((resolve) => { reply = resolve; }));
    const logout = vi.fn(); const api = new BackspaceApiClient('', () => 'preserved-token', logout);
    setDesktopSessionAllowed(true); const request = api.users.me();
    setDesktopSessionAllowed(false); reply(new Response('{}', { status: 401 }));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' }); expect(logout).not.toHaveBeenCalled();
  });
});
