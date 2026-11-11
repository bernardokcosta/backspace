import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel } from '@veyvox/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { installSocketHarness, TestWebSocket } from '../test/socketHarness';
import { junoUser } from '../components/games/junoTestFixtures';

// jsdom has no AudioWorkletNode; the handler's imports reach the voice stack.
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      playSound: vi.fn(() => Promise.resolve(null)),
      clearInputDenial: vi.fn(),
      resumeContext: vi.fn(() => Promise.resolve()),
      setInputDevice: vi.fn(() => Promise.resolve(null)),
    }),
  },
}));
vi.mock('../hooks/useMascotAnimation', () => ({ useMascotAnimation: vi.fn() }));

const { useWebSocket, dmCallEventIsOurs } = await import('./useWebSocket');
const { useSpaceStore } = await import('../stores/spaceStore');
const { useUIStore } = await import('../stores/uiStore');
const { useVoiceStore } = await import('../stores/voiceStore');
const { useAuthStore } = await import('../stores/authStore');
const { startDmCall } = await import('../utils/voiceActions');
const { initI18n } = await import('../i18n');
const i18n = (await import('../i18n')).default;

// #415: a dm_call_start the server refuses must not leave the client in its
// calling state (which keeps the outgoing ring playing), and the end of one
// DM's call must not tear down a different call the client is in.

const GROUP = 'dm-group';
const OTHER = 'dm-other';

/** A native call is held by its DM ID only. */
function active(dmChannelId: string) {
  return { dmChannelId };
}

/** A call this client is placing. */
function outgoing(dmChannelId: string) {
  return { dmChannelId, withCamera: false };
}

function dm(id: string): DmChannel {
  return { id, members: [], ownerId: 'owner', name: null, icon: null, createdAt: 1 };
}

function homeSocket(): TestWebSocket {
  renderHook(() => useWebSocket());
  const ws = TestWebSocket.all.at(-1)!;
  ws.open();
  return ws;
}

beforeEach(async () => {
  await initI18n();
  installSocketHarness(); useAuthStore.setState({ token: 'native-token', user: junoUser('me') });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  useUIStore.setState({ toasts: [] });
  useSpaceStore.setState({
    dmChannels: [dm(GROUP), dm(OTHER)],
  });
  useVoiceStore.setState({
    outgoingCall: null,
    incomingCall: null,
    activeDmCall: null,
    currentVoiceChannelId: null,
    isLiveKitConnected: false,
    voiceUsers: new Map(),
    disconnectFn: null,
    connectFn: null,
  });
});

afterEach(() => {
  cleanup(); useAuthStore.setState({ token: null }); vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a refused dm_call_start', () => {
  it('keeps a ringing call when an unrelated ephemeral event was rate limited', () => {
    const ws = homeSocket(); startDmCall(GROUP);
    ws.deliver({ type: 'error', message: 'Too many requests', code: 'rate_limited', retryAfter: 1 });
    expect(useVoiceStore.getState().outgoingCall).toEqual(outgoing(GROUP));
  });

  it('still clears a rate-limited call start correlated to that DM', () => {
    const ws = homeSocket(); startDmCall(GROUP);
    ws.deliver({ type: 'error', message: 'Too many requests', code: 'rate_limited', retryAfter: 1, dmChannelId: GROUP });
    expect(useVoiceStore.getState().outgoingCall).toBeNull();
  });
  it('clears the calling state and says why', () => {
    const ws = homeSocket();
    expect(startDmCall(GROUP)).toBe(true);
    expect(useVoiceStore.getState().outgoingCall).toEqual(outgoing(GROUP));

    ws.deliver({ type: 'error', message: 'A call is already running in this conversation', code: 'dm_call_in_progress', dmChannelId: GROUP });

    expect(useVoiceStore.getState().outgoingCall).toBeNull();
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toBe(i18n.t('errors:dm_call_in_progress'));
  });

  it('keeps a call being placed in another DM', () => {
    const ws = homeSocket();
    startDmCall(GROUP);

    ws.deliver({ type: 'error', message: 'refused', code: 'dm_call_in_progress', dmChannelId: OTHER });

    expect(useVoiceStore.getState().outgoingCall).toEqual(outgoing(GROUP));
  });

  it('ignores a previous-session refusal even with an equal DM ID', () => {
    const ws = homeSocket();
    act(() => useAuthStore.setState(state => ({ sessionRevision: state.sessionRevision + 1 })));
    useVoiceStore.setState({ outgoingCall: outgoing(GROUP) });

    ws.deliver({ type: 'error', message: 'refused', code: 'dm_call_in_progress', dmChannelId: GROUP });

    expect(useVoiceStore.getState().outgoingCall).toEqual(outgoing(GROUP));
  });
});

describe('the end of a DM call', () => {
  it('tears down the call the client is in', () => {
    const ws = homeSocket();
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ activeDmCall: active(GROUP), disconnectFn });

    ws.deliver({ type: 'dm_call_ended', dmChannelId: GROUP });

    expect(useVoiceStore.getState().activeDmCall).toBeNull();
    expect(disconnectFn).toHaveBeenCalledTimes(1);
  });

  it('leaves alone a call in a different DM', () => {
    const ws = homeSocket();
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ activeDmCall: active(OTHER), disconnectFn });

    ws.deliver({ type: 'dm_call_rejected', dmChannelId: GROUP });
    ws.deliver({ type: 'dm_call_ended', dmChannelId: GROUP });

    expect(useVoiceStore.getState().activeDmCall).toEqual(active(OTHER));
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it('clears who is in the ended call, so no join is offered', () => {
    const ws = homeSocket();
    useVoiceStore.setState({ voiceUsers: new Map([[GROUP, ['alice', 'bob']]]) });

    ws.deliver({ type: 'dm_call_ended', dmChannelId: GROUP });

    expect(useVoiceStore.getState().voiceUsers.get(GROUP)).toEqual([]);
  });
});

describe('dmCallEventIsOurs', () => {
  it('matches the native DM ID of an incoming call', () => {
    useVoiceStore.setState({ incomingCall: { dmChannelId: GROUP, callerId: 'c', callerName: 'C' } });
    expect(dmCallEventIsOurs({ dmChannelId: GROUP })).toBe(true);
    expect(dmCallEventIsOurs({ dmChannelId: OTHER })).toBe(false);
  });

  it('matches the exact native DM being called, not another ID', () => {
    useVoiceStore.setState({ outgoingCall: outgoing(GROUP) });
    expect(dmCallEventIsOurs({ dmChannelId: GROUP })).toBe(true);
    expect(dmCallEventIsOurs({ dmChannelId: OTHER })).toBe(false);
  });

  it('matches nothing when the client holds no call', () => {
    expect(dmCallEventIsOurs({ dmChannelId: GROUP })).toBe(false);
  });
});

describe('an accept in a DM call', () => {
  it('connects the caller of that DM', () => {
    const ws = homeSocket();
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ outgoingCall: outgoing(GROUP), connectFn });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'bob' });

    expect(useVoiceStore.getState().outgoingCall).toBeNull();
    expect(useVoiceStore.getState().activeDmCall).toEqual(active(GROUP));
    expect(connectFn).toHaveBeenCalledWith(GROUP, true);
  });

  it('leaves alone a member calling a different DM', () => {
    const ws = homeSocket();
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ outgoingCall: outgoing(OTHER), connectFn });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'bob' });

    expect(useVoiceStore.getState().outgoingCall).toEqual(outgoing(OTHER));
    expect(useVoiceStore.getState().activeDmCall).toBeNull();
    expect(connectFn).not.toHaveBeenCalled();
  });

  it('does not pull a member in a voice channel into the call', () => {
    const ws = homeSocket();
    useVoiceStore.setState({ isLiveKitConnected: true, currentVoiceChannelId: 'voice-1' });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'bob' });

    expect(useVoiceStore.getState().activeDmCall).toBeNull();
  });
});

describe('what a ring leaves behind', () => {
  it('does not let a ring someone else answered tear down a later call', () => {
    const ws = homeSocket();
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ disconnectFn, isLiveKitConnected: false });

    // The native ring was answered by this account on another device.
    ws.deliver({ type: 'dm_call_incoming', dmChannelId: GROUP, callerId: 'c', callerName: 'C' });
    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'me' });
    expect(useVoiceStore.getState().incomingCall).toBeNull();

    // A delayed end for that earlier call cannot disconnect the later one.
    useVoiceStore.setState({ activeDmCall: active(OTHER) });
    ws.deliver({ type: 'dm_call_ended', dmChannelId: GROUP });

    expect(useVoiceStore.getState().activeDmCall).toEqual(active(OTHER));
    expect(disconnectFn).not.toHaveBeenCalled();
  });

  it('does not change the active native call or retain media secrets from an incoming event', () => {
    const ws = homeSocket();
    const held = active(OTHER);
    useVoiceStore.setState({ activeDmCall: held });

    ws.deliver({
      type: 'dm_call_incoming', dmChannelId: GROUP, callerId: 'c', callerName: 'C',
      livekitUrl: 'wss://host/lk', livekitToken: 'tok-new',
    });

    expect(useVoiceStore.getState().activeDmCall).toEqual(held);
    expect(useVoiceStore.getState().incomingCall).toEqual({
      dmChannelId: GROUP, callerId: 'c', callerName: 'C',
    });
    expect(dmCallEventIsOurs({ dmChannelId: OTHER })).toBe(true);
  });
});

describe('a ring answered on another device', () => {
  it('does not put a client sitting in a voice channel into the call', () => {
    const ws = homeSocket();
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ isLiveKitConnected: true, currentVoiceChannelId: 'voice-1', connectFn });
    ws.deliver({ type: 'dm_call_incoming', dmChannelId: GROUP, callerId: 'c', callerName: 'C' });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'me' });

    expect(useVoiceStore.getState().incomingCall).toBeNull();
    expect(useVoiceStore.getState().activeDmCall).toBeNull();
    expect(useVoiceStore.getState().currentVoiceChannelId).toBe('voice-1');
    expect(connectFn).not.toHaveBeenCalled();
  });
});

describe('who answered a group call', () => {
  // The ring plays while incomingCall is set. Another member's answer must
  // leave it on, so this member can still answer; an answer by the same
   // person on another session stops it. Compared by authenticated native ID.

  function ringing(ws: TestWebSocket): void {
    ws.deliver({ type: 'dm_call_incoming', dmChannelId: GROUP, callerId: 'c', callerName: 'C' });
    expect(useVoiceStore.getState().incomingCall).not.toBeNull();
  }

  it('keeps ringing when another member answered', () => {
    const ws = homeSocket();
    ringing(ws);

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'someone-else' });

    expect(useVoiceStore.getState().incomingCall).not.toBeNull();
  });

  it('keeps ringing when a malformed event does not name its authenticated answerer', () => {
    const ws = homeSocket();
    ringing(ws);

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP });

    expect(useVoiceStore.getState().incomingCall).not.toBeNull();
  });

  it('stops ringing when this native user answered on another session', () => {
    const ws = homeSocket();
    ringing(ws);

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'me' });

    expect(useVoiceStore.getState().incomingCall).toBeNull();
    expect(useVoiceStore.getState().activeDmCall).toBeNull();
  });

  it('still connects the caller, whoever answered', () => {
    const ws = homeSocket();
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ outgoingCall: outgoing(GROUP), connectFn });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: GROUP, answeredByUserId: 'someone-else' });

    expect(useVoiceStore.getState().outgoingCall).toBeNull();
    expect(connectFn).toHaveBeenCalledWith(GROUP, true);
  });

  it('leaves a ring for another call alone when the call this client is in is answered', () => {
    const ws = homeSocket();
    useVoiceStore.setState({ activeDmCall: active(OTHER) });
    ringing(ws);

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: OTHER, answeredByUserId: 'me' });

    expect(useVoiceStore.getState().incomingCall).not.toBeNull();
  });
});

describe('an accept naming a different native DM', () => {
  it('keeps the id a joined client holds the call by', () => {
    const ws = homeSocket();
    useVoiceStore.setState({ activeDmCall: active(GROUP), isLiveKitConnected: true });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: OTHER, answeredByUserId: 'me' });

    expect(useVoiceStore.getState().activeDmCall).toEqual(active(GROUP));
  });

  it('cannot connect the caller under a different DM ID', () => {
    const ws = homeSocket();
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ outgoingCall: outgoing(GROUP), connectFn });

    ws.deliver({ type: 'dm_call_accepted', dmChannelId: OTHER, answeredByUserId: 'bob' });

    expect(useVoiceStore.getState().activeDmCall).toBeNull();
    expect(connectFn).not.toHaveBeenCalled();
  });
});

describe('a refused dm_call_accept', () => {
  it('takes the client out of the call it joined on its side', () => {
    const ws = homeSocket();
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ activeDmCall: active(GROUP), disconnectFn });

    ws.deliver({ type: 'error', message: 'This call has already ended', code: 'dm_call_not_found', dmChannelId: GROUP });

    expect(useVoiceStore.getState().activeDmCall).toBeNull();
    expect(disconnectFn).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().toasts[0]!.message).toBe(i18n.t('errors:dm_call_not_found'));
  });

  it('leaves alone a call in another DM', () => {
    const ws = homeSocket();
    const disconnectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ activeDmCall: active(OTHER), disconnectFn });

    ws.deliver({ type: 'error', message: 'This call has already ended', code: 'dm_call_not_found', dmChannelId: GROUP });

    expect(useVoiceStore.getState().activeDmCall).toEqual(active(OTHER));
    expect(disconnectFn).not.toHaveBeenCalled();
  });
});
