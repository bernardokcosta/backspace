import { beforeEach, describe, expect, it, vi } from 'vitest';

const wsSend = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useWebSocket', () => ({ wsSend }));
vi.mock('../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: () => ({
      clearInputDenial: vi.fn(),
      resumeContext: vi.fn().mockResolvedValue(undefined),
      setInputDevice: vi.fn().mockResolvedValue(null),
    }),
  },
}));

import { useVoiceStore } from '../stores/voiceStore';
import { broadcastVoiceStatus, joinVoiceChannel } from './voice';

describe('voice status resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVoiceStore.setState({
      ...useVoiceStore.getInitialState(),
      currentVoiceChannelId: null,
      activeDmCall: { dmChannelId: 'dm-reconnect' },
      isMuted: true,
      isDeafened: false,
      isCameraOn: true,
      isScreenSharing: false,
    });
  });

  it('sends voice_status for an active DM even though space channel state is null', () => {
    broadcastVoiceStatus();

    expect(wsSend).toHaveBeenCalledWith({
      type: 'voice_status',
      isMuted: true,
      isDeafened: false,
      isCameraOn: true,
      isScreenSharing: false,
    });
  });
});

describe('rejoining a dropped session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVoiceStore.setState({
      ...useVoiceStore.getInitialState(),
      currentVoiceChannelId: 'channel-1',
      activeDmCall: null,
    });
  });

  it('reconnects when the retained channel is selected again after a drop', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ voiceConnectionStatus: 'disconnected' });

    joinVoiceChannel('channel-1', connectFn);

    expect(connectFn).toHaveBeenCalledWith('channel-1');
    expect(useVoiceStore.getState().currentVoiceChannelId).toBe('channel-1');
  });

  it('stays a no-op while the session is still live', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ voiceConnectionStatus: 'connected' });

    joinVoiceChannel('channel-1', connectFn);

    expect(connectFn).not.toHaveBeenCalled();
  });

  it('stays a no-op while the session is still reconnecting on its own', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ voiceConnectionStatus: 'reconnecting' });

    joinVoiceChannel('channel-1', connectFn);

    expect(connectFn).not.toHaveBeenCalled();
  });
});

describe('joining a native voice channel replaces a DM call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVoiceStore.setState({ ...useVoiceStore.getInitialState(), currentVoiceChannelId: null });
  });

  it('clears the active native call and connects to the selected channel', () => {
    useVoiceStore.setState({ activeDmCall: { dmChannelId: 'dm-1' } });
    const connect = vi.fn().mockResolvedValue(undefined);

    joinVoiceChannel('channel-1', connect);

    expect(connect).toHaveBeenCalledWith('channel-1');
    expect(useVoiceStore.getState().activeDmCall).toBeNull();
  });

  it('clears an outgoing native ring while server voice_join performs replacement', () => {
    useVoiceStore.setState({ outgoingCall: { dmChannelId: 'dm-1', withCamera: false } });

    joinVoiceChannel('channel-1', vi.fn().mockResolvedValue(undefined));

    expect(wsSend).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().outgoingCall).toBeNull();
  });

  it('leaves replacement to the sole server voice_join without an extra leave', () => {
    useVoiceStore.setState({ activeDmCall: { dmChannelId: 'dm-1' } });

    joinVoiceChannel('channel-1', vi.fn().mockResolvedValue(undefined));

    expect(wsSend).not.toHaveBeenCalled();
  });
});
