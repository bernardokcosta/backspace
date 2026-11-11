import type { Activity, ActivityAssets, ActivityPlayback, ActivityTimestamps, ActivityType, ServerEvent } from '@veyvox/shared';
import { ACTIVITY_LIMITS } from '@veyvox/shared/src/activities.js';

/**
 * The S→C `presence_update` event, built in one place so every emitter names
 * the subject the same way.
 *
 * `userId` is the current instance's stable local account id.
 *
 * Kept free of `connectionManager` so emitters can share it without a cycle.
 */
export type PresenceUpdateEvent = Extract<ServerEvent, { type: 'presence_update' }>;

/**
 * Build a presence_update about a row already in hand. `activities` omitted
 * means "unchanged" to the client; an empty array clears.
 */
export function presenceUpdateEvent(
  subject: { id: string },
  status: string,
  activities?: Activity[],
): PresenceUpdateEvent {
  return {
    type: 'presence_update',
    userId: subject.id,
    status,
    ...(activities !== undefined ? { activities } : {}),
  };
}

/** Build a presence_update about a verified local account id. */
export function presenceUpdateFor(userId: string, status: string, activities?: Activity[]): PresenceUpdateEvent {
  return presenceUpdateEvent({ id: userId }, status, activities);
}

/**
 * The activity set a snapshot reports for a user: their live
 * activities, else their custom status as a `custom` activity. Used by the
 * ready payload and by the friendship snapshot, so both show the same thing.
 */
export function snapshotActivities(live: Activity[], customStatus: string | null): Activity[] {
  if (live.length > 0) return live;
  return customStatus ? [{ type: 'custom', name: customStatus }] : [];
}

// ─── Activity Validation ──────────────────────────────────────────────────

const VALID_ACTIVITY_TYPES = new Set<string>(['custom', 'playing', 'listening', 'watching', 'streaming']);
const MAX_TIMESTAMP = 4102444800000;
const MAX_PLAYBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Validate and normalize an activity list from a client. Null when
 * anything in it is malformed or over the limits in `ACTIVITY_LIMITS`.
 */
export function validateActivities(raw: unknown): Activity[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > ACTIVITY_LIMITS.MAX_ACTIVITIES_PER_USER) return null;

  const validated: Activity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const obj = item as Record<string, unknown>;
    if (!VALID_ACTIVITY_TYPES.has(obj.type as string)) return null;
    if (typeof obj.name !== 'string') return null;
    // Validate the trimmed name, which is what observers receive.
    if (obj.name.trim().length === 0 || obj.name.length > ACTIVITY_LIMITS.MAX_NAME_LENGTH) return null;

    const activity: Activity = { type: obj.type as ActivityType, name: (obj.name as string).trim() };

    if (typeof obj.details === 'string' && obj.details.length <= ACTIVITY_LIMITS.MAX_DETAILS_LENGTH) activity.details = obj.details.trim();
    if (typeof obj.state === 'string' && obj.state.length <= ACTIVITY_LIMITS.MAX_STATE_LENGTH) activity.state = obj.state.trim();
    if (typeof obj.url === 'string' && obj.url.length <= ACTIVITY_LIMITS.MAX_URL_LENGTH) {
      if (obj.url.startsWith('https://') || obj.url.startsWith('http://')) activity.url = obj.url;
    }

    if (obj.timestamps && typeof obj.timestamps === 'object') {
      const tsObj = obj.timestamps as Record<string, unknown>;
      const ts: ActivityTimestamps = {};
      if (typeof tsObj.start === 'number' && tsObj.start >= 0 && tsObj.start <= MAX_TIMESTAMP) ts.start = tsObj.start;
      if (typeof tsObj.end === 'number' && tsObj.end >= 0 && tsObj.end <= MAX_TIMESTAMP) ts.end = tsObj.end;
      if (ts.start !== undefined || ts.end !== undefined) activity.timestamps = ts;
    }

    if (obj.playback && typeof obj.playback === 'object') {
      const playbackObj = obj.playback as Record<string, unknown>;
      const positionMs = playbackObj.positionMs;
      const durationMs = playbackObj.durationMs;
      if (
        typeof positionMs === 'number'
        && Number.isFinite(positionMs)
        && positionMs >= 0
        && positionMs <= MAX_PLAYBACK_MS
      ) {
        const playback: ActivityPlayback = { positionMs };
        if (
          typeof durationMs === 'number'
          && Number.isFinite(durationMs)
          && durationMs > 0
          && durationMs <= MAX_PLAYBACK_MS
        ) {
          playback.durationMs = durationMs;
          playback.positionMs = Math.min(positionMs, durationMs);
        }
        activity.playback = playback;
      }
    }

    if (obj.assets && typeof obj.assets === 'object') {
      const aObj = obj.assets as Record<string, unknown>;
      const assets: ActivityAssets = {};
      if (typeof aObj.largeImage === 'string' && aObj.largeImage.length <= ACTIVITY_LIMITS.MAX_URL_LENGTH) assets.largeImage = aObj.largeImage;
      if (typeof aObj.largeText === 'string' && aObj.largeText.length <= ACTIVITY_LIMITS.MAX_ASSET_TEXT_LENGTH) assets.largeText = aObj.largeText;
      if (typeof aObj.smallImage === 'string' && aObj.smallImage.length <= ACTIVITY_LIMITS.MAX_URL_LENGTH) assets.smallImage = aObj.smallImage;
      if (typeof aObj.smallText === 'string' && aObj.smallText.length <= ACTIVITY_LIMITS.MAX_ASSET_TEXT_LENGTH) assets.smallText = aObj.smallText;
      if (Object.keys(assets).length > 0) activity.assets = assets;
    }

    validated.push(activity);
  }
  return validated;
}

/**
 * Advance stored media positions by the time an activity has been held on this
 * server. A late WebSocket ready must see the current point, not the position
 * from whenever the desktop last reported it.
 */
export function projectActivityPlayback(activities: Activity[], elapsedMs: number): Activity[] {
  if (elapsedMs <= 0) return activities;
  let changed = false;
  const projected = activities.map((activity) => {
    const playback = activity.playback;
    if (!playback) return activity;

    const positionMs = playback.durationMs === undefined
      ? playback.positionMs + elapsedMs
      : Math.min(playback.durationMs, playback.positionMs + elapsedMs);
    if (positionMs === playback.positionMs) return activity;

    changed = true;
    return {
      ...activity,
      playback: { ...playback, positionMs },
    };
  });
  return changed ? projected : activities;
}
