import { useMemo } from 'react';
import type { DmChannel, MemberWithUser, User } from '@veyvox/shared';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore, type SpaceWithMyRoles } from '../stores/spaceStore';
import { canonicalUserViewIn, getCanonicalUserView, useCanonicalUserView } from './userViewLookup';

export const OWNER_NAME_COLOR = '#fda4af';
export const MENTION_CANDIDATE_LIMIT = 8;
export interface ChannelUser {
  userId: string;
  user: User;
  /** Nicknames/roles belong to this space; null for native DMs. */
  member: MemberWithUser | null;
  nameColor: string | null;
}
interface ChannelUserSources { dmChannels: DmChannel[]; members: MemberWithUser[]; spaces: SpaceWithMyRoles[] }
type ChannelRoster =
  | { kind: 'dm'; people: readonly User[] }
  | { kind: 'space'; members: MemberWithUser[]; ownerId: string | null }
  | { kind: 'unknown' };

/** The open roster is not authoritative for another space or for a DM. */
function rosterOf(sources: ChannelUserSources, spaceId: string | undefined, channelId: string): ChannelRoster {
  const dm = sources.dmChannels.find(row => row.id === channelId);
  if (dm) return { kind: 'dm', people: dm.members };
  if (!spaceId) return { kind: 'unknown' };
  return { kind: 'space', members: sources.members.filter(member => member.spaceId === spaceId),
    ownerId: sources.spaces.find(space => space.id === spaceId)?.ownerId ?? null };
}
function fromMember(member: MemberWithUser, ownerId: string | null): ChannelUser {
  const top = member.roles.reduce<MemberWithUser['roles'][number] | null>((best, role) => !best || role.position > best.position ? role : best, null);
  return { userId: member.userId, user: member.user, member, nameColor: top ? top.color : ownerId === member.userId ? OWNER_NAME_COLOR : null };
}
function fromUser(user: User): ChannelUser { return { userId: user.id, user, member: null, nameColor: null }; }
function userInRoster(roster: ChannelRoster, userId: string): ChannelUser | null {
  if (roster.kind === 'dm') { const user = roster.people.find(person => person.id === userId); return user ? fromUser(user) : null; }
  if (roster.kind === 'space') { const member = roster.members.find(row => row.userId === userId); return member ? fromMember(member, roster.ownerId) : null; }
  return null;
}
function channelCandidates(roster: ChannelRoster, selfId: string | undefined): ChannelUser[] {
  if (roster.kind === 'dm') return roster.people.filter(user => user.id !== selfId).map(fromUser);
  if (roster.kind === 'space') return roster.members.map(member => fromMember(member, roster.ownerId));
  return [];
}
function useRoster(channelId: string | null): ChannelRoster {
  const dmChannels = useSpaceStore(state => state.dmChannels), members = useSpaceStore(state => state.members), spaces = useSpaceStore(state => state.spaces);
  const spaceId = useSpaceStore(state => channelId ? state.channelToSpaceMap.get(channelId) : undefined);
  return useMemo(() => channelId ? rosterOf({ dmChannels, members, spaces }, spaceId, channelId) : { kind: 'unknown' }, [dmChannels, members, spaces, spaceId, channelId]);
}

/** Mentions resolve only against the native channel's own people. */
export function resolveChannelUser(channelId: string, userId: string): ChannelUser | null {
  const state = useSpaceStore.getState();
  const found = userInRoster(rosterOf(state, state.channelToSpaceMap.get(channelId), channelId), userId);
  return found ? { ...found, user: getCanonicalUserView(found.user) } : null;
}
export function getChannelMentionCandidates(channelId: string): ChannelUser[] {
  const state = useSpaceStore.getState();
  return channelCandidates(rosterOf(state, state.channelToSpaceMap.get(channelId), channelId), useAuthStore.getState().user?.id);
}
export function filterMentionCandidates(candidates: readonly ChannelUser[], query: string, limit = MENTION_CANDIDATE_LIMIT): ChannelUser[] {
  const q = query.toLowerCase();
  const matches = (user: User) => (user.displayName ?? '').toLowerCase().includes(q) || user.username.toLowerCase().includes(q);
  return candidates.filter(candidate => (candidate.member?.nickname ?? '').toLowerCase().includes(q)
    || matches(candidate.user) || matches(getCanonicalUserView(candidate.user))).slice(0, limit);
}
const NO_USER: User = { id: '', username: '', displayName: null, avatar: null, banner: null, accentColor: null,
  avatarColor: null, bio: null, status: 'offline', customStatus: null, isAdmin: false, createdAt: 0 };
export function useChannelUser(channelId: string | null, userId: string | null): ChannelUser | null {
  const roster = useRoster(channelId);
  const found = useMemo(() => userId ? userInRoster(roster, userId) : null, [roster, userId]);
  const user = useCanonicalUserView(found?.user ?? NO_USER);
  return useMemo(() => found ? { ...found, user } : null, [found, user]);
}
/** One memoized resolver for dynamically parsed mention tokens. */
export function useChannelUserResolver(channelId: string): (userId: string) => ChannelUser | null {
  const roster = useRoster(channelId), views = useSpaceStore(state => state.userViews);
  return useMemo(() => (userId: string) => {
    const found = userInRoster(roster, userId); return found ? { ...found, user: canonicalUserViewIn(views, found.user) } : null;
  }, [roster, views]);
}
export function useChannelMentionCandidates(channelId: string): ChannelUser[] {
  const roster = useRoster(channelId), selfId = useAuthStore(state => state.user?.id);
  return useMemo(() => channelCandidates(roster, selfId), [roster, selfId]);
}
