import { eq } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { type Activity, type BotActivity, type ChosenUserStatus, type UserStatus } from '@veyvox/shared';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from './handler.js';
import { collectProfileBroadcastTargetIds } from '../utils/userDeletion.js';
import { presenceUpdateEvent, presenceUpdateFor, snapshotActivities } from './presenceEvent.js';
import { botActivityAsLive } from '../utils/botActivity.js';

/**
 * The one path for a user changing their own status, shared by REST
 * `PATCH /api/users/@me` and the WS `presence_update` client event.
 *
 * - Writes `chosen_status`, so the choice survives disconnects, restarts and
 *   the boot presence reset.
 * - Live `status` follows only while the user has a connection: 'offline'
 *   keeps meaning "no connection". Without one, nobody is told anything; the
 *   next socket auth publishes the choice (utils/presenceStatus.ts).
 * - While connected: updates the in-memory status cache (later activity
 *   broadcasts read it), tells friends, DM and space co-members and the user's
 *   own other sessions.
 */
export function applyChosenStatus(userId: string, status: ChosenUserStatus): void {
  const db = getDb();
  const row = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!row) return;

  const connected = connectionManager.isUserOnline(userId);

  if (connected) {
    db.update(schema.users).set({ chosenStatus: status, status }).where(eq(schema.users.id, userId)).run();
  } else {
    db.update(schema.users).set({ chosenStatus: status }).where(eq(schema.users.id, userId)).run();
  }

  if (!connected) return;

  connectionManager.setUserStatus(userId, status);
  const activities: Activity[] = connectionManager.getUserActivities(userId);
  const payload = presenceUpdateFor(userId, status, activities.length > 0 ? activities : undefined);
  for (const uid of collectProfileBroadcastTargetIds(userId)) connectionManager.sendToUser(uid, payload);
  connectionManager.sendToUser(userId, payload);

}

/**
 * Make `activities` the live activity set of a connected user and tell everyone
 * who sees their presence: friends, DM and space co-members, the user's own
 * sessions.
 * The caller has validated the list. The one publisher for the WS
 * `activity_update` and for a bot's stored status (`applyStoredBotActivity`).
 */
export function publishActivities(userId: string, activities: Activity[], ws?: WebSocket): void {
  connectionManager.setUserActivities(userId, activities, ws);
  const status = connectionManager.getUserStatus(userId) as UserStatus;
  // getUserActivities projects playback positions to now, so late joins see current progress.
  const published = connectionManager.getUserActivities(userId);

  const payload = presenceUpdateFor(userId, status, published);
  for (const uid of collectProfileBroadcastTargetIds(userId)) connectionManager.sendToUser(uid, payload);
  connectionManager.sendToUser(userId, payload);

}

/**
 * A bot's owner changed its stored activity. While the bot
 * is connected to this instance and shows activities, the new status replaces
 * its live activity at once, also one the bot code set (null clears it). An
 * offline bot shows no activity; the stored value applies at its next
 * connection (`seedStoredBotActivity` in ws/handler.ts).
 */
export function applyStoredBotActivity(userId: string, activity: BotActivity | null): void {
  if (!connectionManager.isUserOnline(userId)) return;
  if (!connectionManager.getUserShowActivity(userId)) return;
  publishActivities(userId, botActivityAsLive(activity));
}

/**
 * Send `recipientId`'s sessions the current presence of `subjectId`: status and
 * the activity snapshot (live activities, else the custom status),
 * as the ready payload would report them. An offline subject reports no
 * activities.
 */
export function sendPresenceSnapshot(recipientId: string, subjectId: string): void {
  const subject = getDb()
    .select({
      id: schema.users.id,
      status: schema.users.status,
      customStatus: schema.users.customStatus,
    })
    .from(schema.users)
    .where(eq(schema.users.id, subjectId))
    .get();
  if (!subject) return;
  const status = subject.status ?? 'offline';
  const activities = status === 'offline'
    ? []
    : snapshotActivities(connectionManager.getUserActivities(subject.id), subject.customStatus);
  connectionManager.sendToUser(recipientId, presenceUpdateEvent(subject, status, activities));
}

/**
 * A friendship between two rows of this instance was just created. Presence
 * events only fire on change, so without this a friend who was already in a
 * game when the friendship formed would show none until it changed (#340).
 *
 * - Each side's sessions get the other's current presence.
 */
export function exchangeFriendPresence(userIdA: string, userIdB: string): void {
  // Best effort: the friendship is already committed.
  try {
    sendPresenceSnapshot(userIdA, userIdB);
    sendPresenceSnapshot(userIdB, userIdA);
  } catch (e) {
    console.warn('[presence] exchangeFriendPresence failed', e);
  }
}
