import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { api } from '../../../api/client';
import { useAuthStore } from '../../../stores/authStore';
import { BansPanel } from './BansPanel';
const ban = { spaceId: 'space', userId: 'native', reason: 'reason', bannedBy: 'manager', createdAt: 1,
  user: { id: 'native', username: 'native@retained.test' }, moderator: { id: 'manager', username: 'manager' } };
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(api.spaces, 'getBans').mockResolvedValue([ban]); vi.spyOn(api.spaces, 'unban').mockResolvedValue({ success: true }); });
afterEach(cleanup);
describe('native bans', () => {
  it('lists and unbans exact native IDs through the current API', async () => {
    render(<BansPanel spaceId="space" />); await screen.findByText(ban.user.username);
    fireEvent.click(screen.getByText('Unban')); await waitFor(() => expect(screen.queryByText(ban.user.username)).toBeNull());
    expect(api.spaces.getBans).toHaveBeenCalledWith('space'); expect(api.spaces.unban).toHaveBeenCalledExactlyOnceWith('space', ban.userId);
  });
  it('rejects a late listing from another space', async () => {
    let finish!: (rows: typeof ban[]) => void;
    vi.mocked(api.spaces.getBans).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce([]);
    const view = render(<BansPanel spaceId="old" />); view.rerender(<BansPanel spaceId="new" />);
    await waitFor(() => expect(api.spaces.getBans).toHaveBeenCalledWith('new')); await act(async () => finish([ban]));
    expect(screen.queryByText(ban.user.username)).toBeNull();
  });
  it('does not remove the next-session equal-ID ban after an old unban response', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(api.spaces.unban).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<BansPanel spaceId="space" />); fireEvent.click(await screen.findByText('Unban'));
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await waitFor(() => expect(api.spaces.getBans).toHaveBeenCalledTimes(2)); await act(async () => finish({ success: true }));
    expect(screen.getByText(ban.user.username)).toBeInTheDocument();
  });
});
