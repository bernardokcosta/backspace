import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useWebSocket, wsSend } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
const ADD = { type: 'reaction_add', messageId: 'm-1', emoji: '👍' } as const;
beforeEach(() => { installSocketHarness(); useAuthStore.setState({ token: 'native-token' }); });
afterEach(() => { cleanup(); useAuthStore.setState({ token: null }); vi.unstubAllGlobals(); });
describe('native wsSend delivery result', () => {
  it('returns false without creating a connection when no hook is mounted', () => {
    expect(wsSend(ADD)).toBe(false); expect(TestWebSocket.all).toEqual([]);
  });
  it('returns false while connecting and true only after sending on the open socket', () => {
    renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!;
    expect(wsSend(ADD)).toBe(false); expect(ws.sent).toEqual([]);
    ws.open(); expect(wsSend(ADD)).toBe(true);
    expect(ws.sent.filter(event => event.type === ADD.type)).toEqual([ADD]);
  });
  it('returns false after unmount and cannot send through a stale transport', () => {
    const view = renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; ws.open();
    view.unmount(); expect(wsSend(ADD)).toBe(false); expect(ws.sent.filter(event => event.type === ADD.type)).toEqual([]);
  });
});
