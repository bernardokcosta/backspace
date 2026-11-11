import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UserProfilePopout } from './UserProfilePopout';
import { watchUserScreen } from '../../utils/watchStream';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { PermissionBits, permissionsToString } from '../../utils/permissions';
import { junoUser } from '../games/junoTestFixtures';
import type { ParticipantInfo } from '../../hooks/useLiveKit';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({
  playSound: vi.fn(), setOutputDevice: vi.fn(), setVolume: vi.fn(), resumeContext: vi.fn().mockResolvedValue(undefined),
  clearInputDenial: vi.fn(), setInputDevice: vi.fn().mockResolvedValue(null),
}) } }));
vi.mock('../../hooks/useLiveKit', async original => ({ ...await original<typeof import('../../hooks/useLiveKit')>(), getActiveRoom: () => null }));
vi.mock('../../api/client', async original => {
  const actual = await original<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, users: { ...actual.api.users, getMutuals: vi.fn().mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }) } } };
});
const SHARER = junoUser('u-2', 'Bob');
const FLAGS = { isMuted: false, isDeafened: false, isCameraOn: false, isScreenSharing: true };
const anchor = { top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 };
const mount = (memberId = SHARER.id) => render(<MemoryRouter><UserProfilePopout user={SHARER} onClose={() => {}} anchor={anchor}
  member={{ spaceId: 'space-1', userId: memberId }} /></MemoryRouter>);
const watch = () => screen.queryByRole('button', { name: 'Watch Stream' });
const stop = () => screen.queryByRole('button', { name: 'Stop Watching' });

beforeEach(() => {
  useAuthStore.setState({ user: junoUser('u-1', 'Me') });
  useSpaceStore.getState().reset();
  useSpaceStore.setState({ channelToSpaceMap: new Map([['voice-1', 'space-1'], ['voice-2', 'space-2']]),
    channelPermissions: new Map([['voice-1', permissionsToString(PermissionBits.CONNECT | PermissionBits.VIEW_CHANNEL)],
      ['voice-2', permissionsToString(PermissionBits.CONNECT | PermissionBits.VIEW_CHANNEL)]]) });
  useVoiceStore.setState({ ...useVoiceStore.getInitialState(), currentVoiceChannelId: 'voice-1', isLiveKitConnected: true,
    participants: [], voiceUsers: new Map([['voice-1', [SHARER.id]]]), voiceUserStates: new Map([[SHARER.id, FLAGS]]) });
});

describe('native profile screen-share controls', () => {
  it('shows Watch below the @name when the native member shares a screen', () => {
    mount(); expect(watch()).toHaveTextContent('Watch'); expect(stop()).toBeNull();
  });
  it('shows Stop Watching instead while already watching the exact native seat', () => {
    useVoiceStore.setState({ watchingStreams: new Set([SHARER.id]), watchingChannels: new Map([[SHARER.id, 'voice-1']]) });
    mount(); expect(stop()).toBeInTheDocument(); expect(watch()).toBeNull();
  });
  it('marks the native watch when clicked', () => {
    mount(); fireEvent.click(watch()!); expect(useVoiceStore.getState().watchingChannels.get(SHARER.id)).toBe('voice-1');
  });
  it('drops the watch when Stop Watching is clicked', () => {
    useVoiceStore.setState({ watchingStreams: new Set([SHARER.id]), watchingChannels: new Map([[SHARER.id, 'voice-1']]) });
    mount(); fireEvent.click(stop()!); expect(useVoiceStore.getState().watchingStreams.has(SHARER.id)).toBe(false);
  });
  it('shows neither control when the member is not sharing', () => {
    useVoiceStore.setState({ voiceUserStates: new Map() }); mount(); expect(watch()).toBeNull(); expect(stop()).toBeNull();
  });
  it('reconnects a dropped current session while watching', () => {
    const connectFn = vi.fn().mockResolvedValue(undefined);
    useVoiceStore.setState({ voiceConnectionStatus: 'disconnected', connectFn }); watchUserScreen('voice-1', SHARER.id, vi.fn());
    expect(connectFn).toHaveBeenCalledWith('voice-1'); expect(useVoiceStore.getState().watchingChannels.get(SHARER.id)).toBe('voice-1');
  });
  it('does not use a mismatched member context to operate another native account', () => {
    mount('someone-else'); expect(watch()).toBeNull(); expect(stop()).toBeNull();
  });
  it('finds the exact visible native seat in another channel', () => {
    useVoiceStore.setState({ voiceUsers: new Map([['voice-2', [SHARER.id]]]) }); mount(); fireEvent.click(watch()!);
    expect(useVoiceStore.getState().watchingChannels.get(SHARER.id)).toBe('voice-2');
  });
  it('rejects an ambiguous presence snapshot with two seats for the same account', () => {
    useVoiceStore.setState({ voiceUsers: new Map([['voice-1', [SHARER.id]], ['voice-2', [SHARER.id]]]) });
    mount(); expect(watch()).toBeNull(); expect(stop()).toBeNull();
  });
  it('does not stop a watch bound to an old channel when the sharer has moved', () => {
    useVoiceStore.setState({ voiceUsers: new Map([['voice-2', [SHARER.id]]]), watchingStreams: new Set([SHARER.id]),
      watchingChannels: new Map([[SHARER.id, 'voice-1']]) }); mount();
    expect(watch()).toBeInTheDocument(); expect(stop()).toBeNull(); expect(useVoiceStore.getState().watchingStreams.has(SHARER.id)).toBe(true);
  });
  it('requires CONNECT even when native presence reports a live screen', () => {
    useSpaceStore.setState({ channelPermissions: new Map([['voice-1', '0']]) }); mount(); expect(watch()).toBeDisabled();
    fireEvent.click(watch()!); expect(useVoiceStore.getState().watchingStreams.size).toBe(0);
  });
  it('prefers the connected room LiveKit screen flag over stale WS presence', () => {
    useVoiceStore.setState({ participants: [{ userId: SHARER.id, isScreenSharing: false } as ParticipantInfo] });
    mount(); expect(watch()).toBeNull();
  });
});
