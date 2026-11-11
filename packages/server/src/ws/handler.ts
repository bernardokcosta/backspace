import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { verifyJwt } from '../utils/auth.js';
import { consumeWsEvent, wsEventRateLimitError } from '../utils/rateLimits.js';
import { getDb, schema } from '../db/index.js';
import { eq, and, or, inArray, desc, sql } from 'drizzle-orm';
import { handleClientEvent } from './events.js';
import { recordSocketAddress } from './socketAddress.js';
import { computePermissions, PermissionBits, permissionsToString } from '../utils/permissions.js';
import { idsHiddenFromEveryone } from '@veyvox/shared/src/permissions.js';
import { BOT_TOKEN_IN_USE_CLOSE_CODE } from '@veyvox/shared/src/constants.js';
import type {
  User,
  Space,
  SpaceWithChannelsAndMembers,
  MemberWithUser,
  Channel,
  ChannelCategory,
  DmChannel,
  ServerEvent,
  SpaceFolder,
  SpaceLayoutItem,
  ReadState,
  ActiveCallInfo,
  Activity,
} from '@veyvox/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { batchInArray } from '../utils/sqlBatch.js';
import { loadOpenDmChannels } from '../utils/dmChannelWire.js';
import { collectProfileBroadcastTargetIds } from '../utils/userDeletion.js';
import { statusOnConnect, type StatusSourceRow } from '../utils/presenceStatus.js';
import { type ChosenUserStatus } from '@veyvox/shared';
import { presenceUpdateFor, projectActivityPlayback, snapshotActivities } from './presenceEvent.js';
import { isGroupConversation } from '../utils/dmConversation.js';
import { memberRolesView, rolesForViewer } from '../utils/permissionDataView.js';
import { canCountUnread, readyUnreadCounts, unreadCountFollowUp } from './channelUnreadCounts.js';
import { userWrittenMessages } from '../db/userWrittenMessages.js';
import { isBotTokenString, isRetiredLegacyBotJwt, verifyBotToken } from '../utils/botTokens.js';
import { botActivityAsLive, parseStoredBotActivity } from '../utils/botActivity.js';

// ─── Heartbeat State ──────────────────────────────────────────────────────────
const wsIsAlive: WeakMap<WebSocket, boolean> = new WeakMap();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export const VOICE_RECONNECT_GRACE_MS = 60_000;
const MAX_PENDING_VOICE_RECONNECTS = 10_000;

export interface AuthenticatedSocket {
  ws: WebSocket;
  userId: string;
  username: string;
}

// ─── VoiceRoom Abstraction ─────────────────────────────────────────────────

export interface SpaceRoomMeta {
  type: 'space';
  spaceId: string;
}

export interface DmRoomMeta {
  type: 'dm';
  callerId: string;
  state: 'ringing' | 'active';
  /**
   * The call is in a group conversation (`isGroupConversation`). A group
   * member's end or decline removes only that member; in a 1-on-1 either
   * side ends the call (voice.md, "DM Call State Machine").
   */
  group: boolean;
  /** Members who declined while the call rang. Read only for group calls. */
  declinedUserIds: Set<string>;
}

interface PendingVoiceReconnect {
  timeout: NodeJS.Timeout;
  roomId: string;
}

export interface VoiceRoom {
  roomId: string;
  roomType: 'space' | 'dm';
  participants: Set<string>;
  metadata: SpaceRoomMeta | DmRoomMeta;
  startedAt: number;
}

/** Whole occupied seconds for the wire protocol; never exposes a server clock timestamp. */
export function getVoiceRoomElapsedSeconds(room: VoiceRoom, now = Date.now()): number {
  return Math.max(0, Math.floor((now - room.startedAt) / 1_000));
}

// ─── ConnectionManager ─────────────────────────────────────────────────────

class ConnectionManager {
  // userId → Set of WebSocket connections (multiple tabs)
  private connections: Map<string, Set<WebSocket>> = new Map();
  // userId → Set of space IDs the user belongs to
  private userSpaces: Map<string, Set<string>> = new Map();
  /**
   * Voice rooms a BOT sits in. A bot may be in many voice channels at once, one
   * instance per channel, so it is kept apart from `userToRoom` (one room per
   * user, the rule every human session lives by). Members of these rooms are in
   * `room.participants` like anyone else, so everything that reads occupancy
   * (the ready payload, voice_state_update) already sees them.
   */
  private botRooms: Map<string, Set<string>> = new Map();
  /**
   * One live socket per bot credential: a `bsb_` token is held as `token:<id>`,
   * a JWT login of a legacy local bot as `account:<userId>`. A bot runs as one process that serves
   * all of its channels; a second process with the same credential is refused
   * instead of splitting the bot's events and seats between the two.
   */
  private botSessions: Map<string, WebSocket> = new Map();
  private wsBotSession: Map<WebSocket, string> = new Map();
  // ws → userId (reverse lookup)
  private wsToUser: Map<WebSocket, string> = new Map();
  // Unified voice room tracking (replaces voiceStates + activeCalls)
  private voiceRooms: Map<string, VoiceRoom> = new Map();
  // O(1) reverse index: userId → roomId
  private userToRoom: Map<string, string> = new Map();
  // userId → { isMuted, isDeafened, isCameraOn, isScreenSharing } — voice user status
  private voiceUserStates: Map<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }> = new Map();
  // userId → Timeout
  private pendingOfflineTimeouts: Map<string, NodeJS.Timeout> = new Map();
  // Voice has a longer grace than presence so a VPN/network handover can be
  // recovered by LiveKit without creating a visible leave/join cycle.
  private pendingVoiceReconnects: Map<string, PendingVoiceReconnect> = new Map();
  // roomId → Timeout for ringing DM rooms (60s auto-cleanup)
  private ringingTimeouts: Map<string, NodeJS.Timeout> = new Map();
  // Space-muted/deafened users (moderator action)
  private spaceMutedUsers: Set<string> = new Set(); // Stores spaceId:userId
  private spaceDeafenedUsers: Set<string> = new Set(); // Stores spaceId:userId
  // Permission-muted users (SPEAK permission revoked while in voice)
  private permissionMutedUsers: Set<string> = new Set(); // Stores spaceId:userId
  /**
   * Permission mute of a bot SEAT (`bot_voice_join`), keyed `roomId:botId`. A bot
   * sits in several channels at once and SPEAK is computed per channel, so the
   * per-space flag above cannot hold it: muted in one channel must not mean
   * muted in the others. A person (one room at a time) keeps the per-space flag.
   */
  private botSeatPermissionMuted: Set<string> = new Set();
  // The specific WebSocket that initiated voice_join / DM call for this user.
  // When THIS socket closes, voice cleanup enters the reconnect grace period.
  private voiceWs: Map<string, WebSocket> = new Map();

  // ─── Rich Presence ──────────────────────────────────────────────────────
  // userId → Activity[] (ephemeral, same lifecycle as voiceUserStates)
  private userActivities: Map<string, Activity[]> = new Map();
  private activityObservedAt: Map<string, number> = new Map();
  // userId → boolean (cached from DB at auth time, updated via REST)
  private userShowActivity: Map<string, boolean> = new Map();
  // userId → status string (cached at auth, updated on presence_update)
  private userStatuses: Map<string, string> = new Map();
  // userId → timestamp of last activity_update (rate limiting)
  private lastActivityUpdate: Map<string, number> = new Map();
  // userId → the WebSocket that published the current userActivities
  private activityWs: Map<string, WebSocket> = new Map();

  addConnection(userId: string, ws: WebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(ws);
    this.wsToUser.set(ws, userId);

    // If they were pending offline, cancel it!
    this.cancelDisconnect(userId);
  }

  /**
   * Holds the bot credential `key` for this socket. False while another socket
   * that is still open holds it; a holder that is closing or closed is replaced.
   */
  claimBotSession(key: string, ws: WebSocket): boolean {
    const held = this.botSessions.get(key);
    if (held && held !== ws && held.readyState === 1 /* WebSocket.OPEN */) return false;
    if (held && held !== ws) this.wsBotSession.delete(held);
    this.botSessions.set(key, ws);
    this.wsBotSession.set(ws, key);
    return true;
  }

  /** Lets go of the bot credential this socket held, if any. */
  releaseBotSession(ws: WebSocket): void {
    const key = this.wsBotSession.get(ws);
    if (key === undefined) return;
    this.wsBotSession.delete(ws);
    if (this.botSessions.get(key) === ws) this.botSessions.delete(key);
  }

  removeConnection(ws: WebSocket): string | undefined {
    this.releaseBotSession(ws);
    const userId = this.wsToUser.get(ws);
    if (!userId) return undefined;

    this.wsToUser.delete(ws);
    const userConnections = this.connections.get(userId);
    if (userConnections) {
      userConnections.delete(ws);

      // Only the socket that owns voice starts the voice grace period. Closing
      // another tab must not disturb the active voice session.
      if (this.voiceWs.get(userId) === ws) {
        this.voiceWs.delete(userId);
        this.scheduleVoiceDisconnect(userId);
      }

      // If the socket that was publishing activities for this user disconnects (e.g. Desktop app exited),
      // clear the activities immediately and broadcast to the user's remaining connections (e.g. Web) and friends.
      if (this.activityWs.get(userId) === ws) {
        this.activityWs.delete(userId);
        this.userActivities.delete(userId);

        const status = this.getUserStatus(userId);
        const payload = presenceUpdateFor(userId, status, []);
        const targets = collectProfileBroadcastTargetIds(userId);
        for (const uid of targets) this.sendToUser(uid, payload);
        this.sendToUser(userId, payload);

      }

      if (userConnections.size === 0) {
        this.connections.delete(userId);
        // Presence and voice have independent grace periods.
        this.scheduleDisconnect(userId);
      }
    }
    return userId;
  }

  private scheduleDisconnect(userId: string) {
    if (this.pendingOfflineTimeouts.has(userId)) return;

    const timeout = setTimeout(() => {
      this.finalizeDisconnect(userId);
      this.pendingOfflineTimeouts.delete(userId);
    }, 5000); // 5 second grace period

    this.pendingOfflineTimeouts.set(userId, timeout);
  }

  private cancelDisconnect(userId: string) {
    const timeout = this.pendingOfflineTimeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingOfflineTimeouts.delete(userId);
      console.log(`[ConnectionManager] Rescued session for user ${userId}`);
    }
  }

  private scheduleVoiceDisconnect(userId: string): void {
    this.cancelVoiceDisconnect(userId);
    const roomId = this.userToRoom.get(userId)
      ?? Array.from(this.voiceRooms).find(([, room]) =>
        room.roomType === 'dm'
        && (room.metadata as DmRoomMeta).state === 'ringing'
        && (room.metadata as DmRoomMeta).callerId === userId,
      )?.[0]
      ?? null;
    if (!roomId) return;

    if (this.pendingVoiceReconnects.size >= MAX_PENDING_VOICE_RECONNECTS) {
      const oldest = this.pendingVoiceReconnects.entries().next().value as
        | [string, PendingVoiceReconnect]
        | undefined;
      if (oldest) {
        clearTimeout(oldest[1].timeout);
        this.pendingVoiceReconnects.delete(oldest[0]);
        this.finalizeVoiceDisconnect(oldest[0], oldest[1].roomId);
      }
    }

    const timeout = setTimeout(() => {
      const pending = this.pendingVoiceReconnects.get(userId);
      if (!pending || pending.timeout !== timeout) return;
      this.pendingVoiceReconnects.delete(userId);
      if (!this.voiceWs.has(userId)) this.finalizeVoiceDisconnect(userId, pending.roomId);
    }, VOICE_RECONNECT_GRACE_MS);
    this.pendingVoiceReconnects.set(userId, { timeout, roomId });
  }

  private cancelVoiceDisconnect(userId: string): void {
    const pending = this.pendingVoiceReconnects.get(userId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingVoiceReconnects.delete(userId);
  }

  private finalizeVoiceDisconnect(
    userId: string,
    expectedRoomId: string | null = null,
  ): void {
    if (this.voiceWs.has(userId)) return;
    this.clearVoiceUserStatus(userId);

    const current = this.getUserRoom(userId);
    if (!expectedRoomId || current?.roomId === expectedRoomId) this.leaveCurrentRoomAnnounced(userId);

    for (const [roomId, room] of this.voiceRooms) {
      if (room.roomType !== 'dm') continue;
      const meta = room.metadata as DmRoomMeta;
      if (meta.state === 'ringing' && meta.callerId === userId
          && (!expectedRoomId || expectedRoomId === roomId)) {
        this.endDmRoom(roomId, 'dm_call_ended');
      }
    }
  }

  /**
   * Publish the status of a connection for `row` that just authenticated and
   * return the saved local chosen status (`statusOnConnect`).
   */
  publishConnectStatus(row: StatusSourceRow & { id: string }): ChosenUserStatus {
    const status = statusOnConnect(row);
    getDb().update(schema.users).set({ status }).where(eq(schema.users.id, row.id)).run();
    return status;
  }

  /** A session of the user is open here, or its disconnect grace period runs. */
  hasSessionHere(userId: string): boolean {
    return this.isUserOnline(userId) || this.pendingOfflineTimeouts.has(userId);
  }

  private finalizeDisconnect(userId: string) {
    // Double check they are still offline
    if (this.isUserOnline(userId)) return;

    console.log(`[ConnectionManager] Finalizing disconnect for user ${userId}`);
    // A bot that dropped leaves every voice channel it sat in (humans have the reconnect grace).
    this.botLeaveRooms(userId);

    getDb().update(schema.users).set({ status: 'offline' }).where(eq(schema.users.id, userId)).run();

    // Clear activity state
    this.clearUserActivities(userId);

    // Broadcast offline to friends + DM co-members + space co-members.
    // Mirrors collectProfileBroadcastTargetIds (the recipient set used by
    // user_updated). Two locally-friended users with no shared space now see
    // each other's offline transitions live, instead of being space-only.
    const offlinePayload = presenceUpdateFor(userId, 'offline', []);
    const offlineTargets = collectProfileBroadcastTargetIds(userId);
    for (const uid of offlineTargets) this.sendToUser(uid, offlinePayload);

    this.forgetSessionState(userId);
  }

  /** The per-session state a user's last disconnect drops. */
  private forgetSessionState(userId: string): void {
    // Activities and their observed timestamps were cleared by finalizeDisconnect.
    this.activityWs.delete(userId);
    this.userShowActivity.delete(userId);
    this.userStatuses.delete(userId);
    this.lastActivityUpdate.delete(userId);
    // userSpaces is re-populated on the next connect via setUserSpaces.
    this.userSpaces.delete(userId);
  }

  getUserConnections(userId: string): Set<WebSocket> {
    return this.connections.get(userId) ?? new Set();
  }

  isUserOnline(userId: string): boolean {
    const conns = this.connections.get(userId);
    return conns !== undefined && conns.size > 0;
  }

  // ─── Activity accessors ─────────────────────────────────────────────────

  setUserActivities(userId: string, activities: Activity[], ws?: WebSocket): void {
    if (activities.length === 0) {
      this.userActivities.delete(userId);
      this.activityObservedAt.delete(userId);
      this.activityWs.delete(userId);
    } else {
      this.userActivities.set(userId, activities);
      this.activityObservedAt.set(userId, Date.now());
      if (ws) {
        this.activityWs.set(userId, ws);
      } else {
        // Bot stored status or another non-socket publisher now
        // owns the activity set: a later disconnect of a stale local socket
        // must not wipe the replacement activity.
        this.activityWs.delete(userId);
      }
    }
  }

  getUserActivities(userId: string): Activity[] {
    const activities = this.userActivities.get(userId) ?? [];
    const observedAt = this.activityObservedAt.get(userId);
    if (observedAt === undefined) return activities;
    return projectActivityPlayback(activities, Math.max(0, Date.now() - observedAt));
  }

  clearUserActivities(userId: string): void {
    this.userActivities.delete(userId);
    this.activityObservedAt.delete(userId);
    this.activityWs.delete(userId);
  }

  setUserShowActivity(userId: string, show: boolean): void {
    this.userShowActivity.set(userId, show);
  }

  getUserShowActivity(userId: string): boolean {
    return this.userShowActivity.get(userId) ?? true;
  }

  setUserStatus(userId: string, status: string): void {
    this.userStatuses.set(userId, status);
  }

  getUserStatus(userId: string): string {
    return this.userStatuses.get(userId) ?? 'offline';
  }

  /**
   * Removing an already-published activity is accepted even inside the normal
   * update window. Without this exception a pause immediately after a track
   * change is dropped and the old "listening" state remains on other clients.
   */
  checkActivityRateLimit(userId: string, removingPublishedActivities = false): boolean {
    const now = Date.now();
    const last = this.lastActivityUpdate.get(userId) ?? 0;
    if (!removingPublishedActivities && now - last < 3000) return false;
    this.lastActivityUpdate.set(userId, now);
    return true;
  }

  setUserSpaces(userId: string, spaceIds: string[]): void {
    this.userSpaces.set(userId, new Set(spaceIds));
  }

  /** Stops delivering a space's events to a user who is no longer a member. */
  removeUserSpace(userId: string, spaceId: string): void {
    // A bot removed or banned from a space must leave its voice channels too. This
    // goes first: the bot is still a recipient of the space, so it hears itself leave.
    this.botLeaveRooms(userId, spaceId);
    this.userSpaces.get(userId)?.delete(spaceId);
  }

  addUserSpace(userId: string, spaceId: string): void {
    if (!this.userSpaces.has(userId)) {
      this.userSpaces.set(userId, new Set());
    }
    this.userSpaces.get(userId)!.add(spaceId);

    // A user joining a space mid-session must be bootstrapped with that space's
    // current voice presence. The `ready` payload only carries voice state at
    // connect time (see buildReadyPayload), so without this push, members already
    // sitting in a voice channel stay invisible in the new member's channel
    // sidebar until a full page reload. `addUserSpace` is the single chokepoint
    // every join path funnels through (invite, public join, join-request
    // approval) and is NOT used on reconnect (that path uses setUserSpaces), so
    // this fires exactly once per genuine join. Space creation hits this too but
    // produces an empty snapshot, which is not sent.
    this.pushSpaceVoiceState(userId, spaceId);
  }

  /**
   * Send `userId` the voice presence of `spaceId` they can see now, as one
   * `space_voice_state` (`buildSpaceVoiceState`, VIEW_CHANNEL-filtered). It
   * rides the same ordered socket as the `voice_state_update` deltas, so a
   * join or leave after it arrives after it. Nothing is sent when the user has
   * no connection or the snapshot is empty (no one in voice, no restriction).
   */
  pushSpaceVoiceState(userId: string, spaceId: string): void {
    if (this.getUserConnections(userId).size === 0) return;
    const snapshot = this.buildSpaceVoiceState(spaceId, userId);
    if (Object.keys(snapshot.voiceStates).length === 0
        && Object.keys(snapshot.spaceVoiceStates).length === 0) {
      return;
    }
    this.sendToUser(userId, {
      type: 'space_voice_state',
      spaceId,
      voiceStates: snapshot.voiceStates,
      voiceChannelElapsedSeconds: snapshot.voiceChannelElapsedSeconds,
      voiceUserStates: snapshot.voiceUserStates,
      spaceVoiceStates: snapshot.spaceVoiceStates,
    });
  }

  /**
   * After a change to the space's roles or to a member's roles
   * (websocket.md, `space_access_changed`): every connected member of the
   * space is told, and refetches the space's detail. The detail has no voice
   * presence, so each member in `affectedUserIds` (whose own permissions may
   * have changed) is then sent the voice state they can see now
   * (`pushSpaceVoiceState`); a voice channel they just gained shows who is in
   * it at once.
   */
  announceSpaceAccessChange(spaceId: string, affectedUserIds: Iterable<string>): void {
    this.sendToSpace(spaceId, { type: 'space_access_changed', spaceId });
    for (const userId of new Set(affectedUserIds)) {
      if (this.getUserSpaces(userId).has(spaceId)) this.pushSpaceVoiceState(userId, spaceId);
    }
  }

  /**
   * After a change to one user's own permissions in each of `spaceIds` that
   * no other member's view depends on (an instance admin promoted or demoted:
   * websocket.md, `space_access_changed`). Only that user is told, with one
   * `space_access_changed` per space on each of their connections, and is
   * then sent the voice state they can see there now (`pushSpaceVoiceState`).
   */
  announceUserAccessChange(userId: string, spaceIds: Iterable<string>): void {
    if (this.getUserConnections(userId).size === 0) return;
    for (const spaceId of new Set(spaceIds)) {
      this.sendToUser(userId, { type: 'space_access_changed', spaceId });
      this.pushSpaceVoiceState(userId, spaceId);
    }
  }

  getUserSpaces(userId: string): Set<string> {
    return this.userSpaces.get(userId) ?? new Set();
  }

  /**
   * Build the current voice-presence snapshot for a single space, from the
   * perspective of `userId`:
   * - which voice channels the user can VIEW have participants, and who they are,
   * - each participant's per-user status (mute/deafen/camera/screenshare),
   * - space-level mute/deafen (persisted) + permission-mute (ephemeral)
   *   restrictions, keyed `spaceId:userId`.
   *
   * Voice presence is VIEW_CHANNEL-filtered per `computePermissions` exactly as
   * `buildReadyPayload` does — a user must never learn who is sitting in a voice
   * channel they cannot see.
   *
   * Single source of truth shared by `buildReadyPayload` (connect-time bootstrap,
   * looped across all of a user's spaces) and `addUserSpace` (mid-session join
   * push). Keep these two consumers in sync by changing only this method.
   */
  buildSpaceVoiceState(spaceId: string, userId: string): {
    voiceStates: Record<string, string[]>;
    voiceChannelElapsedSeconds: Record<string, number>;
    voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>;
    spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }>;
  } {
    const db = getDb();
    const voiceStates: Record<string, string[]> = {};
    const voiceChannelElapsedSeconds: Record<string, number> = {};
    const voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }> = {};
    const spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }> = {};

    // Who is currently in each of this space's voice channels the user can VIEW.
    const voiceChannels = db.select({ id: schema.channels.id })
      .from(schema.channels)
      .where(and(eq(schema.channels.spaceId, spaceId), eq(schema.channels.type, 'voice')))
      .all();
    for (const ch of voiceChannels) {
      const chPerms = computePermissions(userId, spaceId, ch.id);
      const hasView = (chPerms & PermissionBits.VIEW_CHANNEL) !== 0n || (chPerms & PermissionBits.ADMINISTRATOR) !== 0n;
      if (!hasView) continue;
      const room = this.getRoom(ch.id);
      if (room && room.participants.size > 0) {
        const ids = Array.from(room.participants);
        voiceStates[ch.id] = ids;
        voiceChannelElapsedSeconds[ch.id] = getVoiceRoomElapsedSeconds(room);
        for (const uid of ids) {
          const status = this.getVoiceUserStatus(uid);
          if (status) voiceUserStates[uid] = status;
        }
      }
    }

    // Space mute/deafen — persisted, authoritative (survives reconnect). These are
    // space-level flags (they do not reveal which channel a user is in), so they
    // are not channel-filtered, mirroring buildReadyPayload.
    const restrictions = db.select()
      .from(schema.voiceRestrictions)
      .where(eq(schema.voiceRestrictions.spaceId, spaceId))
      .all();
    for (const r of restrictions) {
      const key = `${r.spaceId}:${r.userId}`;
      const existing = spaceVoiceStates[key] ?? { spaceMuted: false, spaceDeafened: false, permissionMuted: false };
      if (r.restrictionType === 'mute') existing.spaceMuted = true;
      if (r.restrictionType === 'deafen') existing.spaceDeafened = true;
      spaceVoiceStates[key] = existing;
    }
    // A moderator's mute / deafen of a bot seat — persisted per channel
    // (`bot_seat_restrictions`), keyed `spaceId:botId:channelId` like the
    // seat's permission mute below.
    const seatRestrictions = db.select({
      channelId: schema.botSeatRestrictions.channelId,
      botId: schema.botSeatRestrictions.botId,
      restrictionType: schema.botSeatRestrictions.restrictionType,
    })
      .from(schema.botSeatRestrictions)
      .innerJoin(schema.channels, eq(schema.botSeatRestrictions.channelId, schema.channels.id))
      .where(eq(schema.channels.spaceId, spaceId))
      .all();
    for (const r of seatRestrictions) {
      const seatKey = `${spaceId}:${r.botId}:${r.channelId}`;
      const existing = spaceVoiceStates[seatKey] ?? { spaceMuted: false, spaceDeafened: false, permissionMuted: false };
      if (r.restrictionType === 'mute') existing.spaceMuted = true;
      if (r.restrictionType === 'deafen') existing.spaceDeafened = true;
      spaceVoiceStates[seatKey] = existing;
    }
    // Permission-mute — ephemeral, derived from in-memory state for every
    // participant currently in this space's voice rooms (mirrors buildReadyPayload).
    for (const [, room] of this.voiceRooms) {
      if (room.roomType !== 'space') continue;
      const meta = room.metadata as SpaceRoomMeta;
      if (meta.spaceId !== spaceId) continue;
      for (const participantId of room.participants) {
        if (this.isBotSeat(participantId, room.roomId)) {
          // A bot seat is muted per channel: key `spaceId:botId:channelId`.
          if (this.isBotSeatPermissionMuted(room.roomId, participantId)) {
            const seatKey = `${spaceId}:${participantId}:${room.roomId}`;
            const existing = spaceVoiceStates[seatKey] ?? { spaceMuted: false, spaceDeafened: false, permissionMuted: false };
            existing.permissionMuted = true;
            spaceVoiceStates[seatKey] = existing;
          }
          continue;
        }
        if (this.isPermissionMuted(spaceId, participantId)) {
          const key = `${spaceId}:${participantId}`;
          const existing = spaceVoiceStates[key] ?? { spaceMuted: false, spaceDeafened: false, permissionMuted: false };
          existing.permissionMuted = true;
          spaceVoiceStates[key] = existing;
        }
      }
    }

    return { voiceStates, voiceChannelElapsedSeconds, voiceUserStates, spaceVoiceStates };
  }

  // ─── Unified VoiceRoom API ─────────────────────────────────────────────────

  /** Create a room. Returns false if room already exists. */
  createRoom(roomId: string, roomType: 'space' | 'dm', metadata: SpaceRoomMeta | DmRoomMeta): boolean {
    if (this.voiceRooms.has(roomId)) return false;
    this.voiceRooms.set(roomId, {
      roomId,
      roomType,
      participants: new Set(),
      metadata,
      startedAt: Date.now(),
    });
    return true;
  }

  /**
   * Take `userId` out of the room they are in, unless it is `keepRoomId`,
   * and tell whoever sees that room. An active DM call left empty ends.
   * Returns the room left, if any.
   */
  leaveCurrentRoomAnnounced(userId: string, keepRoomId?: string): { roomId: string; room: VoiceRoom } | null {
    if (keepRoomId !== undefined && this.userToRoom.get(userId) === keepRoomId) return null;
    const left = this.leaveCurrentRoom(userId);
    if (!left) return null;
    if (left.room.roomType === 'space') {
      const meta = left.room.metadata as SpaceRoomMeta;
      this.sendToSpace(meta.spaceId, {
        type: 'voice_state_update', channelId: left.roomId, userId, action: 'leave',
      });
    } else {
      this.afterDmCallLeave(left.roomId, userId);
    }
    return left;
  }

  /**
   * End every DM call hosted here that `userId` placed and that still rings,
   * except `exceptRoomId`: the user started another call or joined voice, and
   * holds one call at a time. Each end goes to the local DM members.
   */
  endRingingCallsPlacedBy(userId: string, exceptRoomId?: string): void {
    for (const [roomId, room] of Array.from(this.voiceRooms)) {
      if (room.roomType !== 'dm' || roomId === exceptRoomId) continue;
      const meta = room.metadata as DmRoomMeta;
      if (meta.state !== 'ringing' || meta.callerId !== userId) continue;
      this.endDmRoom(roomId, 'dm_call_ended');
    }
  }

  /** Create a DM room in ringing state with 60s auto-cleanup. */
  createDmRoom(dmChannelId: string, callerId: string): boolean {
    const row = getDb().select({ ownerId: schema.dmChannels.ownerId })
      .from(schema.dmChannels)
      .where(eq(schema.dmChannels.id, dmChannelId))
      .get();
    const created = this.createRoom(dmChannelId, 'dm', {
      type: 'dm',
      callerId,
      state: 'ringing',
      group: row ? isGroupConversation({ owner_id: row.ownerId }) : false,
      declinedUserIds: new Set(),
    });
    if (!created) return false;

    // 60s ringing timeout: nobody but the caller joined, so the call ends.
    const timeout = setTimeout(() => {
      this.ringingTimeouts.delete(dmChannelId);
      const room = this.voiceRooms.get(dmChannelId);
      if (room && room.roomType === 'dm' && (room.metadata as DmRoomMeta).state === 'ringing') {
        this.endDmRoom(dmChannelId, 'dm_call_ended');
      }
    }, 60_000);
    this.ringingTimeouts.set(dmChannelId, timeout);

    return true;
  }

  /**
   * End a DM call hosted here: unbind the voice sessions it holds, destroy the
   * room, tell the DM members that each participant left, then send `kind`
   * (`dm_call_ended`, or `dm_call_rejected` for a call every ringee declined).
   * Returns false when there is no such room.
   */
  endDmRoom(dmChannelId: string, kind: 'dm_call_ended' | 'dm_call_rejected'): boolean {
    const room = this.voiceRooms.get(dmChannelId);
    if (!room || room.roomType !== 'dm') return false;
    const meta = room.metadata as DmRoomMeta;
    const participants = Array.from(room.participants);
    // The caller of a ringing call holds no seat but owns the voice binding,
    // unless they have since joined some other room.
    const callerRoom = this.userToRoom.get(meta.callerId);
    if (callerRoom === undefined || callerRoom === dmChannelId) this.clearVoiceWs(meta.callerId);
    for (const participantId of participants) {
      this.clearVoiceUserStatus(participantId);
      this.clearVoiceWs(participantId);
    }
    this.destroyRoom(dmChannelId);
    for (const participantId of participants) {
      this.sendToDmMembers(dmChannelId, {
        type: 'voice_state_update', channelId: dmChannelId, userId: participantId, action: 'leave',
      });
    }
    this.sendToDmMembers(dmChannelId, { type: kind, dmChannelId });
    return true;
  }

  /**
   * After `userId` left the DM call `dmChannelId` (already out of its
   * participants): tell the DM members, and end the call when it is active
   * and nobody is left in it. Returns 'ended' when the call ended.
   */
  afterDmCallLeave(dmChannelId: string, userId: string): 'left' | 'ended' {
    const room = this.voiceRooms.get(dmChannelId);
    this.sendToDmMembers(dmChannelId, {
      type: 'voice_state_update', channelId: dmChannelId, userId, action: 'leave',
    });
    if (room && room.roomType === 'dm' && room.participants.size === 0
        && (room.metadata as DmRoomMeta).state === 'active') {
      this.endDmRoom(dmChannelId, 'dm_call_ended');
      return 'ended';
    }
    return 'left';
  }

  /**
   * A member hangs up or cancels a group call (`dm_call_end`).
   * The caller of a call nobody has joined yet ends it;
   * a participant leaves it, and the call ends with the last one out; anyone
   * else is not in the call and changes nothing.
   */
  leaveGroupDmCall(dmChannelId: string, userId: string): 'ignored' | 'left' | 'ended' {
    const room = this.voiceRooms.get(dmChannelId);
    if (!room || room.roomType !== 'dm') return 'ignored';
    const meta = room.metadata as DmRoomMeta;
    if (meta.state === 'ringing' && meta.callerId === userId) {
      this.endDmRoom(dmChannelId, 'dm_call_ended');
      return 'ended';
    }
    if (!room.participants.has(userId)) return 'ignored';
    this.leaveRoom(dmChannelId, userId);
    this.clearVoiceUserStatus(userId);
    this.clearVoiceWs(userId);
    return this.afterDmCallLeave(dmChannelId, userId);
  }

  /**
   * A member declines a group call (`dm_call_reject`).
   * The decliner stops ringing; the call goes on for everyone else.
   * When the call is still ringing and every member but the caller has
   * declined, nobody is left to answer and it ends as rejected. The caller
   * and participants cannot decline. Membership is the caller's to check.
   */
  declineGroupDmCall(dmChannelId: string, userId: string): 'ignored' | 'declined' | 'ended' {
    const room = this.voiceRooms.get(dmChannelId);
    if (!room || room.roomType !== 'dm') return 'ignored';
    const meta = room.metadata as DmRoomMeta;
    if (meta.callerId === userId || room.participants.has(userId)) return 'ignored';
    meta.declinedUserIds.add(userId);
    if (meta.state !== 'ringing') return 'declined';
    const ringees = getDb().select({ userId: schema.dmMembers.userId })
      .from(schema.dmMembers)
      .where(eq(schema.dmMembers.dmChannelId, dmChannelId))
      .all()
      .filter(m => m.userId !== meta.callerId);
    if (ringees.some(m => !meta.declinedUserIds.has(m.userId))) return 'declined';
    this.endDmRoom(dmChannelId, 'dm_call_rejected');
    return 'ended';
  }

  /** Transition a DM room from ringing → active. Returns false if not found or not ringing. */
  activateDmRoom(dmChannelId: string): boolean {
    const room = this.voiceRooms.get(dmChannelId);
    if (!room || room.roomType !== 'dm') return false;
    const meta = room.metadata as DmRoomMeta;
    if (meta.state !== 'ringing') return false;
    meta.state = 'active';

    // Clear ringing timeout
    const timeout = this.ringingTimeouts.get(dmChannelId);
    if (timeout) {
      clearTimeout(timeout);
      this.ringingTimeouts.delete(dmChannelId);
    }
    return true;
  }

  /** Add a user to a room. Enforces one-room-per-user invariant. Returns the room or null if room doesn't exist. */
  joinRoom(roomId: string, userId: string): VoiceRoom | null {
    const room = this.voiceRooms.get(roomId);
    if (!room) return null;

    // Enforce one-room-per-user invariant: silently remove from old room
    const currentRoomId = this.userToRoom.get(userId);
    if (currentRoomId && currentRoomId !== roomId) {
      const oldRoom = this.voiceRooms.get(currentRoomId);
      if (oldRoom) {
        oldRoom.participants.delete(userId);
        if (oldRoom.participants.size === 0 && oldRoom.roomType === 'space') {
          this.voiceRooms.delete(currentRoomId);
        }
      }
    }

    room.participants.add(userId);
    this.userToRoom.set(userId, roomId);
    return room;
  }

  /** Remove a user from a specific room. Returns the room or null if not found. */
  leaveRoom(roomId: string, userId: string): VoiceRoom | null {
    const room = this.voiceRooms.get(roomId);
    if (!room || !room.participants.has(userId)) return null;

    room.participants.delete(userId);
    this.userToRoom.delete(userId);
    
    if (room.roomType === 'space') {
      const meta = room.metadata as SpaceRoomMeta;
      this.clearSpaceVoiceState(meta.spaceId, userId);
    }

    // Auto-cleanup empty space rooms (they're lazy-created)
    if (room.participants.size === 0 && room.roomType === 'space') {
      this.voiceRooms.delete(roomId);
    }

    return room;
  }

  /** Leave whatever room the user is in. Returns { roomId, room } or null. */
  leaveCurrentRoom(userId: string): { roomId: string; room: VoiceRoom } | null {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return null;

    const room = this.leaveRoom(roomId, userId);
    if (!room) return null;

    return { roomId, room };
  }

  /** Destroy a room entirely. Returns displaced userIds. */
  destroyRoom(roomId: string): string[] {
    const room = this.voiceRooms.get(roomId);
    if (!room) return [];

    const displaced: string[] = [];
    for (const userId of room.participants) {
      this.userToRoom.delete(userId);
      this.cancelVoiceDisconnect(userId);
      displaced.push(userId);
    }

    if (room.roomType === 'dm') {
      this.cancelVoiceDisconnect((room.metadata as DmRoomMeta).callerId);
    }

    this.voiceRooms.delete(roomId);

    // Clear ringing timeout if any
    const timeout = this.ringingTimeouts.get(roomId);
    if (timeout) {
      clearTimeout(timeout);
      this.ringingTimeouts.delete(roomId);
    }

    return displaced;
  }

  /** Get a room by ID. */
  getRoom(roomId: string): VoiceRoom | undefined {
    return this.voiceRooms.get(roomId);
  }

  /** Get participants in a room. */
  getRoomParticipants(roomId: string): Set<string> {
    return this.voiceRooms.get(roomId)?.participants ?? new Set();
  }

  /** Get the room a user is currently in. Returns { roomId, room } or null. */
  getUserRoom(userId: string): { roomId: string; room: VoiceRoom } | null {
    const roomId = this.userToRoom.get(userId);
    if (!roomId) return null;
    const room = this.voiceRooms.get(roomId);
    if (!room) return null;
    return { roomId, room };
  }

  /** Read-only access to all rooms. */
  getAllRooms(): Map<string, VoiceRoom> {
    return this.voiceRooms;
  }

  // ─── Voice User Status (unchanged) ────────────────────────────────────────

  setVoiceUserStatus(userId: string, isMuted: boolean, isDeafened: boolean, isCameraOn: boolean, isScreenSharing: boolean): void {
    this.voiceUserStates.set(userId, { isMuted, isDeafened, isCameraOn, isScreenSharing });
  }

  getVoiceUserStatus(userId: string): { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean } | undefined {
    return this.voiceUserStates.get(userId);
  }

  clearVoiceUserStatus(userId: string): void {
    this.voiceUserStates.delete(userId);
  }

  // ─── Voice WebSocket Binding ───────────────────────────────────────────────

  /** Store which ws owns the voice session for this user. */
  setVoiceWs(userId: string, ws: WebSocket): void {
    this.cancelVoiceDisconnect(userId);
    this.voiceWs.set(userId, ws);
  }

  /** Get the voice-owning ws for this user. */
  getVoiceWs(userId: string): WebSocket | undefined {
    return this.voiceWs.get(userId);
  }

  /** Clear the voice ws binding for this user. */
  clearVoiceWs(userId: string): void {
    this.cancelVoiceDisconnect(userId);
    this.voiceWs.delete(userId);
  }

  setSpaceMuted(spaceId: string, userId: string, muted: boolean): void {
    const key = `${spaceId}:${userId}`;
    if (muted) this.spaceMutedUsers.add(key);
    else this.spaceMutedUsers.delete(key);
  }

  isSpaceMuted(spaceId: string, userId: string): boolean {
    return this.spaceMutedUsers.has(`${spaceId}:${userId}`);
  }

  setSpaceDeafened(spaceId: string, userId: string, deafened: boolean): void {
    const key = `${spaceId}:${userId}`;
    if (deafened) this.spaceDeafenedUsers.add(key);
    else this.spaceDeafenedUsers.delete(key);
  }

  isSpaceDeafened(spaceId: string, userId: string): boolean {
    return this.spaceDeafenedUsers.has(`${spaceId}:${userId}`);
  }

  clearSpaceVoiceState(spaceId: string, userId: string): void {
    this.spaceMutedUsers.delete(`${spaceId}:${userId}`);
    this.spaceDeafenedUsers.delete(`${spaceId}:${userId}`);
    this.permissionMutedUsers.delete(`${spaceId}:${userId}`);
  }

  setPermissionMuted(spaceId: string, userId: string, muted: boolean): void {
    const key = `${spaceId}:${userId}`;
    if (muted) this.permissionMutedUsers.add(key);
    else this.permissionMutedUsers.delete(key);
  }

  isPermissionMuted(spaceId: string, userId: string): boolean {
    return this.permissionMutedUsers.has(`${spaceId}:${userId}`);
  }

  /** Whether the bot holds a `bot_voice_join` seat in this room. */
  isBotSeat(botId: string, roomId: string): boolean {
    return this.botRooms.get(botId)?.has(roomId) ?? false;
  }

  setBotSeatPermissionMuted(roomId: string, botId: string, muted: boolean): void {
    const key = `${roomId}:${botId}`;
    if (muted) this.botSeatPermissionMuted.add(key);
    else this.botSeatPermissionMuted.delete(key);
  }

  isBotSeatPermissionMuted(roomId: string, botId: string): boolean {
    return this.botSeatPermissionMuted.has(`${roomId}:${botId}`);
  }

  getAllVoiceUserStates(): Map<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }> {
    return this.voiceUserStates;
  }

  // ─── Broadcasting ─────────────────────────────────────────────────────────

  /** The voice rooms a bot is in through `bot_voice_join` (its `voice_join` seat is not listed). */
  getBotRoomIds(botId: string): string[] {
    return [...(this.botRooms.get(botId) ?? [])];
  }

  /**
   * Seats a bot in a space voice room (created on demand). False when it is
   * already there. Caller checked the channel, the bot's membership and CONNECT.
   */
  botJoinRoom(botId: string, roomId: string, spaceId: string): boolean {
    const rooms = this.botRooms.get(botId) ?? new Set<string>();
    if (rooms.has(roomId)) return false;
    // A seat taken with the ordinary `voice_join` is already a seat here. Holding
    // both would announce the join twice and leave `userToRoom` pointing at a
    // room the bot has left.
    if (this.userToRoom.get(botId) === roomId) return false;
    this.createRoom(roomId, 'space', { type: 'space', spaceId });
    const room = this.voiceRooms.get(roomId);
    if (!room) return false;
    room.participants.add(botId);
    rooms.add(roomId);
    this.botRooms.set(botId, rooms);
    return true;
  }

  private botHasSeatInSpace(botId: string, spaceId: string): boolean {
    for (const roomId of this.botRooms.get(botId) ?? []) {
      const meta = this.voiceRooms.get(roomId)?.metadata as SpaceRoomMeta | undefined;
      if (meta?.spaceId === spaceId) return true;
    }
    return false;
  }

  /** Takes a bot out of one voice room. Returns the room, or null when it was not in it. */
  botLeaveRoom(botId: string, roomId: string): VoiceRoom | null {
    const rooms = this.botRooms.get(botId);
    if (!rooms || !rooms.delete(roomId)) return null;
    if (rooms.size === 0) this.botRooms.delete(botId);
    const room = this.voiceRooms.get(roomId);
    if (!room) return null;
    room.participants.delete(botId);
    if (room.roomType === 'space') {
      const spaceId = (room.metadata as SpaceRoomMeta).spaceId;
      if (this.botSeatPermissionMuted.delete(`${roomId}:${botId}`)) {
        this.sendToSpace(spaceId, { type: 'voice_permission_muted', userId: botId, spaceId, channelId: roomId, muted: false });
      }
      // Space-wide flags belong to the bot's other seats in this space too.
      if (!this.botHasSeatInSpace(botId, spaceId)) this.clearSpaceVoiceState(spaceId, botId);
    }
    // Lazy-created space rooms disappear with their last participant.
    if (room.participants.size === 0 && room.roomType === 'space') this.voiceRooms.delete(roomId);
    return room;
  }

  /**
   * Takes a bot out of every voice room, or only those of one space, and tells
   * the rest of each space. Used when the bot disconnects, is removed or banned.
   */
  botLeaveRooms(botId: string, onlySpaceId?: string): void {
    for (const roomId of this.getBotRoomIds(botId)) {
      const meta = this.voiceRooms.get(roomId)?.metadata as SpaceRoomMeta | undefined;
      if (onlySpaceId !== undefined && meta?.spaceId !== onlySpaceId) continue;
      const room = this.botLeaveRoom(botId, roomId);
      if (!room) continue;
      this.sendToSpace((room.metadata as SpaceRoomMeta).spaceId, {
        type: 'voice_state_update',
        channelId: roomId,
        userId: botId,
        action: 'leave',
      });
    }
    if (!this.botRooms.has(botId)) this.clearVoiceUserStatus(botId);
  }

  /** Whether the user has at least one open socket (a bot with none cannot be handed a command). */
  hasLiveConnection(userId: string): boolean {
    for (const ws of this.getUserConnections(userId)) {
      if (ws.readyState === 1) return true;
    }
    return false;
  }

  /**
   * Send to a specific user (all their connections). An event that moves one
   * of the user's unread counts is followed on the same sockets by its
   * `channel_unread_count` (ws/channelUnreadCounts.ts). `channelPerms` are
   * the user's permissions in the event's space channel when the caller has
   * already computed them, so the count does not compute them again.
   */
  sendToUser(userId: string, event: ServerEvent, channelPerms?: bigint): void {
    this.deliver(userId, event, JSON.stringify(event), channelPerms);
  }

  /** `sendToUser` with the event already serialized, for fan-outs that serialize it once. */
  private deliver(userId: string, event: ServerEvent, message: string, channelPerms?: bigint): void {
    const connections = this.getUserConnections(userId);
    if (connections.size === 0) return;
    const followUp = unreadCountFollowUp(userId, event, channelPerms);
    const followUpMessage = followUp ? JSON.stringify(followUp) : null;
    for (const ws of connections) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
        if (followUpMessage) ws.send(followUpMessage);
      }
    }
  }

  /** Send to all members of a space. */
  sendToSpace(spaceId: string, event: ServerEvent, excludeUserId?: string): void {
    const message = JSON.stringify(event);
    for (const [userId, spaceIds] of this.userSpaces) {
      if (spaceIds.has(spaceId) && userId !== excludeUserId) {
        const connections = this.getUserConnections(userId);
        for (const ws of connections) {
          if (ws.readyState === 1) {
            ws.send(message);
          }
        }
      }
    }
  }

  /** Send to space members who have VIEW_CHANNEL on the given channel. */
  sendToChannel(spaceId: string, channelId: string, event: ServerEvent, excludeUserId?: string): void {
    const message = JSON.stringify(event);
    for (const [userId, spaceIds] of this.userSpaces) {
      if (spaceIds.has(spaceId) && userId !== excludeUserId) {
        const perms = computePermissions(userId, spaceId, channelId);
        if ((perms & PermissionBits.VIEW_CHANNEL) !== 0n) {
          this.deliver(userId, event, message, perms);
        }
      }
    }
  }

  /** Expose userSpaces iterator for pre-delete viewer collection. */
  getUserSpaceEntries(): IterableIterator<[string, Set<string>]> {
    return this.userSpaces.entries();
  }

  /** Send to all DM channel members (queries dm_members table). */
  sendToDmMembers(dmChannelId: string, event: ServerEvent, excludeUserId?: string): void {
    const db = getDb();
    const dmMembers = db.select()
      .from(schema.dmMembers)
      .where(eq(schema.dmMembers.dmChannelId, dmChannelId))
      .all();

    for (const member of dmMembers) {
      if (member.userId !== excludeUserId) {
        this.sendToUser(member.userId, event);
      }
    }
  }

  /** Send to a room — routes to sendToSpace (space rooms) or sendToDmMembers (DM rooms). */
  sendToRoom(roomId: string, event: ServerEvent, excludeUserId?: string): void {
    const room = this.voiceRooms.get(roomId);
    if (!room) return;

    if (room.roomType === 'space') {
      const meta = room.metadata as SpaceRoomMeta;
      this.sendToSpace(meta.spaceId, event, excludeUserId);
    } else {
      this.sendToDmMembers(roomId, event, excludeUserId);
    }
  }

  /** Send to all connections of all online users. */
  sendToAll(event: ServerEvent, excludeUserId?: string): void {
    const message = JSON.stringify(event);
    for (const [userId, connections] of this.connections) {
      if (userId !== excludeUserId) {
        for (const ws of connections) {
          if (ws.readyState === 1) {
            ws.send(message);
          }
        }
      }
    }
  }

  /** Send to a specific WebSocket instance (not all of a user's connections). */
  sendToWs(ws: WebSocket, event: ServerEvent): void {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(event));
    }
  }

  /** Force-disconnect all WebSocket connections for a user (e.g. account deletion). */
  forceDisconnectUser(userId: string): void {
    // Cancel any pending offline timeout
    const timeout = this.pendingOfflineTimeouts.get(userId);
    if (timeout) {
      clearTimeout(timeout);
      this.pendingOfflineTimeouts.delete(userId);
    }

    // A bot may sit in several voice rooms
    this.botLeaveRooms(userId);

    // Leave the voice room and end an active DM call it empties.
    this.clearVoiceUserStatus(userId);
    this.clearVoiceWs(userId);
    this.leaveCurrentRoomAnnounced(userId);

    // End any ringing DM rooms where this user is the caller
    for (const [roomId, room] of this.voiceRooms) {
      if (room.roomType === 'dm') {
        const meta = room.metadata as DmRoomMeta;
        if (meta.state === 'ringing' && meta.callerId === userId) {
          this.endDmRoom(roomId, 'dm_call_ended');
        }
      }
    }

    // Clear activity state
    this.clearUserActivities(userId);
    this.userShowActivity.delete(userId);
    this.userStatuses.delete(userId);
    this.lastActivityUpdate.delete(userId);

    // Close all WebSocket connections
    const connections = this.connections.get(userId);
    if (connections) {
      for (const ws of connections) {
        this.wsToUser.delete(ws);
        try { ws.close(4001, 'Account deleted'); } catch { /* ignore */ }
      }
      this.connections.delete(userId);
    }

    // Clean up user spaces
    this.userSpaces.delete(userId);
  }

  getAllOnlineUserIds(): string[] {
    return Array.from(this.connections.keys());
  }

  getAllConnections(): Map<string, Set<WebSocket>> {
    return this.connections;
  }

  /** Send an event to all connected admin users. */
  sendToAdmins(event: ServerEvent): void {
    const db = getDb();
    for (const userId of this.connections.keys()) {
      const user = db.select({ isAdmin: schema.users.isAdmin })
        .from(schema.users).where(eq(schema.users.id, userId)).get();
      if (user?.isAdmin === 1) {
        this.sendToUser(userId, event);
      }
    }
  }
}

export const connectionManager = new ConnectionManager();

/**
 * When a bot account's socket authenticates: if the account shows activities
 * and has no live ones yet (no other session of it reported any), its stored
 * status (`users.bot_activity`, the home's copy on a host) becomes its live
 * activity. Returns the seeded list, or null when nothing was seeded. Does not
 * broadcast: the connect path announces the presence with these activities.
 * A bot's own `activity_update` replaces the seed until its next connection.
 */
export function seedStoredBotActivity(row: {
  id: string;
  isBot: number;
  showActivity: number;
  botActivity: string | null;
}): Activity[] | null {
  if (row.isBot !== 1 || row.showActivity === 0) return null;
  if (connectionManager.getUserActivities(row.id).length > 0) return null;
  const live = botActivityAsLive(parseStoredBotActivity(row.botActivity));
  if (live.length === 0) return null;
  connectionManager.setUserActivities(row.id, live);
  return live;
}

/** The `ready` payload for `userId`: everything a client needs to start, sent once per connection. */
export function buildReadyPayload(userId: string): {
  user: User;
  spaces: SpaceWithChannelsAndMembers[];
  dmChannels: DmChannel[];
  folders: SpaceFolder[];
  spaceLayout: SpaceLayoutItem[] | null;
  layoutUpdatedAt: number | null;
  voiceStates: Record<string, string[]>;
  voiceChannelElapsedSeconds: Record<string, number>;
  voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }>;
  spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }>;
  supportsPoke: boolean;
  supportsJuno: boolean;
  unreadCounts: Record<string, number>;
  readStates: ReadState[];
  activeCalls: ActiveCallInfo[];
  userActivities: Record<string, Activity[]>;
} {
  const db = getDb();

  // Get user
  const userRow = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!userRow) {
    throw new Error('User not found');
  }
  const user = sanitizeUser(userRow, true);

  // Cache showActivity and status for Rich Presence
  connectionManager.setUserShowActivity(userId, userRow.showActivity !== 0);
  connectionManager.setUserStatus(userId, (userRow.status ?? 'offline') as string);

  // Get user's space memberships
  const memberships = db.select()
    .from(schema.spaceMembers)
    .where(eq(schema.spaceMembers.userId, userId))
    .all();

  const spaceIds = memberships.map(m => m.spaceId);

  // Space channels whose unread count the user may see (`canCountUnread`).
  const countableChannelIds: string[] = [];
  const spaces: SpaceWithChannelsAndMembers[] = [];

  if (spaceIds.length > 0) {
    const spaceRows = db.select()
      .from(schema.spaces)
      .where(inArray(schema.spaces.id, spaceIds))
      .all();

    // Batch: all channels for all spaces (1 query instead of N)
    const allChannels = batchInArray(
      spaceIds,
      ids => db.select().from(schema.channels).where(inArray(schema.channels.spaceId, ids)).all(),
    );
    const channelsBySpace = new Map<string, (typeof allChannels)>();
    for (const ch of allChannels) {
      let arr = channelsBySpace.get(ch.spaceId);
      if (!arr) { arr = []; channelsBySpace.set(ch.spaceId, arr); }
      arr.push(ch);
    }

    // Batch: which channels are private (`isHiddenFromEveryone`). The @everyone
    // role id equals the space id, so only overrides on a role whose id is one
    // of these spaces are read, each against the space of its own channel.
    const channelSpaceIds = new Map(allChannels.map((ch) => [ch.id, ch.spaceId]));
    const privateChannelIds = idsHiddenFromEveryone(
      batchInArray(
        spaceIds,
        ids => db.select().from(schema.channelOverrides).where(
          and(
            eq(schema.channelOverrides.targetType, 'role'),
            inArray(schema.channelOverrides.targetId, ids),
          )
        ).all(),
      ),
      (o) => o.channelId,
      (channelId) => channelSpaceIds.get(channelId),
    );

    // Batch: all categories for all spaces (1 query instead of N)
    const allCategories = batchInArray(
      spaceIds,
      ids => db.select().from(schema.channelCategories).where(inArray(schema.channelCategories.spaceId, ids)).all(),
    );
    // Batch: which categories are private, read the same way as channels.
    const categorySpaceIds = new Map(allCategories.map((cat) => [cat.id, cat.spaceId]));
    const privateCategoryIds = idsHiddenFromEveryone(
      batchInArray(
        spaceIds,
        ids => db.select().from(schema.categoryOverrides).where(
          and(
            eq(schema.categoryOverrides.targetType, 'role'),
            inArray(schema.categoryOverrides.targetId, ids),
          )
        ).all(),
      ),
      (o) => o.categoryId,
      (categoryId) => categorySpaceIds.get(categoryId),
    );
    const categoriesBySpace = new Map<string, ChannelCategory[]>();
    for (const cat of allCategories) {
      let arr = categoriesBySpace.get(cat.spaceId);
      if (!arr) { arr = []; categoriesBySpace.set(cat.spaceId, arr); }
      arr.push({
        id: cat.id,
        spaceId: cat.spaceId,
        name: cat.name,
        position: cat.position ?? 0,
        isPrivate: privateCategoryIds.has(cat.id),
        createdAt: cat.createdAt,
      });
    }

    // Batch: last message ID per channel (1 query instead of N×C)
    const allChannelIds = allChannels.map(ch => ch.id);
    const lastMsgMap = new Map<string, string>();
    if (allChannelIds.length > 0) {
      const lastMsgRows = batchInArray(
        allChannelIds,
        ids => db.select({
          channelId: schema.messages.channelId,
          lastId: sql<string>`max(${schema.messages.id})`,
        }).from(schema.messages).where(and(inArray(schema.messages.channelId, ids), userWrittenMessages())).groupBy(schema.messages.channelId).all(),
      );
      for (const row of lastMsgRows) {
        if (row.lastId) lastMsgMap.set(row.channelId, row.lastId);
      }
    }

    for (const spaceRow of spaceRows) {
      const channels = channelsBySpace.get(spaceRow.id) ?? [];

      const roles = db.select()
        .from(schema.roles)
        .where(eq(schema.roles.spaceId, spaceRow.id))
        .orderBy(schema.roles.position)
        .all();

      const memberRows = db.select()
        .from(schema.spaceMembers)
        .where(eq(schema.spaceMembers.spaceId, spaceRow.id))
        .all();

      const memberUserIds = memberRows.map(m => m.userId);
      const users = memberUserIds.length > 0
        ? batchInArray(memberUserIds, ids => db.select().from(schema.users).where(inArray(schema.users.id, ids)).all())
        : [];
      const userMap = new Map(users.map(u => [u.id, u]));

      const memberRoleRows = db.select()
        .from(schema.memberRoles)
        .where(eq(schema.memberRoles.spaceId, spaceRow.id))
        .all();

      const members: MemberWithUser[] = memberRows
        .map(m => {
          const u = userMap.get(m.userId);
          if (!u) return null;

          const assignedRoleIds = new Set(memberRoleRows
            .filter(mr => mr.userId === m.userId)
            .map(mr => mr.roleId));

          return {
            spaceId: m.spaceId,
            userId: m.userId,
            nickname: m.nickname,
            joinedAt: m.joinedAt,
            user: sanitizeUser(u),
            roles: memberRolesView(roles, assignedRoleIds),
          };
        })
        .filter((m): m is MemberWithUser => m !== null);

      // Compute space-level permissions for this user
      const spacePerms = computePermissions(userId, spaceRow.id);

      // Filter channels by VIEW_CHANNEL and attach per-channel permissions
      const visibleChannels: Channel[] = [];
      for (const ch of channels) {
        const chPerms = computePermissions(userId, spaceRow.id, ch.id);
        const hasView = (chPerms & PermissionBits.VIEW_CHANNEL) !== 0n || (chPerms & PermissionBits.ADMINISTRATOR) !== 0n;
        if (hasView) {
          if (canCountUnread(chPerms)) countableChannelIds.push(ch.id);
          visibleChannels.push({
            id: ch.id,
            spaceId: ch.spaceId,
            name: ch.name,
            type: ch.type as Channel['type'],
            topic: ch.topic,
            position: ch.position ?? 0,
            categoryId: ch.categoryId ?? null,
            isPrivate: privateChannelIds.has(ch.id),
            createdAt: ch.createdAt,
            lastMessageId: lastMsgMap.get(ch.id) ?? null,
            myPermissions: permissionsToString(chPerms),
          });
        }
      }

      spaces.push({
        id: spaceRow.id,
        name: spaceRow.name,
        icon: spaceRow.icon,
        banner: spaceRow.banner ?? null,
        avatarColor: (spaceRow.avatarColor as Space['avatarColor']) ?? null,
        ownerId: spaceRow.ownerId,
        ownerTitle: spaceRow.ownerTitle,
        inviteCode: spaceRow.inviteCode,
        visibility: (spaceRow.visibility ?? 'private') as SpaceWithChannelsAndMembers['visibility'],
        description: spaceRow.description ?? null,
        afkChannelId: spaceRow.afkChannelId ?? null,
        afkTimeoutSeconds: spaceRow.afkTimeoutSeconds ?? 300,
        createdAt: spaceRow.createdAt,
        channels: visibleChannels,
        categories: categoriesBySpace.get(spaceRow.id) ?? [],
        members,
        roles: rolesForViewer(roles, spacePerms),
        myPermissions: permissionsToString(spacePerms),
      });
    }
  }

  // Store user's space IDs for broadcasting
  connectionManager.setUserSpaces(userId, spaceIds);

  // Open DM memberships (active-call lookup below) and the DM channels
  // themselves (the same list GET /api/dm serves).
  const dmMemberships = db.select()
    .from(schema.dmMembers)
    .where(and(
      eq(schema.dmMembers.userId, userId),
      eq(schema.dmMembers.closed, 0),
    ))
    .all();
  const dmChannels = loadOpenDmChannels(db, userId, dmMemberships);

  // Get Space Folders
  const folderRows = db.select()
    .from(schema.spaceFolders)
    .where(eq(schema.spaceFolders.userId, userId))
    .orderBy(schema.spaceFolders.position)
    .all();

  const folders: SpaceFolder[] = [];
  for (const folder of folderRows) {
    const folderSpaceIds = db.select()
      .from(schema.spaceFolderMembers)
      .where(eq(schema.spaceFolderMembers.folderId, folder.id))
      .orderBy(schema.spaceFolderMembers.position)
      .all()
      .map(m => m.spaceId);

    folders.push({
      id: folder.id,
      userId: folder.userId,
      name: folder.name,
      color: folder.color,
      position: folder.position ?? 0,
      spaceIds: folderSpaceIds,
    });
  }

  // Get user space layout
  const layoutRow = db.select().from(schema.userSpaceLayout)
    .where(eq(schema.userSpaceLayout.userId, userId)).get();
  const spaceLayout: SpaceLayoutItem[] | null = layoutRow ? JSON.parse(layoutRow.layout) : null;
  const layoutUpdatedAt: number | null = layoutRow?.updatedAt ?? null;

  // Build voice states — who is currently in voice channels, plus space mute/
  // deafen and permission-mute, across all the user's spaces. Delegates to the
  // shared per-space helper (also used for the mid-session join push in
  // ConnectionManager.addUserSpace) so the two code paths can never diverge.
  // The helper applies the same VIEW_CHANNEL filtering used when building the
  // `spaces` array above.
  const voiceStates: Record<string, string[]> = {};
  const voiceChannelElapsedSeconds: Record<string, number> = {};
  const spaceVoiceStates: Record<string, { spaceMuted: boolean; spaceDeafened: boolean; permissionMuted: boolean }> = {};
  for (const space of spaces) {
    const snap = connectionManager.buildSpaceVoiceState(space.id, userId);
    Object.assign(voiceStates, snap.voiceStates);
    Object.assign(voiceChannelElapsedSeconds, snap.voiceChannelElapsedSeconds);
    Object.assign(spaceVoiceStates, snap.spaceVoiceStates);
  }

  // Build active calls from user's DM memberships
  const activeCalls: ActiveCallInfo[] = [];
  for (const dm of dmMemberships) {
    const room = connectionManager.getRoom(dm.dmChannelId);
    if (room && room.roomType === 'dm') {
      const dmMeta = room.metadata as DmRoomMeta;
      // A member who declined a group call that still rings is not rung
      // again on reconnect.
      if (dmMeta.state === 'ringing' && dmMeta.declinedUserIds.has(userId)) continue;
      activeCalls.push({
        dmChannelId: dm.dmChannelId,
        callerId: dmMeta.callerId,
        participants: Array.from(room.participants),
        startedAt: room.startedAt,
        state: dmMeta.state,
      });
      // Inject DM call participants into voiceStates so frontend's generic handler works
      if (room.participants.size > 0) {
        voiceStates[dm.dmChannelId] = Array.from(room.participants);
      }
    }
  }

  // Build voice user states — includes both space and DM participants now
  const voiceUserStates: Record<string, { isMuted: boolean; isDeafened: boolean; isCameraOn: boolean; isScreenSharing: boolean }> = {};
  for (const chId of Object.keys(voiceStates)) {
    const usersInChannel = voiceStates[chId];
    if (usersInChannel) {
      for (const uid of usersInChannel) {
        const status = connectionManager.getVoiceUserStatus(uid);
        if (status) {
          voiceUserStates[uid] = status;
        }
      }
    }
  }

  // Fetch read states for unread tracking
  const readStateRows = db.select()
    .from(schema.readStates)
    .where(eq(schema.readStates.userId, userId))
    .all();

  const readStates: ReadState[] = readStateRows
    .map(rs => ({
      channelId: rs.channelId,
      lastReadMessageId: rs.lastReadMessageId,
    }));

  // Build user activities snapshot for all visible users: space members, DM
  // members and friends (a friend may share neither with the user). Keys are
  // the stable local account ids.
  // Auto-inject customStatus as a 'custom' activity for users with no ephemeral activities
  const userActivities: Record<string, Activity[]> = {};
  const seenUserIds = new Set<string>();

  function collectUserActivities(
    subject: { id: string; customStatus: string | null },
  ) {
    if (seenUserIds.has(subject.id)) return;
    seenUserIds.add(subject.id);
    const acts = snapshotActivities(connectionManager.getUserActivities(subject.id), subject.customStatus);
    if (acts.length > 0) {
      userActivities[subject.id] = acts;
    }
  }

  for (const space of spaces) {
    for (const member of space.members) {
      collectUserActivities({
        id: member.userId,
        customStatus: member.user?.customStatus ?? null,
      });
    }
  }
  for (const dm of dmChannels) {
    for (const member of dm.members) {
      collectUserActivities({
        id: member.id,
        customStatus: member.customStatus ?? null,
      });
    }
  }
  const friendIds = db.select({ userId: schema.friends.userId, friendId: schema.friends.friendId })
    .from(schema.friends)
    .where(or(eq(schema.friends.userId, userId), eq(schema.friends.friendId, userId)))
    .all()
    .map(f => (f.userId === userId ? f.friendId : f.userId));
  if (friendIds.length > 0) {
    const friendRows = db.select({
      id: schema.users.id,
      customStatus: schema.users.customStatus,
    })
      .from(schema.users)
      .where(inArray(schema.users.id, friendIds))
      .all();
    for (const friend of friendRows) collectUserActivities(friend);
  }

  const unreadCounts = readyUnreadCounts(
    userId,
    countableChannelIds,
    dmChannels.map(dm => dm.id),
    new Map(readStateRows.map(rs => [rs.channelId, rs.lastReadMessageId])),
  );
  return { supportsJuno: true, supportsPoke: true, unreadCounts, user, spaces, dmChannels, folders, spaceLayout, layoutUpdatedAt, voiceStates, voiceChannelElapsedSeconds, voiceUserStates, spaceVoiceStates, readStates, activeCalls, userActivities };
}

export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket, request) => {
    const ws = socket as unknown as WebSocket;
    // Per-address limits on events key on this, as the HTTP limiter does.
    recordSocketAddress(ws, request.ip);
    let authenticated = false;
    let userId: string | undefined;
    let username: string | undefined;

    // Set auth timeout - must authenticate within 10 seconds
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'Authentication timeout' }));
        ws.close();
      }
    }, 10000);

    ws.on('message', (data: Buffer | string) => {
      let parsed: Record<string, unknown>;
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      // Any received message proves liveness
      wsIsAlive.set(ws, true);

      if (!authenticated) {
        // First message must be auth
        if (parsed.type !== 'auth' || typeof parsed.token !== 'string') {
          ws.send(JSON.stringify({ type: 'error', message: 'First message must be auth' }));
          ws.close();
          return;
        }

        try {
          // A bot token is checked against its stored hash; anything else is a JWT.
          let payload: { userId: string; username: string; iat?: number };
          let botTokenId: string | null = null;
          if (isBotTokenString(parsed.token)) {
            const resolved = verifyBotToken(parsed.token);
            if (resolved === 'deleted') {
              ws.send(JSON.stringify({ type: 'error', message: 'This account has been deleted' }));
              ws.close();
              return;
            }
            if (resolved === 'invalid') throw new Error('Invalid bot token');
            payload = { userId: resolved.userId, username: resolved.username };
            botTokenId = resolved.tokenId;
          } else {
            payload = verifyJwt(parsed.token);
          }
          userId = payload.userId;
          username = payload.username;

          // Reject deleted users and revoked tokens
          const db = getDb();
          const userRow = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
          if (!userRow || userRow.isDeleted) {
            ws.send(JSON.stringify({ type: 'error', message: 'This account has been deleted' }));
            ws.close();
            return;
          }
          // A bot's old 10-year JWT stops working once it holds a `bsb_` token.
          if (payload.iat !== undefined && isRetiredLegacyBotJwt(userRow)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Token has been revoked' }));
            ws.close();
            return;
          }
          // Token revocation: reject tokens issued before last password change
          if (userRow.passwordChangedAt && payload.iat) {
            if (payload.iat < userRow.passwordChangedAt / 1000) {
              ws.send(JSON.stringify({ type: 'error', message: 'Token has been revoked' }));
              ws.close();
              return;
            }
          }

          // One process per bot credential: a second socket is refused while the first is open.
          if (userRow.isBot === 1) {
            const sessionKey = botTokenId !== null ? `token:${botTokenId}` : `account:${userRow.id}`;
            if (!connectionManager.claimBotSession(sessionKey, ws)) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'This bot token is already connected from another process',
                code: 'bot_token_in_use',
              }));
              ws.close(BOT_TOKEN_IN_USE_CLOSE_CODE, 'bot_token_in_use');
              return;
            }
          }

          authenticated = true;
          clearTimeout(authTimeout);

          // Chosen idle/dnd survives reconnects and restarts.
          const connectStatus = connectionManager.publishConnectStatus(userRow);

          // Add connection
          connectionManager.addConnection(userId, ws);

          // A bot shows its stored status while connected, unless another of its
          // sessions already reported an activity (its code may have set one).
          const seededActivities = seedStoredBotActivity(userRow);

          // Mark alive for heartbeat detection; browsers auto-respond to ping frames (RFC 6455)
          wsIsAlive.set(ws, true);
          ws.on('pong', () => {
            wsIsAlive.set(ws, true);
          });

          // Build and send ready payload
          const readyData = buildReadyPayload(userId);
          ws.send(JSON.stringify({
            type: 'ready',
            ...readyData,
          }));

          // Broadcast the connect status to friends + DM co-members + space co-members.
          const connectPayload = presenceUpdateFor(userId, connectStatus, seededActivities ?? undefined);
          const connectTargets = collectProfileBroadcastTargetIds(userId);
          for (const uid of connectTargets) connectionManager.sendToUser(uid, connectPayload);

        } catch {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
          ws.close();
        }
        return;
      }

      // Fast-path heartbeat — never reaches business logic
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      // Ephemeral traffic cannot spend the capacity needed to leave/end/mute.
      const retryAfter = consumeWsEvent(userId!, parsed.type);
      if (retryAfter > 0) {
        ws.send(JSON.stringify(wsEventRateLimitError(retryAfter, parsed)));
        return;
      }

      // Handle authenticated events
      if (userId && username) {
        try {
          handleClientEvent(parsed, userId, username, ws);
        } catch (err) {
          app.log.error({ err, eventType: parsed.type, userId }, 'Unhandled error in WS event handler');
          try {
            ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
          } catch { /* ws may already be closed */ }
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (userId) {
        connectionManager.removeConnection(ws);
      }
    });

    ws.on('error', () => {
      clearTimeout(authTimeout);
    });
  });

  // ─── Heartbeat Sweep ──────────────────────────────────────────────────────
  // Detect dead connections (e.g. PC shut off without TCP FIN).
  // Sends protocol-level ping frames; browsers auto-respond with pong (RFC 6455).
  // Worst-case detection: 30s + 30s + 5s grace = ~65s.
  const HEARTBEAT_INTERVAL_MS = 30_000;

  heartbeatInterval = setInterval(() => {
    for (const [, userConnections] of connectionManager.getAllConnections()) {
      for (const ws of userConnections) {
        if (wsIsAlive.get(ws) === false) {
          ws.terminate(); // Emits 'close' → removeConnection → scheduleDisconnect → finalizeDisconnect
          continue;
        }
        wsIsAlive.set(ws, false);
        if (ws.readyState === 1) ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook('onClose', async () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  });
}
