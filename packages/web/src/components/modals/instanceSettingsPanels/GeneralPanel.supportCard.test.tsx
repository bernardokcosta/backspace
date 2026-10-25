import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
const { invalidateHomeInstanceInfo } = vi.hoisted(() => ({ invalidateHomeInstanceInfo: vi.fn() }));
vi.mock('../../../hooks/useHomeInstanceInfo', () => ({ invalidateHomeInstanceInfo, useHomeInstanceInfo: () => null }));
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { InstanceAdminSettings, InstanceInfoResponse } from '@backspace/shared';
import { MemoryRouter } from 'react-router-dom';
import { GeneralPanel } from './GeneralPanel';
import { api } from '../../../api/client';
import { useSettingsStore } from '../../../stores/settingsStore';

const base: InstanceAdminSettings = {
  instanceName: 'Workbench', registrationOpen: true, federatedRegistrationOpen: true,
  discoveryEnabled: true, maxUploadSizeMb: 100, maxStickerSizeMb: 8, federationRelayEnabled: true,
  federationRelayTtlDays: 30, defaultAutoRotateIntervalDays: 90, autoAcceptPeering: true,
  directoryEnabled: false, directoryBrowseEnabled: true, directoryLastPingAt: null,
  directoryLastError: null, directoryListedSpaceCount: 1,
};

function seed() {
  const update = vi.fn().mockResolvedValue(undefined);
  useSettingsStore.setState({ instanceSettings: base, updateInstanceSettings: update });
  return update;
}
function renderPanel() { return render(<MemoryRouter><GeneralPanel /></MemoryRouter>); }
async function editName() { await userEvent.type(screen.getByDisplayValue('Workbench'), ' renamed'); }

beforeEach(() => {
  vi.spyOn(api.instance, 'info').mockReturnValue(new Promise<InstanceInfoResponse>(() => {}));
  useSettingsStore.setState({ instanceSettings: null, fetchInstanceSettings: vi.fn().mockResolvedValue(undefined) });
  invalidateHomeInstanceInfo.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('GeneralPanel after hub retirement', () => {
  it('has no Support card switch or section', () => {
    seed(); renderPanel();
    expect(screen.queryByRole('switch', { name: 'Show the Support card' })).toBeNull();
    expect(screen.queryByText('Backspace page')).toBeNull();
  });

  it('keeps retained draft changes local until save and never sends the retired field', async () => {
    const update = seed(); renderPanel();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    await editName();
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ instanceName: 'Workbench renamed' }));
    expect(update.mock.calls[0]?.[0]).not.toHaveProperty('supportCardEnabled');
    await waitFor(() => expect(invalidateHomeInstanceInfo).toHaveBeenCalledTimes(1));
  });

  it('leaves shared instance info alone when saving fails', async () => {
    const update = seed(); update.mockRejectedValue(new Error('server said no')); renderPanel();
    await editName();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(invalidateHomeInstanceInfo).not.toHaveBeenCalled();
  });
});
