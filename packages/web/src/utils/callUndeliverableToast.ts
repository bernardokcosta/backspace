import i18n from '../i18n';
import { formatters } from '../i18n/formatters';

/**
 * Builds a user-facing toast message from a `dm_call_undeliverable` event.
 *
 * Copy is phase-aware:
 * - `start`: call-start delivery; terminal means the ring was destroyed, non-terminal
 *   means the call continues for other reachable recipients.
 * - `accept`: the acceptor's B→host relay failed; terminal means their optimistic
 *   active-call state was rolled back.
 * - `reject`: the rejector's relay to the host failed; state was already cleared
 *   locally, so non-terminal info toast only.
 * - `end`: the ender's relay to the host failed; state was already cleared locally.
 * - `host_unreachable`: the call was terminated by the sentinel worker because the
 *   host peer became permanently unreachable. Always terminal. A single failure entry
 *   is expected; multiple fall back to a generic line.
 *
 * Extracted from `useWebSocket.ts` so it can be unit-tested without pulling in
 * the full WS handler graph (livekit / audio deps).
 */
export function buildCallUndeliverableToast(
  failures: Array<{ reason: string; peerOrigin?: string; peerLabel?: string }>,
  terminal: boolean,
  phase: 'start' | 'accept' | 'reject' | 'end' | 'host_unreachable' = 'start',
): string {
  const primary = failures[0];
  const labelFor = (f: { peerLabel?: string; peerOrigin?: string }) =>
    f.peerLabel ?? f.peerOrigin?.replace(/^https?:\/\//, '') ?? i18n.t('dm:callDelivery.remoteInstance');
  const labelsFor = () => formatters.formatList(failures.map(labelFor));

  if (phase === 'accept' && terminal) {
    const label = primary ? labelFor(primary) : i18n.t('dm:callDelivery.hostInstance');
    return i18n.t('dm:callDelivery.acceptDropped', { instance: label });
  }

  if (phase === 'reject') {
    const labels = labelsFor() || i18n.t('dm:callDelivery.hostInstance');
    return i18n.t('dm:callDelivery.rejectFailed', { instances: labels });
  }

  if (phase === 'end') {
    const labels = labelsFor() || i18n.t('dm:callDelivery.hostInstance');
    return i18n.t('dm:callDelivery.endFailed', { instances: labels });
  }

  // host_unreachable: call terminated because the host peer became unreachable.
  // Terminal is always true in this phase. A single failure entry is expected;
  // zero or multiple fall back to a generic line.
  if (phase === 'host_unreachable') {
    const [f] = failures;
    if (!f || failures.length !== 1) {
      return i18n.t('dm:callDelivery.hostUnreachable');
    }
    const label = f.peerLabel || f.peerOrigin?.replace(/^https?:\/\//, '') || i18n.t('dm:callDelivery.hostInstance');
    if (f.reason === 'peer_rejected') {
      return i18n.t('dm:callDelivery.peeringLost', { instance: label });
    }
    return i18n.t('dm:callDelivery.instanceUnreachable', { instance: label });
  }

  // phase === 'start' (default + legacy)
  if (!terminal) {
    return i18n.t('dm:callDelivery.someUnreachable', { instances: labelsFor() });
  }
  if (failures.length > 1) {
    return i18n.t('dm:callDelivery.multipleUnreachable', { count: failures.length, instances: labelsFor() });
  }
  if (!primary) return i18n.t('dm:callDelivery.callFailed');

  const label = labelFor(primary);
  switch (primary.reason) {
    case 'peer_rejected':
      return i18n.t('dm:callDelivery.manualApproval', { instance: label });
    case 'peer_awaiting_approval':
      return i18n.t('dm:callDelivery.awaitingApproval', { instance: label });
    case 'peer_transient_failure':
      return i18n.t('dm:callDelivery.transientFailure', { instance: label });
    case 'livekit_unavailable':
      return i18n.t('dm:callDelivery.voiceUnavailable');
    case 'no_recipient':
      return i18n.t('dm:callDelivery.noRecipient', { instance: label });
    default:
      return i18n.t('dm:callDelivery.targetCallFailed', { instance: label });
  }
}
