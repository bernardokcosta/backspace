import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberWithUser, Space } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { useUIStore } from '../../stores/uiStore';
import { TransferOwnershipModal } from './TransferOwnershipModal';
import { junoUser } from '../games/junoTestFixtures';
const me = junoUser('owner'), target = { ...junoUser('native'), username: 'native@retained.test', displayName: null };
const space = { id: 'space', name: 'Space', ownerId: me.id } as Space;
const member: MemberWithUser = { userId: target.id, spaceId: space.id, user: target, roles: [], nickname: null, joinedAt: 1 };
const close = vi.fn(), toast = vi.fn();
beforeEach(() => {
  vi.restoreAllMocks(); close.mockClear(); toast.mockClear(); useSpaceStore.getState().reset();
  useSpaceStore.setState({ spaces: [space] }); useAuthStore.setState({ user: me }); useUIStore.setState({ addToast: toast });
  vi.spyOn(api.spaces, 'members').mockResolvedValue([{ ...member, userId: me.id, user: me }, member]);
  vi.spyOn(api.spaces, 'transferOwnership').mockResolvedValue({ ...space, ownerId: target.id });
});
afterEach(cleanup);
describe('native ownership transfer', () => {
  it('excludes self and confirms a native target before reusing the store action', async () => {
    render(<TransferOwnershipModal spaceId={space.id} onClose={close} />);
    fireEvent.click(await screen.findByText(target.username)); expect(api.spaces.transferOwnership).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    await waitFor(() => expect(api.spaces.transferOwnership).toHaveBeenCalledExactlyOnceWith(space.id, target.id));
    expect(useSpaceStore.getState().spaces[0]?.ownerId).toBe(target.id); expect(close).toHaveBeenCalledOnce();
  });
  it('does not populate the new native session cache from an old roster response', async () => {
    let finish!: (rows: MemberWithUser[]) => void;
    vi.mocked(api.spaces.members).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
    render(<TransferOwnershipModal spaceId={space.id} onClose={close} />);
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await waitFor(() => expect(api.spaces.members).toHaveBeenCalledTimes(2)); await act(async () => finish([member]));
    expect(screen.queryByText(target.username)).toBeNull(); expect(useSpaceStore.getState().userViews.has(target.id)).toBe(false);
  });
  it('suppresses old transfer callbacks after the current session is replaced', async () => {
    let finish!: (row: Space) => void;
    vi.mocked(api.spaces.transferOwnership).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<TransferOwnershipModal spaceId={space.id} onClose={close} />); fireEvent.click(await screen.findByText(target.username));
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    act(() => { useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useSpaceStore.getState().reset(); useSpaceStore.setState({ spaces: [space] }); });
    await act(async () => finish({ ...space, ownerId: target.id }));
    expect(close).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled(); expect(useSpaceStore.getState().spaces[0]?.ownerId).toBe(me.id);
  });
});
