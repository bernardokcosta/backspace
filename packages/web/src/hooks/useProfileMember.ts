import { useMemo } from 'react';
import type { MemberWithUser, Role } from '@veyvox/shared';
import { useSpaceStore } from '../stores/spaceStore';
import type { ProfileMemberContext } from '../stores/uiStore';

/**
 * The space member a profile was opened for, read from the loaded space.
 *
 * `member.userId` is the native account ID the loaded member list carries.
 * The member list only ever holds the current space,
 * so a context naming any other space resolves to nothing rather than to a
 * look-alike from the wrong space.
 */
export function useProfileMember(member: ProfileMemberContext | null | undefined): MemberWithUser | undefined {
  return useSpaceStore((s) =>
    member && s.currentSpaceId === member.spaceId
      ? s.members.find((m) => m.userId === member.userId)
      : undefined,
  );
}

/**
 * Non-reactive read of the same native member when a profile opens.
 */
export function getProfileMember(
  member: ProfileMemberContext,
): MemberWithUser | undefined {
  const state = useSpaceStore.getState();
  if (state.currentSpaceId !== member.spaceId) return undefined;
  return state.members.find((m) => m.userId === member.userId);
}

/**
 * The roles a profile shows for a space member: every assigned role except
 * @everyone (whose id is the space id), highest position first. Presence plays
 * no part; the roles are the member's whether they are connected or not.
 */
export function useProfileMemberRoles(member: ProfileMemberContext | null | undefined): Role[] {
  const row = useProfileMember(member);
  return useMemo(
    () => (row?.roles ?? [])
      .filter((r) => r.id !== row?.spaceId)
      .sort((a, b) => b.position - a.position),
    [row],
  );
}
