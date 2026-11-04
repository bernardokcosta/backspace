import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { User } from '@backspace/shared';

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
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    dm: {
      spaceInvite: (...args: unknown[]) => mockSpaceInvite(...args),
    },
  },
}));

import { InviteFriendModal } from './InviteFriendModal';
import { useUIStore } from '../../stores/uiStore';
import { useSpaceStore, type TaggedSpace } from '../../stores/spaceStore';
import { useAuthStore } from '../../stores/authStore';
import type { TaggedFriend } from '../../stores/socialStore';

function makeFriend(overrides: Partial<TaggedFriend> = {}): TaggedFriend {
  return {
    id: 'f1',
    username: 'alex',
    displayName: 'Alex',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    customStatus: null,
    status: 'online' as const,
    createdAt: 0,
    addedAt: 0,
    homeUserId: null,
    homeInstance: null,
    _instanceOrigin: '',
    ...overrides,
  };
}

function makeSpace(overrides: Partial<TaggedSpace> = {}): TaggedSpace {
  return {
    id: 'space-1',
    name: 'My Space',
    icon: null,
    banner: null,
    avatarColor: null,
    ownerId: 'owner-1',
    ownerTitle: null,
    inviteCode: null,
    description: '',
    visibility: 'private',
    createdAt: 0,
    _instanceOrigin: '',
    ...overrides,
  };
}

function me(id = 'me'): User {
  return { ...makeFriend({ id, username: id }), isAdmin: false, replicatedInstances: [] };
}

function setUp({
  friend = makeFriend(),
  spaces = [makeSpace()],
  generateInvite = vi.fn().mockResolvedValue('test-code'),
}: {
  friend?: TaggedFriend;
  spaces?: TaggedSpace[];
  generateInvite?: ReturnType<typeof vi.fn>;
} = {}) {
  useUIStore.setState({ activeModal: 'inviteFriend', modalData: { friend } });
  useSpaceStore.setState({ spaces, generateInvite });
  useAuthStore.setState({ user: me(), token: 'session-me' });
  return { generateInvite };
}

beforeEach(() => {
  mockSpaceInvite.mockReset();
  useUIStore.setState({ activeModal: null, modalData: {} });
  useSpaceStore.setState({ spaces: [] });
  useAuthStore.setState({ user: null, token: null });
});

describe('InviteFriendModal', () => {
  it('does not render when a different modal is active', () => {
    useUIStore.setState({ activeModal: 'invite', modalData: {} });
    render(<InviteFriendModal />);
    expect(screen.queryByText('My Space')).not.toBeInTheDocument();
  });

  it('lists the user\'s spaces under a friend-named title', () => {
    setUp();
    render(<InviteFriendModal />);
    expect(screen.getByText('Invite Alex to a Space')).toBeInTheDocument();
    expect(screen.getByText('My Space')).toBeInTheDocument();
  });

  it('clicking a space generates its invite and sends it to the friend', async () => {
    const user = userEvent.setup();
    mockSpaceInvite.mockResolvedValue({});
    const { generateInvite } = setUp({
      spaces: [makeSpace({ id: 'space-1', name: 'My Space' })],
    });

    render(<InviteFriendModal />);
    await user.click(screen.getByText('My Space'));

    await waitFor(() => expect(mockSpaceInvite).toHaveBeenCalledTimes(1));
    expect(generateInvite).toHaveBeenCalledWith('space-1', '');
    expect(mockSpaceInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        inviteCode: 'test-code',
        target: { userId: 'f1' },
      }),
    );
    expect(await screen.findByText('✓ Sent')).toBeInTheDocument();
  });

  it('surfaces a per-row reason when the send fails', async () => {
    const user = userEvent.setup();
    const { HttpError } = await import('../../api/client');
    mockSpaceInvite.mockRejectedValue(
      new HttpError(400, 'Not a friend', { error: 'Not a friend', code: 'not_a_friend', statusCode: 400 }, 'not_a_friend'),
    );
    setUp();

    render(<InviteFriendModal />);
    await user.click(screen.getByText('My Space'));

    expect(await screen.findByText('Not a friend')).toBeInTheDocument();
  });

  it('shows an empty state when the user has no spaces', () => {
    setUp({ spaces: [] });
    render(<InviteFriendModal />);
    expect(screen.getByText('You’re not in any Spaces yet')).toBeInTheDocument();
  });

  it('generates the selected origin even when another space has the same id', async () => {
    const { generateInvite } = setUp({ spaces: [makeSpace({ name: 'Local' }),
      makeSpace({ name: 'Remote', _instanceOrigin: 'https://remote.example' })] });
    mockSpaceInvite.mockResolvedValue({});
    render(<InviteFriendModal />);
    await userEvent.click(screen.getByText('Remote'));
    expect(generateInvite).toHaveBeenCalledWith('space-1', 'https://remote.example');
    expect(mockSpaceInvite).toHaveBeenCalledWith(expect.objectContaining({ spaceInstanceOrigin: 'https://remote.example' }));
  });

  it.each(['close', 'recipient', 'account', 'token', 'unmount'] as const)('does not send after %s changes during code lookup', async change => {
    let finish!: (code: string) => void;
    setUp({ generateInvite: vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; })) });
    const view = render(<InviteFriendModal />);
    await userEvent.click(screen.getByText('My Space'));
    act(() => {
      if (change === 'close') useUIStore.getState().closeModal();
      if (change === 'recipient') useUIStore.getState().openModal('inviteFriend', { friend: makeFriend({ id: 'bob', displayName: 'Bob' }) });
      if (change === 'account') useAuthStore.setState({ user: me('other'), token: 'other-session' });
      if (change === 'token') useAuthStore.setState({ token: 'replaced-session' });
      if (change === 'unmount') view.unmount();
    });
    await act(async () => { finish('old-code'); });
    expect(mockSpaceInvite).not.toHaveBeenCalled();
  });

  it('does not apply an old send result to a different recipient', async () => {
    let finish!: () => void;
    mockSpaceInvite.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    setUp();
    render(<InviteFriendModal />);
    await userEvent.click(screen.getByText('My Space'));
    await waitFor(() => expect(mockSpaceInvite).toHaveBeenCalledOnce());
    act(() => { useUIStore.getState().openModal('inviteFriend', { friend: makeFriend({ id: 'bob', displayName: 'Bob' }) }); });
    await act(async () => { finish(); });
    expect(screen.getByText('Invite Bob to a Space')).toBeInTheDocument();
    expect(screen.queryByText('✓ Sent')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Space/ })).toBeEnabled();
  });

  it('does not generate or send twice for two clicks before React commits pending state', async () => {
    let finish!: (code: string) => void;
    const { generateInvite } = setUp({ generateInvite: vi.fn().mockReturnValue(new Promise<string>(resolve => { finish = resolve; })) });
    mockSpaceInvite.mockResolvedValue({});
    render(<InviteFriendModal />);
    const button = screen.getByRole('button', { name: /My Space/ });
    act(() => { button.click(); button.click(); });
    expect(generateInvite).toHaveBeenCalledOnce();
    await act(async () => { finish('code'); });
    expect(mockSpaceInvite).toHaveBeenCalledOnce();
  });
});
