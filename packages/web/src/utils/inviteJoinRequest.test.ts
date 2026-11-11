import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { api, HttpError } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { sendInviteJoinRequest } from './inviteJoinRequest';
beforeEach(() => { vi.spyOn(api.joinRequests, 'request').mockResolvedValue({ success: true }); });
afterEach(() => vi.restoreAllMocks());
describe('native invitation request', () => {
  it('sends the native space ID and optional message, not an origin', async () => {
    expect(await sendInviteJoinRequest('space', 'hello')).toBe('sent');
    expect(api.joinRequests.request).toHaveBeenCalledExactlyOnceWith('space', 'hello');
  });
  it('reports an existing pending request without treating other errors as success', async () => {
    vi.mocked(api.joinRequests.request).mockRejectedValueOnce(new HttpError(409, 'Pending', undefined, 'join_request_pending'));
    expect(await sendInviteJoinRequest('space')).toBe('pending');
    vi.mocked(api.joinRequests.request).mockRejectedValueOnce(new HttpError(403, 'Forbidden', undefined, 'forbidden'));
    await expect(sendInviteJoinRequest('space')).rejects.toMatchObject({ status: 403 });
  });
  it('rejects a prior-session response even when its token has not changed', async () => {
    let finish!: (value: { success: boolean }) => void;
    vi.mocked(api.joinRequests.request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = sendInviteJoinRequest('space').catch((error: unknown) => error);
    useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); finish({ success: true });
    await expect(pending).resolves.toMatchObject({ name: 'AbortError' });
  });
});
