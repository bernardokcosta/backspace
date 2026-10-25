import { api, type BackspaceApiClient } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { useInstanceStore } from '../stores/instanceStore';
import { connectedJoinOrigin, NotConnectedError } from '../stores/spaceStore';
import { captureDesktopSessionWork } from './desktopSessionAccess';
import { isJoinRequestPendingError } from './joinErrors';

/** What became of a join request sent from an invite: a new one, or one already waiting. */
export type InviteRequestOutcome = 'sent' | 'pending';

/** Exact connected client: a missing remote must never fall back to home. */
export async function getJoinRequestClient(origin: string): Promise<BackspaceApiClient> {
  const target = await connectedJoinOrigin(origin);
  if (!target) return api;
  const instance = useInstanceStore.getState().instances.find(i => i.origin === target && i.status === 'connected');
  if (!instance) throw new NotConnectedError(target);
  return instance.api;
}

/**
 * Send the join request an invite to a space joined by request leads to,
 * through the existing `POST /api/spaces/:id/request-join`
 * (its rate limit and a manager's approval apply). A request the user
 * already has waiting answers `join_request_pending`, which is reported as
 * `'pending'` rather than thrown. Every other failure is thrown, including
 * `NotConnectedError` for a remote origin without a session.
 */
export async function sendInviteJoinRequest(
  spaceId: string,
  origin: string,
  message?: string,
): Promise<InviteRequestOutcome> {
  const session = useAuthStore.getState().token;
  const work = captureDesktopSessionWork();
  const assertCurrent = () => {
    work.assertCurrent();
    if (useAuthStore.getState().token !== session) throw new DOMException('Session changed', 'AbortError');
  };
  assertCurrent();
  try {
    const client = await getJoinRequestClient(origin);
    assertCurrent();
    await client.joinRequests.request(spaceId, message);
    assertCurrent();
    return 'sent';
  } catch (err) {
    assertCurrent();
    if (isJoinRequestPendingError(err)) return 'pending';
    throw err;
  }
}
