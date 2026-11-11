import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MemberWithUser, Role, User } from '@veyvox/shared';

// Reached transitively via spaceStore -> chatStore -> useWebSocket -> voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }),
  },
}));
const usersGet = vi.fn();
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    users: { get: (...args: unknown[]) => usersGet(...args), getMutuals: vi.fn().mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }) },
    uploads: { url: (k: string) => `/uploads/${k}` },
  },
}));

import { UserProfileModal } from './UserProfileModal';
import { useSpaceStore, type SpaceWithMyRoles } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';

// #302: the full profile lists the member's roles in the space it was opened
// from. On mobile it is opened with ids only, so it takes the member's user
// from the native roster rather than issuing an unnecessary profile request.

const SPACE_ID = 'space-1';
const SPACE: SpaceWithMyRoles = {
  id: SPACE_ID, name: 'Aether Drift', icon: null, banner: null, avatarColor: 'lavender',
  ownerId: 'u-owner', inviteCode: null, visibility: 'public',
  description: '', createdAt: 1,
};

const MIRA: User = {
  id: 'orbit-mira', username: 'mira', displayName: 'Mira', avatar: null, banner: null,
  accentColor: null, avatarColor: null, bio: null, status: 'offline', customStatus: null,
  isAdmin: false, createdAt: 1,
};

const MODS: Role = { id: 'r-mod', spaceId: SPACE_ID, name: 'Moderators', color: '#c4b5fd', position: 3, createdAt: 1 };

const MEMBER: MemberWithUser = {
  spaceId: SPACE_ID, userId: MIRA.id, nickname: null, joinedAt: 1, user: MIRA, roles: [MODS],
};

beforeEach(() => {
  usersGet.mockReset();
  useSpaceStore.setState({ spaces: [SPACE], currentSpaceId: SPACE_ID, members: [MEMBER] });
});

describe('UserProfileModal: roles (#302)', () => {
  it('lists the native member roles from an ID-only open without another lookup', async () => {
    useUIStore.setState({
      activeModal: 'userProfile',
      modalData: { userId: MIRA.id, member: { spaceId: SPACE_ID, userId: MIRA.id } },
    });
    render(<MemoryRouter><UserProfileModal /></MemoryRouter>);

    const list = await screen.findByRole('list', { name: 'Roles' });
    expect(within(list).getByText('Moderators')).toBeInTheDocument();
    expect(usersGet).not.toHaveBeenCalled();
  });

  it('has no roles section without a member context', async () => {
    useUIStore.setState({ activeModal: 'userProfile', modalData: { userId: MIRA.id, user: MIRA, origin: '' } });
    render(<MemoryRouter><UserProfileModal /></MemoryRouter>);
    expect(await screen.findAllByText('Mira')).not.toHaveLength(0);
    expect(screen.queryByRole('list', { name: 'Roles' })).toBeNull();
  });
});
