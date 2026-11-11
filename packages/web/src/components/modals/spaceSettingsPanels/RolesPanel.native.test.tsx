import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, Space } from '@veyvox/shared';
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { RolesPanel } from './RolesPanel';
import { useSpaceStore } from '../../../stores/spaceStore';
import { useAuthStore } from '../../../stores/authStore';
import { api } from '../../../api/client';
import { junoUser } from '../../games/junoTestFixtures';
const space = { id: 'space', name: 'Space', ownerId: 'owner' } as Space;
const role: Role = { id: 'r', spaceId: 'space', name: 'Helpers', color: '#c4b5fd', permissions: '0', position: 1, createdAt: 1 };
const created = { ...role, id: 'new', name: 'new role' };
const reload = vi.fn(async () => undefined);
beforeEach(() => {
  vi.restoreAllMocks(); reload.mockClear();
  useAuthStore.setState({ user: junoUser('owner') });
  useSpaceStore.setState({ currentSpaceId: space.id, spaces: [space], roles: [role], members: [], loadSpaceDetail: reload });
  vi.spyOn(api.roles, 'create').mockImplementation(async (_id, body) => {
    const row = { ...created, name: body.name };
    useSpaceStore.setState(s => ({ roles: [...s.roles, row] })); return row;
  });
  vi.spyOn(api.roles, 'update').mockResolvedValue(role);
  vi.spyOn(api.roles, 'delete').mockResolvedValue({ success: true });
});
afterEach(cleanup);
describe('native role editing endpoints', () => {
  it('creates a role through the current API and opens the confirmed role', async () => {
    render(<RolesPanel spaceId={space.id} />); fireEvent.click(screen.getByText('Create Role'));
    await waitFor(() => expect(api.roles.create).toHaveBeenCalledExactlyOnceWith(space.id, { name: 'new role' }));
    expect(await screen.findByDisplayValue('new role')).toBeInTheDocument();
  });
  it('saves a native role ID without an origin resolver', async () => {
    render(<RolesPanel spaceId={space.id} />); fireEvent.click(screen.getByRole('button', { name: 'Helpers' }));
    fireEvent.change(screen.getByDisplayValue('Helpers'), { target: { value: 'Greeters' } }); fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(api.roles.update).toHaveBeenCalledWith(space.id, role.id, { name: 'Greeters' }));
  });
  it('copies the selected native role and opens its returned ID', async () => {
    render(<RolesPanel spaceId={space.id} />); fireEvent.click(screen.getByRole('button', { name: 'Helpers' })); fireEvent.click(screen.getByText('Copy Role'));
    await waitFor(() => expect(api.roles.create).toHaveBeenCalledWith(space.id, expect.objectContaining({ name: 'Copy of Helpers' })));
    expect(await screen.findByDisplayValue('Copy of Helpers')).toBeInTheDocument();
  });
  it('deletes only after native confirmation', async () => {
    render(<RolesPanel spaceId={space.id} />); fireEvent.click(screen.getByRole('button', { name: 'Helpers' })); fireEvent.click(screen.getByText('Delete Role'));
    expect(api.roles.delete).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Confirm?'));
    await waitFor(() => expect(api.roles.delete).toHaveBeenCalledExactlyOnceWith(space.id, role.id));
  });
  it('does not reload or enter an old newly-created role after a session change', async () => {
    let finish!: (row: Role) => void;
    vi.mocked(api.roles.create).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<RolesPanel spaceId={space.id} />); fireEvent.click(screen.getByText('Create Role'));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish(created)); expect(reload).not.toHaveBeenCalled(); expect(screen.queryByDisplayValue('new role')).toBeNull();
  });
});
