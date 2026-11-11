import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('./useWebSocket', () => ({ wsSend: vi.fn() }));
import { useAuthStore } from '../stores/authStore';
import { useShownStatus } from './useShownStatus';
const me = { id: 'me', username: 'legacy@old.invalid', status: 'dnd' } as User;
afterEach(() => { cleanup(); useAuthStore.setState({ user: null }); });
describe('native status dots', () => {
  it('shows the loaded own choice and reacts to a same-account update', () => {
    useAuthStore.setState({ user: me }); const { result } = renderHook(() => useShownStatus(me, 'online'));
    expect(result.current).toBe('dnd'); act(() => useAuthStore.setState({ user: { ...me, status: 'idle' } })); expect(result.current).toBe('idle');
  });
  it('never identifies a different local account by the same username', () => {
    useAuthStore.setState({ user: me }); const { result } = renderHook(() => useShownStatus({ ...me, id: 'other' }, 'online')); expect(result.current).toBe('online');
  });
  it('keeps a supplied status while auth bootstrap is unknown', () => {
    useAuthStore.setState({ user: null }); const { result } = renderHook(() => useShownStatus(me, 'online')); expect(result.current).toBe('online');
  });
  it('does not draw a fabricated status for an unresolved subject', () => {
    useAuthStore.setState({ user: me }); const { result } = renderHook(() => useShownStatus(null, undefined)); expect(result.current).toBeUndefined();
  });
});
