import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User, MemberWithUser } from '@veyvox/shared';
vi.mock('../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({ setOutputDevice: vi.fn(), setVolume: vi.fn() }) } }));
vi.mock('../hooks/useWebSocket', () => ({ wsSend: vi.fn() }));
import { useSpaceStore } from '../stores/spaceStore';
import { useAuthStore } from '../stores/authStore';
import { resolveChannelUser, getChannelMentionCandidates, filterMentionCandidates, useChannelUser, useChannelUserResolver } from './channelUser';
import { getCanonicalUserView } from './userViewLookup';
import { useVoiceParticipantMeta } from '../hooks/useVoiceParticipantMeta';
import type { ParticipantInfo } from '../hooks/useLiveKit';
const user = (id: string): User => ({ id, username: `${id}@retained.invalid`, displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'online', customStatus: null, isAdmin: false, createdAt: 1 });
const member = (spaceId: string, id: string): MemberWithUser => ({ spaceId, userId: id, user: user(id), nickname: null, roles: [], joinedAt: 1 });
beforeEach(() => { useSpaceStore.getState().reset(); useAuthStore.setState({ user: user('me') }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('native channel-scoped roster/name lookup', () => {
  it('resolves a native DM only from that DM roster, never a loaded space or another DM', () => {
    useSpaceStore.getState().upsertDmChannel({ id: 'dm', ownerId: null, name: null, icon: null, createdAt: 1, members: [user('me'), user('bob')] });
    useSpaceStore.setState({ members: [member('s', 'carol')] });
    expect(resolveChannelUser('dm', 'bob')).toMatchObject({ userId: 'bob', member: null, nameColor: null });
    expect(resolveChannelUser('dm', 'bob')).not.toHaveProperty('origin'); expect(resolveChannelUser('dm', 'carol')).toBeNull();
    expect(getChannelMentionCandidates('dm').map(row => row.userId)).toEqual(['bob']);
  });
  it('resolves a space only through its own loaded roster, keeping nickname/role color context', () => {
    useSpaceStore.setState({ channelToSpaceMap: new Map([['a', 's'], ['b', 'other']]), members: [{ ...member('s', 'bob'), nickname: 'Local nickname' }] });
    expect(resolveChannelUser('a', 'bob')?.member?.nickname).toBe('Local nickname'); expect(resolveChannelUser('b', 'bob')).toBeNull(); expect(resolveChannelUser('unknown', 'bob')).toBeNull();
    expect(filterMentionCandidates(getChannelMentionCandidates('a'), 'NICKNAME').map(row => row.userId)).toEqual(['bob']);
  });
  it('memoizes native profile lookup and updates both one-person and bulk hooks on cache changes', () => {
    const row = user('bob'); useSpaceStore.getState().upsertDmChannel({ id: 'dm', ownerId: null, name: null, icon: null, createdAt: 1, members: [row] });
    const { result } = renderHook(() => ({ one: useChannelUser('dm', 'bob'), resolve: useChannelUserResolver('dm') }));
    const changed = { ...row, displayName: 'Changed' }; act(() => useSpaceStore.getState().upsertUserView(changed));
    expect(getCanonicalUserView(row)).toBe(changed); expect(getCanonicalUserView(row)).toBe(getCanonicalUserView(row));
    expect(result.current.one?.user).toBe(changed); expect(result.current.resolve('bob')?.user).toBe(changed);
    expect(result.current.resolve('missing')).toBeNull();
  });
  it('does not reuse an equal-id profile across native session resets', () => {
    const old = { ...user('bob'), displayName: 'Old server' }; useSpaceStore.getState().upsertUserView(old); useSpaceStore.getState().reset();
    const next = { ...user('bob'), displayName: 'Next server' }; expect(getCanonicalUserView(next)).toBe(next);
  });
  it('voice metadata uses the native cached profile and keeps the complete retained username', () => {
    const row = user('bob');
    const participant = { userId: 'bob', username: row.username, cachedUser: row } as ParticipantInfo;
    const { result } = renderHook(() => useVoiceParticipantMeta(participant));
    expect(result.current.displayName).toBe(row.username); expect(result.current).not.toHaveProperty('origin');
    const fresh = { ...row, displayName: 'Fresh' }; act(() => useSpaceStore.getState().upsertUserView(fresh));
    expect(result.current.displayName).toBe('Fresh'); expect(result.current.user).toBe(fresh);
  });
});
