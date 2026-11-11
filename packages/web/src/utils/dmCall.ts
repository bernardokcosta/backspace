import type { DmCallRef } from '../stores/voiceStore';
import { wsSend } from '../hooks/useWebSocket';

/** Cancel or hang up a native DM call; the caller manages its local state. */
export function sendDmCallEnd(call: DmCallRef): void {
  wsSend({ type: 'dm_call_end', dmChannelId: call.dmChannelId });
}

/** Decline only this account's ring for the native call. */
export function sendDmCallReject(call: DmCallRef): void {
  wsSend({ type: 'dm_call_reject', dmChannelId: call.dmChannelId });
}
