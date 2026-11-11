import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@veyvox/shared';

// Keep the native API and profile lookups deterministic for presentation tests.
vi.mock('../../stores/spaceStore', () => ({
  useSpaceStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ upsertDmChannel: vi.fn(), findExistingDmForUser: vi.fn(), upsertUserView: vi.fn() }),
    { getState: () => ({ upsertDmChannel: vi.fn(), findExistingDmForUser: vi.fn(), upsertUserView: vi.fn() }) },
  ),
}));
// authStore imports voiceStore, which imports AudioManager and with it an
// AudioWorklet module jsdom cannot evaluate.
vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: vi.fn().mockReturnValue({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) },
}));
vi.mock('../../api/client', async original => {
  const actual = await original<typeof import('../../api/client')>();
  return { ...actual, api: { ...actual.api, users: { ...actual.api.users, getMutuals: vi.fn().mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }) } } };
});

import { UserProfileModal } from './UserProfileModal';
import { useUIStore } from '../../stores/uiStore';
import { useSocialStore } from '../../stores/socialStore';
import { api, HttpError } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useActivityStore } from '../../stores/activityStore';

function makeUser(overrides: Partial<User>): User {
  return {
    id: 'u-1', username: 'james', displayName: 'James', avatar: null, banner: null,
    accentColor: null, avatarColor: null, bio: null, status: 'online',
    customStatus: null, isAdmin: false, createdAt: 0,
    ...overrides,
  };
}

describe('UserProfileModal', () => {
  beforeEach(() => {
    useUIStore.setState({ activeModal: null, modalData: {} });
  });

  it('renders emoji shortcodes in the bio and custom status as emoji (issue #252)', () => {
    const user = makeUser({
      customStatus: 'praying :pray:',
      bio: 'Christus aeternus est. :heart_on_fire:',
    });
    useUIStore.getState().openModal('userProfile', { userId: user.id, user, origin: '' });

    render(
      <MemoryRouter>
        <UserProfileModal />
      </MemoryRouter>,
    );

    expect(screen.getByText('praying 🙏')).toBeInTheDocument();
    expect(screen.getByText('Christus aeternus est. ❤️‍🔥')).toBeInTheDocument();
  });

  it('lists every game the person is playing, with its own time, in the About tab', () => {
    const user = makeUser({});
    useActivityStore.getState().setUserActivities(user.id, [
      { type: 'playing', name: 'Honkai: Star Rail', timestamps: { start: Date.now() - 90_000 } },
      { type: 'playing', name: 'Stardew Valley', timestamps: { start: Date.now() - 3_600_000 } },
    ]);
    useUIStore.getState().openModal('userProfile', { userId: user.id, user, origin: '' });

    render(
      <MemoryRouter>
        <UserProfileModal />
      </MemoryRouter>,
    );

    // One card per game, each headed by the activity type (the old single
    // "Playing now" section header was replaced by ProfileActivities).
    expect(screen.getAllByText('Playing a Game')).toHaveLength(2);
    expect(screen.getByText('Honkai: Star Rail')).toBeInTheDocument();
    expect(screen.getByText('Stardew Valley')).toBeInTheDocument();
    expect(document.querySelectorAll('.tabular-nums')).toHaveLength(2);
  });

  it('Add Friend sends only the exact native username, including retained @ text', async () => {
    const stub = makeUser({
      id: 'stub-local-id',
      username: '342939417492520960@orbit.test',
      displayName: 'Yoko',
    });
    const sendFriendRequest = vi.fn().mockResolvedValue('req-1');
    useSocialStore.setState({ friends: [], requests: [], sendFriendRequest });
    useUIStore.getState().openModal('userProfile', { userId: stub.id, user: stub, origin: '' });

    render(
      <MemoryRouter>
        <UserProfileModal />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Add Friend'));

    await waitFor(() => expect(sendFriendRequest).toHaveBeenCalledOnce());
    expect(sendFriendRequest).toHaveBeenCalledWith({
      username: '342939417492520960@orbit.test',
    });
  });

  it('tells the user why Send Message failed', async () => {
    const create = vi.spyOn(api.dm, 'create').mockRejectedValueOnce(new HttpError(404, 'User not found', null, 'user_not_found'));
    const addToast = vi.fn();
    useUIStore.setState({ addToast });
    const user = makeUser({});
    useUIStore.getState().openModal('userProfile', { userId: user.id, user, origin: '' });

    render(
      <MemoryRouter>
        <UserProfileModal />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Send Message'));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Could not open the conversation: No user with that name was found.', 'warning'));
    expect(useUIStore.getState().activeModal).toBe('userProfile');
    create.mockRestore();
  });

  describe('the signed-in user (#325)', () => {
    const pageHost = window.location.host;
    const erinHere = makeUser({ id: 'erin-here', username: 'erin@nova.example' });

    afterEach(() => {
      useAuthStore.setState({ user: null });
    });

    it('offers no messaging or friend actions on the own profile', () => {
      useAuthStore.setState({ user: erinHere });
      useSocialStore.setState({ friends: [], requests: [] });
      useUIStore.getState().openModal('userProfile', { userId: erinHere.id, user: erinHere, origin: '' });

      render(<MemoryRouter><UserProfileModal /></MemoryRouter>);

      expect(screen.queryByText('Send Message')).toBeNull();
      expect(screen.queryByText('Add Friend')).toBeNull();
    });

    it('never takes a different person with the same name for the signed-in user', () => {
      const otherErin = makeUser({
        id: 'erin-native', username: `erin@${pageHost}`,
      });
      useAuthStore.setState({ user: erinHere });
      useSocialStore.setState({ friends: [], requests: [] });
      useUIStore.getState().openModal('userProfile', { userId: otherErin.id, user: otherErin, origin: 'https://nova.example' });

      render(<MemoryRouter><UserProfileModal /></MemoryRouter>);

      expect(screen.getByText('Send Message')).toBeInTheDocument();
      expect(screen.getByText('Add Friend')).toBeInTheDocument();
    });
  });
});

