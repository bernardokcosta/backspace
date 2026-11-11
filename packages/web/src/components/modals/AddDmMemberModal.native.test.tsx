import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { DmChannel, Friend, User } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
const mocks = vi.hoisted(() => ({ createGroup: vi.fn(), addMember: vi.fn(), bots: vi.fn() }));
vi.mock('../../api/client', async original => ({ ...await original<typeof import('../../api/client')>(), api: {
  dm: { createGroup: mocks.createGroup, addMember: mocks.addMember }, bots: { list: mocks.bots }, uploads: { url: (file: string) => `/api/uploads/${file}` },
} }));
import { AddDmMemberModal } from './AddDmMemberModal';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useSocialStore } from '../../stores/socialStore';
const user = (id: string): User => ({ id, username: id, displayName: null, avatar: null, banner: null, accentColor: null, avatarColor: null,
  bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 });
const me = user('me'), partner = user('partner'), friend = user('friend');
const pair: DmChannel = { id: 'pair', ownerId: null, name: null, icon: null, members: [me, partner], createdAt: 1 };
const group: DmChannel = { ...pair, id: 'group', ownerId: me.id, members: [me, partner, friend] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.bots.mockResolvedValue({ bots: [] }); mocks.createGroup.mockResolvedValue(group); mocks.addMember.mockResolvedValue(group);
  useSpaceStore.getState().reset(); useSpaceStore.getState().upsertDmChannel(pair); useAuthStore.setState({ user: me });
  useSocialStore.setState({ friends: [friend as Friend] }); useUIStore.setState({ activeModal: 'addDmMember', modalData: { dmChannelId: pair.id } });
});
afterEach(cleanup);
const mount = () => render(<MemoryRouter><AddDmMemberModal /></MemoryRouter>);
const submit = async () => { fireEvent.click(await screen.findByText('friend')); fireEvent.click(screen.getByText('Add 1 Friend')); };
describe('native add-member requests', () => {
  it('creates a separate native group from the exact source pair and native members', async () => {
    mount(); await submit(); await waitFor(() => expect(mocks.createGroup).toHaveBeenCalledExactlyOnceWith({ users: [{ id: partner.id }, { id: friend.id }], fromDmChannelId: pair.id }));
    expect(useSpaceStore.getState().dmChannels.map(row => row.id).sort()).toEqual(['group', 'pair']);
  });
  it('adds a selected friend through the native group ID', async () => {
    useSpaceStore.getState().upsertDmChannel({ ...group, members: [me, partner] }); useUIStore.setState({ modalData: { dmChannelId: group.id } });
    mount(); await submit(); await waitFor(() => expect(mocks.addMember).toHaveBeenCalledExactlyOnceWith(group.id, { userId: friend.id })); expect(mocks.createGroup).not.toHaveBeenCalled();
  });
  it('blocks a native friend already present and does not infer membership from an equal username', async () => {
    useSocialStore.setState({ friends: [partner as Friend, { ...friend, username: partner.username } as Friend] }); mount();
    await waitFor(() => expect(screen.getAllByText('partner')).toHaveLength(2));
    const buttons = screen.getAllByText('partner').map(label => label.closest('button'));
    expect(buttons.filter(button => button?.disabled)).toHaveLength(1);
  });
  it('drops a late group response without adopting it or closing a next-session modal', async () => {
    let finish!: (value: DmChannel) => void; mocks.createGroup.mockReturnValueOnce(new Promise<DmChannel>(resolve => { finish = resolve; }));
    mount(); await submit(); await waitFor(() => expect(mocks.createGroup).toHaveBeenCalledOnce());
    act(() => { useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useSpaceStore.getState().reset(); useUIStore.setState({ activeModal: 'newDm' }); });
    await act(async () => finish(group)); expect(useSpaceStore.getState().dmChannels).toEqual([]); expect(useUIStore.getState().activeModal).toBe('newDm');
  });
});
