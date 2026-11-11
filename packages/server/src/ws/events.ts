import { handleChannelPoke } from './channelPoke.js';
import type { WebSocket } from 'ws';
import { addsMassMention, hasMassMention } from '@veyvox/shared/src/mentions.js';
import { eq, inArray, and } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager, getVoiceRoomElapsedSeconds } from './handler.js';
import type { VoiceRoom, DmRoomMeta, SpaceRoomMeta } from './handler.js';
import { isMember, getChannelSpaceId, isDmMember, isDeadOneOnOne, hasPermission, computePermissions, PermissionBits } from '../utils/permissions.js';
import { broadcastDmMessage, getDmMessageWithUser, reopenForClosedMembers } from '../routes/dm.js';
import { fetchReplyToMessages, isReplyTargetInChannel, storedMassMentionFields } from '../routes/messages.js';
import { MAX_MESSAGE_LENGTH, isChosenUserStatus, type MessageWithUser, type Attachment, type Embed } from '@veyvox/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { applyChosenStatus, publishActivities } from './presence.js';
import { validateActivities } from './presenceEvent.js';
import { deleteAttachmentFiles } from '../utils/fileCleanup.js';
import { resolveEmbeds, reResolveEmbeds, embedRowToEmbed } from '../utils/embedResolver.js';
import { config } from '../config.js';
import { canActOnMemberInSpace } from '../utils/roleHierarchy.js';
import { ERROR_MESSAGES, errorText } from '../utils/httpErrors.js';
import type { ErrorCode, ErrorDetails } from '@veyvox/shared/src/errors';
import { checkDmMessageCreate, checkDmMessageDelete, checkDmMessageEdit } from '../utils/dmMessageRules.js';
import { consumeMessageCreate, consumeReaction, rateLimitEvent } from '../utils/rateLimits.js';

/**
 * Re-evaluate SPEAK permission for all participants in voice channels
 * belonging to the given space. On transition, updates the in-memory
 * permissionMutedUsers Set and broadcasts voice_permission_muted events.
 */
export function checkVoicePermissions(spaceId: string): void {
  for (const [roomId, room] of connectionManager.getAllRooms()) {
    if (room.roomType !== 'space') continue;
    const meta = room.metadata as SpaceRoomMeta;
    if (meta.spaceId !== spaceId) continue;

    for (const userId of room.participants) {
      const perms = computePermissions(userId, spaceId, roomId);
      const canSpeak = (perms & PermissionBits.SPEAK) !== 0n || (perms & PermissionBits.ADMINISTRATOR) !== 0n;
      const shouldMute = !canSpeak;

      // A bot seat is judged per channel: another seat of the same bot, in a
      // channel where it may speak, must not change this one.
      if (connectionManager.isBotSeat(userId, roomId)) {
        if (shouldMute !== connectionManager.isBotSeatPermissionMuted(roomId, userId)) {
          connectionManager.setBotSeatPermissionMuted(roomId, userId, shouldMute);
          connectionManager.sendToSpace(spaceId, {
            type: 'voice_permission_muted',
            userId,
            spaceId,
            channelId: roomId,
            muted: shouldMute,
          });
        }
        continue;
      }

      const wasMuted = connectionManager.isPermissionMuted(spaceId, userId);

      if (shouldMute !== wasMuted) {
        connectionManager.setPermissionMuted(spaceId, userId, shouldMute);
        connectionManager.sendToSpace(spaceId, {
          type: 'voice_permission_muted',
          userId,
          spaceId,
          muted: shouldMute,
        });
      }
    }
  }
}

function getMessageWithUser(messageId: string): MessageWithUser | null {
  const db = getDb();
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!message) return null;

  const user = db.select().from(schema.users).where(eq(schema.users.id, message.userId)).get();
  if (!user) return null;

  const attachmentRows = db.select()
    .from(schema.attachments)
    .where(eq(schema.attachments.messageId, messageId))
    .all();

  const attachments: Attachment[] = attachmentRows.map(a => ({
    id: a.id,
    messageId: a.messageId ?? messageId,
    filename: a.filename,
    originalName: a.originalName,
    mimetype: a.mimetype,
    size: a.size,
    thumbnailFilename: a.thumbnailFilename ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
    duration: a.duration ?? null,
    playable: a.playable ?? null,
    createdAt: a.createdAt,
  }));

  const reactionRows = db.select()
    .from(schema.reactions)
    .where(eq(schema.reactions.messageId, messageId))
    .all();

  const reactions = reactionRows.map(r => ({
    id: r.id,
    messageId: r.messageId,
    userId: r.userId,
    emoji: r.emoji,
    createdAt: r.createdAt,
  }));

  const embedRows = db.select()
    .from(schema.embeds)
    .where(eq(schema.embeds.messageId, messageId))
    .all();

  // Reply targets are confined to the message's own channel. This is the same
  // helper the REST read paths use, so both stay on one rule.
  let replyTo: MessageWithUser | null = null;
  if (message.replyToId) {
    const replyToMap = fetchReplyToMessages(message.channelId, [message]);
    replyTo = replyToMap.get(message.replyToId) ?? null;
  }

  return {
    id: message.id,
    channelId: message.channelId,
    userId: message.userId,
    replyToId: message.replyToId,
    content: message.content,
    type: message.type,
    editedAt: message.editedAt,
    createdAt: message.createdAt,
    ...storedMassMentionFields(message),
    user: sanitizeUser(user),
    attachments,
    embeds: embedRows.map(e => embedRowToEmbed(e)),
    reactions,
    replyTo,
  };
}

// Typing timeout tracking (capped to prevent unbounded growth)
const MAX_TYPING_ENTRIES = 10_000;
const typingTimeouts: Map<string, NodeJS.Timeout> = new Map();

export function handleClientEvent(
  event: Record<string, unknown>,
  userId: string,
  username: string,
  ws: WebSocket,
): void {
  const type = event.type as string;

  switch (type) {
    case 'message_create':
      handleMessageCreate(event, userId, ws);
      break;
    case 'message_edit':
      handleMessageEdit(event, userId);
      break;
    case 'message_delete':
      handleMessageDelete(event, userId);
      break;
    case 'channel_poke':
      handleChannelPoke({ event, userId, ws });
      break;
    case 'typing_start':
      handleTypingStart(event, userId, username);
      break;
    case 'presence_update':
      handlePresenceUpdate(event, userId);
      break;
    case 'voice_join':
      handleVoiceJoin(event, userId, ws);
      break;
    case 'voice_leave':
      handleVoiceLeave(userId);
      break;
    case 'bot_voice_join':
      handleBotVoiceJoin(event, userId);
      break;
    case 'bot_voice_leave':
      handleBotVoiceLeave(event, userId);
      break;
    case 'dm_message_create':
      handleDmMessageCreate(event, userId, ws);
      break;
    case 'dm_typing_start':
      handleDmTypingStart(event, userId, username);
      break;
    case 'dm_message_edit':
      handleDmMessageEdit(event, userId, ws);
      break;
    case 'dm_message_delete':
      handleDmMessageDelete(event, userId, ws);
      break;
    case 'reaction_add':
      handleReactionAdd(event, userId, ws);
      break;
    case 'reaction_remove':
      handleReactionRemove(event, userId, ws);
      break;
    case 'channel_ack':
      handleChannelAck(event, userId);
      break;
    case 'mark_unread':
      handleMarkUnread(event, userId);
      break;
    case 'dm_call_start':
      handleDmCallStart(event, userId, username, ws).catch(err =>
        console.error('[ws] handleDmCallStart error:', err),
      );
      break;
    case 'dm_call_accept':
      handleDmCallAccept(event, userId, ws).catch(err =>
        console.error('[ws] handleDmCallAccept error:', err),
      );
      break;
    case 'dm_call_reject':
      handleDmCallReject(event, userId).catch(err =>
        console.error('[ws] handleDmCallReject error:', err),
      );
      break;
    case 'dm_call_end':
      handleDmCallEnd(event, userId).catch(err =>
        console.error('[ws] handleDmCallEnd error:', err),
      );
      break;
    case 'voice_status':
      handleVoiceStatus(event, userId, ws);
      break;
    case 'voice_space_mute':
      handleVoiceSpaceMute(event, userId);
      break;
    case 'voice_space_deafen':
      handleVoiceSpaceDeafen(event, userId);
      break;
    case 'voice_move':
      handleVoiceMove(event, userId);
      break;
    case 'voice_disconnect':
      handleVoiceDisconnect(event, userId);
      break;
    case 'activity_update':
      handleActivityUpdate(event, userId, ws);
      break;
    default:
      connectionManager.sendToUser(userId, {
        type: 'error',
        message: `Unknown event type: ${type}`,
      });
  }
}

/** The coded refusal of a mass mention without MENTION_EVERYONE, as REST answers it. */
function sendMissingMentionEveryone(userId: string): void {
  const details = { permission: 'MENTION_EVERYONE' };
  connectionManager.sendToUser(userId, { type: 'error', message: errorText('missing_permission', details), code: 'missing_permission', details });
}

function handleMessageCreate(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const channelId = event.channelId as string;
  const content = event.content as string;
  const replyToId = event.replyToId as string | undefined;

  if (!channelId || typeof channelId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'channelId is required' });
    return;
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'content is required' });
    return;
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    connectionManager.sendToUser(userId, { type: 'error', message: `Message content must be ${MAX_MESSAGE_LENGTH} characters or less` });
    return;
  }

  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Channel not found' });
    return;
  }

  if (!hasPermission(userId, spaceId, PermissionBits.SEND_MESSAGES, channelId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing SEND_MESSAGES permission' });
    return;
  }

  if (hasMassMention(content) && !hasPermission(userId, spaceId, PermissionBits.MENTION_EVERYONE, channelId)) {
    sendMissingMentionEveryone(userId);
    return;
  }

  // A reply may only target a message in the channel it is posted into.
  if (replyToId && !isReplyTargetInChannel(channelId, replyToId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Invalid reply target' });
    return;
  }

  const retryAfter = consumeMessageCreate(userId);
  if (retryAfter > 0) { connectionManager.sendToWs(ws, rateLimitEvent(retryAfter)); return; }

  const db = getDb();
  const messageId = generateSnowflake();
  const now = Date.now();

  db.insert(schema.messages).values({
    id: messageId,
    channelId,
    userId,
    replyToId: replyToId || null,
    content: content.trim(),
    createdAt: now,
  }).run();

  const messageWithUser = getMessageWithUser(messageId);
  if (messageWithUser) {
    // Broadcast to members with VIEW_CHANNEL on this channel
    connectionManager.sendToChannel(spaceId, channelId, {
      type: 'message_created',
      message: messageWithUser,
    });

    // Resolve embeds asynchronously
    setImmediate(() => {
      resolveEmbeds(messageId, content.trim(), channelId, false, spaceId).catch(() => {});
    });
  }
}

function handleMessageEdit(event: Record<string, unknown>, userId: string): void {
  const messageId = event.messageId as string;
  const content = event.content as string;

  if (!messageId || typeof messageId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'messageId is required' });
    return;
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'content is required' });
    return;
  }

  if (content.length > MAX_MESSAGE_LENGTH) {
    connectionManager.sendToUser(userId, { type: 'error', message: `Message content must be ${MAX_MESSAGE_LENGTH} characters or less` });
    return;
  }

  const db = getDb();
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!message) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Message not found' });
    return;
  }

  // A system row (a poke) is written by this instance, so nobody edits it,
  // its author included; PATCH /api/messages/:id refuses it with the same code.
  if (message.type === 'system') {
    connectionManager.sendToUser(userId, { type: 'error', message: errorText('system_message_immutable'), code: 'system_message_immutable' });
    return;
  }
  if (message.userId !== userId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'You can only edit your own messages' });
    return;
  }

  // The same rule as PATCH /api/messages/:id: adding a mass mention needs
  // MENTION_EVERYONE, keeping one the message already has does not.
  const mentionSpaceId = getChannelSpaceId(message.channelId);
  if (addsMassMention(message.content, content) && (!mentionSpaceId || !hasPermission(userId, mentionSpaceId, PermissionBits.MENTION_EVERYONE, message.channelId))) {
    sendMissingMentionEveryone(userId);
    return;
  }

  const now = Date.now();
  db.update(schema.messages)
    .set({ content: content.trim(), editedAt: now })
    .where(eq(schema.messages.id, messageId))
    .run();

  const spaceId = getChannelSpaceId(message.channelId);
  if (!spaceId) return;

  // Delete old embeds synchronously so the broadcast reflects the edit
  db.delete(schema.embeds).where(eq(schema.embeds.messageId, messageId)).run();

  const updatedMessage = getMessageWithUser(messageId);
  if (updatedMessage) {
    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'message_updated',
      message: updatedMessage,
    });

    // Resolve new embeds asynchronously (old ones already deleted above)
    setImmediate(() => {
      resolveEmbeds(messageId, content.trim(), message.channelId, false, spaceId).catch(() => {});
    });
  }
}

function handleMessageDelete(event: Record<string, unknown>, userId: string): void {
  const messageId = event.messageId as string;

  if (!messageId || typeof messageId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'messageId is required' });
    return;
  }

  const db = getDb();
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (!message) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Message not found' });
    return;
  }

  const spaceId = getChannelSpaceId(message.channelId);
  if (!spaceId) return;

  // Allow author or MANAGE_MESSAGES permission holder to delete
  const isAuthor = message.userId === userId;
  const canManageMessages = hasPermission(userId, spaceId, PermissionBits.MANAGE_MESSAGES, message.channelId);

  if (!isAuthor && !canManageMessages) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'You cannot delete this message' });
    return;
  }

  // Collect attachment filenames before deletion
  const attachmentRows = db.select({ filename: schema.attachments.filename })
    .from(schema.attachments).where(eq(schema.attachments.messageId, messageId)).all();

  // Delete attachments + message atomically, file cleanup outside transaction
  db.transaction((tx) => {
    tx.delete(schema.attachments).where(eq(schema.attachments.messageId, messageId)).run();
    tx.delete(schema.messages).where(eq(schema.messages.id, messageId)).run();
  });

  // Clean up files from disk (outside transaction — file I/O)
  deleteAttachmentFiles(attachmentRows);

  connectionManager.sendToChannel(spaceId, message.channelId, {
    type: 'message_deleted',
    messageId,
    channelId: message.channelId,
  });
}

function handleTypingStart(event: Record<string, unknown>, userId: string, username: string): void {
  const channelId = event.channelId as string;

  if (!channelId || typeof channelId !== 'string') return;

  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) return;

  if (!hasPermission(userId, spaceId, PermissionBits.SEND_MESSAGES, channelId)) return;

  // Clear previous typing timeout for this user+channel
  const key = `${userId}:${channelId}`;
  const existing = typingTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Broadcast typing event to channel viewers (exclude sender)
  connectionManager.sendToChannel(spaceId, channelId, {
    type: 'typing',
    channelId,
    userId,
    username,
  }, userId);

  // Safety cap: skip if Map is at max capacity (auto-expiry handles normal cleanup)
  if (!existing && typingTimeouts.size >= MAX_TYPING_ENTRIES) return;

  // Auto-expire typing after 5 seconds
  const timeout = setTimeout(() => {
    typingTimeouts.delete(key);
  }, 5000);
  typingTimeouts.set(key, timeout);
}

function handlePresenceUpdate(event: Record<string, unknown>, userId: string): void {
  if (!isChosenUserStatus(event.status)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Status must be "online", "idle", or "dnd"' });
    return;
  }
  applyChosenStatus(userId, event.status);
}

function handleActivityUpdate(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  if (!connectionManager.getUserShowActivity(userId)) return;

  const activities = validateActivities(event.activities);
  if (!activities) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Invalid activity payload' });
    return;
  }

  const removingPublishedActivities =
    activities.length < connectionManager.getUserActivities(userId).length;
  if (!connectionManager.checkActivityRateLimit(userId, removingPublishedActivities)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Activity update rate limited' });
    return;
  }

  publishActivities(userId, activities, ws);
}

// ─── Voice Handlers (Unified Room API) ─────────────────────────────────────

/** Helper: broadcast a voice leave and end a DM call its last participant left. */
function broadcastRoomLeave(roomId: string, room: VoiceRoom, userId: string): void {
  if (room.roomType === 'space') {
    const meta = room.metadata as SpaceRoomMeta;
    connectionManager.sendToSpace(meta.spaceId, {
      type: 'voice_state_update',
      channelId: roomId,
      userId,
      action: 'leave',
    });
  } else {
    connectionManager.afterDmCallLeave(roomId, userId);
  }
}

/** Voice channels one bot may sit in at the same time. */
export const MAX_BOT_VOICE_ROOMS = 25;

function isBotAccount(userId: string): boolean {
  return getDb().select({ isBot: schema.users.isBot })
    .from(schema.users).where(eq(schema.users.id, userId)).get()?.isBot === 1;
}

/**
 * A bot takes a seat in a voice channel without leaving the others: one
 * instance per channel. Same checks as `voice_join` (channel, membership,
 * CONNECT); the audio itself is the bot's own LiveKit connection per room, with
 * a token from `POST /api/livekit/token { channelId }`.
 */
function handleBotVoiceJoin(event: Record<string, unknown>, userId: string): void {
  const channelId = event.channelId;
  if (typeof channelId !== 'string' || channelId.length === 0) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'channelId is required' });
    return;
  }
  if (!isBotAccount(userId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Only bots can join several voice channels', code: 'bot_account_required' });
    return;
  }
  const channel = getDb().select({ spaceId: schema.channels.spaceId, type: schema.channels.type })
    .from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Channel not found' });
    return;
  }
  if (channel.type !== 'voice') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target channel is not a voice channel' });
    return;
  }
  const spaceId = channel.spaceId;
  if (!isMember(spaceId, userId) || !hasPermission(userId, spaceId, PermissionBits.CONNECT, channelId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing CONNECT permission' });
    return;
  }
  if (connectionManager.getBotRoomIds(userId).length >= MAX_BOT_VOICE_ROOMS
      && !connectionManager.getBotRoomIds(userId).includes(channelId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: `A bot can be in at most ${MAX_BOT_VOICE_ROOMS} voice channels` });
    return;
  }
  if (!connectionManager.botJoinRoom(userId, channelId, spaceId)) return; // already there

  const room = connectionManager.getRoom(channelId);
  connectionManager.sendToRoom(channelId, {
    type: 'voice_state_update',
    channelId,
    userId,
    action: 'join',
    channelElapsedSeconds: room ? getVoiceRoomElapsedSeconds(room) : undefined,
  });

  // A bot has no SPEAK-less listener mode of its own: a role without SPEAK mutes it like anyone.
  const perms = computePermissions(userId, spaceId, channelId);
  const canSpeak = (perms & PermissionBits.SPEAK) !== 0n || (perms & PermissionBits.ADMINISTRATOR) !== 0n;
  // Kept per seat: muted here says nothing about the bot's other channels.
  connectionManager.setBotSeatPermissionMuted(channelId, userId, !canSpeak);
  if (!canSpeak) {
    connectionManager.sendToSpace(spaceId, { type: 'voice_permission_muted', userId, spaceId, channelId, muted: true });
  }

  // A moderator's mute or deafen of this seat outlives the seat: it is back on rejoin.
  for (const type of botSeatRestrictionTypes(channelId, userId)) {
    connectionManager.sendToSpace(spaceId, type === 'mute'
      ? { type: 'voice_space_muted', userId, channelId, spaceId, muted: true, botSeat: true }
      : { type: 'voice_space_deafened', userId, channelId, spaceId, deafened: true, botSeat: true });
  }
}

/** The restrictions a moderator put on the bot's seat in this channel. */
function botSeatRestrictionTypes(channelId: string, botId: string): Array<'mute' | 'deafen'> {
  return getDb().select({ type: schema.botSeatRestrictions.restrictionType })
    .from(schema.botSeatRestrictions)
    .where(and(eq(schema.botSeatRestrictions.channelId, channelId), eq(schema.botSeatRestrictions.botId, botId)))
    .all()
    .map(r => r.type)
    .filter((t): t is 'mute' | 'deafen' => t === 'mute' || t === 'deafen');
}

/**
 * A moderator's mute or deafen of one bot seat. A bot sits in several voice
 * channels at once, so the restriction is the channel's only (kept in
 * `bot_seat_restrictions`, per channel) and is announced with `botSeat: true`;
 * the bot's seats elsewhere keep their own state. Same checks as for a person:
 * the bit in that channel and the role hierarchy. Like a person's, it is a
 * flag the bot's client is told to honour, not a cut at the media server.
 */
function restrictBotSeat(actorId: string, botId: string, channelId: string, type: 'mute' | 'deafen', on: boolean): void {
  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) {
    connectionManager.sendToUser(actorId, { type: 'error', message: 'Channel not found' });
    return;
  }
  const bit = type === 'mute' ? PermissionBits.MUTE_MEMBERS : PermissionBits.DEAFEN_MEMBERS;
  if (!hasPermission(actorId, spaceId, bit, channelId)) {
    connectionManager.sendToUser(actorId, {
      type: 'error',
      message: type === 'mute' ? 'Missing MUTE_MEMBERS permission' : 'Missing DEAFEN_MEMBERS permission',
    });
    return;
  }
  if (actorId === botId) {
    connectionManager.sendToUser(actorId, { type: 'error', message: type === 'mute' ? 'Cannot space-mute yourself' : 'Cannot space-deafen yourself' });
    return;
  }
  if (refusedByRoleHierarchy(spaceId, actorId, botId)) return;

  const db = getDb();
  if (on) {
    db.insert(schema.botSeatRestrictions).values({
      channelId,
      botId,
      restrictionType: type,
      moderatorId: actorId,
      createdAt: Date.now(),
    }).onConflictDoNothing().run();
  } else {
    db.delete(schema.botSeatRestrictions).where(and(
      eq(schema.botSeatRestrictions.channelId, channelId),
      eq(schema.botSeatRestrictions.botId, botId),
      eq(schema.botSeatRestrictions.restrictionType, type),
    )).run();
  }

  connectionManager.sendToSpace(spaceId, type === 'mute'
    ? { type: 'voice_space_muted', userId: botId, channelId, spaceId, muted: on, botSeat: true }
    : { type: 'voice_space_deafened', userId: botId, channelId, spaceId, deafened: on, botSeat: true });
}

/** The channel a moderation event names, when it names one: the seat of a bot there. */
function botSeatTarget(event: Record<string, unknown>, targetUserId: string): string | null {
  const channelId = event.channelId;
  if (typeof channelId !== 'string' || channelId.length === 0) return null;
  return connectionManager.isBotSeat(targetUserId, channelId) ? channelId : null;
}

function handleBotVoiceLeave(event: Record<string, unknown>, userId: string): void {
  const channelId = event.channelId;
  if (typeof channelId !== 'string' || channelId.length === 0) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'channelId is required' });
    return;
  }
  const room = connectionManager.botLeaveRoom(userId, channelId);
  if (!room) return; // not in that channel
  broadcastRoomLeave(channelId, room, userId);
  if (connectionManager.getBotRoomIds(userId).length === 0) connectionManager.clearVoiceUserStatus(userId);
}

/**
 * A refused join is terminal for the client, so it must be terminal on the
 * server too. When the refusal concerns the room the user is still holding —
 * the resume-after-reconnect case, where CONNECT was revoked or the channel
 * deleted mid-grace — leaving them parked there until the grace period expires
 * would keep them listed in a voice channel they have already been told they
 * are out of. A refusal aimed at any *other* channel leaves the live session
 * alone, which is what it has always done.
 */
function rejectVoiceJoin(userId: string, channelId: string): void {
  if (connectionManager.getUserRoom(userId)?.roomId === channelId) {
    handleVoiceLeave(userId);
  }
  connectionManager.sendToUser(userId, {
    type: 'voice_disconnected', userId, channelId, reason: 'rejected',
  });
}

function handleVoiceJoin(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const channelId = event.channelId as string;

  if (!channelId || typeof channelId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'channelId is required' });
    return;
  }

  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Channel not found' });
    rejectVoiceJoin(userId, channelId);
    return;
  }

  if (!hasPermission(userId, spaceId, PermissionBits.CONNECT, channelId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing CONNECT permission' });
    rejectVoiceJoin(userId, channelId);
    return;
  }

  // A bot that already sits in this channel through `bot_voice_join` keeps that
  // seat; a second, person-style seat in the same room would be announced twice
  // and outlive the first one's `bot_voice_leave`.
  if (connectionManager.getBotRoomIds(userId).includes(channelId)) return;

  // ── Device switch guardrail ──
  // If this user already has a voice session on a different socket,
  // notify that socket to tear down its LiveKit connection.
  {
    const oldVoiceWs = connectionManager.getVoiceWs(userId);
    if (oldVoiceWs && oldVoiceWs !== ws) {
      const oldRoom = connectionManager.getUserRoom(userId);
      connectionManager.sendToWs(oldVoiceWs, {
        type: 'voice_disconnected',
        userId,
        channelId: oldRoom?.roomId ?? channelId,
        reason: 'displaced',
      });
    }
    connectionManager.setVoiceWs(userId, ws);
  }

  // If the user is already in this exact room (e.g. WS reconnect re-registration),
  // skip the leave+join broadcast to avoid visual flicker for other users.
  const currentRoom = connectionManager.getUserRoom(userId);
  if (currentRoom && currentRoom.roomId === channelId) {
    const status = connectionManager.getVoiceUserStatus(userId);
    if (status) {
      connectionManager.sendToRoom(channelId, {
        type: 'voice_status_update',
        userId,
        channelId,
        isMuted: status.isMuted,
        isDeafened: status.isDeafened,
        isCameraOn: status.isCameraOn,
        isScreenSharing: status.isScreenSharing,
      });
    }

    // Re-broadcast persistent restrictions (covers page reload while in voice)
    const db = getDb();
    const restrictions = db.select()
      .from(schema.voiceRestrictions)
      .where(and(
        eq(schema.voiceRestrictions.spaceId, spaceId),
        eq(schema.voiceRestrictions.userId, userId),
      ))
      .all();
    for (const r of restrictions) {
      if (r.restrictionType === 'mute') {
        connectionManager.setSpaceMuted(spaceId, userId, true);
        connectionManager.sendToUser(userId, {
          type: 'voice_space_muted',
          userId,
          channelId,
          spaceId,
          muted: true,
        });
      } else if (r.restrictionType === 'deafen') {
        connectionManager.setSpaceDeafened(spaceId, userId, true);
        connectionManager.sendToUser(userId, {
          type: 'voice_space_deafened',
          userId,
          channelId,
          spaceId,
          deafened: true,
        });
      }
    }

    // Re-check permission mute on re-registration
    {
      const perms = computePermissions(userId, spaceId, channelId);
      const canSpeak = (perms & PermissionBits.SPEAK) !== 0n || (perms & PermissionBits.ADMINISTRATOR) !== 0n;
      const shouldPermMute = !canSpeak;
      connectionManager.setPermissionMuted(spaceId, userId, shouldPermMute);
      if (shouldPermMute) {
        connectionManager.sendToUser(userId, {
          type: 'voice_permission_muted',
          userId,
          spaceId,
          muted: true,
        });
      }
    }
    return;
  }

  // Joining voice here leaves a call hosted on a peer that the user is in
  // through this instance, as it leaves a DM call hosted here.

  // Leave current room (space OR DM)
  const left = connectionManager.leaveCurrentRoom(userId);
  if (left) {
    broadcastRoomLeave(left.roomId, left.room, userId);

    // Notify all of the user's tabs so the displaced tab tears down LiveKit
    connectionManager.sendToUser(userId, {
      type: 'voice_disconnected',
      userId,
      channelId: left.roomId,
      reason: 'displaced',
    });
  }

  // Lazy-create space room
  connectionManager.createRoom(channelId, 'space', { type: 'space', spaceId });

  // Join room
  connectionManager.joinRoom(channelId, userId);

  // A call the user started that still rings ends, and the peers hear it
  // (the user started a call, then joined voice before anyone answered).
  // After the join, so ending it leaves the voice session bound to this
  // socket alone.
  connectionManager.endRingingCallsPlacedBy(userId);

  // Broadcast join
  const joinedRoom = connectionManager.getRoom(channelId);
  connectionManager.sendToRoom(channelId, {
    type: 'voice_state_update',
    channelId,
    userId,
    action: 'join',
    channelElapsedSeconds: joinedRoom ? getVoiceRoomElapsedSeconds(joinedRoom) : undefined,
  });

  // Also broadcast current voice status if it exists (persisted during moves)
  const status = connectionManager.getVoiceUserStatus(userId);
  if (status) {
    connectionManager.sendToRoom(channelId, {
      type: 'voice_status_update',
      userId,
      channelId,
      isMuted: status.isMuted,
      isDeafened: status.isDeafened,
      isCameraOn: status.isCameraOn,
      isScreenSharing: status.isScreenSharing,
    });
  }

  // Load persistent voice restrictions for this user in this space
  const db = getDb();
  const restrictions = db.select()
    .from(schema.voiceRestrictions)
    .where(and(
      eq(schema.voiceRestrictions.spaceId, spaceId),
      eq(schema.voiceRestrictions.userId, userId),
    ))
    .all();

  for (const r of restrictions) {
    if (r.restrictionType === 'mute') {
      connectionManager.setSpaceMuted(spaceId, userId, true);
      connectionManager.sendToSpace(spaceId, {
        type: 'voice_space_muted',
        userId,
        channelId,
        spaceId,
        muted: true,
      });
    } else if (r.restrictionType === 'deafen') {
      connectionManager.setSpaceDeafened(spaceId, userId, true);
      connectionManager.sendToSpace(spaceId, {
        type: 'voice_space_deafened',
        userId,
        channelId,
        spaceId,
        deafened: true,
      });
    }
  }

  // Check SPEAK permission and apply permission mute if needed
  {
    const perms = computePermissions(userId, spaceId, channelId);
    const canSpeak = (perms & PermissionBits.SPEAK) !== 0n || (perms & PermissionBits.ADMINISTRATOR) !== 0n;
    if (!canSpeak) {
      connectionManager.setPermissionMuted(spaceId, userId, true);
      connectionManager.sendToSpace(spaceId, {
        type: 'voice_permission_muted',
        userId,
        spaceId,
        muted: true,
      });
    }
  }
}

function handleVoiceLeave(userId: string): void {
  // A call hosted on a peer, joined through this instance, is voice the user
  // holds here too: the client leaves it this way when it joins voice on
  // another instance, which tells this one nothing else.
  connectionManager.clearVoiceWs(userId);
  const left = connectionManager.leaveCurrentRoom(userId);
  if (left) {
    broadcastRoomLeave(left.roomId, left.room, userId);
  }
  connectionManager.clearVoiceUserStatus(userId);
}

function handleVoiceStatus(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const isMuted = event.isMuted === true;
  const isDeafened = event.isDeafened === true;
  const isCameraOn = event.isCameraOn === true;
  const isScreenSharing = event.isScreenSharing === true;

  // BUG FIX: uses unified getUserRoom() instead of server-only getUserVoiceChannel()
  // This now works for both server channels AND DM calls.
  const userRoom = connectionManager.getUserRoom(userId);
  if (!userRoom) return;
  // Space sessions must resume through voice_join so an ordinary tab cannot
  // keep a stale session alive merely by sending status. DM calls have no
  // voice_join event, so voice_status is their explicit resume signal.
  if (userRoom.room.roomType === 'dm') connectionManager.setVoiceWs(userId, ws);

  let isSpaceMuted = false;
  let isSpaceDeafened = false;
  let isPermMuted = false;
  if (userRoom.room.roomType === 'space') {
    const meta = userRoom.room.metadata as SpaceRoomMeta;
    isSpaceMuted = connectionManager.isSpaceMuted(meta.spaceId, userId);
    isSpaceDeafened = connectionManager.isSpaceDeafened(meta.spaceId, userId);
    isPermMuted = connectionManager.isPermissionMuted(meta.spaceId, userId);
  }

  // Server-side enforcement: prevent clients from bypassing server mute/deafen/permission mute
  const effectiveMuted = (isSpaceMuted || isPermMuted) ? true : isMuted;
  const effectiveDeafened = isSpaceDeafened ? true : isDeafened;

  connectionManager.setVoiceUserStatus(userId, effectiveMuted, effectiveDeafened, isCameraOn, isScreenSharing);

  // sendToRoom routes to sendToSpace for space rooms, sendToDmMembers for DM rooms
  connectionManager.sendToRoom(userRoom.roomId, {
    type: 'voice_status_update',
    userId,
    channelId: userRoom.roomId,
    isMuted: effectiveMuted,
    isDeafened: effectiveDeafened,
    isCameraOn,
    isScreenSharing,
  });
}

// ─── DM Message Handlers ───────────────────────────────────────────────────

/**
 * Refuse a DM message event with a coded `error` on the socket that sent it.
 * The client shows a coded error as a toast, and the user's other sessions
 * did not take the action, so they are not told about it (as `refuseDmCall`).
 * The English text is the code's, with `details` filled in; the client shows
 * the code's text in the user's language (websocket.md, "error").
 */
function refuseDmMessage(ws: WebSocket, code: ErrorCode, details?: ErrorDetails): void {
  connectionManager.sendToWs(ws, details
    ? { type: 'error', message: errorText(code, details), code, details }
    : { type: 'error', message: errorText(code), code });
}

/**
 * `dm_message_create` uses REST validation and the same actor-scoped creation
 * bucket as both HTTP and WS channel/DM messages, immediately before persistence.
 */
function handleDmMessageCreate(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const dmChannelId = event.dmChannelId;
  if (!dmChannelId || typeof dmChannelId !== 'string') {
    refuseDmMessage(ws, 'validation_failed');
    return;
  }

  const check = checkDmMessageCreate(dmChannelId, userId, {
    content: event.content,
    attachments: event.attachments,
    replyToId: event.replyToId,
  });
  if (!check.ok) {
    refuseDmMessage(ws, check.refusal.code, check.refusal.details);
    return;
  }
  const { content, attachmentIds, replyToId } = check.value;

  const retryAfter = consumeMessageCreate(userId);
  if (retryAfter > 0) { connectionManager.sendToWs(ws, rateLimitEvent(retryAfter)); return; }

  const db = getDb();
  const messageId = generateSnowflake();
  const now = Date.now();

  // Insert the message and link its attachments atomically, as the REST
  // route does.
  db.transaction((tx) => {
    tx.insert(schema.dmMessages).values({
      id: messageId,
      dmChannelId,
      userId,
      replyToId,
      content,
      createdAt: now,
    }).run();

    for (const attId of attachmentIds) {
      tx.update(schema.attachments)
        .set({ dmMessageId: messageId })
        .where(eq(schema.attachments.id, attId))
        .run();
    }
  });

  const dmMessage = getDmMessageWithUser(messageId);
  if (!dmMessage) {
    refuseDmMessage(ws, 'message_create_failed');
    return;
  }

  // Broadcast to all DM members (including those who closed the channel)
  broadcastDmMessage(dmChannelId, dmMessage);

  // Clear any pending typing timeout for this user+channel
  const typingKey = `dm:${userId}:${dmChannelId}`;
  const existingTimeout = typingTimeouts.get(typingKey);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    typingTimeouts.delete(typingKey);
  }

  // Resolve embeds asynchronously
  setImmediate(() => {
    resolveEmbeds(messageId, content, dmChannelId, true, null).catch(() => {});
  });
}

function handleDmTypingStart(event: Record<string, unknown>, userId: string, username: string): void {
  const dmChannelId = event.dmChannelId as string;

  if (!dmChannelId || typeof dmChannelId !== 'string') return;

  if (!isDmMember(dmChannelId, userId)) return;

  const key = `dm:${userId}:${dmChannelId}`;
  const existing = typingTimeouts.get(key);
  if (existing) {
    clearTimeout(existing);
  }

  // Send to all other DM members
  const db = getDb();
  const dmMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, dmChannelId))
    .all();

  for (const member of dmMembers) {
    if (member.userId !== userId) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_typing',
        dmChannelId,
        userId,
        username,
      });
    }
  }

  const timeout = setTimeout(() => {
    typingTimeouts.delete(key);
  }, 5000);
  typingTimeouts.set(key, timeout);
}

/** `dm_message_edit`, on the REST route's checks (`checkDmMessageEdit`). */
function handleDmMessageEdit(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const messageId = event.messageId;
  if (!messageId || typeof messageId !== 'string') {
    refuseDmMessage(ws, 'validation_failed');
    return;
  }

  const check = checkDmMessageEdit(messageId, userId, event.content);
  if (!check.ok) {
    refuseDmMessage(ws, check.refusal.code, check.refusal.details);
    return;
  }
  const { message: msg, content } = check.value;

  const db = getDb();
  const now = Date.now();
  db.update(schema.dmMessages)
    .set({ content, editedAt: now })
    .where(eq(schema.dmMessages.id, messageId))
    .run();

  // Delete old embeds synchronously so the broadcast reflects the edit
  db.delete(schema.embeds).where(eq(schema.embeds.dmMessageId, messageId)).run();

  const updated = getDmMessageWithUser(messageId);
  if (!updated) {
    refuseDmMessage(ws, 'message_update_failed');
    return;
  }

  const dmMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, msg.dmChannelId))
    .all();

  for (const member of dmMembers) {
    connectionManager.sendToUser(member.userId, {
      type: 'dm_message_updated',
      message: updated,
    });
  }

  // Resolve new embeds asynchronously (old ones already deleted above)
  setImmediate(() => {
    resolveEmbeds(messageId, content, msg.dmChannelId, true, null).catch(() => {});
  });
}

/** `dm_message_delete`, on the REST route's checks (`checkDmMessageDelete`). */
function handleDmMessageDelete(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const messageId = event.messageId;
  if (!messageId || typeof messageId !== 'string') {
    refuseDmMessage(ws, 'validation_failed');
    return;
  }

  const check = checkDmMessageDelete(messageId, userId);
  if (!check.ok) {
    refuseDmMessage(ws, check.refusal.code, check.refusal.details);
    return;
  }
  const msg = check.value;
  const db = getDb();

  // Collect attachment filenames before deletion
  const dmAttachmentRows = db.select({ filename: schema.attachments.filename })
    .from(schema.attachments).where(eq(schema.attachments.dmMessageId, messageId)).all();

  // Delete attachments, reactions, and message atomically
  db.transaction((tx) => {
    tx.delete(schema.attachments)
      .where(eq(schema.attachments.dmMessageId, messageId))
      .run();
    tx.delete(schema.dmReactions)
      .where(eq(schema.dmReactions.dmMessageId, messageId))
      .run();
    tx.delete(schema.dmMessages)
      .where(eq(schema.dmMessages.id, messageId))
      .run();
  });

  // Clean up files from disk
  deleteAttachmentFiles(dmAttachmentRows);

  const dmMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, msg.dmChannelId))
    .all();

  for (const member of dmMembers) {
    connectionManager.sendToUser(member.userId, {
      type: 'dm_message_deleted',
      messageId,
      dmChannelId: msg.dmChannelId,
    });
  }

}

// ─── Reaction Handlers ─────────────────────────────────────────────────────

export type ReactionOutcome =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  | { ok: false; reason: 'message_not_found' | 'missing_permission' | 'read_only' };

/**
 * Adds a reaction for `userId` to a space or DM message, found by id. Shared by
 * the WS `reaction_add` event and the REST route, so both check the same things
 * and reach the same audience. A reaction that already exists is `changed: false`.
 */
export function applyReactionAdd(messageId: string, emoji: string, userId: string): ReactionOutcome {
  const db = getDb();

  // Try space message first
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (message) {
    const spaceId = getChannelSpaceId(message.channelId);
    if (!spaceId || !isMember(spaceId, userId)) return { ok: false, reason: 'message_not_found' };

    if (!hasPermission(userId, spaceId, PermissionBits.ADD_REACTIONS, message.channelId)) {
      return { ok: false, reason: 'missing_permission' };
    }
    if (db.select({ id: schema.reactions.id }).from(schema.reactions).where(and(
      eq(schema.reactions.messageId, messageId), eq(schema.reactions.userId, userId), eq(schema.reactions.emoji, emoji),
    )).get()) return { ok: true, changed: false };
    const retryAfterMs = consumeReaction(userId);
    if (retryAfterMs > 0) return { ok: false, reason: 'rate_limited', retryAfterMs };
    const reactionId = generateSnowflake();
    const now = Date.now();
    // The unique index on (message_id, user_id, emoji) keeps one reaction per
    // user and emoji. A repeat inserts nothing and announces nothing.
    const inserted = db.insert(schema.reactions).values({
      id: reactionId,
      messageId,
      userId,
      emoji,
      createdAt: now,
    }).onConflictDoNothing().run();
    if (inserted.changes === 0) return { ok: true, changed: false };

    // Include the public native profile for the reaction audience.
    const reactionUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    const userObj = reactionUser ? sanitizeUser(reactionUser) : undefined;

    connectionManager.sendToChannel(spaceId, message.channelId, {
      type: 'reaction_added',
      messageId,
      reaction: { id: reactionId, messageId, userId, emoji, createdAt: now, user: userObj },
    });
    return { ok: true, changed: true };
  }

  // Fall through to a native DM message.
  const dmMsg = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, messageId)).get();
  if (!dmMsg || !isDmMember(dmMsg.dmChannelId, userId)) return { ok: false, reason: 'message_not_found' };
  // Read-only enforcement: a dead 1-on-1 thread (partner tombstoned) accepts no
  // reaction mutations.
  if (isDeadOneOnOne(dmMsg.dmChannelId, userId)) return { ok: false, reason: 'read_only' };

  if (db.select({ id: schema.dmReactions.id }).from(schema.dmReactions).where(and(
    eq(schema.dmReactions.dmMessageId, messageId), eq(schema.dmReactions.userId, userId), eq(schema.dmReactions.emoji, emoji),
  )).get()) return { ok: true, changed: false };
  const retryAfterMs = consumeReaction(userId);
  if (retryAfterMs > 0) return { ok: false, reason: 'rate_limited', retryAfterMs };

  const reactionId = generateSnowflake();
  const now = Date.now();
  // The unique index on (dm_message_id, user_id, emoji) keeps one reaction per
  // user and emoji. A repeat inserts and announces nothing.
  const inserted = db.insert(schema.dmReactions).values({
    id: reactionId,
    dmMessageId: messageId,
    userId,
    emoji,
    createdAt: now,
  }).onConflictDoNothing().run();
  if (inserted.changes === 0) return { ok: true, changed: false };

  // Include the public native profile for the reaction audience.
  const reactionUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  const userObj = reactionUser ? sanitizeUser(reactionUser) : undefined;

  connectionManager.sendToDmMembers(dmMsg.dmChannelId, {
    type: 'reaction_added',
    messageId,
    reaction: { id: reactionId, messageId, userId, emoji, createdAt: now, user: userObj },
  });

  return { ok: true, changed: true };
}

/** Removes `userId`'s own reaction. Shared by the WS `reaction_remove` event and the REST route. */
export function applyReactionRemove(messageId: string, emoji: string, userId: string): ReactionOutcome {
  const db = getDb();

  // Try space message first
  const message = db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).get();
  if (message) {
    const spaceId = getChannelSpaceId(message.channelId);
    if (!spaceId || !isMember(spaceId, userId)) return { ok: false, reason: 'message_not_found' };

    if (!db.select({ id: schema.reactions.id }).from(schema.reactions).where(and(
      eq(schema.reactions.messageId, messageId), eq(schema.reactions.userId, userId), eq(schema.reactions.emoji, emoji),
    )).get()) return { ok: true, changed: false };
    const retryAfterMs = consumeReaction(userId);
    if (retryAfterMs > 0) return { ok: false, reason: 'rate_limited', retryAfterMs };

    const result = db.delete(schema.reactions)
      .where(and(
        eq(schema.reactions.messageId, messageId),
        eq(schema.reactions.userId, userId),
        eq(schema.reactions.emoji, emoji)
      ))
      .run();

    if (result.changes > 0) {
      connectionManager.sendToChannel(spaceId, message.channelId, {
        type: 'reaction_removed',
        messageId,
        userId,
        emoji,
      });
    }
    return { ok: true, changed: result.changes > 0 };
  }

  // Fall through to DM message (same rules as applyReactionAdd).
  const dmMsg = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, messageId)).get();
  if (!dmMsg || !isDmMember(dmMsg.dmChannelId, userId)) return { ok: false, reason: 'message_not_found' };
  if (isDeadOneOnOne(dmMsg.dmChannelId, userId)) return { ok: false, reason: 'read_only' };

  if (!db.select({ id: schema.dmReactions.id }).from(schema.dmReactions).where(and(
    eq(schema.dmReactions.dmMessageId, messageId), eq(schema.dmReactions.userId, userId), eq(schema.dmReactions.emoji, emoji),
  )).get()) return { ok: true, changed: false };
  const retryAfterMs = consumeReaction(userId);
  if (retryAfterMs > 0) return { ok: false, reason: 'rate_limited', retryAfterMs };

  const result = db.delete(schema.dmReactions)
    .where(and(
      eq(schema.dmReactions.dmMessageId, messageId),
      eq(schema.dmReactions.userId, userId),
      eq(schema.dmReactions.emoji, emoji)
    ))
    .run();

  if (result.changes > 0) {
    connectionManager.sendToDmMembers(dmMsg.dmChannelId, {
      type: 'reaction_removed',
      messageId,
      userId,
      emoji,
    });

  }
  return { ok: true, changed: result.changes > 0 };
}

function handleReactionAdd(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const messageId = event.messageId as string;
  const emoji = event.emoji as string;

  if (!messageId || !emoji) return;

  const outcome = applyReactionAdd(messageId, emoji, userId);
  if (!outcome.ok && outcome.reason === 'rate_limited') {
    connectionManager.sendToWs(ws, rateLimitEvent(outcome.retryAfterMs));
  }
  if (!outcome.ok && outcome.reason === 'missing_permission') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing ADD_REACTIONS permission' });
  }
}

function handleReactionRemove(event: Record<string, unknown>, userId: string, ws: WebSocket): void {
  const messageId = event.messageId as string;
  const emoji = event.emoji as string;

  if (!messageId || !emoji) return;

  const outcome = applyReactionRemove(messageId, emoji, userId);
  if (!outcome.ok && outcome.reason === 'rate_limited') {
    connectionManager.sendToWs(ws, rateLimitEvent(outcome.retryAfterMs));
  }
}

// ─── Read State Handler ────────────────────────────────────────────────────

function handleChannelAck(event: Record<string, unknown>, userId: string): void {
  const channelId = event.channelId as string;
  const messageId = event.messageId as string;
  if (!channelId || !messageId) return;
  // Validate messageId is a valid snowflake (numeric string) — reject temp/garbage IDs
  if (!/^\d+$/.test(messageId)) return;

  // Validate channel membership — reject acks for channels the user doesn't belong to
  const spaceId = getChannelSpaceId(channelId);
  if (spaceId) {
    if (!isMember(spaceId, userId)) return;
  } else {
    if (!isDmMember(channelId, userId)) return;
  }

  const db = getDb();

  const existing = db.select()
    .from(schema.readStates)
    .where(and(
      eq(schema.readStates.userId, userId),
      eq(schema.readStates.channelId, channelId),
    ))
    .get();

  const now = Date.now();

  if (existing) {
    // Only update if the new messageId is newer (larger snowflake)
    if (BigInt(messageId) > BigInt(existing.lastReadMessageId)) {
      db.update(schema.readStates)
        .set({ lastReadMessageId: messageId, updatedAt: now })
        .where(and(
          eq(schema.readStates.userId, userId),
          eq(schema.readStates.channelId, channelId),
        ))
        .run();
    }
  } else {
    db.insert(schema.readStates).values({
      userId,
      channelId,
      lastReadMessageId: messageId,
      updatedAt: now,
    }).run();
  }

  // Echo ack back to all of this user's connections (multi-tab sync)
  connectionManager.sendToUser(userId, {
    type: 'channel_ack',
    channelId,
    messageId,
  });

}

function handleMarkUnread(event: Record<string, unknown>, userId: string): void {
  const channelId = event.channelId as string;
  const messageId = event.messageId as string;
  if (!channelId || !messageId) return;
  if (!/^\d+$/.test(messageId)) return;

  // Validate channel membership
  const spaceId = getChannelSpaceId(channelId);
  if (spaceId) {
    if (!isMember(spaceId, userId)) return;
  } else {
    if (!isDmMember(channelId, userId)) return;
  }

  const db = getDb();
  const now = Date.now();

  if (messageId === '0') {
    // '0' sentinel: delete the read state entirely → channel appears fully unread
    db.delete(schema.readStates)
      .where(and(
        eq(schema.readStates.userId, userId),
        eq(schema.readStates.channelId, channelId),
      ))
      .run();
  } else {
    // Set read state to the specified message (allows backward writes)
    const existing = db.select()
      .from(schema.readStates)
      .where(and(
        eq(schema.readStates.userId, userId),
        eq(schema.readStates.channelId, channelId),
      ))
      .get();

    if (existing) {
      db.update(schema.readStates)
        .set({ lastReadMessageId: messageId, updatedAt: now })
        .where(and(
          eq(schema.readStates.userId, userId),
          eq(schema.readStates.channelId, channelId),
        ))
        .run();
    } else {
      db.insert(schema.readStates).values({
        userId,
        channelId,
        lastReadMessageId: messageId,
        updatedAt: now,
      }).run();
    }
  }

  // Broadcast to all of this user's connections (multi-tab sync)
  connectionManager.sendToUser(userId, {
    type: 'mark_unread',
    channelId,
    messageId,
  });

}

// ─── DM Call Handlers (Unified Room API) ───────────────────────────────────

/**
 * Refuse a `dm_call_start` or `dm_call_accept` on the socket that sent it.
 * Only that socket set a calling or joined state, and another session of the
 * same user may be the one in a call in this DM, so the refusal is not sent
 * to the user's other sessions. `dmChannelId` tells the client which call
 * state to drop.
 */
function refuseDmCall(ws: WebSocket, code: ErrorCode, dmChannelId?: string): void {
  connectionManager.sendToWs(ws, { type: 'error', message: ERROR_MESSAGES[code], code, dmChannelId });
}

async function handleDmCallStart(event: Record<string, unknown>, userId: string, username: string, ws: WebSocket): Promise<void> {
  const dmChannelId = event.dmChannelId;
  if (!dmChannelId || typeof dmChannelId !== 'string') {
    refuseDmCall(ws, 'validation_failed');
    return;
  }

  if (!isDmMember(dmChannelId, userId)) {
    refuseDmCall(ws, 'not_dm_member', dmChannelId);
    return;
  }

  // The DM already has a call hosted here. A member who is not in it joins
  // it, as if they had accepted the ring; one who is already in it (as a
  // participant, or as the caller of a call still ringing) has nothing to
  // start.
  const existing = connectionManager.getRoom(dmChannelId);
  if (existing && existing.roomType === 'dm') {
    const meta = existing.metadata as DmRoomMeta;
    if (existing.participants.has(userId) || (meta.state === 'ringing' && meta.callerId === userId)) {
      refuseDmCall(ws, 'dm_call_in_progress', dmChannelId);
      return;
    }
    await joinHostedDmCall(dmChannelId, userId, ws);
    return;
  }

  // Leave the previous native room, if any.
  const left = connectionManager.leaveCurrentRoom(userId);
  if (left) {
    broadcastRoomLeave(left.roomId, left.room, userId);
  }
  connectionManager.clearVoiceUserStatus(userId);

  // A call this user still rings elsewhere ends: one call at a time.
  connectionManager.endRingingCallsPlacedBy(userId, dmChannelId);

  // Create DM room in ringing state. No room exists for this DM (checked
  // above), so this only fails on a concurrent start.
  const created = connectionManager.createDmRoom(dmChannelId, userId);
  if (!created) {
    refuseDmCall(ws, 'dm_call_in_progress', dmChannelId);
    return;
  }

  // Bind voice session to this socket so removeConnection can clean up
  // if the caller closes the tab while the call is ringing
  connectionManager.setVoiceWs(userId, ws);

  // A member who has the conversation closed (a new 1-on-1's recipient before
  // its first message, #360) gets it back first, so the call has a
  // conversation to open in and survives a reconnect.
  reopenForClosedMembers(dmChannelId);

  // Ring other members
  connectionManager.sendToDmMembers(dmChannelId, {
    type: 'dm_call_incoming',
    dmChannelId,
    callerId: userId,
    callerName: username,
  }, userId);

}

/**
 * `userId` joins the call hosted here for `dmChannelId`. The first join turns
 * a ringing call active and seats its caller; any later one is a late join,
 * which every call allows (voice.md, "DM Call State Machine").
 */
async function joinHostedDmCall(dmChannelId: string, userId: string, ws: WebSocket): Promise<void> {
  const room = connectionManager.getRoom(dmChannelId);
  if (!room || room.roomType !== 'dm') return;
  const meta = room.metadata as DmRoomMeta;

  if (meta.state === 'ringing') {
    connectionManager.activateDmRoom(dmChannelId);
    const callerLeft = connectionManager.leaveCurrentRoom(meta.callerId);
    if (callerLeft) broadcastRoomLeave(callerLeft.roomId, callerLeft.room, meta.callerId);
    connectionManager.joinRoom(dmChannelId, meta.callerId);
    connectionManager.sendToDmMembers(dmChannelId, {
      type: 'voice_state_update',
      channelId: dmChannelId,
      userId: meta.callerId,
      action: 'join',
    });
  }

  // Leave the room the user is in, unless it is this call: a session taking
  // the call over from another session of the same user must not empty, and
  // so end, the call it is joining.
  if (connectionManager.getUserRoom(userId)?.roomId !== dmChannelId) {
    const acceptorLeft = connectionManager.leaveCurrentRoom(userId);
    if (acceptorLeft) broadcastRoomLeave(acceptorLeft.roomId, acceptorLeft.room, userId);
  }
  meta.declinedUserIds.delete(userId);
  connectionManager.joinRoom(dmChannelId, userId);
  connectionManager.setVoiceWs(userId, ws);
  // Who answered, so only their own other sessions stop ringing: in a group
  // call the other members are still free to answer.
  connectionManager.sendToDmMembers(dmChannelId, {
    type: 'dm_call_accepted',
    dmChannelId,
    answeredByUserId: userId,
  });
  connectionManager.sendToDmMembers(dmChannelId, {
    type: 'voice_state_update',
    channelId: dmChannelId,
    userId,
    action: 'join',
  });
}

async function handleDmCallAccept(event: Record<string, unknown>, userId: string, ws: WebSocket): Promise<void> {
  const dmChannelId = event.dmChannelId;
  if (!dmChannelId || typeof dmChannelId !== 'string') {
    refuseDmCall(ws, 'validation_failed');
    return;
  }
  if (!isDmMember(dmChannelId, userId)) {
    refuseDmCall(ws, 'not_dm_member', dmChannelId);
    return;
  }
  const room = connectionManager.getRoom(dmChannelId);
  if (!room || room.roomType !== 'dm') {
    refuseDmCall(ws, 'dm_call_not_found', dmChannelId);
    return;
  }
  await joinHostedDmCall(dmChannelId, userId, ws);
}

async function handleDmCallReject(event: Record<string, unknown>, userId: string): Promise<void> {
  const dmChannelId = event.dmChannelId;
  if (!dmChannelId || typeof dmChannelId !== 'string' || !isDmMember(dmChannelId, userId)) return;
  const room = connectionManager.getRoom(dmChannelId);
  if (!room || room.roomType !== 'dm') return;
  if ((room.metadata as DmRoomMeta).group) {
    // A decline ends only this member's ring, unless nobody is left to answer.
    if (connectionManager.declineGroupDmCall(dmChannelId, userId) === 'declined') {
      connectionManager.sendToUser(userId, { type: 'dm_call_rejected', dmChannelId });
    }
  } else {
    connectionManager.endDmRoom(dmChannelId, 'dm_call_rejected');
  }
}

async function handleDmCallEnd(event: Record<string, unknown>, userId: string): Promise<void> {
  const dmChannelId = event.dmChannelId;
  if (!dmChannelId || typeof dmChannelId !== 'string' || !isDmMember(dmChannelId, userId)) return;
  const room = connectionManager.getRoom(dmChannelId);
  if (!room || room.roomType !== 'dm') return;
  if ((room.metadata as DmRoomMeta).group) {
    connectionManager.leaveGroupDmCall(dmChannelId, userId);
  } else {
    connectionManager.endDmRoom(dmChannelId, 'dm_call_ended');
  }
}

// ─── Voice Moderation Handlers ──────────────────────────────────────────────

/**
 * Voice moderation of another member follows the role hierarchy, like kick and
 * ban (permissions.md, "Role hierarchy"). Sends the refusal and returns true
 * when `actorId` does not outrank `targetId`; acting on oneself is not
 * moderation and is left to each handler's own rules.
 */
function refusedByRoleHierarchy(spaceId: string, actorId: string, targetId: string): boolean {
  if (actorId === targetId) return false;
  if (canActOnMemberInSpace(spaceId, actorId, targetId)) return false;
  connectionManager.sendToUser(actorId, { type: 'error', message: ERROR_MESSAGES.role_hierarchy, code: 'role_hierarchy' });
  return true;
}

function handleVoiceSpaceMute(event: Record<string, unknown>, userId: string): void {
  const targetUserId = event.userId as string;
  const muted = event.muted === true;

  if (!targetUserId || typeof targetUserId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'userId is required' });
    return;
  }

  // A bot seat named by its channel is muted in that channel only.
  const seatChannelId = botSeatTarget(event, targetUserId);
  if (seatChannelId) {
    restrictBotSeat(userId, targetUserId, seatChannelId, 'mute', muted);
    return;
  }

  // Find the target user's current room
  const targetRoom = connectionManager.getUserRoom(targetUserId);
  if (!targetRoom || targetRoom.room.roomType !== 'space') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target user is not in a voice channel' });
    return;
  }

  const meta = targetRoom.room.metadata as SpaceRoomMeta;
  if (!hasPermission(userId, meta.spaceId, PermissionBits.MUTE_MEMBERS, targetRoom.roomId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing MUTE_MEMBERS permission' });
    return;
  }

  // Cannot space-mute yourself
  if (targetUserId === userId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Cannot space-mute yourself' });
    return;
  }

  if (refusedByRoleHierarchy(meta.spaceId, userId, targetUserId)) return;

  connectionManager.setSpaceMuted(meta.spaceId, targetUserId, muted);

  // Persist to DB
  const db = getDb();
  if (muted) {
    db.insert(schema.voiceRestrictions).values({
      spaceId: meta.spaceId,
      userId: targetUserId,
      restrictionType: 'mute',
      moderatorId: userId,
      createdAt: Date.now(),
    }).onConflictDoNothing().run();
  } else {
    db.delete(schema.voiceRestrictions).where(
      and(
        eq(schema.voiceRestrictions.spaceId, meta.spaceId),
        eq(schema.voiceRestrictions.userId, targetUserId),
        eq(schema.voiceRestrictions.restrictionType, 'mute'),
      )
    ).run();
  }

  // Broadcast to all space members
  connectionManager.sendToSpace(meta.spaceId, {
    type: 'voice_space_muted',
    userId: targetUserId,
    channelId: targetRoom.roomId,
    spaceId: meta.spaceId,
    muted,
  });
}

function handleVoiceSpaceDeafen(event: Record<string, unknown>, userId: string): void {
  const targetUserId = event.userId as string;
  const deafened = event.deafened === true;

  if (!targetUserId || typeof targetUserId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'userId is required' });
    return;
  }

  // A bot seat named by its channel is deafened in that channel only.
  const seatChannelId = botSeatTarget(event, targetUserId);
  if (seatChannelId) {
    restrictBotSeat(userId, targetUserId, seatChannelId, 'deafen', deafened);
    return;
  }

  const targetRoom = connectionManager.getUserRoom(targetUserId);
  if (!targetRoom || targetRoom.room.roomType !== 'space') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target user is not in a voice channel' });
    return;
  }

  const meta = targetRoom.room.metadata as SpaceRoomMeta;
  if (!hasPermission(userId, meta.spaceId, PermissionBits.DEAFEN_MEMBERS, targetRoom.roomId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing DEAFEN_MEMBERS permission' });
    return;
  }

  if (targetUserId === userId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Cannot space-deafen yourself' });
    return;
  }

  if (refusedByRoleHierarchy(meta.spaceId, userId, targetUserId)) return;

  connectionManager.setSpaceDeafened(meta.spaceId, targetUserId, deafened);

  // Persist to DB
  const db = getDb();
  if (deafened) {
    db.insert(schema.voiceRestrictions).values({
      spaceId: meta.spaceId,
      userId: targetUserId,
      restrictionType: 'deafen',
      moderatorId: userId,
      createdAt: Date.now(),
    }).onConflictDoNothing().run();
  } else {
    db.delete(schema.voiceRestrictions).where(
      and(
        eq(schema.voiceRestrictions.spaceId, meta.spaceId),
        eq(schema.voiceRestrictions.userId, targetUserId),
        eq(schema.voiceRestrictions.restrictionType, 'deafen'),
      )
    ).run();
  }

  connectionManager.sendToSpace(meta.spaceId, {
    type: 'voice_space_deafened',
    userId: targetUserId,
    channelId: targetRoom.roomId,
    spaceId: meta.spaceId,
    deafened,
  });
}

function handleVoiceMove(event: Record<string, unknown>, userId: string): void {
  const targetUserId = event.userId as string;
  const targetChannelId = event.targetChannelId as string;

  if (!targetUserId || typeof targetUserId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'userId is required' });
    return;
  }
  if (!targetChannelId || typeof targetChannelId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'targetChannelId is required' });
    return;
  }

  // Find the target user's current room
  const currentRoom = connectionManager.getUserRoom(targetUserId);
  if (!currentRoom || currentRoom.room.roomType !== 'space') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target user is not in a voice channel' });
    return;
  }

  const meta = currentRoom.room.metadata as SpaceRoomMeta;
  if (!hasPermission(userId, meta.spaceId, PermissionBits.MOVE_MEMBERS, currentRoom.roomId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing MOVE_MEMBERS permission' });
    return;
  }

  if (refusedByRoleHierarchy(meta.spaceId, userId, targetUserId)) return;

  // Verify target channel exists and is a voice/video channel in the same space
  const db = getDb();
  const targetChannel = db.select().from(schema.channels).where(eq(schema.channels.id, targetChannelId)).get();
  if (!targetChannel || targetChannel.spaceId !== meta.spaceId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target channel not found in this space' });
    return;
  }
  if (targetChannel.type !== 'voice') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target channel is not a voice channel' });
    return;
  }
  if (targetChannelId === currentRoom.roomId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'User is already in that channel' });
    return;
  }

  const oldChannelId = currentRoom.roomId;

  // Leave current room
  connectionManager.leaveRoom(oldChannelId, targetUserId);

  // Broadcast leave from old channel
  connectionManager.sendToSpace(meta.spaceId, {
    type: 'voice_state_update',
    channelId: oldChannelId,
    userId: targetUserId,
    action: 'leave',
  });

  // Lazy-create target room and join
  connectionManager.createRoom(targetChannelId, 'space', { type: 'space', spaceId: meta.spaceId });
  connectionManager.joinRoom(targetChannelId, targetUserId);

  // Read the room after the join: an empty voice channel has no room at all
  // (leaveRoom tears space rooms down when the last participant leaves), so
  // looking it up any earlier reports no duration for the channel this move
  // just occupied.
  const targetRoom = connectionManager.getRoom(targetChannelId);

  // Broadcast join to new channel
  connectionManager.sendToSpace(meta.spaceId, {
    type: 'voice_state_update',
    channelId: targetChannelId,
    userId: targetUserId,
    action: 'join',
    channelElapsedSeconds: targetRoom ? getVoiceRoomElapsedSeconds(targetRoom) : undefined,
  });

  // Notify the moved user so they reconnect to LiveKit
  connectionManager.sendToUser(targetUserId, {
    type: 'voice_moved',
    userId: targetUserId,
    oldChannelId,
    newChannelId: targetChannelId,
  });

  // Preserve voice user status during move
  const status = connectionManager.getVoiceUserStatus(targetUserId);
  if (status) {
    connectionManager.sendToRoom(targetChannelId, {
      type: 'voice_status_update',
      userId: targetUserId,
      channelId: targetChannelId,
      isMuted: status.isMuted,
      isDeafened: status.isDeafened,
      isCameraOn: status.isCameraOn,
      isScreenSharing: status.isScreenSharing,
    });
  }
}

/** A moderator takes a bot out of one voice channel; its other seats stay. */
function disconnectBotSeat(actorId: string, botId: string, channelId: string): void {
  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) {
    connectionManager.sendToUser(actorId, { type: 'error', message: 'Channel not found' });
    return;
  }
  if (!hasPermission(actorId, spaceId, PermissionBits.DISCONNECT_MEMBERS, channelId)) {
    connectionManager.sendToUser(actorId, { type: 'error', message: 'Missing DISCONNECT_MEMBERS permission' });
    return;
  }
  if (refusedByRoleHierarchy(spaceId, actorId, botId)) return;

  const room = connectionManager.botLeaveRoom(botId, channelId);
  if (!room) return;
  broadcastRoomLeave(channelId, room, botId);
  if (connectionManager.getBotRoomIds(botId).length === 0) connectionManager.clearVoiceUserStatus(botId);
  connectionManager.sendToUser(botId, { type: 'voice_disconnected', userId: botId, channelId });
}

function handleVoiceDisconnect(event: Record<string, unknown>, userId: string): void {
  const targetUserId = event.userId as string;

  if (!targetUserId || typeof targetUserId !== 'string') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'userId is required' });
    return;
  }

  if (targetUserId === userId) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Cannot disconnect yourself' });
    return;
  }

  // A bot seat named by its channel: take the bot out of that channel only.
  const seatChannelId = botSeatTarget(event, targetUserId);
  if (seatChannelId) {
    disconnectBotSeat(userId, targetUserId, seatChannelId);
    return;
  }

  // Find the target user's current room
  const currentRoom = connectionManager.getUserRoom(targetUserId);
  if (!currentRoom || currentRoom.room.roomType !== 'space') {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Target user is not in a voice channel' });
    return;
  }

  const meta = currentRoom.room.metadata as SpaceRoomMeta;
  if (!hasPermission(userId, meta.spaceId, PermissionBits.DISCONNECT_MEMBERS, currentRoom.roomId)) {
    connectionManager.sendToUser(userId, { type: 'error', message: 'Missing DISCONNECT_MEMBERS permission' });
    return;
  }

  if (refusedByRoleHierarchy(meta.spaceId, userId, targetUserId)) return;

  const channelId = currentRoom.roomId;

  // Remove from voice room
  connectionManager.leaveRoom(channelId, targetUserId);
  connectionManager.clearVoiceWs(targetUserId);

  // Clear ephemeral voice status (mute/camera/etc)
  connectionManager.clearVoiceUserStatus(targetUserId);

  // Broadcast leave to all space members
  connectionManager.sendToSpace(meta.spaceId, {
    type: 'voice_state_update',
    channelId,
    userId: targetUserId,
    action: 'leave',
  });

  // Notify the disconnected user so they clean up client-side
  connectionManager.sendToUser(targetUserId, {
    type: 'voice_disconnected',
    userId: targetUserId,
    channelId,
  });
}

// ─── Test-only exports ──────────────────────────────────────────────────────
/** Direct export for unit tests — do not use in production code paths. */
export const handleDmCallStartForTest = handleDmCallStart;
export const handleDmCallAcceptForTest = handleDmCallAccept;
export const handleDmCallRejectForTest = handleDmCallReject;
export const handleDmCallEndForTest = handleDmCallEnd;
