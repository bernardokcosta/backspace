import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { VoiceUser } from './VoiceUser';
import { useVoiceStore } from '../../stores/voiceStore';
import { useSpaceStore } from '../../stores/spaceStore';
import type { ParticipantInfo, UserTile } from '../../hooks/useLiveKit';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

vi.mock('../../hooks/useLiveKit', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getActiveRoom: () => null,
    setCameraSubscription: vi.fn(),
    setStreamSubscription: vi.fn(),
  };
});

function remoteCameraTile(): UserTile {
  const videoTrack = {
    addEventListener: () => {},
    removeEventListener: () => {},
    readyState: 'live',
  } as unknown as MediaStreamTrack;
  const participant: ParticipantInfo = {
    identity: '2:bob',
    userId: '2',
    username: 'bob',
    homeUserId: null,
    isMuted: false,
    isDeafened: false,
    isCameraOn: true,
    isScreenSharing: false,
    isLocal: false,
    audioTrack: null,
    videoTrack,
    screenTrack: null,
    screenAudioTrack: null,
    lkVideoTrack: null,
    lkScreenTrack: null,
    cachedUser: null,
  };
  return {
    kind: 'user',
    key: participant.identity,
    participant,
    videoTrack,
    audioTrack: null,
    lkVideoTrack: null,
  };
}

beforeEach(() => {
  useVoiceStore.setState({
    isDeafened: false,
    currentVoiceChannelId: 'voice-1',
    speakingParticipantIds: new Set(),
    spaceMutedUserIds: new Set(),
    spaceDeafenedUserIds: new Set(),
    permissionMutedUserIds: new Set(),
    unwatchedCameras: new Set(),
    participantMutes: new Map(),
  });
  useSpaceStore.setState({
    channelToSpaceMap: new Map([['voice-1', 'space-1']]),
    members: [],
  });
});

describe('VoiceUser camera tile', () => {
  it('keeps remote camera video muted so it never registers an OS media session for this app', () => {
    const { container } = render(<VoiceUser tile={remoteCameraTile()} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video!.muted).toBe(true);
  });
});
