import { api } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { isJoinRequestPendingError } from './joinErrors';

/** What became of a join request sent from an invite: a new one, or one already waiting. */
export type InviteRequestOutcome = 'sent' | 'pending';

/**
 * Send the join request an invite to a space joined by request leads to,
 * through the existing `POST /api/spaces/:id/request-join`
 * (its rate limit and a manager's approval apply). A request the user
 * already has waiting answers `join_request_pending`, which is reported as
 * `'pending'` rather than thrown. Every other failure is thrown.
 */
export async function sendInviteJoinRequest(
  spaceId: string,
  message?: string,
): Promise<InviteRequestOutcome> {
  const session = useAuthStore.getState().sessionRevision;
  const assertCurrent = () => {
    if (useAuthStore.getState().sessionRevision !== session) throw new DOMException('Session changed', 'AbortError');
  };
  assertCurrent();
  try {
    await api.joinRequests.request(spaceId, message);
    assertCurrent();
    return 'sent';
  } catch (err) {
    assertCurrent();
    if (isJoinRequestPendingError(err)) return 'pending';
    throw err;
  }
}
