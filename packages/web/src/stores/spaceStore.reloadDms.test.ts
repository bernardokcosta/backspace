import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from './spaceStore';
import { api } from '../api/client';
import { wireDm, copyDm } from '../test/dmWireShape';
import { junoUser } from '../components/games/junoTestFixtures';
const pair = wireDm({ id: 'pair', createdAt: 1, members: [junoUser('me'), junoUser('bob')] });
const group = wireDm({ id: 'group', ownerId: 'me', name: 'Weekend plans', icon: 'group.png', metadataUpdatedAt: 42,
  createdAt: 3, members: [junoUser('me'), junoUser('bob'), junoUser('carol')] });
beforeEach(() => { useSpaceStore.getState().reset(); vi.spyOn(api.dm, 'list').mockResolvedValue([pair, group].map(copyDm)); });
afterEach(() => vi.restoreAllMocks());
describe('native DM reload', () => {
  it('uses the current API and preserves distinct native pairs and group metadata', async () => {
    await useSpaceStore.getState().reloadDms();
    expect(api.dm.list).toHaveBeenCalledExactlyOnceWith();
    expect(useSpaceStore.getState().dmChannels).toHaveLength(2);
    expect(useSpaceStore.getState().dmChannels.find(row => row.id === group.id)).toEqual(group);
    expect(useSpaceStore.getState().userViews.has('carol')).toBe(true);
  });
  it('honors an explicit null group icon from the authoritative list', async () => {
    useSpaceStore.getState().upsertDmChannel(group);
    vi.mocked(api.dm.list).mockResolvedValueOnce([{ ...group, icon: null, metadataUpdatedAt: 43 }]);
    await useSpaceStore.getState().reloadDms();
    expect(useSpaceStore.getState().dmChannels[0]).toMatchObject({ id: group.id, icon: null, metadataUpdatedAt: 43 });
  });
  it('does not make up external identity or private pair-key wire fields for native pairs', async () => {
    await useSpaceStore.getState().reloadDms();
    const row = useSpaceStore.getState().dmChannels.find(dm => dm.id === pair.id);
    for (const key of ['federatedId', 'pairKey', 'ownerHomeUserId', 'ownerHomeInstance']) expect(row).not.toHaveProperty(key);
  });
  it('leaves the native listing intact after a failed refresh', async () => {
    useSpaceStore.getState().upsertDmChannel(group); vi.mocked(api.dm.list).mockRejectedValueOnce(new Error('Unavailable'));
    await expect(useSpaceStore.getState().reloadDms()).rejects.toThrow('Unavailable');
    expect(useSpaceStore.getState().dmChannels).toEqual([group]);
  });
});
