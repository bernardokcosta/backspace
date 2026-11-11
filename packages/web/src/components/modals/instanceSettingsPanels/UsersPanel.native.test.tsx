import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser, AdminUserListResponse } from '@veyvox/shared';
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { UsersPanel } from './UsersPanel';
import { api } from '../../../api/client';
import { useAuthStore } from '../../../stores/authStore';
import { junoUser } from '../../games/junoTestFixtures';
const bot: AdminUser = { id: 'native-bot', username: 'radio_bot@retained.test', displayName: null, avatar: null, avatarColor: null,
  status: 'offline', isAdmin: false, isBot: true, isDeleted: false, createdAt: 1 };
const rows = (users = [bot]): AdminUserListResponse => ({ users, total: users.length, page: 1, pageSize: 50 });
beforeEach(() => { vi.restoreAllMocks(); useAuthStore.setState({ user: { ...junoUser('admin'), isAdmin: true } });
  vi.spyOn(api.admin, 'listUsers').mockResolvedValue(rows()); vi.spyOn(api.admin, 'deleteUser').mockResolvedValue({ success: true }); });
afterEach(cleanup);
describe('native admin users', () => {
  it('keeps native bot deletion and never offers a cross-server block or instance filter', async () => {
    render(<UsersPanel />); const name = await screen.findByText(bot.username);
    expect(screen.queryByRole('option', { name: 'All instances' })).toBeNull();
    fireEvent.click(within(name.closest('div.flex.items-center.gap-3')!).getByTitle('Delete user'));
    expect(screen.queryByText('Do not let this bot register again')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));
    await waitFor(() => expect(api.admin.deleteUser).toHaveBeenCalledExactlyOnceWith(bot.id));
  });
  it('promotes exact native IDs without interpreting retained handles as foreign', async () => {
    vi.spyOn(api.admin, 'setUserRole').mockResolvedValue({ success: true }); render(<UsersPanel />);
    fireEvent.click(await screen.findByTitle('Promote to admin'));
    await waitFor(() => expect(api.admin.setUserRole).toHaveBeenCalledExactlyOnceWith(bot.id, true));
  });
  it('does not expose a temporary password from an earlier native session', async () => {
    let finish!: (value: { temporaryPassword: string }) => void;
    vi.spyOn(api.admin, 'resetUserPassword').mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<UsersPanel />); fireEvent.click(await screen.findByTitle('Reset password'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await act(async () => finish({ temporaryPassword: 'old-private-password' }));
    expect(screen.queryByText('old-private-password')).toBeNull();
  });
  it('ignores an earlier-session list even when user IDs repeat', async () => {
    let finish!: (value: AdminUserListResponse) => void;
    vi.mocked(api.admin.listUsers).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(rows([{ ...bot, username: 'next-user' }]));
    render(<UsersPanel />); act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await screen.findByText('next-user'); await act(async () => finish(rows())); expect(screen.queryByText(bot.username)).toBeNull();
  });
});
