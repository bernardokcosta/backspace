import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from './spaceStore';
import { api } from '../api/client';
beforeEach(() => { vi.restoreAllMocks(); useSpaceStore.getState().reset(); vi.spyOn(api.spaces, 'invite').mockResolvedValue({ inviteCode: 'native-code' }); });
describe('native invite generation', () => {
  it('passes only the native space ID through the primary API', async () => {
    expect(await useSpaceStore.getState().generateInvite('native-space')).toBe('native-code');
    expect(api.spaces.invite).toHaveBeenCalledExactlyOnceWith('native-space');
  });
  it('rejects a previous-session code even with an equal space ID', async () => {
    let finish!: (value: { inviteCode: string }) => void;
    vi.mocked(api.spaces.invite).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = useSpaceStore.getState().generateInvite('native-space').catch((error: unknown) => error);
    useSpaceStore.getState().reset(); finish({ inviteCode: 'old-code' });
    await expect(pending).resolves.toMatchObject({ name: 'AbortError' });
  });
});
