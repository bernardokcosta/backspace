import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@backspace/shared';
import { UserProfilePopout } from './UserProfilePopout';
import { watchUserScreen } from '../../utils/watchStream';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { PermissionBits, permissionsToString } from '../../utils/permissions';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: () => ({
      playSound: vi.fn(),
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
      resumeContext: vi.fn().mockResolvedValue(undefined),
      clearInputDenial: vi.fn(),
      setInputDevice: vi.fn().mockResolvedValue(null),
    }),
  },
}));

vi.mock('../../hooks/useLiveKit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useLiveKit')>();
  return { ...actual, getActiveRoom: () => null };
});

vi.mock('../../utils/mutuals', () => ({
  loadFederatedMutuals: vi.fn().mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }),
}));

vi.mock('../../hooks/useShownStatus', () => ({
  useShownStatus: (_u: User, _origin: string, status: User['status']) => status,
}));

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    username: 'ada',
    displayName: 'Ada',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 0,
    homeInstance: null,
    homeUserId: null,
    replicatedInstances: [],
    ...overrides,
  };
}

const SHARER: User = makeUser({ id: 'u-2', username: 'bob', displayName: 'Bob' });

function renderCard(watching: boolean) {
  useVoiceStore.setState({
    currentVoiceChannelId: 'voice-1',
    isLiveKitConnected: true,
    participants: [],
    voiceUsers: new Map([['voice-1', ['u-2']]]),
    voiceUserStates: new Map([
      ['u-2', { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true }],
    ]),
    watchingStreams: watching ? new Set(['u-2']) : new Set(),
    watchingChannels: watching ? new Map([['u-2', 'voice-1']]) : new Map(),
  });
  return render(
    <MemoryRouter>
      <UserProfilePopout
        user={SHARER}
        origin=""
        onClose={() => {}}
        anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
        placement="right"
        member={{ spaceId: 'space-1', userId: 'u-2' }}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: makeUser({ id: 'u-1', username: 'me', displayName: 'Me' }),
    myRowIds: new Map(),
  } as never);
  useSpaceStore.setState({
    spaces: [],
    members: [
      { spaceId: 'space-1', userId: 'u-2', user: SHARER, roles: [] },
    ],
    channelToSpaceMap: new Map([['voice-1', 'space-1']]),
    channelOriginMap: new Map(),
    channelPermissions: new Map([
      ['voice-1', permissionsToString(PermissionBits.CONNECT | PermissionBits.VIEW_CHANNEL)],
    ]),
    spacePermissions: new Map(),
    roles: [],
    currentSpaceId: 'space-1',
  } as never);
});

describe('UserProfilePopout screen-share controls', () => {
  it('shows Watch below the @name when the member is sharing a screen', () => {
    renderCard(false);
    const button = screen.getByRole('button', { name: 'Watch Stream' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent('Watch');
  });

  it('shows Stop Watching instead while already watching', () => {
    renderCard(true);
    expect(screen.getByRole('button', { name: 'Stop Watching' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Watch Stream' })).toBeNull();
  });

  it('marks the watch when Watch is clicked', () => {
    renderCard(false);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Stream' }));
    expect(useVoiceStore.getState().watchingStreams.has('u-2')).toBe(true);
  });

  it('drops the watch when Stop Watching is clicked', () => {
    renderCard(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Watching' }));
    expect(useVoiceStore.getState().watchingStreams.has('u-2')).toBe(false);
  });

  it('shows no watch controls when the member is not sharing', () => {
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      isLiveKitConnected: true,
      participants: [],
      voiceUsers: new Map([['voice-1', ['u-2']]]),
      voiceUserStates: new Map(),
      watchingStreams: new Set(),
    });
    render(
      <MemoryRouter>
        <UserProfilePopout
          user={SHARER}
          origin=""
          onClose={() => {}}
          anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
          placement="right"
          member={{ spaceId: 'space-1', userId: 'u-2' }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Watch Stream' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop Watching' })).toBeNull();
  });

  it('reconnects a dropped session when watching the current channel', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      voiceConnectionStatus: 'disconnected',
      connectFn,
    } as never);
    watchUserScreen('voice-1', 'u-2', vi.fn());
    expect(connectFn).toHaveBeenCalledWith('voice-1');
    expect(useVoiceStore.getState().watchingStreams.has('u-2')).toBe(true);
    expect(useVoiceStore.getState().watchingChannels.get('u-2')).toBe('voice-1');
  });

  it('ignores a same-id sharer on another origin', () => {
    useSpaceStore.setState({
      spaces: [
        { id: 'space-1', _instanceOrigin: '' },
        { id: 'space-remote', _instanceOrigin: 'https://orbit.example' },
      ],
      channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-r', 'space-remote']]),
      channelOriginMap: new Map([['voice-1', ''], ['voice-r', 'https://orbit.example']]),
    } as never);
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      participants: [],
      // Only the remote same-id user is sharing.
      voiceUsers: new Map([['voice-r', ['u-2']]]),
      voiceUserStates: new Map([
        ['u-2', { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true }],
      ]),
      watchingStreams: new Set(),
    });
    render(
      <MemoryRouter>
        <UserProfilePopout
          user={SHARER}
          origin=""
          onClose={() => {}}
          anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
          placement="right"
          member={{ spaceId: 'space-1', userId: 'u-2' }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Watch Stream' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop Watching' })).toBeNull();
  });

  it('controls the same-origin share when ids collide across origins', () => {
    useSpaceStore.setState({
      spaces: [
        { id: 'space-1', _instanceOrigin: '' },
        { id: 'space-remote', _instanceOrigin: 'https://orbit.example' },
      ],
      channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-r', 'space-remote']]),
      channelOriginMap: new Map([['voice-1', ''], ['voice-r', 'https://orbit.example']]),
      channelPermissions: new Map([
        ['voice-r', permissionsToString(PermissionBits.CONNECT | PermissionBits.VIEW_CHANNEL)],
      ]),
    } as never);
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      participants: [],
      voiceUsers: new Map([['voice-r', ['u-2']]]),
      voiceUserStates: new Map([
        ['u-2', { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true }],
      ]),
      watchingStreams: new Set(),
      watchingChannels: new Map(),
    });
    render(
      <MemoryRouter>
        <UserProfilePopout
          user={SHARER}
          origin="https://orbit.example"
          onClose={() => {}}
          anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
          placement="right"
          member={{ spaceId: 'space-remote', userId: 'u-2' }}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Watch Stream' }));
    expect(useVoiceStore.getState().watchingStreams.has('u-2')).toBe(true);
    expect(useVoiceStore.getState().watchingChannels.get('u-2')).toBe('voice-r');
  });

  it('shows neither button when the same id sits on two origins', () => {
    // u-2 occupies both a local and a remote channel: the shared WS presence
    // cannot tell whose screen is live, so no button may drive either room.
    useSpaceStore.setState({
      spaces: [
        { id: 'space-1', _instanceOrigin: '' },
        { id: 'space-remote', _instanceOrigin: 'https://orbit.example' },
      ],
      channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-r', 'space-remote']]),
      channelOriginMap: new Map([['voice-1', ''], ['voice-r', 'https://orbit.example']]),
    } as never);
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      participants: [],
      voiceUsers: new Map([['voice-1', ['u-2']], ['voice-r', ['u-2']]]),
      voiceUserStates: new Map([
        ['u-2', { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true }],
      ]),
      watchingStreams: new Set(),
      watchingChannels: new Map(),
    });
    render(
      <MemoryRouter>
        <UserProfilePopout
          user={SHARER}
          origin=""
          onClose={() => {}}
          anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
          placement="right"
          member={{ spaceId: 'space-1', userId: 'u-2' }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Watch Stream' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop Watching' })).toBeNull();
  });

  it('shows Watch (not Stop) on the remote card while watching the local twin', () => {
    // Watching local u-2 must not flip the remote twin's card to Stop: the
    // binding belongs to voice-1, and the shared id is ambiguous anyway.
    useSpaceStore.setState({
      spaces: [
        { id: 'space-1', _instanceOrigin: '' },
        { id: 'space-remote', _instanceOrigin: 'https://orbit.example' },
      ],
      channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-r', 'space-remote']]),
      channelOriginMap: new Map([['voice-1', ''], ['voice-r', 'https://orbit.example']]),
      channelPermissions: new Map([
        ['voice-r', permissionsToString(PermissionBits.CONNECT | PermissionBits.VIEW_CHANNEL)],
      ]),
    } as never);
    useVoiceStore.setState({
      currentVoiceChannelId: 'voice-1',
      participants: [],
      voiceUsers: new Map([['voice-1', ['u-2']], ['voice-r', ['u-2']]]),
      voiceUserStates: new Map([
        ['u-2', { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true }],
      ]),
      watchingStreams: new Set(['u-2']),
      watchingChannels: new Map([['u-2', 'voice-1']]),
    });
    render(
      <MemoryRouter>
        <UserProfilePopout
          user={SHARER}
          origin="https://orbit.example"
          onClose={() => {}}
          anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }}
          placement="right"
          member={{ spaceId: 'space-remote', userId: 'u-2' }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Watch Stream' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop Watching' })).toBeNull();
    expect(useVoiceStore.getState().watchingStreams.has('u-2')).toBe(true);
  });
});
