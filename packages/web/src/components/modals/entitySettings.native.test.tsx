import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelCategory, Channel } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { PermissionBits, permissionsToString } from '../../utils/permissions';
import { ChannelSettingsModal } from './ChannelSettingsModal';
import { CategorySettingsModal } from './CategorySettingsModal';

const category: ChannelCategory = { id: 'category', spaceId: 'space', name: 'Category', position: 0, createdAt: 1 };
const channel: Channel = { id: 'channel', spaceId: 'space', name: 'channel', type: 'text', topic: null, categoryId: null, position: 0, createdAt: 1 };
beforeEach(() => {
  vi.restoreAllMocks(); useSpaceStore.getState().reset();
  const perms = permissionsToString(PermissionBits.MANAGE_CHANNELS);
  useSpaceStore.setState({ currentSpaceId: 'space', categories: [category], channels: [channel],
    spacePermissions: new Map([['space', perms]]), channelPermissions: new Map([['channel', perms]]) });
});
afterEach(cleanup);

describe.each(['channel', 'category'] as const)('native %s settings lifecycle', kind => {
  const modal = kind === 'channel' ? 'channelSettings' : 'categorySettings';
  const label = kind === 'channel' ? 'Channel' : 'Category';
  const row = kind === 'channel' ? channel : category;
  const mount = () => {
    useUIStore.getState().openModal(modal, { [`${kind}Id`]: row.id });
    return render(kind === 'channel' ? <ChannelSettingsModal /> : <CategorySettingsModal />);
  };
  const confirmDelete = () => {
    fireEvent.click(screen.getByRole('button', { name: `Delete ${label}` }));
    fireEvent.click(screen.getAllByRole('button', { name: `Delete ${label}` }).at(-1)!);
  };
  it('cannot close another modal after an old native deletion resolves', async () => {
    let finish!: (value: { success: boolean }) => void;
    const remove = vi.spyOn(kind === 'channel' ? api.channels : api.categories, 'delete')
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mount(); confirmDelete(); await waitFor(() => expect(remove).toHaveBeenCalledWith(row.id));
    act(() => useUIStore.getState().openModal('newDm'));
    await act(async () => finish({ success: true }));
    expect(useUIStore.getState().activeModal).toBe('newDm');
  });
  it('does not leak a late rename failure into another native entity editor', async () => {
    let fail!: (reason: Error) => void;
    const update = vi.spyOn(kind === 'channel' ? api.channels : api.categories, 'update')
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    mount(); fireEvent.click(screen.getByTitle(`Rename ${label}`));
    fireEvent.change(screen.getByRole('textbox', { name: `${label} Name` }), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(update).toHaveBeenCalledOnce());
    act(() => {
      if (kind === 'channel') useSpaceStore.setState(s => ({ channels: [...s.channels, { ...channel, id: 'next', name: 'next-channel' }],
        channelPermissions: new Map(s.channelPermissions).set('next', permissionsToString(PermissionBits.MANAGE_CHANNELS)) }));
      else useSpaceStore.setState(s => ({ categories: [...s.categories, { ...category, id: 'next', name: 'Next Category' }] }));
      useUIStore.getState().openModal(modal, { [`${kind}Id`]: 'next' });
    });
    await act(async () => fail(new Error('Private prior entity error')));
    expect(screen.queryByText('Private prior entity error')).toBeNull();
    expect(screen.getByTitle(`Rename ${label}`)).toBeInTheDocument();
  });
  it('cannot close a next-session modal after deletion of an equal-ID entity', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.spyOn(kind === 'channel' ? api.channels : api.categories, 'delete').mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    mount(); confirmDelete();
    act(() => { useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useUIStore.getState().openModal('newDm'); });
    await act(async () => finish({ success: true })); expect(useUIStore.getState().activeModal).toBe('newDm');
  });
});
