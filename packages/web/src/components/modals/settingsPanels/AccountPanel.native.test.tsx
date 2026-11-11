import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../../ui/ImageCropModal', () => ({ ImageCropModal: () => null }));
vi.mock('../DeleteAccountModal', () => ({ DeleteAccountModal: () => null }));
import { AccountPanel } from './AccountPanel';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { api } from '../../../api/client';
import { junoUser } from '../../games/junoTestFixtures';
const me = { ...junoUser('me', 'Me'), username: 'me@retained.test' };
const toast = vi.fn();
beforeEach(() => { vi.restoreAllMocks(); toast.mockClear(); useAuthStore.setState({ user: me }); useUIStore.setState({ addToast: toast }); });
afterEach(cleanup);
describe('native account settings', () => {
  it('isolates the complete retained account handle from RTL direction without reattachment controls', () => {
    render(<div dir="rtl"><AccountPanel /></div>);
    const handle = screen.getByText(`@${me.username}`); expect(handle.tagName).toBe('BDI'); expect(handle).toHaveAttribute('dir', 'ltr');
    expect(screen.queryByText(/detached|re-attach/i)).toBeNull();
  });
  it('saves native profile fields through the existing auth action', async () => {
    const update = vi.spyOn(api.users, 'update').mockResolvedValue({ ...me, bio: 'Native profile' }); render(<AccountPanel />);
    fireEvent.change(screen.getByPlaceholderText('Tell the world about yourself…'), { target: { value: 'Native profile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith({ bio: 'Native profile' })); expect(toast).toHaveBeenCalled();
  });
  it('does not show a previous-session profile failure on a replacement account', async () => {
    let fail!: (error: Error) => void; vi.spyOn(api.users, 'update').mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }));
    render(<AccountPanel />); fireEvent.change(screen.getByPlaceholderText('Tell the world about yourself…'), { target: { value: 'Old profile' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1, user: { ...me, bio: 'New profile' } })));
    await act(async () => fail(new Error('Old private error'))); expect(screen.queryByText('Old private error')).toBeNull();
    expect(screen.getByDisplayValue('New profile')).toBeInTheDocument(); expect(toast).not.toHaveBeenCalled();
  });
  it('keeps native password validation and successful session rotation feedback', async () => {
    const change = vi.spyOn(api.users, 'changePassword').mockResolvedValue({ token: 'rotated-jwt' });
    render(<AccountPanel />);
    fireEvent.change(screen.getByPlaceholderText('Enter current password'), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'not-matching' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' })); expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith({ currentPassword: 'current-password', newPassword: 'new-password' }));
    await waitFor(() => expect(useAuthStore.getState().token).toBe('rotated-jwt'));
    expect(toast).toHaveBeenCalledWith('Password changed', 'success', 2000);
    expect(screen.getByPlaceholderText('Enter current password')).toHaveValue('');
  });
});
