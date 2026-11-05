import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GamesButton } from './GamesButton';
import { GamesPicker } from './GamesPicker';
import { VoiceControlBar } from '../voice/VoiceControlBar';
import { useJunoStore } from '../../stores/junoStore';
import { useUIStore } from '../../stores/uiStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../voice/ScreenShareSettingsPopover', () => ({ ScreenShareSettingsPopover: () => null }));
vi.mock('../../utils/voiceActions', () => ({
  handleMuteAction: vi.fn(), handleDeafenAction: vi.fn(), handleCameraAction: vi.fn(),
  handleScreenShareAction: vi.fn(), handleDisconnectAction: vi.fn(),
}));

const target = { accountId: 'account', selfId: 'remote-row', origin: 'https://remote.test', channelId: 'voice' };
const command = vi.fn(async () => {});
const originalCommand = useJunoStore.getState().command;
beforeEach(() => {
  vi.clearAllMocks();
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useJunoStore.setState({ command });
  useAuthStore.setState({ user: { id: 'account', username: 'ada', displayName: 'Ada', avatar: null, banner: null,
    accentColor: null, avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false,
    createdAt: 1, homeInstance: null, homeUserId: null, replicatedInstances: [] } });
  useVoiceStore.setState({ currentVoiceChannelId: 'voice', activeDmCall: null, isLiveKitConnected: true,
    voiceConnectionStatus: 'connected', focusedParticipantId: 'camera', isMuted: false, isDeafened: false,
    isCameraOn: false, isScreenSharing: false, spaceMutedUserIds: new Set(), spaceDeafenedUserIds: new Set() });
  useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'remote-space', origin: target.origin, type: 'voice' }]]) });
  useUIStore.setState({ activeModal: null, modalData: {}, isMobile: false, mobileStack: [], voiceFullscreen: false });
});
afterEach(() => { cleanup(); useJunoStore.setState({ command: originalCommand }); });

function Route() { return <output data-testid="route">{useLocation().pathname}</output>; }
function mount(withCallBar = false) {
  return render(<MemoryRouter initialEntries={['/channels/another/text']}>
    {withCallBar ? <VoiceControlBar /> : <GamesButton />}
    <GamesPicker /><Route />
  </MemoryRouter>);
}

describe('shared Games picker', () => {
  it('shows a game list first and does not focus, create or join Juno on opening/canceling', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    const dialog = screen.getByRole('dialog', { name: 'Games' });
    expect(within(dialog).getByRole('button', { name: 'Open Juno' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1);
    expect(useJunoStore.getState().open).toBe(false);
    expect(useVoiceStore.getState().focusedParticipantId).toBe('camera');
    expect(command).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useJunoStore.getState().open).toBe(false);
    expect(screen.getByRole('button', { name: 'Games' })).toHaveFocus();
  });
  it('opens the connected channel, not the text channel being viewed, only after choosing Juno', async () => {
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Juno' }));
    expect(screen.getByTestId('route')).toHaveTextContent('/channels/remote-space/voice');
    expect(useJunoStore.getState().open).toBe(true);
    expect(useVoiceStore.getState().focusedParticipantId).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(command).not.toHaveBeenCalled();
  });
  it('keeps an existing game focused when the picker is canceled', async () => {
    useJunoStore.getState().setOpen(true);
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await userEvent.keyboard('{Escape}'); expect(useJunoStore.getState().open).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });
  it.each(['room', 'account', 'origin', 'connection'] as const)('dismisses a picker whose %s changed', async reason => {
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    act(() => {
      if (reason === 'room') useVoiceStore.setState({ currentVoiceChannelId: 'elsewhere' });
      if (reason === 'account') useAuthStore.setState({ user: null });
      if (reason === 'origin') useSpaceStore.setState({ spaceChannelIndex: new Map([['voice', { spaceId: 'remote-space', origin: 'https://other.test', type: 'voice' }]]) });
      if (reason === 'connection') useJunoStore.getState().bind(target, false);
    });
    expect(await screen.findByTestId('route')).toHaveTextContent('/channels/another/text');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useJunoStore.getState().open).toBe(false); expect(command).not.toHaveBeenCalled();
  });
  it('contains Tab focus and closes with Escape without exiting fullscreen', async () => {
    useUIStore.setState({ voiceFullscreen: true }); mount(true);
    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    const close = screen.getByRole('button', { name: 'Close' }); const juno = screen.getByRole('button', { name: 'Open Juno' });
    expect(close).toHaveFocus(); await userEvent.tab({ shift: true }); expect(juno).toHaveFocus();
    await userEvent.tab(); expect(close).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(useUIStore.getState().voiceFullscreen).toBe(true);
  });
  it('uses the mobile voice screen without duplicating its stack entry', async () => {
    useUIStore.setState({ isMobile: true, mobileStack: [{ screen: 'channel-chat' }] });
    mount(); await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Juno' }));
    expect(useUIStore.getState().mobileStack.map(entry => entry.screen)).toEqual(['channel-chat', 'voice-full']);
    await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open Juno' }));
    expect(useUIStore.getState().mobileStack).toHaveLength(2);
  });
});
