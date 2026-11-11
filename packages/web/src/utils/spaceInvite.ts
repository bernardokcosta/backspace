import type { TFunction } from 'i18next';
import type { Friend } from '@veyvox/shared';
import { api, HttpError } from '../api/client';

export type SpaceInviteSendStatus =
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'failure'; reason: string };
type InviteT = TFunction<['spaces', 'common']>;

/** The native space and its current invitation code. */
export interface SpaceInviteSource {
  spaceId: string;
  inviteCode: string;
}

/** Row-sized localized reasons shared by both invitation pickers. */
export function spaceInviteFailureReason(error: unknown, t: InviteT): string {
  if (error instanceof HttpError) {
    switch (error.code) {
      case 'invite_invalid': return t('spaces:invite.failure.inviteInvalid');
      case 'not_a_friend': return t('spaces:invite.failure.notAFriend');
      case 'user_not_found': return t('spaces:invite.failure.userNotFound');
      case 'already_member': return t('spaces:invite.failure.alreadyMember');
      case 'cannot_invite_self': return t('spaces:invite.failure.cannotInviteSelf');
      case 'invalid_body': return t('spaces:invite.failure.invalidBody');
      case 'invalid_target': return t('spaces:invite.failure.invalidTarget');
      default: break;
    }
  }
  if (error instanceof Error && /network|fetch|failed to fetch/i.test(error.message)) {
    return t('spaces:invite.failure.unreachable');
  }
  return t('spaces:invite.failure.serverError');
}

/** Both invitation pickers use the current API and native target IDs. */
export async function sendSpaceInvite(friend: Friend, space: SpaceInviteSource, t: InviteT): Promise<SpaceInviteSendStatus> {
  try {
    await api.dm.spaceInvite({ target: { userId: friend.id }, spaceId: space.spaceId,
      spaceInstanceOrigin: '', inviteCode: space.inviteCode });
    return { kind: 'success' };
  } catch (error) {
    return { kind: 'failure', reason: spaceInviteFailureReason(error, t) };
  }
}
