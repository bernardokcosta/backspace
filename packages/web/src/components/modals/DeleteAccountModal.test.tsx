import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberWithUser, Space } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { DeleteAccountModal } from './DeleteAccountModal';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';
import { junoUser } from '../games/junoTestFixtures';
const me = { ...junoUser('me'), username: 'me@retained.test' };
const owned = { id: 'owned', name: 'Owned Space', ownerId: me.id } as Space;
beforeEach(() => { vi.restoreAllMocks(); useSpaceStore.getState().reset(); useAuthStore.setState({ user: me });
  vi.spyOn(api.spaces, 'members').mockResolvedValue([]); vi.spyOn(api.users, 'deleteAccount').mockResolvedValue({ success: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function confirm() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.change(screen.getByPlaceholderText(me.username), { target: { value: me.username } });
  fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'local-password' } });
}
describe('native account deletion', () => {
  it('requires full native username plus password and submits only to the current API', async () => {
    render(<DeleteAccountModal isOpen onClose={vi.fn()} />); confirm();
    fireEvent.click(screen.getByRole('button', { name: 'Delete My Account' }));
    await waitFor(() => expect(api.users.deleteAccount).toHaveBeenCalledExactlyOnceWith({ username: me.username, password: 'local-password' }));
    expect(screen.queryByText(/Removing your account from connected instances/)).toBeNull();
  });
  it('does not allow Continue to skip owned spaces while their native roster is loading', async () => {
    let finish!: (members: MemberWithUser[]) => void; vi.mocked(api.spaces.members).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    useSpaceStore.setState({ spaces: [owned] }); render(<DeleteAccountModal isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled(); await act(async () => finish([]));
    expect(await screen.findByText(owned.name)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
  it('cannot display completion or expire a replacement session after an old deletion returns', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(api.users.deleteAccount).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<DeleteAccountModal isOpen onClose={vi.fn()} />); confirm(); fireEvent.click(screen.getByRole('button', { name: 'Delete My Account' }));
    act(() => useAuthStore.setState(s => ({ user: { ...me }, token: 'next-token', sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish({ success: true }));
    expect(screen.queryByText('Account deleted')).toBeNull(); expect(useAuthStore.getState().token).toBe('next-token');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });
});
