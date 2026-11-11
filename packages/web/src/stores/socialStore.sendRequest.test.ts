import { beforeEach, describe, expect, it, vi } from 'vitest';
const { sendRequest, requests } = vi.hoisted(() => ({
  sendRequest: vi.fn<(data: object) => Promise<{ success: boolean; requestId: string }>>(async () => ({ success: true, requestId: 'req-1' })),
  requests: vi.fn(async () => []),
}));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { social: { sendRequest, requests } } }));
import { useSocialStore } from './socialStore';
beforeEach(() => { vi.clearAllMocks(); useSocialStore.getState().reset(); });
describe('native friend requests', () => {
  it.each(['bob', 'legacy@old.invalid', 'bob@local.test'])('sends the exact local handle %s, never remote identity fields', async username => {
    expect(await useSocialStore.getState().sendFriendRequest({ username })).toBe('req-1');
    expect(sendRequest).toHaveBeenCalledExactlyOnceWith({ username }); expect(requests).toHaveBeenCalledTimes(1);
  });
  it('trims surrounding whitespace without rewriting the handle', async () => {
    await useSocialStore.getState().sendFriendRequest({ username: '  bob  ' }); expect(sendRequest).toHaveBeenCalledExactlyOnceWith({ username: 'bob' });
  });
  it('does not forward old identity extras from an untyped caller', async () => {
    const body = { username: 'legacy@old.invalid', homeUserId: 'other', homeInstance: 'unused.invalid' };
    await useSocialStore.getState().sendFriendRequest(body); expect(sendRequest).toHaveBeenCalledExactlyOnceWith({ username: 'legacy@old.invalid' });
  });
  it('propagates native server errors and settles loading', async () => {
    sendRequest.mockRejectedValueOnce(new Error('user_not_found'));
    await expect(useSocialStore.getState().sendFriendRequest({ username: 'absent' })).rejects.toThrow('user_not_found');
    expect(useSocialStore.getState()).toMatchObject({ error: 'user_not_found', isLoading: false });
  });
});
