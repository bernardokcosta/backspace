import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useSpaceStore } from './spaceStore';
import { junoUser } from '../components/games/junoTestFixtures';
beforeEach(() => useSpaceStore.getState().reset());
describe('native cached profile views', () => {
  it('inserts the exact native row and its timestamp', () => {
    const user = junoUser('native'); useSpaceStore.getState().upsertUserView(user);
    expect(useSpaceStore.getState().userViews.get(user.id)).toEqual({ user, updatedAt: expect.any(Number) });
  });
  it('updates a native profile with the later row, without a second copy', () => {
    const user = junoUser('native'); useSpaceStore.getState().upsertUserView(user);
    useSpaceStore.getState().upsertUserView({ ...user, displayName: 'Later name', avatarColor: 'sky' });
    expect(useSpaceStore.getState().userViews.size).toBe(1);
    expect(useSpaceStore.getState().userViews.get(user.id)?.user).toMatchObject({ displayName: 'Later name', avatarColor: 'sky' });
  });
  it('does not merge different native IDs with an equal retained handle', () => {
    for (const id of ['first', 'second']) useSpaceStore.getState().upsertUserView({ ...junoUser(id), username: 'native@retained.test' });
    expect([...useSpaceStore.getState().userViews.keys()]).toEqual(['first', 'second']);
  });
  it('reset evicts every old native cached profile', () => {
    useSpaceStore.getState().upsertUserView(junoUser('native')); useSpaceStore.getState().reset();
    expect(useSpaceStore.getState().userViews.size).toBe(0);
  });
});
