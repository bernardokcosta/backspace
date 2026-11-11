import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FriendsPage } from './FriendsPage';
import { useSocialStore } from '../../stores/socialStore';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useContextMenuStore } from '../../stores/contextMenuStore';
import type { Friend, FriendRequest } from '@veyvox/shared';
import { api as mockedApi } from '../../api/client';

// Mock the mascot animation hook
vi.mock('../../hooks/useMascotAnimation', () => ({
  useMascotAnimation: vi.fn(),
}));

// Stub AudioManager to avoid AudioWorkletNode reference error in jsdom
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: {
    getInstance: vi.fn().mockReturnValue({
      setOutputDevice: vi.fn(),
      setVolume: vi.fn(),
    }),
  },
}));

// Mock the api module
// Keep the real HttpError class: describeError narrows on it when a request fails.
vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  api: {
    dm: {
      create: vi.fn(),
    },
    social: {
      friends: vi.fn().mockResolvedValue([]),
      requests: vi.fn().mockResolvedValue([]),
      sendRequest: vi.fn().mockResolvedValue({ success: true }),
      updateRequest: vi.fn().mockResolvedValue({ success: true }),
      cancelRequest: vi.fn().mockResolvedValue({ success: true }),
      removeFriend: vi.fn().mockResolvedValue({ success: true }),
      search: vi.fn().mockResolvedValue([]),
      discover: vi.fn().mockResolvedValue({ users: [], total: 0 }),
    },
  },
}));

vi.mock('../../stores/discoverStore', () => ({
  useDiscoverStore: Object.assign(
    (selector: (s: any) => any) => selector({
      users: [],
      isLoading: false,
      searchQuery: '',
      setSearchQuery: vi.fn(),
      fetchUsers: vi.fn(),
      updateRelationship: vi.fn(),
    }),
    {
      getState: () => ({
        users: [],
        isLoading: false,
        searchQuery: '',
        fetchUsers: vi.fn(),
        updateRelationship: vi.fn(),
      }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

// Mock activityStore
vi.mock('../../stores/activityStore', () => ({
  useActivityStore: Object.assign(
    (selector: (s: any) => any) => selector({
      userActivities: new Map(),
    }),
    {
      getState: () => ({ userActivities: new Map(), reset: vi.fn() }),
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  ),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const makeFriend = (overrides: Partial<Friend> = {}): Friend => ({
  id: 'friend-1',
  username: 'testfriend',
  displayName: 'Test Friend',
  avatar: null,
  banner: null,
  accentColor: null,
  avatarColor: null,
  bio: null,
  status: 'online',
  customStatus: null,
  createdAt: Date.now(),
  addedAt: Date.now(),
  ...overrides,
});

const makeRequest = (overrides: Partial<FriendRequest> = {}): FriendRequest => ({
  id: 'req-1',
  fromId: 'other-user',
  toId: 'current-user',
  status: 'pending',
  createdAt: Date.now(),
  user: {
    id: 'other-user',
    username: 'otheruser',
    displayName: 'Other User',
    avatar: null,
    banner: null,
    accentColor: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: Date.now(),
  },
  ...overrides,
});

function renderFriendsPage() {
  return render(
    <MemoryRouter>
      <FriendsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: { ...makeFriend(), id: 'current-user', isAdmin: false } });
  mockNavigate.mockClear();
  // Reset the social store with no-op loaders (we set state directly)
  useSocialStore.setState({
    friends: [],
    requests: [],
    isLoading: false,
    error: null,
    loadFriends: vi.fn(),
    loadRequests: vi.fn(),
    searchUsers: vi.fn().mockResolvedValue([]),
  });
  useSpaceStore.setState({
    dmChannels: [],
    findExistingDmForUser: () => null,
  });
});

describe('FriendsPage', () => {
  it('opens the space invitation picker with the native friend', () => {
    const friend = makeFriend({ displayName: 'Invite Friend' });
    useUIStore.setState({ activeModal: null, modalData: {} });
    useContextMenuStore.getState().close();
    useSocialStore.setState({ friends: [friend] });
    renderFriendsPage();
    fireEvent.contextMenu(screen.getByText('Invite Friend'));
    const item = useContextMenuStore.getState().menu?.items.find(item => item.key === 'invite-to-server');
    expect(item?.type).toBe('action');
    if (item?.type !== 'action') throw new Error('missing invitation action');
    act(() => { item.onClick(); });
    expect(useUIStore.getState().activeModal).toBe('inviteFriend');
    expect(useUIStore.getState().modalData.friend).toBe(friend);
  });
  describe('Add Friend tab', () => {
    it('renders the search input when Add Friend tab is clicked', async () => {
      const user = userEvent.setup();
      renderFriendsPage();

      const addFriendTab = screen.getByText('Add Friend');
      await user.click(addFriendTab);

      expect(screen.getByPlaceholderText(/Search or add by username/)).toBeInTheDocument();
      expect(screen.getByText('Find People')).toBeInTheDocument();
    });

    it('shows Direct Add row and sends request for user@domain input', async () => {
      const user = userEvent.setup();
      const mockSendFriendRequest = vi.fn().mockResolvedValue('req-123');
      useSocialStore.setState({
        sendFriendRequest: mockSendFriendRequest,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));

      const input = screen.getByPlaceholderText(/Search or add by username/);
      await user.type(input, 'newbuddy@remote.example.com');

      // Direct Add row should appear
      expect(screen.getByText(/Send friend request to/)).toBeInTheDocument();

      // Click Send Request
      await user.click(screen.getByText('Send Request'));

      await waitFor(() => {
        expect(mockSendFriendRequest).toHaveBeenCalledWith({ username: 'newbuddy@remote.example.com' });
      });
    });

    it('sends a native search result handle exactly, including a retained @ suffix', async () => {
      const user = userEvent.setup();
      const mockSendFriendRequest = vi.fn().mockResolvedValue('req-9');
      const mockSearchUsers = vi.fn().mockResolvedValue([{
        id: 'alice-id', username: 'alice@orbit.test', displayName: 'Alice', avatar: null, banner: null,
        accentColor: null, avatarColor: null, bio: null, status: 'online', customStatus: null,
        isAdmin: false, createdAt: 0,
      }]);
      useSocialStore.setState({
        friends: [],
        requests: [],
        sendFriendRequest: mockSendFriendRequest,
        searchUsers: mockSearchUsers,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));
      await user.type(screen.getByPlaceholderText(/Search or add by username/), 'alice');
      await user.click(await screen.findByText('Send Friend Request'));

      await waitFor(() => {
        expect(mockSendFriendRequest).toHaveBeenCalledWith({
          username: 'alice@orbit.test',
        });
      });
    });

    it('shows toast when Direct Add request fails', async () => {
      const user = userEvent.setup();
      const mockSendFriendRequest = vi.fn().mockRejectedValue(new Error('User not found'));
      const mockAddToast = vi.fn();
      useSocialStore.setState({
        sendFriendRequest: mockSendFriendRequest,
      });
      useUIStore.setState({
        addToast: mockAddToast,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));

      const input = screen.getByPlaceholderText(/Search or add by username/);
      await user.type(input, 'ghost@remote.example.com');
      await user.click(screen.getByText('Send Request'));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('User not found', 'warning');
      });
    });

    it('shows the exact native username for direct add, without appending a host', async () => {
      const user = userEvent.setup();
      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));

      const input = screen.getByPlaceholderText(/Search or add by username/);
      await user.type(input, 'marc');

      expect(screen.getByText(/Send friend request to/)).toBeInTheDocument();
      expect(screen.getByText('marc')).toBeInTheDocument();
    });

    it('does not show Direct Add row for malformed @ shapes', async () => {
      const user = userEvent.setup();
      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));

      const input = screen.getByPlaceholderText(/Search or add by username/);

      // Lone @
      await user.type(input, '@');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      await user.clear(input);

      // Leading @ — only domain, no baseName
      await user.type(input, '@bob');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
      await user.clear(input);

      // Trailing @ — only baseName, no domain
      await user.type(input, 'bob@');
      expect(screen.queryByText(/Send friend request to/)).not.toBeInTheDocument();
    });

    describe('native search results and graph state', () => {
      const bobOnOrbit = {
        id: 'b-1', username: 'bob', displayName: 'Bob', avatar: null, banner: null, accentColor: null,
        avatarColor: null, bio: null, status: 'online' as const, customStatus: null, isAdmin: false, createdAt: 0,
      };
      const bobOnPage = { ...bobOnOrbit, username: 'bob@retained.test' };

      async function searchForBob() {
        const user = userEvent.setup();
        renderFriendsPage();
        await user.click(screen.getByText('Add Friend'));
        await user.type(screen.getByPlaceholderText(/Search or add by username/), 'bob');
        return user;
      }

      it('matches friendship by native ID even when the cached username changed', async () => {
        useSocialStore.setState({
          friends: [makeFriend({ ...bobOnPage, addedAt: 0 })],
          searchUsers: vi.fn().mockResolvedValue([bobOnOrbit]),
        });
        await searchForBob();
        expect(await screen.findByText('Message')).toBeInTheDocument();
      });

      it('accepts the native incoming request ID from a search card', async () => {
        const mockUpdate = vi.fn().mockResolvedValue(undefined);
        useSocialStore.setState({
          requests: [makeRequest({ id: 'r-bob-page', fromId: 'b-1', toId: 'current-user', user: bobOnPage })],
          searchUsers: vi.fn().mockResolvedValue([bobOnOrbit]),
          updateFriendRequest: mockUpdate,
        });
        const user = await searchForBob();
        await user.click(await screen.findByText('Accept'));
        await waitFor(() => {
          expect(mockUpdate).toHaveBeenCalledWith('r-bob-page', 'accepted');
        });
      });

      it('cancels a native pending request through the existing store', async () => {
        const mockCancel = vi.fn().mockResolvedValue(undefined);
        useSocialStore.setState({
          requests: [makeRequest({ id: 'r-bob-orbit', fromId: 'current-user', toId: 'b-1', user: bobOnOrbit })],
          searchUsers: vi.fn().mockResolvedValue([bobOnOrbit]),
          cancelFriendRequest: mockCancel,
        });
        const user = await searchForBob();
        await user.click(await screen.findByText('Request Pending'));
        await waitFor(() => {
          expect(mockCancel).toHaveBeenCalledWith('r-bob-orbit');
        });
        expect(mockedApi.social.cancelRequest).not.toHaveBeenCalled();
      });
    });

    it('calls searchUsers when typing a non-@ query', async () => {
      const user = userEvent.setup();
      const mockSearchUsers = vi.fn().mockResolvedValue([]);
      useSocialStore.setState({
        searchUsers: mockSearchUsers,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Add Friend'));

      const input = screen.getByPlaceholderText(/Search or add by username/);
      await user.type(input, 'marc');

      // Wait for debounce
      await waitFor(() => {
        expect(mockSearchUsers).toHaveBeenCalledWith('marc');
      }, { timeout: 500 });
    });
  });

  describe('DM button on friend item', () => {
    it('calls api.dm.create and navigates when clicking the Message button', async () => {
      const user = userEvent.setup();
      const friend = makeFriend({ id: 'friend-42', username: 'dmpal', displayName: 'DM Pal' });

      useSocialStore.setState({
        friends: [friend],
        requests: [],
      });
      useSpaceStore.getState().reset();
      useSpaceStore.setState({
        findExistingDmForUser: () => null,
      });

      // Mock the dm.create API
      const { api } = await import('../../api/client');
      (api.dm.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'dm-channel-99',
        createdAt: Date.now(),
        members: [],
      });

      renderFriendsPage();

      // Switch to "All" tab to see the friend
      await user.click(screen.getByText('All'));

      // Find the Message button by title
      const dmButton = screen.getByTitle('Message');
      await user.click(dmButton);

      await waitFor(() => {
        expect(api.dm.create).toHaveBeenCalledWith({ userId: 'friend-42' });
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/channels/@me/dm-channel-99');
      });
      expect(useSpaceStore.getState().dmChannels.map(d => d.id)).toEqual(['dm-channel-99']);
    });

    it('reuses an existing native pair instead of duplicating the DM', async () => {
      const user = userEvent.setup();
      const friend = makeFriend({ id: 'friend-42', username: 'dmpal', displayName: 'DM Pal' });
      useSocialStore.setState({ friends: [friend], requests: [] });
      useSpaceStore.getState().reset();
      const existing = { id: 'dm-existing', ownerId: null, createdAt: 1, members: [friend] };
      useSpaceStore.getState().upsertDmChannel(existing);
      useSpaceStore.setState({ findExistingDmForUser: () => existing });
      const { api } = await import('../../api/client');
      vi.mocked(api.dm.create).mockClear();

      renderFriendsPage();
      await user.click(screen.getByText('All'));
      await user.click(screen.getByTitle('Message'));

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/channels/@me/dm-existing');
      });
      expect(useSpaceStore.getState().dmChannels.map(d => d.id)).toEqual(['dm-existing']);
      expect(api.dm.create).not.toHaveBeenCalled();
    });
  });

  describe('Friend names', () => {
    it('names a friend with an empty display name by their username', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [makeFriend({ username: 'dmpal@orbit.test', displayName: '' })], requests: [] });
      renderFriendsPage();
      await user.click(screen.getByText('All'));
      expect(screen.getByText('dmpal@orbit.test')).toBeInTheDocument();
    });
  });

  describe('Message button failure', () => {
    it('tells the user why opening the DM failed', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [makeFriend({ id: 'friend-7' })], requests: [] });
      const addToast = vi.fn();
      useUIStore.setState({ addToast });
      const { api, HttpError } = await import('../../api/client');
      (api.dm.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new HttpError(404, 'User not found', null, 'user_not_found'));

      renderFriendsPage();
      await user.click(screen.getByText('All'));
      await user.click(screen.getByTitle('Message'));

      await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not open the conversation: No user with that name was found.', 'warning'));
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  describe('Cancel outgoing friend request', () => {
    it('calls cancelFriendRequest when clicking cancel on an outgoing request', async () => {
      const user = userEvent.setup();
      const mockCancel = vi.fn().mockResolvedValue(undefined);

      // Outgoing request: user.id === toId means current user sent it (fromId is current user, user is the recipient)
      const outgoingRequest = makeRequest({
        id: 'req-out-1',
        fromId: 'current-user',
        toId: 'other-user',
        user: {
          id: 'other-user',
          username: 'recipient',
          displayName: 'Recipient',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [outgoingRequest],
        cancelFriendRequest: mockCancel,
      });

      renderFriendsPage();

      // Switch to Pending tab
      await user.click(screen.getByText('Pending'));

      // Should see the outgoing request
      expect(screen.getByText('Outgoing Friend Request')).toBeInTheDocument();

      // Click the cancel button (the X icon button with title "Cancel Request")
      const cancelButton = screen.getByTitle('Cancel Request');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(mockCancel).toHaveBeenCalledWith('req-out-1');
      });
    });
  });

  describe('Accept/Decline incoming friend request', () => {
    it('calls updateFriendRequest with "accepted" when clicking accept', async () => {
      const user = userEvent.setup();
      const mockUpdate = vi.fn().mockResolvedValue(undefined);

      const incomingRequest = makeRequest({
        id: 'req-in-1',
        fromId: 'sender-id',
        toId: 'current-user',
        user: {
          id: 'sender-id',
          username: 'sender',
          displayName: 'Sender',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [incomingRequest],
        updateFriendRequest: mockUpdate,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Pending'));

      expect(screen.getByText('Incoming Friend Request')).toBeInTheDocument();

      // Click accept button (title "Accept")
      const acceptButton = screen.getByTitle('Accept');
      await user.click(acceptButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('req-in-1', 'accepted');
      });
    });

    it('calls updateFriendRequest with "declined" when clicking decline', async () => {
      const user = userEvent.setup();
      const mockUpdate = vi.fn().mockResolvedValue(undefined);

      const incomingRequest = makeRequest({
        id: 'req-in-2',
        fromId: 'sender-id',
        toId: 'current-user',
        user: {
          id: 'sender-id',
          username: 'sender2',
          displayName: 'Sender 2',
          avatar: null,
          banner: null,
          accentColor: null,
          avatarColor: null,
          bio: null,
          status: 'online',
          customStatus: null,
          isAdmin: false,
          createdAt: Date.now(),
        },
      });

      useSocialStore.setState({
        friends: [],
        requests: [incomingRequest],
        updateFriendRequest: mockUpdate,
      });

      renderFriendsPage();
      await user.click(screen.getByText('Pending'));

      const declineButton = screen.getByTitle('Decline');
      await user.click(declineButton);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('req-in-2', 'declined');
      });
    });
  });

  describe('Empty state mascot messages', () => {
    it('shows "No one\'s online right now." in online tab when no friends online', () => {
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      expect(screen.getByText("No one's online right now.")).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });

    it('shows "No friends yet — add someone!" in all tab when no friends', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      await user.click(screen.getByText('All'));

      expect(screen.getByText('No friends yet — add someone!')).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });

    it('shows "No pending requests — Nori is napping." in pending tab when empty', async () => {
      const user = userEvent.setup();
      useSocialStore.setState({ friends: [], requests: [] });
      renderFriendsPage();

      await user.click(screen.getByText('Pending'));

      expect(screen.getByText('No pending requests — Nori is napping.')).toBeInTheDocument();
      expect(screen.queryByText(/Wumpus/)).not.toBeInTheDocument();
    });
  });
});
