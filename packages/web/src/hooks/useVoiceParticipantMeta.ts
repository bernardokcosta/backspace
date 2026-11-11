import { useMemo } from 'react';
import { useSpaceStore } from '../stores/spaceStore';
import { userDisplayName } from '../utils/identity';
import { canonicalUserViewIn } from '../utils/userViewLookup';
import type { ParticipantInfo } from './useLiveKit';
import type { User } from '@veyvox/shared';

/** Native participant metadata stays reactive even after the visible space changes. */
export function useVoiceParticipantMeta(participant: ParticipantInfo) {
  const members = useSpaceStore(state => state.members), dmChannels = useSpaceStore(state => state.dmChannels), views = useSpaceStore(state => state.userViews);
  return useMemo(() => {
    const row = members.find(member => member.userId === participant.userId)?.user
      ?? dmChannels.flatMap(dm => dm.members).find(user => user.id === participant.userId)
      ?? participant.cachedUser;
    const user: User | null = row ? canonicalUserViewIn(views, row) : null;
    return { displayName: user ? userDisplayName(user) : participant.username, avatar: user?.avatar ?? null, user };
  }, [members, dmChannels, views, participant.userId, participant.username, participant.cachedUser]);
}
