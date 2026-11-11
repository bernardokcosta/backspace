import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
vi.mock('./lazySettingsPanels', () => ({ SettingsPanelSuspense: ({ children }: { children: React.ReactNode }) => children,
  AccountPanel: () => null, AppearancePanel: () => null, VoicePanel: () => null, PrivacyPanel: () => null,
  ConnectionsPanel: () => null, KeybindsPanel: () => null, DesktopPanel: () => null, DesktopDownloadPanel: () => null,
  BotsPanel: () => null, DeveloperPanel: () => null }));
import { MobileSettingsScreen } from '../layout/MobileSettingsScreen';
import { MobileYouScreen } from '../layout/MobileYouScreen';
import { MobileInstancePanel } from '../layout/MobileInstancePanel';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { junoUser } from '../games/junoTestFixtures';
beforeEach(() => { useAuthStore.setState({ user: { ...junoUser('native'), username: 'native@retained.test', isAdmin: true } });
  useSettingsStore.setState({ fetchInstanceSettings: vi.fn().mockResolvedValue(undefined) }); });
afterEach(cleanup);
describe('standalone settings surfaces', () => {
  it('keeps native mobile settings without a Connections entry', () => {
    render(<MobileSettingsScreen />);
    expect(screen.queryByText('Connections')).toBeNull(); expect(screen.getByText('Voice & Video')).toBeInTheDocument();
  });
  it('shows retained handles verbatim on You, not as a home-server badge', () => {
    render(<MobileYouScreen />);
    expect(screen.getByText('@native@retained.test')).toBeInTheDocument();
    expect(screen.queryByText('Connections')).toBeNull();
    expect(screen.queryByText(/Home instance|From retained.test/)).toBeNull();
  });
  it('keeps native admin sections without a Federation entry or pending approval store', () => {
    render(<MemoryRouter><MobileInstancePanel /></MemoryRouter>);
    expect(screen.queryByText('Federation')).toBeNull();
    for (const title of ['General', 'Registration', 'Streaming', 'Storage', 'Users', 'Updates']) expect(screen.getByText(title)).toBeInTheDocument();
  });
});
