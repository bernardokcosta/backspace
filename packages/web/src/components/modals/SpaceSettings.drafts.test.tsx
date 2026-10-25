import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: vi.fn(() => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() })) } }));
import { AccessPanel } from './SpaceSettings';
import { OverviewPanel } from './spaceSettingsPanels/OverviewPanel';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';

const initial: TaggedSpace = {
  id: 'draft-space', name: 'Retained', icon: null, banner: null, avatarColor: null,
  ownerId: 'owner', ownerTitle: null, inviteCode: 'invite', visibility: 'private',
  description: 'Old description', createdAt: 1, _instanceOrigin: '',
};
let serverSpace: TaggedSpace;
beforeEach(() => {
  serverSpace = { ...initial };
  useSpaceStore.setState({ spaces: [{ ...initial }], spacePermissions: new Map([[initial.id, '-1']]), members: [] });
  // Real panels, store action and API client: mock only the HTTP transport.
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'PATCH') throw new Error('Unexpected request');
    serverSpace = { ...serverSpace, ...JSON.parse(String(init.body)) };
    return new Response(JSON.stringify(serverSpace), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });
function renderPanels() {
  render(<MemoryRouter>
    <div data-testid="overview"><OverviewPanel spaceId={initial.id} /></div>
    <div data-testid="access"><AccessPanel spaceId={initial.id} /></div>
  </MemoryRouter>);
  return { overview: within(screen.getByTestId('overview')), access: within(screen.getByTestId('access')) };
}

describe('co-mounted Overview and Access drafts', () => {
  it('keeps pending description and visibility when the name is saved, then saves the retained draft', async () => {
    const { overview, access } = renderPanels();
    const description = access.getByRole('textbox');
    await userEvent.type(description, ' pending');
    fireEvent.click(access.getByRole('radio', { name: /Public/ }));
    await userEvent.type(overview.getByDisplayValue('Retained'), ' renamed');
    await userEvent.click(overview.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(useSpaceStore.getState().spaces[0]?.name).toBe('Retained renamed'));
    expect(overview.queryByRole('button', { name: 'Save', exact: true })).toBeNull();
    expect(description).toHaveValue('Old description pending');
    expect(access.getByRole('radio', { name: /Public/ })).toBeChecked();
    await userEvent.click(access.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(access.queryByRole('button', { name: 'Save', exact: true })).toBeNull());
    expect(serverSpace).toMatchObject({ name: 'Retained renamed', visibility: 'public', description: 'Old description pending' });
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { name: 'Retained renamed' }, { visibility: 'public', description: 'Old description pending' },
    ]);
  });

  it('keeps a pending name when access is saved, then resets access to its own latest server values', async () => {
    const { overview, access } = renderPanels();
    const name = overview.getByDisplayValue('Retained');
    await userEvent.type(name, ' pending');
    await userEvent.type(access.getByRole('textbox'), ' saved');
    fireEvent.click(access.getByRole('radio', { name: /Public/ }));
    await userEvent.click(access.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(useSpaceStore.getState().spaces[0]?.description).toBe('Old description saved'));
    expect(name).toHaveValue('Retained pending');
    expect(overview.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await userEvent.type(access.getByRole('textbox'), ' unsaved');
    fireEvent.click(access.getByRole('radio', { name: /Private/ }));
    await userEvent.click(access.getByRole('button', { name: 'Reset', exact: true }));
    expect(access.getByRole('textbox')).toHaveValue('Old description saved');
    expect(access.getByRole('radio', { name: /Public/ })).toBeChecked();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
