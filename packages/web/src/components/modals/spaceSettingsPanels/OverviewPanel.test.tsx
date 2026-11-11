import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MemberWithUser, User } from '@veyvox/shared';

// Stub AudioManager to avoid an AudioWorkletNode reference error in jsdom.
// Reached transitively via spaceStore -> chatStore -> useWebSocket -> voiceStore.
vi.mock('../../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

import { OverviewPanel } from './OverviewPanel';
import { useSpaceStore, type SpaceWithMyRoles } from '../../../stores/spaceStore';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { api } from '../../../api/client';

const owner: User = {
  id: 'user-1',
  username: 'owner',
  displayName: 'Owner',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: 'lavender',
  bio: null,
  status: 'online',
  customStatus: null,
  isAdmin: false,
  createdAt: 1,
};

const other: User = { ...owner, id: 'user-2', username: 'member', displayName: 'Member' };

function member(user: User): MemberWithUser {
  return { spaceId: 'space-1', userId: user.id, nickname: null, joinedAt: 1, user, roles: [] };
}

const space: SpaceWithMyRoles = {
  id: 'space-1',
  name: 'Aether Drift',
  icon: null,
  banner: null,
  avatarColor: 'lavender',
  ownerId: 'user-1',
  inviteCode: null,
  visibility: 'public',
  description: '',
  createdAt: 1,
};

beforeEach(() => {
  vi.restoreAllMocks();
  useSpaceStore.setState({
    spaces: [space],
    members: [member(owner), member(other)],
    spacePermissions: new Map([['space-1', '-1']]),
  });
  useAuthStore.setState({ user: owner });
});

function renderPanel(): void {
  render(
    <MemoryRouter>
      <OverviewPanel spaceId="space-1" />
    </MemoryRouter>,
  );
}

/**
 * The panel guards on `if (!space) return null`, and that guard is reachable
 * while the panel stays mounted: the WebSocket handler calls removeSpace on
 * `member_banned`, and session reset drops its spaces. Neither closes the settings modal. While a hook sat
 * below the guard, that re-render called fewer hooks than the previous one and
 * React threw "Rendered fewer hooks than expected".
 */
describe('OverviewPanel when the space leaves the store', () => {
  it('survives removeSpace while it is mounted', () => {
    renderPanel();
    expect(screen.getByDisplayValue('Aether Drift')).toBeInTheDocument();

    expect(() => {
      act(() => {
        useSpaceStore.getState().removeSpace('space-1');
      });
    }).not.toThrow();

    expect(screen.queryByDisplayValue('Aether Drift')).not.toBeInTheDocument();
  });

  it('survives a native session reset while it is mounted', () => {
    renderPanel();
    expect(screen.getByDisplayValue('Aether Drift')).toBeInTheDocument();

    expect(() => {
      act(() => {
        useSpaceStore.getState().reset();
      });
    }).not.toThrow();

    expect(screen.queryByDisplayValue('Aether Drift')).not.toBeInTheDocument();
  });
});

describe('OverviewPanel ownership transfer candidates', () => {
  function openTransfer(): void {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer Ownership' }));
  }

  it('excludes the native owner even with a retained @ handle, but not a namesake', () => {
    const retained: User = { ...owner, username: 'owner@retained.test', displayName: 'Native Owner' };
    const cleo: User = { ...owner, id: 'different', username: 'owner@retained.test', displayName: 'Cleo' };
    useSpaceStore.setState({
      spaces: [space], members: [member(retained), member(cleo)],
    });
    useAuthStore.setState({ user: retained });
    openTransfer();

    expect(screen.getByText('Cleo')).toBeInTheDocument();
    expect(screen.queryByText('Native Owner')).not.toBeInTheDocument();
  });

  it('renders child sections before the Danger Zone', () => {
    render(
      <MemoryRouter>
        <OverviewPanel spaceId="space-1">
          <div data-testid="afk-section">AFK Channel</div>
        </OverviewPanel>
      </MemoryRouter>,
    );

    const afkSection = screen.getByTestId('afk-section');
    const transferButton = screen.getByRole('button', { name: 'Transfer Ownership' });
    expect(afkSection.compareDocumentPosition(transferButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leave out the session row on the page instance", () => {
    openTransfer();

    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByText('Owner')).not.toBeInTheDocument();
  });
  it('does not show a settings-save toast from a previous session', async () => {
    let finish!: (value: typeof space) => void;
    const toast = vi.spyOn(useUIStore.getState(), 'addToast').mockImplementation(() => {});
    vi.spyOn(api.spaces, 'update').mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    renderPanel(); fireEvent.change(screen.getByDisplayValue(space.name), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(api.spaces.update).toHaveBeenCalledOnce());
    act(() => { useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useSpaceStore.getState().reset(); useSpaceStore.setState({ spaces: [space] }); });
    await act(async () => finish({ ...space, name: 'New name' })); expect(toast).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(space.name)).toBeInTheDocument();
  });
});
