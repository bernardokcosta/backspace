import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../api/client';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useUIStore } from '../../../stores/uiStore';
import { RegistrationPanel } from './RegistrationPanel';

const BASE_SETTINGS = {
  instanceName: 'Backspace',
  registrationOpen: true,
  federatedRegistrationOpen: true,
  spaceCreationOpen: true,
  gifEnabled: false,
  maxUploadSizeMb: 50,
  maxStickerSizeMb: 2,
  federationRelayEnabled: true,
  federationRelayTtlDays: 7,
  defaultAutoRotateIntervalDays: 30,
  autoAcceptPeering: false,
};

describe('RegistrationPanel: Space Creation toggle', () => {
  const updateInstanceSettings = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.spyOn(api.invites, 'list').mockResolvedValue({ invites: [] });
    updateInstanceSettings.mockClear().mockResolvedValue(undefined);
    useSettingsStore.setState({
      instanceSettings: { ...BASE_SETTINGS },
      updateInstanceSettings,
    });
    useUIStore.setState({ toasts: [] });
  });

  it('renders the Space Creation toggle and saves spaceCreationOpen when toggled', async () => {
    render(<RegistrationPanel />);

    expect(screen.getByText('Space Creation')).toBeInTheDocument();
    expect(screen.getByText('Allow creating new spaces')).toBeInTheDocument();

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    expect(switches[2]).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(switches[2]!);
    expect(switches[2]).toHaveAttribute('aria-checked', 'false');

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateInstanceSettings).toHaveBeenCalledWith({
        registrationOpen: true,
        federatedRegistrationOpen: true,
        spaceCreationOpen: false,
      });
    });
  });
});
