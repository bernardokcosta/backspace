import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, RoomEvent, DisconnectReason } from 'livekit-client';
import { useLiveKit } from './useLiveKit';
import { useVoiceStore } from '../stores/voiceStore';
import { useAuthStore } from '../stores/authStore';
import type { User } from '@veyvox/shared';

/**
 * The local participant's fallback is the native authenticated account.
 */

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  connect: vi.fn(), disconnect: vi.fn(),
  audio: {
    releaseInputStream: vi.fn(), resumeContext: vi.fn(),
    setVoiceProcessing: vi.fn(), setRnnoiseEnabled: vi.fn(),
    setInputDevice: vi.fn(), setInputVolume: vi.fn(),
    onResumed: vi.fn(() => vi.fn()), onInputTrackEnded: vi.fn(() => vi.fn()),
    getStreamGeneration: () => 1, getFreshTrack: () => null,
    playSound: vi.fn(),
  },
  space: {
    channelToSpaceMap: new Map<string, string>(),
    members: [] as unknown[],
    dmChannels: [] as unknown[],
  },
}));
vi.mock('livekit-client', async importOriginal => {
  const sdk = await importOriginal<typeof import('livekit-client')>();
  return { ...sdk, Room: class extends sdk.Room {
    connect = mocks.connect;
    disconnect = mocks.disconnect;
  } };
});
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => mocks.audio } }));
vi.mock('../audio/SpeakingDetector', () => ({
  SpeakingDetector: { getInstance: () => ({ clear: vi.fn(), syncTracks: vi.fn() }) },
}));
vi.mock('./useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('../utils/voice', () => ({ broadcastVoiceStatus: vi.fn(), clearSpaceVoiceForDmCall: vi.fn() }));
vi.mock('../utils/hwOverdrive', () => ({ activate: vi.fn(), deactivate: vi.fn() }));
vi.mock('../stores/spaceStore', () => ({
  useSpaceStore: { getState: () => mocks.space },
}));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { livekit: { token: mocks.token, dmToken: mocks.token } } }));

const me = { id: 'n-1', username: 'legacy@old.invalid', displayName: 'Jannis' } as User;

async function listedLocalRow(identity: string): Promise<User | null | undefined> {
  const { result } = renderHook(() => useLiveKit());
  await act(async () => { await result.current.connect('channel'); });
  const room = result.current.room!;
  (room.localParticipant as { identity: string }).identity = identity;
  act(() => { room.emit(RoomEvent.ParticipantMetadataChanged, undefined, room.localParticipant); });
  return useVoiceStore.getState().participants.find((p) => p.identity === identity)?.cachedUser;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue({ token: 'test', url: 'wss://example.invalid' });
  mocks.audio.resumeContext.mockResolvedValue(undefined);
  mocks.audio.setRnnoiseEnabled.mockResolvedValue(undefined);
  mocks.audio.setInputDevice.mockResolvedValue(null);
  mocks.connect.mockResolvedValue(undefined);
  mocks.disconnect.mockImplementation(async function (this: Room) {
    this.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED);
  });
  useVoiceStore.setState({ ...useVoiceStore.getInitialState(), isMuted: false, currentVoiceChannelId: 'channel' });
  useAuthStore.setState({ user: me });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAuthStore.setState({ user: null });
});

describe('the local participant row', () => {
  it('uses the native session row, without relabeling a retained @ username', async () => {
    expect(await listedLocalRow('n-1:legacy@old.invalid')).toBe(me);
    expect(useVoiceStore.getState().participants[0]).not.toHaveProperty('homeUserId');
    expect(mocks.token).toHaveBeenCalledWith('channel');
  });
  it('fetches DM credentials privately even if an untyped old call slot contains a signaled token', async () => {
    const stale = { dmChannelId: 'dm', livekit: { token: 'untrusted-old', url: 'wss://unused.invalid' }, federatedCallId: 'obsolete' };
    useVoiceStore.setState({ activeDmCall: stale });
    const { result } = renderHook(() => useLiveKit()); await act(async () => { await result.current.connect('dm', true); });
    expect(mocks.token).toHaveBeenCalledWith('dm'); expect(mocks.connect).toHaveBeenCalledWith('wss://example.invalid', 'test', expect.any(Object));
  });
});
