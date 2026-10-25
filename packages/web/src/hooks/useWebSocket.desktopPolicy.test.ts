import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn(), playSound: vi.fn() }) } }));
class Socket {
  static OPEN = 1; static CONNECTING = 0; static all: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { Socket.all.push(this); }
  close() { this.readyState = 3; }
  send() {}
}
vi.stubGlobal('WebSocket', Socket);
const { connectInstance, disconnectInstance, wsSend } = await import('./useWebSocket');
const { onDesktopPolicyRefused } = await import('../utils/desktopPolicyEvents');
const { setDesktopSessionAllowed } = await import('../utils/desktopSessionAccess');
const PEER = 'https://peer.test';
afterEach(() => { disconnectInstance(PEER); Socket.all = []; vi.useRealTimers(); setDesktopSessionAllowed(true); });
describe('desktop policy socket refusal', () => {
  it('never creates a blocked socket or authenticates a stale connection after reallow', () => {
    setDesktopSessionAllowed(false); connectInstance(PEER, 'token'); expect(Socket.all).toHaveLength(0);
    setDesktopSessionAllowed(true); connectInstance(PEER, 'token'); const socket = Socket.all[0]!;
    const send = vi.spyOn(socket, 'send');
    setDesktopSessionAllowed(false); setDesktopSessionAllowed(true);
    socket.onopen?.(); expect(send).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
  });
  it('stops reconnects and writes on 4406 without clearing another origin or trusting peer minima', () => {
    vi.useFakeTimers(); const listener = vi.fn(); const remove = onDesktopPolicyRefused(listener);
    try {
      connectInstance(PEER, 'token');
      Socket.all[0]!.onclose?.({ code: 4406 });
      vi.advanceTimersByTime(90_000);
      connectInstance(PEER, 'token');
      expect(Socket.all).toHaveLength(1);
      expect(listener).toHaveBeenCalledExactlyOnceWith(PEER);
      expect(wsSend({ type: 'ping' }, PEER)).toBe(false);
      disconnectInstance(PEER); connectInstance(PEER, 'token');
      expect(Socket.all).toHaveLength(2); // Explicit recovery, not an automatic retry storm.
    } finally { remove(); }
  });
  it('also stops retries when a coded refusal arrives before the close frame', () => {
    vi.useFakeTimers(); const listener = vi.fn(); const remove = onDesktopPolicyRefused(listener);
    try {
      connectInstance(PEER, 'token');
      Socket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'error', code: 'desktop_update_required', message: 'Update', details: { minimumVersion: '99.0.0' } }) });
      Socket.all[0]!.onclose?.({ code: 1006 });
      vi.advanceTimersByTime(90_000);
      expect(Socket.all).toHaveLength(1);
      expect(listener).toHaveBeenCalledExactlyOnceWith(PEER);
    } finally { remove(); }
  });
});
