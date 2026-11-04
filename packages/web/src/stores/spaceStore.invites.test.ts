import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpaceStore, type TaggedSpace } from './spaceStore';

vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
const api = vi.hoisted(() => ({ invite: vi.fn(), origins: [] as string[] }));
vi.mock('../utils/crossStoreResolvers', async importOriginal => ({
  ...await importOriginal<typeof import('../utils/crossStoreResolvers')>(),
  getApiForOrigin: (origin: string) => {
    api.origins.push(origin);
    return { spaces: { invite: api.invite } };
  },
}));

const remote: TaggedSpace = { id: 'same', name: 'Remote', icon: null, banner: null, avatarColor: null,
  ownerId: 'owner', ownerTitle: null, inviteCode: null, visibility: 'private', description: '', createdAt: 1,
  _instanceOrigin: 'https://remote.example' };
beforeEach(() => {
  vi.clearAllMocks(); api.origins.length = 0;
  api.invite.mockResolvedValue({ inviteCode: 'code' });
  useSpaceStore.setState({ spaces: [remote, { ...remote, name: 'Local', _instanceOrigin: '' }] });
});

describe('space invite generation origin', () => {
  it.each(['', 'https://remote.example'])('uses explicit origin %s instead of an id-only lookup', async origin => {
    expect(await useSpaceStore.getState().generateInvite('same', origin)).toBe('code');
    expect(api.origins).toEqual([origin]);
    expect(api.invite).toHaveBeenCalledWith('same');
  });
  it('keeps legacy callers resolving the listed space origin', async () => {
    expect(await useSpaceStore.getState().generateInvite('same')).toBe('code');
    expect(api.origins).toEqual(['https://remote.example']);
  });
});
