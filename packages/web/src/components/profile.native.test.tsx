import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
const mocks = vi.hoisted(() => ({ get: vi.fn(), mutuals: vi.fn(), create: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: {
  users: { get: mocks.get, getMutuals: mocks.mutuals }, dm: { create: mocks.create },
} }));
import { UserProfileModal } from './modals/UserProfileModal';
import { UserProfilePopout } from './ui/UserProfilePopout';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useUIStore } from '../stores/uiStore';
import { useSocialStore } from '../stores/socialStore';
const user = (id: string): User => ({ id, username: `${id}@retained.invalid`, displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 });
const me = user('me'), other = user('other');
const anchor = { top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 };
function Route() { return <output data-testid="route">{useLocation().pathname}</output>; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.mutuals.mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }); mocks.get.mockResolvedValue(other);
  mocks.create.mockResolvedValue({ id: 'pair', ownerId: null, members: [me, other], createdAt: 1 });
  useSpaceStore.getState().reset(); useAuthStore.setState({ user: me }); useSocialStore.setState({ friends: [], requests: [] });
  useUIStore.setState({ activeModal: 'userProfile', modalData: { userId: other.id, user: other }, isMobile: false });
});
afterEach(cleanup);
describe('native profiles', () => {
  it.each(['modal', 'popout'] as const)('loads native mutuals and opens the local DM from the %s', async surface => {
    render(<MemoryRouter>{surface === 'modal' ? <UserProfileModal /> : <UserProfilePopout user={other} anchor={anchor} onClose={vi.fn()} />}<Route /></MemoryRouter>);
    expect(screen.getByText(other.username)).toBeInTheDocument(); await waitFor(() => expect(mocks.mutuals).toHaveBeenCalledExactlyOnceWith(other.id));
    fireEvent.click(screen.getByText('Send Message')); await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ userId: other.id }));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/channels/@me/pair'));
  });
  it('ignores a late profile read after a different native profile is opened', async () => {
    let finish!: (value: User) => void; mocks.get.mockReturnValueOnce(new Promise<User>(resolve => { finish = resolve; }));
    useUIStore.setState({ modalData: { userId: 'old' } }); render(<MemoryRouter><UserProfileModal /></MemoryRouter>);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('old'));
    act(() => useUIStore.setState({ modalData: { userId: other.id, user: other } }));
    await act(async () => finish(user('old'))); expect(screen.queryByText('old@retained.invalid')).toBeNull();
    expect(useSpaceStore.getState().userViews.has('old')).toBe(false);
  });
  it('ignores prior-session mutuals instead of showing them on a replacement profile', async () => {
    let finish!: (value: { mutualFriends: User[]; mutualSpaces: [] }) => void;
    mocks.mutuals.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<MemoryRouter><UserProfileModal /></MemoryRouter>); await waitFor(() => expect(mocks.mutuals).toHaveBeenCalledOnce());
    act(() => { useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useUIStore.setState({ modalData: { userId: me.id, user: me } }); });
    await act(async () => finish({ mutualFriends: [user('private-old')], mutualSpaces: [] }));
    fireEvent.click(screen.getByText(/Mutual Friends/)); expect(screen.queryByText('private-old@retained.invalid')).toBeNull();
  });
});
