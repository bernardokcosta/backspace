import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

const joinVoiceChannel = vi.fn();
vi.mock('../utils/voice', () => ({
  joinVoiceChannel: (...args: unknown[]) => joinVoiceChannel(...args),
}));

import { useAfkVoiceMove } from './useAfkVoiceMove';
import { useVoiceStore } from '../stores/voiceStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';

const space = {
  id: 'space-1',
  name: 'Space',
  icon: null,
  banner: null,
  avatarColor: 'lavender',
  ownerId: 'user-1',
  ownerTitle: null,
  inviteCode: null,
  visibility: 'public' as const,
  directoryListed: false,
  description: null,
  afkChannelId: 'afk',
  afkTimeoutSeconds: 300,
  createdAt: 1,
  _instanceOrigin: '',
};

const channel = (id: string, type: 'voice' | 'text') => ({
  id, spaceId: 'space-1', name: id, type, topic: null, position: 0, categoryId: null, createdAt: 1,
});

function seedVoice(over: Record<string, unknown> = {}): void {
  useVoiceStore.setState({
    currentVoiceChannelId: 'general',
    voiceConnectionStatus: 'connected',
    isLiveKitConnected: true,
    activeDmCall: null,
    isMuted: false,
    isDeafened: false,
    speakingUserIds: new Set<string>(),
    connectFn: null,
    ...over,
  } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'me' } as never });
  useSpaceStore.setState({
    spaces: [space],
    channels: [channel('general', 'voice'), channel('afk', 'voice')],
    channelToSpaceMap: new Map([['general', 'space-1'], ['afk', 'space-1']]),
  } as never);
  seedVoice();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAfkVoiceMove', () => {
  it('moves to the AFK channel after the timeout of silence', () => {
    renderHook(() => useAfkVoiceMove());
    act(() => { vi.advanceTimersByTime(299_000); });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(joinVoiceChannel).toHaveBeenCalledWith('afk', undefined);
  });

  it('speaking resets the idle clock', () => {
    renderHook(() => useAfkVoiceMove());
    act(() => { vi.advanceTimersByTime(200_000); });
    act(() => {
      useVoiceStore.setState({ speakingUserIds: new Set(['me']) });
    });
    act(() => { vi.advanceTimersByTime(200_000); });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(100_000); });
    expect(joinVoiceChannel).toHaveBeenCalledWith('afk', undefined);
  });

  it('mute toggles count as activity', () => {
    renderHook(() => useAfkVoiceMove());
    act(() => { vi.advanceTimersByTime(200_000); });
    act(() => {
      useVoiceStore.setState({ isMuted: true });
    });
    act(() => { vi.advanceTimersByTime(200_000); });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });

  it('stays put when disabled, already there, in a DM call or disconnected', () => {
    useSpaceStore.setState({ spaces: [{ ...space, afkChannelId: null }] });
    const { unmount } = renderHook(() => useAfkVoiceMove());
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
    unmount();

    useSpaceStore.setState({ spaces: [space] });
    seedVoice({ currentVoiceChannelId: 'afk' });
    renderHook(() => useAfkVoiceMove());
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(joinVoiceChannel).not.toHaveBeenCalled();
  });
});
