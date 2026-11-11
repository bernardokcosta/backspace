import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DmChannel, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../api/client', async original => ({ ...await original<typeof import('../api/client')>(), api: { dm: { create } } }));
import { openDirectMessage } from './openDirectMessage';
import { useSpaceStore } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';
const me = { id: 'me' } as User, other = { id: 'other', username: 'retained@old.invalid' } as User;
const dm: DmChannel = { id: 'dm', ownerId: null, name: null, icon: null, createdAt: 1, members: [me, other] };
beforeEach(() => { create.mockReset(); useSpaceStore.getState().reset(); useAuthStore.setState({ user: me }); });
describe('open a native direct message', () => {
  it('reuses the existing native pair without creating another row', async () => {
    useSpaceStore.getState().upsertDmChannel(dm); expect(await openDirectMessage(other.id)).toBe(dm.id); expect(create).not.toHaveBeenCalled();
  });
  it('sends only the native userId and adopts the current API response once', async () => {
    create.mockResolvedValue(dm); expect(await openDirectMessage(other.id)).toBe(dm.id);
    expect(create).toHaveBeenCalledExactlyOnceWith({ userId: other.id }); expect(useSpaceStore.getState().dmChannels).toEqual([dm]);
  });
  it('cannot install an old response after an equal-ID account session is replaced', async () => {
    let finish!: (channel: DmChannel) => void; create.mockReturnValue(new Promise<DmChannel>(resolve => { finish = resolve; }));
    const pending = openDirectMessage(other.id); const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    useAuthStore.setState(s => ({ sessionRevision: s.sessionRevision + 1 })); useSpaceStore.getState().reset(); finish(dm); await rejected;
    expect(useSpaceStore.getState().dmChannels).toEqual([]);
  });
});
