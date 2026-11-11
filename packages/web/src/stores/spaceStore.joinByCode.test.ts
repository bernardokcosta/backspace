import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Space } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from './spaceStore';
import { api, HttpError } from '../api/client';
import { JoinRequestRequiredError } from '../utils/joinErrors';
const space: Space = { id: 'space', name: 'Native', ownerId: 'native', ownerTitle: null, icon: null, banner: null, avatarColor: null,
  inviteCode: null, visibility: 'private', description: null, createdAt: 1 };
const refusal = (details?: Record<string, string>) => new HttpError(403, 'Request required', undefined, 'join_request_required', details);
beforeEach(() => { vi.restoreAllMocks(); useSpaceStore.getState().reset(); vi.spyOn(api.spaces, 'joinByCode').mockResolvedValue(space); vi.spyOn(api.spaces, 'invitePreview'); });
describe('native join-by-code and approval', () => {
  it('joins by native code and adds the returned membership', async () => {
    expect(await useSpaceStore.getState().joinByCode('code')).toEqual(space);
    expect(api.spaces.joinByCode).toHaveBeenCalledExactlyOnceWith('code'); expect(useSpaceStore.getState().spaces).toContainEqual(space);
  });
  it('names the refused native space without provisioning a membership', async () => {
    vi.mocked(api.spaces.joinByCode).mockRejectedValueOnce(refusal({ spaceId: 'request-space' }));
    const error = await useSpaceStore.getState().joinByCode('code').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JoinRequestRequiredError); expect(error).toMatchObject({ spaceId: 'request-space', code: 'join_request_required' });
    expect(api.spaces.invitePreview).not.toHaveBeenCalled(); expect(useSpaceStore.getState().spaces).toEqual([]);
  });
  it('uses native preview to resolve a refusal missing its space ID', async () => {
    vi.mocked(api.spaces.joinByCode).mockRejectedValueOnce(refusal());
    vi.mocked(api.spaces.invitePreview).mockResolvedValueOnce({ ...space, spaceId: space.id, spaceName: space.name, instanceName: 'Native', memberCount: 1 });
    await expect(useSpaceStore.getState().joinByCode('code')).rejects.toMatchObject({ spaceId: space.id });
    expect(api.spaces.invitePreview).toHaveBeenCalledExactlyOnceWith('code');
  });
  it('keeps the original refusal if its native preview is unavailable', async () => {
    const error = refusal(); vi.mocked(api.spaces.joinByCode).mockRejectedValueOnce(error); vi.mocked(api.spaces.invitePreview).mockRejectedValueOnce(new Error('Unavailable'));
    await expect(useSpaceStore.getState().joinByCode('code')).rejects.toBe(error);
  });
  it('passes native ban errors through unchanged', async () => {
    const error = new HttpError(403, 'Banned', undefined, 'user_banned'); vi.mocked(api.spaces.joinByCode).mockRejectedValueOnce(error);
    await expect(useSpaceStore.getState().joinByCode('code')).rejects.toBe(error);
  });
});
