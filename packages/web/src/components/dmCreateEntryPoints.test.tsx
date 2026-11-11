import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DmChannel, Friend, BotSummary } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
const mocks = vi.hoisted(() => ({ create: vi.fn(), createGroup: vi.fn(), addMember: vi.fn(), search: vi.fn(), mutuals: vi.fn(), bots: vi.fn() }));
vi.mock('../api/client', async original => {
  const actual = await original<typeof import('../api/client')>();
  return { ...actual, api: { ...actual.api,
    dm: { ...actual.api.dm, create: mocks.create, createGroup: mocks.createGroup, addMember: mocks.addMember },
    social: { ...actual.api.social, search: mocks.search }, users: { ...actual.api.users, getMutuals: mocks.mutuals },
    bots: { ...actual.api.bots, list: mocks.bots },
  } };
});
import { FriendsPage } from './chat/FriendsPage';
import { UserProfilePopout } from './ui/UserProfilePopout';
import { UserProfileModal } from './modals/UserProfileModal';
import { NewDmModal } from './modals/NewDmModal';
import { DmSearchBar } from './layout/DmSearchBar';
import { AddDmMemberModal } from './modals/AddDmMemberModal';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useSocialStore } from '../stores/socialStore';
import { useUIStore } from '../stores/uiStore';
import { junoUser } from './games/junoTestFixtures';
const me = junoUser('me', 'Me'), bob = junoUser('bob', 'Bob'), carol = junoUser('carol', 'Carol');
const pair: DmChannel = { id: 'pair', ownerId: null, name: null, icon: null, createdAt: 1, members: [me, bob] };
const group: DmChannel = { ...pair, id: 'group', ownerId: me.id, members: [me, bob, carol] };
const asFriend = (row: typeof me): Friend => ({ ...row, addedAt: 1 });
function Route() { return <output data-testid="route">{useLocation().pathname}</output>; }
const rowIds = () => useSpaceStore.getState().dmChannels.map(row => row.id);
beforeEach(() => {
  vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn();
  mocks.create.mockResolvedValue(pair); mocks.createGroup.mockResolvedValue(group); mocks.addMember.mockResolvedValue(group);
  mocks.search.mockResolvedValue([bob]); mocks.mutuals.mockResolvedValue({ mutualFriends: [], mutualSpaces: [] }); mocks.bots.mockResolvedValue({ bots: [] });
  useSpaceStore.getState().reset(); useAuthStore.setState({ user: me });
  useSocialStore.setState({ friends: [asFriend(bob)], requests: [], isLoading: false, loadFriends: async () => {}, loadRequests: async () => {} });
  useUIStore.setState({ activeModal: null, modalData: {}, isMobile: false });
});
afterEach(cleanup);

describe('shared native DM creation entrypoints', () => {
  it.each(['friends', 'profile-popout', 'profile-modal', 'new-dm', 'search-bar'] as const)('adopts one current API response from %s', async surface => {
    if (surface === 'profile-modal') useUIStore.getState().openModal('userProfile', { userId: bob.id, user: bob });
    if (surface === 'new-dm') useUIStore.getState().openModal('newDm');
    render(<MemoryRouter>{surface === 'friends' ? <FriendsPage />
      : surface === 'profile-popout' ? <UserProfilePopout user={bob} anchor={{ top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40 }} onClose={vi.fn()} />
      : surface === 'profile-modal' ? <UserProfileModal /> : surface === 'new-dm' ? <NewDmModal /> : <DmSearchBar />}<Route /></MemoryRouter>);
    if (surface === 'friends') fireEvent.click(screen.getByTitle('Message'));
    else if (surface === 'profile-popout' || surface === 'profile-modal') fireEvent.click(screen.getByText('Send Message'));
    else {
      if (surface === 'search-bar') fireEvent.click(screen.getByRole('button'));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bo' } }); fireEvent.click(await screen.findByText('Bob'));
    }
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/channels/@me/pair'));
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ userId: bob.id }); expect(rowIds()).toEqual([pair.id]);
  });
  it('opens a new native group while preserving its source pair', async () => {
    useSpaceStore.getState().upsertDmChannel(pair); useSocialStore.setState({ friends: [asFriend(carol)] });
    useUIStore.getState().openModal('addDmMember', { dmChannelId: pair.id });
    render(<MemoryRouter><AddDmMemberModal /><Route /></MemoryRouter>);
    fireEvent.click(screen.getByText('Carol')); fireEvent.click(screen.getByText('Add 1 Friend'));
    await waitFor(() => expect(screen.getByTestId('route')).toHaveTextContent('/channels/@me/group'));
    expect(mocks.createGroup).toHaveBeenCalledExactlyOnceWith({ users: [{ id: bob.id }, { id: carol.id }], fromDmChannelId: pair.id });
    expect(rowIds()).toEqual([pair.id, group.id]);
  });
  it('adds native friends and owned bots sequentially using the same group ID', async () => {
    const bot = { id: 'bot', username: 'bot', displayName: 'Owned Bot', avatar: null } as BotSummary;
    mocks.bots.mockResolvedValue({ bots: [bot] }); useSocialStore.setState({ friends: [asFriend(carol)] });
    useSpaceStore.getState().upsertDmChannel({ ...group, members: [me, bob] });
    useUIStore.getState().openModal('addDmMember', { dmChannelId: group.id });
    let finish!: (value: DmChannel) => void; mocks.addMember.mockReturnValueOnce(new Promise<DmChannel>(resolve => { finish = resolve; }));
    render(<MemoryRouter><AddDmMemberModal /></MemoryRouter>);
    fireEvent.click(screen.getByText('Carol')); fireEvent.click(await screen.findByText('Owned Bot')); fireEvent.click(screen.getByText('Add 2 Friends'));
    expect(mocks.addMember).toHaveBeenCalledExactlyOnceWith(group.id, { userId: carol.id });
    await act(async () => finish(group)); expect(mocks.addMember.mock.calls).toEqual([[group.id, { userId: carol.id }], [group.id, { userId: bot.id }]]);
  });
  it('retains the ten-member limit instead of submitting an over-capacity selection', async () => {
    useSpaceStore.getState().upsertDmChannel({ ...group, members: Array.from({ length: 10 }, (_, index) => junoUser(`member-${index}`)) });
    useSocialStore.setState({ friends: [asFriend(carol)] }); useUIStore.getState().openModal('addDmMember', { dmChannelId: group.id });
    render(<MemoryRouter><AddDmMemberModal /></MemoryRouter>); expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByText('Carol').closest('button')).toBeDisabled(); expect(mocks.addMember).not.toHaveBeenCalled();
  });
});
