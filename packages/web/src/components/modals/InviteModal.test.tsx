import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Friend, MemberWithUser, User } from '@veyvox/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom.
// Reached transitively via spaceStore → chatStore → useWebSocket → voiceStore.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

// Mock the API client so we can assert spaceInvite calls.
const mockSpaceInvite = vi.fn();
vi.mock('../../api/client', async (importOriginal) => ({
  // Keep the real exports (HttpError is what describeError inspects) and
  // replace only the api surface this test asserts on.
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    dm: {
      spaceInvite: (...args: unknown[]) => mockSpaceInvite(...args),
    },
  },
}));

import { InviteModal } from './InviteModal';
import { HttpError } from '../../api/client';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore, type SpaceWithMyRoles } from '../../stores/spaceStore';
import { useSocialStore } from '../../stores/socialStore';
import { useAuthStore } from '../../stores/authStore';
import { junoUser } from '../games/junoTestFixtures';

// Helpers — minimal fixtures for store state.
function makeFriend(overrides: Partial<Friend> = {}): Friend {
  return {
    id: 'friend-1',
    username: 'alex',
    displayName: 'Alex',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online' as const,
    customStatus: null,
    createdAt: 0,
    addedAt: 0,
    ...overrides,
  };
}

function makeMember(overrides: Omit<Partial<MemberWithUser>, 'user'> & { user?: Partial<User> } = {}): MemberWithUser {
  return {
    spaceId: 'space-1',
    userId: 'member-1',
    nickname: null,
    joinedAt: 0,
    roles: [],
    ...overrides,
    user: {
      id: 'member-1',
      username: 'memberA',
      displayName: null,
      avatar: null,
      banner: null,
      accentColor: null,
      avatarColor: null,
      bio: null,
      status: 'offline',
      customStatus: null,
      isAdmin: false,
      createdAt: 0,
      ...(overrides.user ?? {}),
    },
  };
}

function makeSpace(overrides: Partial<SpaceWithMyRoles> = {}): SpaceWithMyRoles {
  return {
    id: 'space-1',
    name: 'Test Space',
    icon: null,
    avatarColor: null,
    description: null,
    ownerId: 'owner-1',
    visibility: 'private',
    banner: null,
    inviteCode: null,
    createdAt: 0,
    ...overrides,
  };
}

function setUpStore({
  friends = [],
  members = [],
  myUser = { id: 'me', username: 'me' },
  generateInvite = vi.fn().mockResolvedValue('test-code'),
}: {
  friends?: Friend[];
  members?: MemberWithUser[];
  myUser?: Pick<User, 'id' | 'username'> & Partial<User>;
  generateInvite?: ReturnType<typeof vi.fn>;
} = {}) {
  useUIStore.setState({ activeModal: 'invite', modalData: {} });
  useSpaceStore.setState({
    currentSpaceId: 'space-1',
    spaces: [makeSpace()],
    members,
    generateInvite,
  });
  useSocialStore.setState({ friends });
  useAuthStore.setState({ user: { ...junoUser(myUser.id), ...myUser } });
  return { generateInvite };
}

beforeEach(() => {
  mockSpaceInvite.mockReset();

  useUIStore.setState({ activeModal: null, modalData: {} });
  useSpaceStore.setState({
    currentSpaceId: null,
    spaces: [],
    members: [],
  });
  useSocialStore.setState({ friends: [] });
  useAuthStore.setState({ user: null });

  // Mock clipboard.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});

describe('InviteModal', () => {
  it('does not render when activeModal is not "invite"', () => {
    render(<InviteModal />);
    expect(screen.queryByText('Invite Friends')).not.toBeInTheDocument();
  });

  it('renders friend list, excluding self', async () => {
    setUpStore({
      friends: [
        makeFriend({ id: 'me', username: 'me', displayName: 'Me' }),
        makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' }),
        makeFriend({ id: 'f2', username: 'sam', displayName: 'Sam' }),
      ],
      myUser: { id: 'me', username: 'me' },
    });

    render(<InviteModal />);

    expect(screen.getByText('Invite Friends')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });
    expect(screen.getByText('Sam')).toBeInTheDocument();
    // Self is filtered out.
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('grays out friends already in the native space by exact account ID', async () => {
    setUpStore({
      friends: [
        makeFriend({
          id: 'native-friend',
          username: 'remoteFriend',
          displayName: 'Remote Friend',
        }),
      ],
      members: [
        makeMember({
          userId: 'native-friend',
          user: {
            id: 'native-friend',
            username: 'remoteFriend',
          },
        }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Already in space')).toBeInTheDocument();
    });

    // Clicking the disabled row does not select the friend.
    const button = screen.getByRole('button', { name: /Remote Friend/ });
    expect(button).toBeDisabled();
  });

  it('selecting friends and submitting calls api.dm.spaceInvite once per friend', async () => {
    const user = userEvent.setup();
    mockSpaceInvite.mockResolvedValue({});

    setUpStore({
      friends: [
        makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' }),
        makeFriend({ id: 'f2', username: 'sam', displayName: 'Sam' }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Alex/ }));
    await user.click(screen.getByRole('button', { name: /Sam/ }));

    const submit = screen.getByRole('button', { name: /Send 2 Invites/ });
    await user.click(submit);

    await waitFor(() => {
      expect(mockSpaceInvite).toHaveBeenCalledTimes(2);
    });
    expect(mockSpaceInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        inviteCode: 'test-code',
        target: { userId: 'f1' },
      }),
    );
    expect(mockSpaceInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        inviteCode: 'test-code',
        target: { userId: 'f2' },
      }),
    );
  });

  it('closes the modal after a fully successful send', async () => {
    const user = userEvent.setup();
    mockSpaceInvite.mockResolvedValue({});

    setUpStore({
      friends: [makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' })],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Alex/ }));
    await user.click(screen.getByRole('button', { name: /Send 1 Invite/ }));

    await waitFor(() => {
      expect(useUIStore.getState().activeModal).toBeNull();
    });
  });

  it('shows the results view with reason text on partial failure', async () => {
    const user = userEvent.setup();
    // f1 succeeds, f2 fails with `not_a_friend`.
    mockSpaceInvite.mockImplementation(({ target }: any) => {
      if (target.userId === 'f1') return Promise.resolve({});
      return Promise.reject(new HttpError(400, 'Not a friend', { error: 'Not a friend', code: 'not_a_friend', statusCode: 400 }, 'not_a_friend'));
    });

    setUpStore({
      friends: [
        makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' }),
        makeFriend({ id: 'f2', username: 'sam', displayName: 'Sam' }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Alex/ }));
    await user.click(screen.getByRole('button', { name: /Sam/ }));
    await user.click(screen.getByRole('button', { name: /Send 2 Invites/ }));

    await waitFor(() => {
      expect(screen.getByText('✓ Sent')).toBeInTheDocument();
    });
    expect(screen.getByText('✗ Not a friend')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry failed invites' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    // Modal must remain open while results are visible.
    expect(useUIStore.getState().activeModal).toBe('invite');
  });

  it('Retry failed re-runs only the failed subset', async () => {
    const user = userEvent.setup();
    mockSpaceInvite.mockImplementation(({ target }: any) => {
      if (target.userId === 'f1') return Promise.resolve({});
      return Promise.reject(new Error('upstream'));
    });

    setUpStore({
      friends: [
        makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' }),
        makeFriend({ id: 'f2', username: 'sam', displayName: 'Sam' }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Alex/ }));
    await user.click(screen.getByRole('button', { name: /Sam/ }));
    await user.click(screen.getByRole('button', { name: /Send 2 Invites/ }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry failed invites' })).toBeInTheDocument();
    });
    expect(mockSpaceInvite).toHaveBeenCalledTimes(2);

    // Second pass: Sam succeeds.
    mockSpaceInvite.mockReset();
    mockSpaceInvite.mockResolvedValue({});

    await user.click(screen.getByRole('button', { name: 'Retry failed invites' }));

    await waitFor(() => {
      expect(mockSpaceInvite).toHaveBeenCalledTimes(1);
    });
    expect(mockSpaceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ target: { userId: 'f2' } }),
    );
  });

  it('share-link footer shows the invite URL and Copy writes to clipboard', async () => {
    setUpStore({
      friends: [],
      generateInvite: vi.fn().mockResolvedValue('abc123'),
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByDisplayValue(/\/join\/abc123/)).toBeInTheDocument();
    });

    // Re-install clipboard spy after render. userEvent.setup() may have replaced
    // navigator.clipboard during initialization; we need a fresh spy that
    // matches what the component will call directly.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const copyBtn = screen.getByRole('button', { name: 'Copy' });
    copyBtn.click();

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('/join/abc123'),
      );
    });
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('Copy button is disabled while the invite code is loading', () => {
    setUpStore({
      friends: [],
      generateInvite: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    render(<InviteModal />);

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    expect(copyButton).toBeDisabled();
  });

  it('shows an error in the share-link footer when generateInvite fails', async () => {
    setUpStore({
      friends: [],
      generateInvite: vi.fn().mockRejectedValue(new Error('Not authorized')),
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Not authorized')).toBeInTheDocument();
    });
  });

  it('search filters the friend list', async () => {
    const user = userEvent.setup();
    setUpStore({
      friends: [
        makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' }),
        makeFriend({ id: 'f2', username: 'sam', displayName: 'Sam' }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Alex')).toBeInTheDocument();
    });

    const search = screen.getByPlaceholderText('Search friends...');
    await user.type(search, 'sam');

    await waitFor(() => {
      expect(screen.queryByText('Alex')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('offers the link and the friend list for a space joined by request, and says where the link leads', async () => {
    const user = userEvent.setup();
    const generateInvite = vi.fn().mockResolvedValue('req-code');
    mockSpaceInvite.mockResolvedValue({});
    useUIStore.setState({ activeModal: 'invite', modalData: {} });
    useSpaceStore.setState({
      currentSpaceId: 'space-1',
      spaces: [makeSpace({ visibility: 'request' })],
      members: [],
      generateInvite,
    });
    useSocialStore.setState({
      friends: [makeFriend({ id: 'f1', username: 'alex', displayName: 'Alex' })],
    });
    useAuthStore.setState({ user: junoUser('me') });

    render(<InviteModal />);

    expect(
      screen.getByText('Send to friends, or share a link. People who open it ask to join, and a manager approves each request.'),
    ).toBeInTheDocument();
    expect(generateInvite).toHaveBeenCalledWith('space-1');
    await waitFor(() => {
      expect(screen.getByDisplayValue(`${window.location.origin}/join/req-code`)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('Search friends...')).toBeInTheDocument();

    await user.click(screen.getByText('Alex'));
    await user.click(screen.getByRole('button', { name: /send 1 invite/i }));
    await waitFor(() => expect(mockSpaceInvite).toHaveBeenCalledTimes(1));
    expect(mockSpaceInvite.mock.calls[0][0]).toMatchObject({ spaceId: 'space-1', inviteCode: 'req-code' });
  });

  it('keeps the plain intro for a space that is not joined by request', async () => {
    setUpStore();
    render(<InviteModal />);
    expect(screen.getByText('Send to friends, or share a link.')).toBeInTheDocument();
    await screen.findByDisplayValue(/\/join\/test-code/);
  });

  it('ignores a stale code lookup after switching the source space', async () => {
    let oldCode!: (code: string) => void;
    setUpStore({ generateInvite: vi.fn().mockReturnValueOnce(new Promise<string>(resolve => { oldCode = resolve; }))
      .mockResolvedValueOnce('fresh-code') });
    render(<InviteModal />);
    act(() => {
      useSpaceStore.setState({ currentSpaceId: 'other-space', spaces: [makeSpace(), makeSpace({ id: 'other-space' })] });
    });
    await screen.findByDisplayValue(/\/join\/fresh-code/);
    await act(async () => { oldCode('stale-code'); });
    expect(screen.getByDisplayValue(/\/join\/fresh-code/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/\/join\/stale-code/)).not.toBeInTheDocument();
  });

  it('does not close a different modal when an old invitation send succeeds', async () => {
    let finish!: () => void;
    mockSpaceInvite.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    setUpStore({ friends: [makeFriend({ id: 'f1', displayName: 'Alex' })] });
    render(<InviteModal />);
    await screen.findByDisplayValue(/\/join\/test-code/);
    await userEvent.click(screen.getByText('Alex'));
    await userEvent.click(screen.getByRole('button', { name: /send 1 invite/i }));
    await waitFor(() => expect(mockSpaceInvite).toHaveBeenCalledOnce());
    act(() => { useUIStore.getState().openModal('userSettings'); });
    await act(async () => { finish(); });
    expect(useUIStore.getState().activeModal).toBe('userSettings');
  });

  it('resets a canceled send when the account session changes without closing the modal', async () => {
    let finish!: () => void;
    mockSpaceInvite.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    setUpStore({ friends: [makeFriend({ id: 'f1', displayName: 'Alex' })] });
    render(<InviteModal />);
    await screen.findByDisplayValue(/\/join\/test-code/);
    await userEvent.click(screen.getByText('Alex'));
    await userEvent.click(screen.getByRole('button', { name: /send 1 invite/i }));
    await waitFor(() => expect(mockSpaceInvite).toHaveBeenCalledOnce());
    act(() => { useAuthStore.setState({ token: 'replacement-session' }); });
    await screen.findByDisplayValue(/\/join\/test-code/);
    expect(screen.getByRole('button', { name: /@alex/ })).toBeEnabled();
    await act(async () => { finish(); });
    expect(useUIStore.getState().activeModal).toBe('invite');
    expect(screen.queryByText('✓ Sent')).not.toBeInTheDocument();
  });

  it('names a retained @ handle by its native target ID', async () => {
    const user = userEvent.setup();
    mockSpaceInvite.mockResolvedValue({});

    setUpStore({
      friends: [
        makeFriend({
          id: 'native-alex',
          username: 'alex@retained.test',
          displayName: 'Remote Alex',
        }),
      ],
    });

    render(<InviteModal />);

    await waitFor(() => {
      expect(screen.getByText('Remote Alex')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /Remote Alex/ }));
    await user.click(screen.getByRole('button', { name: /Send 1 Invite/ }));

    await waitFor(() => {
      expect(mockSpaceInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { userId: 'native-alex' },
        }),
      );
    });
  });

  it('selects different native IDs independently even when their usernames match', async () => {
    const user = userEvent.setup();
    setUpStore({
      friends: [
        makeFriend({ id: 'dave', displayName: 'Dave' }),
        makeFriend({ id: 'erin', displayName: 'Erin' }),
      ],
    });

    render(<InviteModal />);
    await user.click(await screen.findByRole('button', { name: /Dave/ }));

    expect(screen.getByRole('button', { name: /Send 1 Invite/ })).toBeInTheDocument();
  });

});
