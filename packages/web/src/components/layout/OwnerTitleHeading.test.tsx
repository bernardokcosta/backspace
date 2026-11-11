import type { SpaceWithChannelsAndMembers, User } from '@veyvox/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));

import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore, type SpaceWithMyRoles } from '../../stores/spaceStore';
import { OwnerTitleHeading } from './OwnerTitleHeading';

const space: SpaceWithMyRoles = {
  id: 'space', name: 'Space', icon: null, banner: null, avatarColor: null,
  ownerId: 'owner', ownerTitle: null, inviteCode: null, visibility: 'private',
  description: null, createdAt: 1,
};
const user: User = {
  id: 'owner', username: 'owner', displayName: null, avatar: null, banner: null,
  accentColor: null, avatarColor: null, bio: null, status: 'online', customStatus: null,
  isAdmin: false, createdAt: 1,
};

function Heading() {
  const current = useSpaceStore((s) => s.spaces[0]!);
  return <OwnerTitleHeading key={current.id} space={current} count={1} />;
}

beforeEach(() => {
  vi.restoreAllMocks();
  useSpaceStore.getState().reset();
  useSpaceStore.setState({ spaces: [{ ...space }] });
  useAuthStore.setState({ user });
});

describe('owner title heading', () => {
  it('shows the default heading and makes the editor available to the owner', async () => {
    render(<Heading />);
    expect(screen.getByRole('heading', { name: 'Owner — 1' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    expect(screen.getByLabelText('Owner title')).toHaveValue('');
    // Reset shows only while a title is set, as in the nickname dialog.
    expect(screen.queryByRole('button', { name: 'Reset to default' })).not.toBeInTheDocument();
  });

  it('saves through the API and displays only the confirmed server response', async () => {
    let confirm!: (value: SpaceWithMyRoles) => void;
    const update = vi.spyOn(api.spaces, 'update').mockReturnValue(new Promise((resolve) => { confirm = resolve; }));
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), '  首席摸鱼官  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).toHaveBeenCalledWith('space', { ownerTitle: '首席摸鱼官' });
    expect(screen.getByRole('heading', { name: 'Owner — 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await act(async () => confirm({ ...space, ownerTitle: '首席摸鱼官' }));
    expect(screen.getByRole('heading', { name: '首席摸鱼官 — 1' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Owner title')).not.toBeInTheDocument();
  });

  it('exposes failed writes without silently changing or closing the editor', async () => {
    vi.spyOn(api.spaces, 'update').mockRejectedValue(new Error('Database is unavailable'));
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), 'Captain');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is unavailable');
    expect(screen.getByLabelText('Owner title')).toHaveValue('Captain');
    expect(screen.getByRole('heading', { name: 'Owner — 1' })).toBeInTheDocument();
  });

  it('closes without a write when the title is unchanged', async () => {
    useSpaceStore.setState({ spaces: [{ ...space, ownerTitle: 'Captain' }] });
    const update = vi.spyOn(api.spaces, 'update');
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), '  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Owner title')).not.toBeInTheDocument();
  });

  it('does not save when cancelled', async () => {
    const update = vi.spyOn(api.spaces, 'update');
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), 'Captain');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(update).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Owner title')).not.toBeInTheDocument();
  });

  it('rejects whitespace instead of silently restoring the default', async () => {
    const update = vi.spyOn(api.spaces, 'update');
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('1 to 32');
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses a title the server would refuse, such as one with only invisible characters', async () => {
    const update = vi.spyOn(api.spaces, 'update');
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.type(screen.getByLabelText('Owner title'), '\u200B\u200B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least one visible character');
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves custom capitalization for viewers and hides editing from non-owners', () => {
    useAuthStore.setState({ user: { ...user, id: 'member', isAdmin: true } });
    useSpaceStore.setState({ spaces: [{ ...space, ownerTitle: 'Captain Ada' }] });
    render(<Heading />);
    expect(screen.getByRole('heading', { name: 'Captain Ada — 1' })).not.toHaveClass('uppercase');
    expect(screen.queryByRole('button', { name: 'Edit owner title' })).not.toBeInTheDocument();
  });

  it('resets the persisted title explicitly', async () => {
    useSpaceStore.setState({ spaces: [{ ...space, ownerTitle: 'Captain' }] });
    const update = vi.spyOn(api.spaces, 'update').mockResolvedValue({ ...space });
    render(<Heading />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit owner title' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    expect(update).toHaveBeenCalledWith('space', { ownerTitle: null });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Owner — 1' })).toBeInTheDocument());
  });

  it('uses the native owner ID even with a retained @ handle', () => {
    useAuthStore.setState({ user: { ...user, username: 'owner@retained.test' } });
    render(<Heading />);
    expect(screen.getByRole('button', { name: 'Edit owner title' })).toBeInTheDocument();
  });

  it('reacts to an authoritative native ownership transfer without remounting', async () => {
    useSpaceStore.setState({ spaces: [{ ...space, ownerId: 'other-owner' }] });
    render(<Heading />);
    expect(screen.queryByRole('button', { name: 'Edit owner title' })).not.toBeInTheDocument();
    act(() => useSpaceStore.setState({ spaces: [{ ...space, ownerId: user.id }] }));
    expect(await screen.findByRole('button', { name: 'Edit owner title' })).toBeInTheDocument();
  });

  it('uses the default heading when the optional title is absent without a peer-version gate', () => {
    const untitled: SpaceWithMyRoles = { ...space };
    delete untitled.ownerTitle;
    useSpaceStore.setState({ spaces: [untitled] });
    render(<Heading />);
    expect(screen.getByRole('heading', { name: 'Owner — 1' })).toHaveClass('uppercase');
    expect(screen.getByRole('button', { name: 'Edit owner title' })).toBeInTheDocument();
  });

  it('retains the native title from ready and newly joined space payloads', () => {
    const detail: SpaceWithChannelsAndMembers = { ...space, ownerTitle: '首席摸鱼官', channels: [], categories: [], members: [], roles: [], myPermissions: '0' };
    useSpaceStore.getState().populateFromReady([detail]);
    expect(useSpaceStore.getState().spaces.find((s) => s.id === space.id)?.ownerTitle).toBe('首席摸鱼官');
    useSpaceStore.getState().addSpaceFromReady({ ...detail, id: 'joined', ownerTitle: 'Captain' });
    expect(useSpaceStore.getState().spaces.find((s) => s.id === 'joined')?.ownerTitle).toBe('Captain');
  });
});
