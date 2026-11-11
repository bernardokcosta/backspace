import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoiceControls } from './VoiceControls';
import { useVoiceStore } from '../../stores/voiceStore';
import { useJunoStore } from '../../stores/junoStore';
import { useUIStore } from '../../stores/uiStore';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('./ScreenShareSettingsPopover', () => ({ ScreenShareSettingsPopover: () => null }));
vi.mock('./ConnectionInfoPopover', () => ({ ConnectionInfoPopover: () => null }));
vi.mock('../../utils/voiceActions', () => ({ handleCameraAction: vi.fn(), handleDisconnectAction: vi.fn(),
  handleScreenShareAction: vi.fn(), reconnectVoice: vi.fn() }));
const target = { userId: 'account', origin: window.location.origin, channelId: 'voice' };
beforeEach(() => {
  useVoiceStore.setState({ currentVoiceChannelId: 'voice', activeDmCall: null, isLiveKitConnected: true,
    voiceConnectionStatus: 'connected', connectionError: null, rnnoiseEnabled: true, isMuted: true });
  useJunoStore.getState().reset(); useJunoStore.getState().bind(target, true);
  useUIStore.setState({ activeModal: null, modalData: {} });
});
describe('voice sidebar game entry and audio processing control', () => {
  it('puts processing next to Disconnect and Games in the old bottom-row slot', () => {
    render(<VoiceControls />);
    const processing = screen.getByRole('button', { name: 'Disable AI Noise Suppression' });
    const disconnect = screen.getByRole('button', { name: 'Disconnect' });
    const games = screen.getByRole('button', { name: 'Games' });
    expect(processing.parentElement).toBe(disconnect.parentElement);
    expect(processing.nextElementSibling).toBe(disconnect);
    expect(processing.parentElement).toHaveClass('gap-2');
    expect(processing).toHaveClass('w-7', 'h-7', 'rounded-lg');
    expect(disconnect).toHaveClass('rounded-lg');
    expect(games.parentElement).not.toContainElement(processing);
    expect(processing).toHaveAttribute('aria-pressed', 'true');
  });
  it('only toggles RNNoise; it never unmutes the microphone', async () => {
    render(<VoiceControls />);
    await userEvent.click(screen.getByRole('button', { name: 'Disable AI Noise Suppression' }));
    expect(useVoiceStore.getState().rnnoiseEnabled).toBe(false); expect(useVoiceStore.getState().isMuted).toBe(true);
    expect(screen.getByRole('button', { name: 'Enable AI Noise Suppression' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('opens the shared list from the sidebar without entering Juno immediately', async () => {
    render(<VoiceControls />); await userEvent.click(screen.getByRole('button', { name: 'Games' }));
    expect(useUIStore.getState().activeModal).toBe('games'); expect(useUIStore.getState().modalData).toEqual(target);
    expect(useJunoStore.getState().open).toBe(false);
  });
});
