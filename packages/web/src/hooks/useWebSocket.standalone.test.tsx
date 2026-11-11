import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn(), playSound: vi.fn(async () => null) }) } }));
vi.mock('./useLiveKit', () => ({ getActiveRoom: vi.fn(() => null) }));
import * as socket from './useWebSocket';
import { useAuthStore } from '../stores/authStore';
import { useActivityStore } from '../stores/activityStore';
import { useSocialStore } from '../stores/socialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useChannelPokeStore } from '../stores/channelPokeStore';
import { installSocketHarness, TestHeartbeatWorker, TestWebSocket } from '../test/socketHarness';
const native: User = { id: 'me', username: 'legacy@old.invalid', displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'dnd', customStatus: null, isAdmin: false, createdAt: 1 };
beforeEach(() => {
  installSocketHarness(); vi.useFakeTimers(); useAuthStore.getState().initSession('synthetic-token', native);
  vi.spyOn(useSettingsStore.getState(), 'fetchStreamingLimits').mockResolvedValue(undefined);
  vi.spyOn(useSettingsStore.getState(), 'fetchGifEnabled').mockResolvedValue(undefined);
  vi.spyOn(useNotificationSettingsStore.getState(), 'load').mockResolvedValue(undefined);
  vi.spyOn(useSocialStore.getState(), 'loadFriends').mockResolvedValue(undefined);
  vi.spyOn(useSocialStore.getState(), 'loadRequests').mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); useAuthStore.getState().logout(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); });
const ready = () => ({ type: 'ready', user: native, spaces: [], folders: [], dmChannels: [], readStates: [], activeCalls: [], voiceStates: {}, userActivities: {}, voiceUserStates: {}, spaceVoiceStates: {} });
const active = () => TestWebSocket.all.filter(ws => ws.readyState < TestWebSocket.CLOSING);
describe('single native signaling session', () => {
  it('opens only the current page socket, never restores peer tokens, and leaves at most one socket active under StrictMode', () => {
    localStorage.setItem('backspace_instances_me', '[{"origin":"https://unused.invalid","token":"synthetic-old"}]');
    renderHook(() => socket.useWebSocket(), { wrapper: StrictMode }); expect(active()).toHaveLength(1);
    const ws = active()[0]!; act(() => ws.open());
    expect(ws.url).toBe(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);
    expect(ws.sent[0]).toMatchObject({ type: 'auth', token: 'synthetic-token' });
    for (const name of ['connectInstance', 'disconnectInstance', 'disconnectAllRemote', 'wsSendAll', 'getActivePeerOrigins', 'onFederationPeersChanged']) expect(socket).not.toHaveProperty(name);
  });
  it('reconnects one socket, stops the old heartbeat and ignores all callbacks of the replaced socket', () => {
    renderHook(() => socket.useWebSocket()); const first = active()[0]!; act(() => first.open());
    act(() => first.fail()); expect(TestHeartbeatWorker.all[0]?.stopped).toBe(true);
    act(() => vi.advanceTimersByTime(1000)); expect(active()).toHaveLength(1); const next = active()[0]!; act(() => next.open());
    act(() => first.deliver({ type: 'presence_update', userId: 'me', status: 'online' }));
    expect(useAuthStore.getState().user?.status).toBe('dnd');
    act(() => first.fail()); act(() => vi.advanceTimersByTime(60_000)); expect(active()).toEqual([next]);
  });
  it('same-token same-user session replacement closes the old socket before it can write a response', () => {
    renderHook(() => socket.useWebSocket()); const old = active()[0]!; act(() => old.open());
    act(() => useAuthStore.getState().initSession('synthetic-token', { ...native, displayName: 'New session' }));
    expect(old.readyState).toBe(TestWebSocket.CLOSED); expect(active()).toHaveLength(1);
    act(() => old.deliver(ready())); expect(useAuthStore.getState().user?.displayName).toBe('New session');
  });
  it('logout blocks stale sends/events and cancels reconnect/heartbeat even before a new server loads', () => {
    renderHook(() => socket.useWebSocket()); const old = active()[0]!; act(() => old.open()); act(() => old.fail());
    act(() => useAuthStore.getState().logout()); act(() => old.deliver(ready())); act(() => vi.advanceTimersByTime(60_000));
    expect(active()).toEqual([]); expect(socket.wsSend({ type: 'ping' })).toBe(false); expect(useAuthStore.getState().user).toBeNull();
    expect(TestHeartbeatWorker.all.every(worker => worker.stopped)).toBe(true);
  });
  it('uses native ready and self/other presence IDs and snapshots activities without identity maps', () => {
    renderHook(() => socket.useWebSocket()); const ws = active()[0]!; act(() => ws.open()); act(() => ws.deliver(ready()));
    expect(useChannelPokeStore.getState()).not.toHaveProperty('hosts'); expect(useChannelPokeStore.getState().supported).toBe(false);
    act(() => ws.deliver({ type: 'presence_update', userId: 'bob', status: 'idle', activities: [{ type: 'playing', name: 'Game' }] }));
    expect(useActivityStore.getState().userActivities.get('bob')?.[0]?.name).toBe('Game'); expect(useAuthStore.getState().user?.status).toBe('dnd');
    act(() => ws.deliver({ type: 'presence_update', userId: 'me', status: 'idle' })); expect(useAuthStore.getState().user?.status).toBe('idle');
  });
  it('call acceptance stops only the authenticated answerer ring, with no legacy identity fallback', () => {
    renderHook(() => socket.useWebSocket()); const ws = active()[0]!; act(() => ws.open());
    act(() => ws.deliver({ type: 'dm_call_incoming', dmChannelId: 'dm', callerId: 'bob', callerName: 'Bob' }));
    act(() => ws.deliver({ type: 'dm_call_accepted', dmChannelId: 'dm', answeredByUserId: 'carol' })); expect(useVoiceStore.getState().incomingCall?.dmChannelId).toBe('dm');
    act(() => ws.deliver({ type: 'dm_call_accepted', dmChannelId: 'other', answeredByUserId: 'me' })); expect(useVoiceStore.getState().incomingCall?.dmChannelId).toBe('dm');
    act(() => ws.deliver({ type: 'dm_call_accepted', dmChannelId: 'dm', answeredByUserId: 'me' })); expect(useVoiceStore.getState().incomingCall).toBeNull();
  });
});
