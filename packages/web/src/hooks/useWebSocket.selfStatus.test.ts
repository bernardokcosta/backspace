import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ playSound: vi.fn(async () => null) }) } }));
import { useWebSocket } from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { alertsAllowed } from '../utils/alerts';
import { junoUser } from '../components/games/junoTestFixtures';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
beforeEach(() => {
  installSocketHarness(); useAuthStore.setState({ token: 'native-token', user: { ...junoUser('me'), status: 'dnd' } });
});
afterEach(() => { cleanup(); useAuthStore.setState({ token: null, user: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function openSocket(): TestWebSocket { renderHook(() => useWebSocket()); const ws = TestWebSocket.all[0]!; act(() => ws.open()); return ws; }
describe('native chosen status and alert gate', () => {
  it('does not let another native user with a retained equal username change my status', () => {
    const ws = openSocket(); act(() => ws.deliver({ type: 'presence_update', userId: 'someone-else', status: 'online' }));
    expect(useAuthStore.getState().user?.status).toBe('dnd'); expect(alertsAllowed('message')).toBe(false);
  });
  it('takes a native same-account change made on another device from its sole socket', () => {
    const ws = openSocket(); act(() => ws.deliver({ type: 'presence_update', userId: 'me', status: 'online' }));
    expect(alertsAllowed('message')).toBe(true);
    act(() => ws.deliver({ type: 'presence_update', userId: 'me', status: 'dnd' }));
    expect(alertsAllowed('incoming_call')).toBe(false);
  });
  it('ignores invalid status values instead of allowing them into auth state', () => {
    const ws = openSocket(); act(() => ws.deliver({ type: 'presence_update', userId: 'me', status: 'invisible' }));
    expect(useAuthStore.getState().user?.status).toBe('dnd');
  });
});
