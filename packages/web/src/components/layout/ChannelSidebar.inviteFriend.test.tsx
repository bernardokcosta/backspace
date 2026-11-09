import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DmChannel, User } from '@veyvox/shared';
import { ChannelSidebar } from './ChannelSidebar';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { useContextMenuStore } from '../../stores/contextMenuStore';

vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
const user = (id: string): User => ({ id, username: id, displayName: id, avatar: null, banner: null,
  accentColor: null, avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false,
  createdAt: 1, homeInstance: null, homeUserId: null, replicatedInstances: [] });
const me = user('me');
const partner = user('Partner');
const dm: DmChannel = { id: 'dm', federatedId: null, ownerId: null, ownerHomeUserId: null, ownerHomeInstance: null,
  createdAt: 1, members: [me, partner], lastMessage: null, name: null, icon: null, metadataUpdatedAt: 0 };
beforeEach(() => {
  useContextMenuStore.getState().close();
  useAuthStore.setState({ user: me, myRowIds: new Map() });
  useUIStore.setState({ showDms: true, activeModal: null, modalData: {} });
  useChatStore.setState({ currentChannelId: null, unreadChannels: new Set() });
  useSpaceStore.setState({ spaces: [], currentSpaceId: null, channels: [], dmChannels: [dm],
    channelOriginMap: new Map([['dm', '']]) });
});
afterEach(() => { cleanup(); useAuthStore.setState({ user: null }); });
const renderSidebar = () => render(<MemoryRouter initialEntries={['/channels/@me']}><ChannelSidebar /></MemoryRouter>);

describe('DM context invitation entry', () => {
  it('passes the actual 1-on-1 counterpart and its origin to the picker', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByText('Partner'));
    const item = useContextMenuStore.getState().menu?.items.find(item => item.key === 'invite-to-server');
    expect(item?.type).toBe('action');
    if (item?.type !== 'action') throw new Error('missing invitation action');
    act(() => { item.onClick(); });
    expect(useUIStore.getState().activeModal).toBe('inviteFriend');
    expect(useUIStore.getState().modalData.friend).toMatchObject({ id: partner.id, _instanceOrigin: '' });
  });
  it('keeps Leave Group and does not invent a single recipient for a group', () => {
    useSpaceStore.setState({ dmChannels: [{ ...dm, ownerId: me.id, name: 'Group' }] });
    renderSidebar();
    fireEvent.contextMenu(screen.getByText('Group'));
    const items = useContextMenuStore.getState().menu?.items ?? [];
    expect(items.some(item => item.key === 'leave-group')).toBe(true);
    expect(items.some(item => item.key === 'invite-to-server')).toBe(false);
  });
});
