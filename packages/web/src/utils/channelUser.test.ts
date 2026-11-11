import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberWithUser, Role, User } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { filterMentionCandidates, getChannelMentionCandidates, resolveChannelUser } from './channelUser';
import { junoUser } from '../components/games/junoTestFixtures';
import { wireDm } from '../test/dmWireShape';
const me = { ...junoUser('me'), username: 'alice', displayName: 'Alice' };
const kai = { ...junoUser('kai'), username: 'kai@retained.test', displayName: 'Kai' };
const zed = { ...junoUser('zed'), username: 'zed', displayName: null };
const dm = wireDm({ id: 'dm', createdAt: 1, members: [me, kai] });
const member = (spaceId: string, user: User, roles: Role[] = []): MemberWithUser => ({ spaceId, userId: user.id, nickname: null, joinedAt: 1, user, roles });
const role = (id: string, color: string, position: number): Role => ({ id, spaceId: 'space', name: id, color, position, permissions: '0', createdAt: 1 });
beforeEach(() => { useSpaceStore.getState().reset(); useAuthStore.setState({ user: me }); });
afterEach(() => { useAuthStore.setState({ user: null }); });
describe('native channel user resolution', () => {
  it('finds a DM member only in that DM roster, without space context or role colors', () => {
    useSpaceStore.setState({ dmChannels: [dm], members: [member('space', zed)] });
    expect(resolveChannelUser(dm.id, kai.id)).toMatchObject({ userId: kai.id, user: kai, member: null, nameColor: null });
    expect(resolveChannelUser(dm.id, zed.id)).toBeNull();
  });
  it('does not treat an unknown DM ID as a listed DM or use a stale space roster', () => {
    useSpaceStore.setState({ dmChannels: [dm], members: [member('space', kai)] }); expect(resolveChannelUser('unknown', kai.id)).toBeNull();
  });
  it('finds a space member only in the channel own loaded roster', () => {
    useSpaceStore.setState({ channelToSpaceMap: new Map([['c1', 'space'], ['c2', 'other']]), members: [member('space', kai)] });
    expect(resolveChannelUser('c1', kai.id)?.member?.spaceId).toBe('space'); expect(resolveChannelUser('c2', kai.id)).toBeNull();
  });
  it('colors members by highest role and the owner rose without a role', () => {
    useSpaceStore.setState({ channelToSpaceMap: new Map([['c1', 'space']]), spaces: [{ id: 'space', name: 'Native', icon: null, banner: null,
      avatarColor: null, ownerId: zed.id, ownerTitle: null, inviteCode: null, visibility: 'private', description: null, createdAt: 1 }],
      members: [member('space', kai, [role('low', '#00ff00', 1), role('high', '#ff0000', 5)]), member('space', zed), member('space', me)] });
    expect(resolveChannelUser('c1', kai.id)?.nameColor).toBe('#ff0000'); expect(resolveChannelUser('c1', zed.id)?.nameColor).toBe('#fda4af'); expect(resolveChannelUser('c1', me.id)?.nameColor).toBeNull();
  });
  it('reuses the better profile only under the exact native ID', () => {
    useSpaceStore.setState({ dmChannels: [dm] }); const fresh = { ...kai, displayName: 'Updated Kai' }; useSpaceStore.getState().upsertUserView(fresh);
    expect(resolveChannelUser(dm.id, kai.id)?.user).toBe(fresh); expect(resolveChannelUser(dm.id, kai.id)?.userId).toBe(kai.id);
  });
});
describe('native mention candidates and filtering', () => {
  it('lists a DM members except the authenticated native self ID', () => {
    useSpaceStore.setState({ dmChannels: [dm], members: [member('unrelated', zed)] }); expect(getChannelMentionCandidates(dm.id).map(row => row.userId)).toEqual([kai.id]);
  });
  it('lists only the channel space roster, with no candidates for unknown channels', () => {
    useSpaceStore.setState({ channelToSpaceMap: new Map([['c1', 'space']]), members: [member('space', kai), member('other', zed)] });
    expect(getChannelMentionCandidates('c1').map(row => row.userId)).toEqual([kai.id]); expect(getChannelMentionCandidates('unknown')).toEqual([]);
  });
  it('matches display name, complete username and nickname case-insensitively and honors limits', () => {
    useSpaceStore.setState({ channelToSpaceMap: new Map([['c1', 'space']]), members: [{ ...member('space', kai), nickname: 'Pilot' }, member('space', zed), member('space', me)] });
    const all = getChannelMentionCandidates('c1');
    for (const query of ['KA', 'retained', 'PIL']) expect(filterMentionCandidates(all, query).map(row => row.userId)).toEqual([kai.id]);
    expect(filterMentionCandidates(all, 'ali').map(row => row.userId)).toEqual([me.id]); expect(filterMentionCandidates(all, '', 2)).toHaveLength(2);
  });
});
