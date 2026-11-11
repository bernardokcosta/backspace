import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import type { JoinRequest } from '@veyvox/shared';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { JoinRequestsSection } from './SpaceSettings';
const request = (message: string): JoinRequest => ({ id: 'same-request', spaceId: 'same-space', userId: 'requester', message,
  status: 'pending', decidedBy: null, createdAt: 1, decidedAt: null });
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(api.joinRequests, 'list').mockResolvedValue({ requests: [request('Native request')] });
  vi.spyOn(api.joinRequests, 'decide').mockResolvedValue({ success: true }); });
afterEach(cleanup);
describe('native space-manager join requests', () => {
  it.each(['Accept', 'Decline'] as const)('lists and sends %s through the primary API', async action => {
    render(<JoinRequestsSection spaceId="same-space" />); await screen.findByText('Native request');
    fireEvent.click(screen.getByTitle(action)); await waitFor(() => expect(screen.queryByText('Native request')).toBeNull());
    expect(api.joinRequests.list).toHaveBeenCalledWith('same-space', 'pending');
    expect(api.joinRequests.decide).toHaveBeenCalledExactlyOnceWith('same-space', 'same-request', action.toLowerCase());
  });
  it('does not replace a new native space list with a late previous-space answer', async () => {
    let finish!: (value: { requests: JoinRequest[] }) => void;
    vi.mocked(api.joinRequests.list).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ requests: [request('Next space request')] });
    const view = render(<JoinRequestsSection spaceId="old" />); view.rerender(<JoinRequestsSection spaceId="new" />);
    await screen.findByText('Next space request'); await act(async () => finish({ requests: [request('Old space request')] }));
    expect(screen.queryByText('Old space request')).toBeNull();
  });
  it('cannot apply an old decision to equal IDs in a replacement session, even with equal JWTs', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(api.joinRequests.decide).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    render(<JoinRequestsSection spaceId="same-space" />); await screen.findByText('Native request'); fireEvent.click(screen.getByTitle('Accept'));
    vi.mocked(api.joinRequests.list).mockResolvedValueOnce({ requests: [request('Next session request')] });
    act(() => useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })));
    await screen.findByText('Next session request'); await act(async () => finish({ success: true }));
    expect(screen.getByText('Next session request')).toBeInTheDocument();
  });
  it('keeps the request available after a rejected decision', async () => {
    vi.mocked(api.joinRequests.decide).mockRejectedValueOnce(new Error('Decision refused'));
    render(<JoinRequestsSection spaceId="same-space" />); await screen.findByText('Native request'); fireEvent.click(screen.getByTitle('Accept'));
    await screen.findByText('Decision refused'); expect(screen.getByText('Native request')).toBeInTheDocument();
  });
});
