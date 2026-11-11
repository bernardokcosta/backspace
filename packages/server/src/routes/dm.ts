import type { FastifyInstance } from 'fastify';
import { eq, and, or, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { insertDmMember, reopenClosedDmMembers, setDmMemberClosed } from '../utils/dmMemberClosed.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { isDmMember } from '../utils/permissions.js';
import { checkDmMessageCreate, checkDmMessageDelete, checkDmMessageEdit } from '../utils/dmMessageRules.js';
import { consumeMessageCreate, sendRateLimit } from '../utils/rateLimits.js';
import { connectionManager } from '../ws/handler.js';
import {
  type DmMessage,
  type DmMessageWithUser,
  type CreateDmRequest,
  type CreateGroupDmRequest,
  type CreateDmMessageRequest,
  type AddDmMemberRequest,
  type PaginatedQuery,
  type Attachment,
  type Reaction,
  type Embed,
  type SpaceInviteRequest,
  type SpaceInviteResponse,
  type SpaceInviteSystemPayload,
} from '@veyvox/shared';
import { getLocalInviteSnapshot } from '../utils/spaceInviteSnapshot.js';
import { getPublicOrigin } from '../utils/publicOrigin.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { loadDmChannelWire, loadOpenDmChannels } from '../utils/dmChannelWire.js';
import { findOrCreateOneOnOne, type OneOnOneResult } from '../utils/dmConversation.js';
import { sendError } from '../utils/httpErrors.js';
import { parseHistoryPage, selectHistoryPage, markHistoryPageHonoured } from '../utils/messagePaging.js';

/** Members a group DM can hold, the owner included. */
const GROUP_DM_MAX_MEMBERS = 10;
import { deleteAttachmentFiles, deleteUnreferencedUploadFiles, deleteAttachmentByFilename, isValidAssetUrl } from '../utils/fileCleanup.js';
import {
  GROUP_DM_NAME_MIN_LENGTH,
  GROUP_DM_NAME_MAX_LENGTH,
  GROUP_DM_ICON_MAX_BYTES,
  GROUP_DM_ICON_MIME_PREFIX,
} from '@veyvox/shared/src/constants.js';
import { fetchDmEmbedsForMessages, resolveEmbeds, reResolveEmbeds, embedRowToEmbed } from '../utils/embedResolver.js';
import { dmSystemContent, dmSystemName } from '../utils/dmSystemMessages.js';
import { announceDmReconcile } from '../utils/dmConversationEvents.js';
import { parseDmSystemEvent } from '@veyvox/shared/src/dmSystemEvents.js';

/**
 * Batch-fetch reactions for a set of DM message IDs.
 * Returns a map from dmMessageId to Reaction[].
 */
export function fetchDmReactionsForMessages(dmMessageIds: string[]): Map<string, Reaction[]> {
  if (dmMessageIds.length === 0) return new Map();
  const db = getDb();
  const reactionRows = db.select()
    .from(schema.dmReactions)
    .where(inArray(schema.dmReactions.dmMessageId, dmMessageIds))
    .all();

  // Batch fetch users for reactions
  const reactionUserIds = [...new Set(reactionRows.map(r => r.userId))];
  const reactionUsers = reactionUserIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, reactionUserIds)).all()
    : [];
  const reactionUserMap = new Map(reactionUsers.map(u => [u.id, u]));

  const map = new Map<string, Reaction[]>();
  for (const r of reactionRows) {
    const user = reactionUserMap.get(r.userId);
    const reaction: Reaction = {
      id: r.id,
      messageId: r.dmMessageId,
      userId: r.userId,
      emoji: r.emoji,
      createdAt: r.createdAt,
      user: user ? sanitizeUser(user) : undefined,
    };
    if (!map.has(r.dmMessageId)) {
      map.set(r.dmMessageId, []);
    }
    map.get(r.dmMessageId)!.push(reaction);
  }
  return map;
}

/**
 * Batch-fetch the reply targets for a set of DM messages, confined to one channel.
 *
 * A reply target only ever names a message in the same DM channel, so the lookup
 * is scoped to `dmChannelId`. That scoping is what keeps hydration from surfacing
 * a message belonging to a different conversation — including for rows written
 * before the create-time guard existed.
 *
 * Returns a map from reply-target id to its shallow hydration (no attachments,
 * embeds or reactions — reply previews do not render them).
 */
export function fetchDmReplyToMessages(
  dmChannelId: string,
  messages: (typeof schema.dmMessages.$inferSelect)[],
): Map<string, DmMessageWithUser> {
  const replyToIds = messages
    .map(m => m.replyToId)
    .filter((id): id is string => id !== null && id !== undefined);
  if (replyToIds.length === 0) return new Map();

  const db = getDb();
  const uniqueReplyIds = [...new Set(replyToIds)];
  const replyMessages = db.select()
    .from(schema.dmMessages)
    .where(and(
      inArray(schema.dmMessages.id, uniqueReplyIds),
      eq(schema.dmMessages.dmChannelId, dmChannelId),
    ))
    .all();

  const replyUserIds = [...new Set(replyMessages.map(m => m.userId))];
  const replyUsers = replyUserIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, replyUserIds)).all()
    : [];
  const replyUserMap = new Map(replyUsers.map(u => [u.id, u]));

  const map = new Map<string, DmMessageWithUser>();
  for (const rm of replyMessages) {
    const rUser = replyUserMap.get(rm.userId);
    if (!rUser) continue;
    map.set(rm.id, {
      id: rm.id,
      dmChannelId: rm.dmChannelId,
      userId: rm.userId,
      replyToId: rm.replyToId,
      content: rm.content,
      type: (rm.type ?? 'user') as 'user' | 'system',
      editedAt: rm.editedAt,
      createdAt: rm.createdAt,
      user: sanitizeUser(rUser),
      attachments: [],
      embeds: [],
      reactions: [],
    });
  }
  return map;
}

/**
 * Pure transformer: builds a DmMessageWithUser from pre-fetched data.
 */
export function buildDmMessageWithUser(
  message: typeof schema.dmMessages.$inferSelect,
  user: typeof schema.users.$inferSelect,
  attachmentRows: (typeof schema.attachments.$inferSelect)[],
  reactions: Reaction[] = [],
  replyTo: DmMessageWithUser | null = null,
  embedRows: (typeof schema.embeds.$inferSelect)[] = [],
): DmMessageWithUser {
  return {
    id: message.id,
    dmChannelId: message.dmChannelId,
    userId: message.userId,
    replyToId: message.replyToId,
    content: message.content,
    type: (message.type ?? 'user') as 'user' | 'system',
    editedAt: message.editedAt,
    createdAt: message.createdAt,
    user: sanitizeUser(user),
    attachments: attachmentRows.map(a => ({
      id: a.id,
      messageId: a.dmMessageId ?? message.id,
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
    })),
    embeds: embedRows.map(e => embedRowToEmbed(e)),
    reactions,
    replyTo,
  };
}

/**
 * Hydrate DM message rows into the wire shape, keeping their order.
 *
 * One batch each for authors, attachments, reactions, embeds and reply
 * targets (confined to `dmChannelId`, see fetchDmReplyToMessages). A row whose
 * author row is missing is dropped. Every read path that returns a page of DM
 * messages goes through here: history, messages-around and search.
 */
export function hydrateDmMessages(
  dmChannelId: string,
  messageRows: (typeof schema.dmMessages.$inferSelect)[],
): DmMessageWithUser[] {
  if (messageRows.length === 0) return [];
  const db = getDb();

  const userIds = [...new Set(messageRows.map(m => m.userId))];
  const users = db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all();
  const userMap = new Map(users.map(u => [u.id, u]));

  const messageIds = messageRows.map(m => m.id);
  const allAttachments = db.select()
    .from(schema.attachments)
    .where(inArray(schema.attachments.dmMessageId, messageIds))
    .all();
  const attachmentMap = new Map<string, (typeof schema.attachments.$inferSelect)[]>();
  for (const att of allAttachments) {
    const mid = att.dmMessageId ?? '';
    if (!attachmentMap.has(mid)) attachmentMap.set(mid, []);
    attachmentMap.get(mid)!.push(att);
  }

  const reactionsMap = fetchDmReactionsForMessages(messageIds);
  const embedMap = fetchDmEmbedsForMessages(messageIds);
  const replyToMap = fetchDmReplyToMessages(dmChannelId, messageRows);

  return messageRows
    .map(m => {
      const user = userMap.get(m.userId);
      if (!user) return null;
      const reactions = reactionsMap.get(m.id) ?? [];
      const replyTo = m.replyToId ? (replyToMap.get(m.replyToId) ?? null) : null;
      return buildDmMessageWithUser(m, user, attachmentMap.get(m.id) ?? [], reactions, replyTo, embedMap.get(m.id) ?? []);
    })
    .filter((m): m is DmMessageWithUser => m !== null);
}

/**
 * Fetches a DM message by ID and hydrates it with user, attachments, reactions, and replyTo.
 */
export function getDmMessageWithUser(dmMessageId: string): DmMessageWithUser | null {
  const db = getDb();
  const message = db.select().from(schema.dmMessages).where(eq(schema.dmMessages.id, dmMessageId)).get();
  if (!message) return null;

  const user = db.select().from(schema.users).where(eq(schema.users.id, message.userId)).get();
  if (!user) return null;

  const attachmentRows = db.select()
    .from(schema.attachments)
    .where(eq(schema.attachments.dmMessageId, dmMessageId))
    .all();

  const embedRows = db.select()
    .from(schema.embeds)
    .where(eq(schema.embeds.dmMessageId, dmMessageId))
    .all();

  const reactionsMap = fetchDmReactionsForMessages([dmMessageId]);
  const reactions = reactionsMap.get(dmMessageId) ?? [];

  // Reply targets are confined to the message's own DM channel.
  let replyTo: DmMessageWithUser | null = null;
  if (message.replyToId) {
    const replyToMap = fetchDmReplyToMessages(message.dmChannelId, [message]);
    replyTo = replyToMap.get(message.replyToId) ?? null;
  }

  return buildDmMessageWithUser(message, user, attachmentRows, reactions, replyTo, embedRows);
}

/**
 * Reopen a conversation for every member who has it closed, and send each of
 * them `dm_channel_created` so it appears in their list. `lastMessage` is the
 * message being delivered with it; without one, the newest stored message is
 * the preview. Run before anything that needs the conversation in a member's
 * list: a new message (`broadcastDmMessage`) and a call (call start), which is
 * how a new 1-on-1 reaches its recipient (#360).
 */
export function reopenForClosedMembers(dmChannelId: string, lastMessage?: DmMessageWithUser): void {
  const db = getDb();
  const reopened = reopenClosedDmMembers(db.$client, dmChannelId);
  if (reopened.length === 0) return;

  const dmChannel = loadDmChannelWire(db, dmChannelId, lastMessage);
  if (!dmChannel) return;
  for (const userId of reopened) {
    connectionManager.sendToUser(userId, {
      type: 'dm_channel_created',
      dmChannel,
    });
  }
}

/**
 * Broadcasts a DM message to all members of a DM channel. Members who have
 * closed the channel get it back first (`reopenForClosedMembers`), with this
 * message as its last message.
 */
export function broadcastDmMessage(dmChannelId: string, message: DmMessageWithUser): void {
  const db = getDb();
  const dmMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, dmChannelId))
    .all();

  // Clear typing indicator for the message author — the message itself proves they stopped
  for (const member of dmMembers) {
    if (member.userId !== message.userId) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_typing_stop',
        dmChannelId,
        userId: message.userId,
      });
    }
  }

  reopenForClosedMembers(dmChannelId, message);

  for (const member of dmMembers) {
    connectionManager.sendToUser(member.userId, {
      type: 'dm_message_created',
      message,
    });
  }
}

/**
 * Open the 1-on-1 between the caller and `targetUser` for the caller: the
 * conversation `findOrCreateOneOnOne` finds or creates, reopened on the
 * caller's side when they had closed it.
 *
 * Nothing reaches the target (#360). A new conversation gets the target's
 * membership closed, and an existing one the target closed stays closed: the
 * next message sent in it reopens it for them and delivers it with that
 * message (`broadcastDmMessage`). `POST /api/dm` and `ensureOneOnOneDmChannel` both open
 * conversations through it.
 */
function openOneOnOne(
  callerId: string,
  targetUser: typeof schema.users.$inferSelect,
  db: ReturnType<typeof getDb>,
): OneOnOneResult {
  const opened = findOrCreateOneOnOne(
    db,
    { id: callerId },
    targetUser,
    { open: 'first' },
  );
  announceDmReconcile(opened.reconciled);
  if (opened.created) return opened;

  setDmMemberClosed(db.$client, opened.channelId, callerId, false);
  return opened;
}

/**
 * The 1-on-1 between `callerId` and `targetUser`, opened for the caller
 * (`openOneOnOne`). Returns the channel id. Used where a feature needs the
 * conversation to post into, such as a space invite.
 */
export function ensureOneOnOneDmChannel(
  callerId: string,
  targetUser: typeof schema.users.$inferSelect,
  db: ReturnType<typeof getDb>,
): string {
  return openOneOnOne(callerId, targetUser, db).channelId;
}

/**
 * Shared core for the leave-DM and kick-DM paths.
 *
 * Performs the destructive half of removal (system message, member-row delete,
 * read_states cleanup, dm_member_removed broadcast,
 * ownership transfer for self-leave, soft-delete on last-member-leave).
 *
 * Pre-validation (channel exists, not 1-on-1, target is a member, etc.) is the
 * caller's responsibility; this helper assumes a valid group DM and a valid
 * target. The caller is also responsible for any voice-room eviction and for
 * sending dm_channel_closed to the affected user.
 *
 * Branching rules:
 *   - Ownership transfer fires only when the actor is leaving themselves AND
 *     was the previous owner (kicks cannot orphan a group: the owner is still
 *     present, so there's nothing to transfer).
 *   - Last-member soft-delete fires only on self-leave (kicks are guaranteed
 *     to leave the owner behind, so the channel can never be empty after a
 *     kick).
 */
/**
 * Evicts a user from a DM channel's voice room (if they're in it), broadcasts the
 * voice_state_update, and tears down the room/call when it becomes empty.
 *
 * Shared by self-leave and owner-kick paths so call-state cleanup stays in lockstep.
 * No-op if the user isn't currently in this DM's voice room.
 */
function evictUserFromDmVoiceRoom(channelId: string, userId: string): void {
  const userRoom = connectionManager.getUserRoom(userId);
  if (userRoom && userRoom.roomId === channelId) {
    const left = connectionManager.leaveCurrentRoom(userId);
    if (left) {
      connectionManager.sendToDmMembers(channelId, {
        type: 'voice_state_update',
        channelId,
        userId,
        action: 'leave',
      });
      // Auto-end call if DM room is now empty
      const updatedRoom = connectionManager.getRoom(channelId);
      if (updatedRoom && updatedRoom.participants.size === 0) {
        connectionManager.destroyRoom(channelId);
        connectionManager.sendToDmMembers(channelId, {
          type: 'dm_call_ended',
          dmChannelId: channelId,
        });
      }
    }
    connectionManager.clearVoiceUserStatus(userId);
  }
}

/**
 * Transfers group-DM ownership from `previousOwnerId` to `newOwnerId`.
 *
 * Shared by the leave-path's auto-transfer (when an owner leaves a non-empty group)
 * and the manual `POST /api/dm/:id/transfer` endpoint. Performs:
 *
 *   1. Channel UPDATE (ownerId)
 *   2. owner_changed system-message INSERT (authored by `actorUserId`)
 *
 * Both writes run inside a single `db.transaction(...)` for atomicity. Broadcasts
 * (`dm_owner_updated` and `dm_message_created`) are side-effects and run AFTER
 * the transaction commits.
 *
 * Caller responsibilities (NOT done here):
 *   - Validation (membership, 1-on-1 rejection, self-transfer rejection, etc.)
 *   - Voice-room eviction
 *   - Member-row deletion (the leave-path handles this separately)
 *
 * `actorUserId` controls the `userId` on the inserted system message — i.e., who
 * appears as having performed the change. In both current call sites the actor IS
 * the previous owner (the leaver, or the owner calling the transfer endpoint), so
 * it defaults to `previousOwnerId`. The option is parameterizable for future paths
 * that may transfer ownership on behalf of someone else (e.g., admin tooling).
 */
function transferGroupDmOwnership(
  channelId: string,
  previousOwnerId: string,
  newOwnerId: string,
  options?: { actorUserId?: string },
): void {
  const db = getDb();
  const actorUserId = options?.actorUserId ?? previousOwnerId;

  // Pre-flight: fetch the channel + user rows the helper needs.
  const dmChannel = db.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, channelId)).get();
  if (!dmChannel) {
    // Caller validates; defensive no-op.
    return;
  }

  const newOwnerRow = db.select().from(schema.users).where(eq(schema.users.id, newOwnerId)).get();

  const ownerSysMsgId = generateSnowflake();
  const ownerNow = Date.now();
  const ownerSysContent = dmSystemContent({
    event: 'owner_changed',
    newOwnerId,
    newOwnerDisplayName: dmSystemName(newOwnerRow),
  });

  // Atomic: channel UPDATE + system message INSERT.
  db.transaction((tx) => {
    tx.update(schema.dmChannels)
      .set({ ownerId: newOwnerId })
      .where(eq(schema.dmChannels.id, channelId))
      .run();

    tx.insert(schema.dmMessages).values({
      id: ownerSysMsgId,
      dmChannelId: channelId,
      userId: actorUserId,
      content: ownerSysContent,
      type: 'system',
      createdAt: ownerNow,
    }).run();

  });

  // Snapshot the post-update member list for broadcasts (membership unchanged by transfer).
  const members = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, channelId))
    .all();

  // Authority is the authenticated owner's action, using native account ids.
  for (const member of members) {
    connectionManager.sendToUser(member.userId, {
      type: 'dm_owner_updated',
      dmChannelId: channelId,
      newOwnerId,
    });
  }

  const systemMessage = getDmMessageWithUser(ownerSysMsgId);
  if (systemMessage) connectionManager.sendToDmMembers(channelId, { type: 'dm_message_created', message: systemMessage });
}

function removeDmMember(
  channelId: string,
  actorUserId: string,
  targetUserId: string,
  reason: 'leave' | 'kick',
): void {
  const db = getDb();
  const isSelfLeave = actorUserId === targetUserId;

  const dmChannel = db.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, channelId)).get();
  if (!dmChannel) {
    // Should never happen — caller validates. Defensive no-op.
    return;
  }

  const targetUserRow = db.select().from(schema.users).where(eq(schema.users.id, targetUserId)).get();

  // Insert + broadcast member_removed system message (still a member at this point)
  const sysMsgId = generateSnowflake();
  const sysNow = Date.now();
  const sysContent = dmSystemContent({
    event: 'member_removed',
    targetUserId,
    targetDisplayName: dmSystemName(targetUserRow),
    reason,
  });

  db.insert(schema.dmMessages).values({
    id: sysMsgId,
    dmChannelId: channelId,
    userId: actorUserId,
    content: sysContent,
    type: 'system',
    createdAt: sysNow,
  }).run();

  const systemMessage = getDmMessageWithUser(sysMsgId);
  if (systemMessage) connectionManager.sendToDmMembers(channelId, { type: 'dm_message_created', message: systemMessage });

  // Delete dm_members row for the target
  db.delete(schema.dmMembers)
    .where(and(
      eq(schema.dmMembers.dmChannelId, channelId),
      eq(schema.dmMembers.userId, targetUserId),
    ))
    .run();

  // Clean up read_states for the removed user
  db.delete(schema.readStates).where(and(
    eq(schema.readStates.userId, targetUserId),
    eq(schema.readStates.channelId, channelId),
  )).run();

  // Check remaining members
  const remainingMembers = db.select()
    .from(schema.dmMembers)
    .where(eq(schema.dmMembers.dmChannelId, channelId))
    .all();

  if (remainingMembers.length > 0) {
    // Ownership transfer only fires on self-leave when the leaver was the owner.
    // Kicks cannot orphan a group: the owner is still in the channel.
    if (isSelfLeave && dmChannel.ownerId === actorUserId) {
      const nextOwner = remainingMembers[0];
      if (nextOwner) {
        transferGroupDmOwnership(channelId, actorUserId, nextOwner.userId, { actorUserId });
      }
    }

    // Broadcast dm_member_removed to remaining members
    for (const member of remainingMembers) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_member_removed',
        dmChannelId: channelId,
        userId: targetUserId,
      });
    }
  } else if (isSelfLeave) {
    // Last member left — soft-delete for deferred GC (24h grace period).
    // Only reachable via self-leave; kicks always leave the owner behind.
    db.update(schema.dmChannels)
      .set({ deletedAt: Date.now() })
      .where(eq(schema.dmChannels.id, channelId))
      .run();
    console.log(`[dm] Group DM ${channelId} has no remaining members, soft-deleted for GC`);
  }
}

export async function dmRoutes(app: FastifyInstance): Promise<void> {
  // Centralized auth for all DM routes
  app.addHook('preHandler', authenticate);

  // GET /api/dm - List user's DM channels, in the same shape as the ready payload
  app.get('/api/dm', async (request, reply) => {
    const dmChannels = loadOpenDmChannels(getDb(), request.userId);

    // Sort by last message timestamp (newest first)
    dmChannels.sort((a, b) => {
      const aTime = a.lastMessage?.createdAt ?? a.createdAt;
      const bTime = b.lastMessage?.createdAt ?? b.createdAt;
      return bTime - aTime;
    });

    return reply.code(200).send(dmChannels);
  });

  // POST /api/dm - Create or get existing DM channel
  app.post<{ Body: CreateDmRequest }>('/api/dm', async (request, reply) => {
    const { userId } = request.body ?? {};
    if (typeof userId !== 'string' || !userId) {
      return sendError(reply, 400, 'dm_target_required');
    }
    const db = getDb();
    const targetUser = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();

    if (!targetUser) {
      return sendError(reply, 404, 'user_not_found');
    }

    const targetUserId = targetUser.id;

    if (targetUserId === request.userId) {
      return sendError(reply, 400, 'cannot_dm_self');
    }

    const opened = openOneOnOne(request.userId, targetUser, db);
    const result = loadDmChannelWire(db, opened.channelId);
    if (!result) {
      return sendError(reply, 500, 'internal_error');
    }
    return reply.code(opened.created ? 201 : 200).send(result);
  });

  // POST /api/dm/group - Create a new group DM with multiple members
  app.post<{ Body: CreateGroupDmRequest }>('/api/dm/group', async (request, reply) => {
    const { users: userIdentities, fromDmChannelId } = request.body ?? {};

    // Validate input is a non-empty array of at least 2 identity objects
    if (!Array.isArray(userIdentities) || userIdentities.length < 2) {
      return sendError(reply, 400, 'group_dm_too_few_members', { min: 2 });
    }
    if (userIdentities.some(u => !u || typeof u.id !== 'string' || !u.id)) {
      return sendError(reply, 400, 'validation_failed');
    }

    // Total members (caller + users) capped at 10
    const totalMembers = 1 + userIdentities.length;
    if (totalMembers > 10) {
      return sendError(reply, 400, 'group_dm_too_many_members', { max: GROUP_DM_MAX_MEMBERS, requested: totalMembers });
    }

    const db = getDb();

    // Only an existing local account can become a member.
    const targetUsers: Array<typeof schema.users.$inferSelect> = [];
    for (const identity of userIdentities) {
      const localUser = db.select().from(schema.users).where(
        and(eq(schema.users.id, identity.id), eq(schema.users.isDeleted, 0)),
      ).get();

      if (!localUser) {
        return sendError(reply, 404, 'users_not_found');
      }
      if (localUser.isDeleted) {
        return sendError(reply, 404, 'users_not_found');
      }

      targetUsers.push(localUser);
    }

    // Dedup: check no resolved user appears twice
    const resolvedIds = new Set(targetUsers.map(u => u.id));
    if (resolvedIds.size !== targetUsers.length) {
      return sendError(reply, 400, 'duplicate_users');
    }

    // Caller cannot include themselves
    if (targetUsers.some(u => u.id === request.userId)) {
      return sendError(reply, 400, 'group_dm_includes_self');
    }

    // When converting a 1-on-1 DM to a group, existing DM members are exempt
    // from the friendship check (DMs don't require friendship).
    const exemptUserIds = new Set<string>();
    if (fromDmChannelId) {
      const sourceDm = db.select().from(schema.dmChannels).where(
        and(eq(schema.dmChannels.id, fromDmChannelId), isNull(schema.dmChannels.deletedAt)),
      ).get();
      if (sourceDm && !sourceDm.ownerId) {
        // Only exempt members from 1-on-1 DMs (ownerId is null)
        if (isDmMember(fromDmChannelId, request.userId)) {
          const members = db.select().from(schema.dmMembers)
            .where(eq(schema.dmMembers.dmChannelId, fromDmChannelId)).all();
          for (const m of members) {
            exemptUserIds.add(m.userId);
          }
        }
      }
    }

    // The caller's own bots take no friendship: an owner adds their bot like an existing member.
    for (const targetUser of targetUsers) {
      if (targetUser.isBot === 1 && targetUser.botOwnerId === request.userId) exemptUserIds.add(targetUser.id);
    }

    // Validate all target users are friends with the caller (exempt existing DM members)
    for (const targetUser of targetUsers) {
      if (exemptUserIds.has(targetUser.id)) continue;

      const friendship = db.select().from(schema.friends).where(
        or(
          and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, targetUser.id)),
          and(eq(schema.friends.userId, targetUser.id), eq(schema.friends.friendId, request.userId)),
        ),
      ).get();

      if (!friendship) {
        return sendError(reply, 403, 'not_a_friend', { name: targetUser.displayName ?? targetUser.username });
      }
    }

    // Create group DM channel + members in a single transaction
    const dmChannelId = generateSnowflake();
    const now = Date.now();

    db.transaction((tx) => {
      tx.insert(schema.dmChannels).values({
        id: dmChannelId,
        ownerId: request.userId,
        createdAt: now,
      }).run();

      insertDmMember(db.$client, dmChannelId, request.userId);

      for (const targetUser of targetUsers) {
        insertDmMember(db.$client, dmChannelId, targetUser.id);
      }
    });

    // Fetch caller's user row once for the response and system messages.
    const callerUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();

    // Build response
    const allMembers = [callerUser, ...targetUsers]
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map(u => sanitizeUser(u));

    const result = loadDmChannelWire(db, dmChannelId);
    if (!result) {
      return sendError(reply, 500, 'internal_error');
    }

    for (const member of allMembers) {
      connectionManager.sendToUser(member.id, {
        type: 'dm_channel_created',
        dmChannel: result,
      });
    }

    // Insert and broadcast the native membership system messages.
    for (const targetUser of targetUsers) {
      if (!targetUser) continue;
      const sysMsg = {
        id: generateSnowflake(),
        dmChannelId: dmChannelId,
        userId: request.userId,
        content: dmSystemContent({
          event: 'member_added',
          targetUserId: targetUser.id,
          targetDisplayName: dmSystemName(targetUser),
        }),
        type: 'system' as const,
        createdAt: now,
        user: callerUser ? sanitizeUser(callerUser) : undefined,
        attachments: [],
        embeds: [],
        reactions: [],
      };

      db.insert(schema.dmMessages).values({
        id: sysMsg.id,
        dmChannelId: sysMsg.dmChannelId,
        userId: sysMsg.userId,
        content: sysMsg.content,
        type: 'system',
        createdAt: sysMsg.createdAt,
      }).run();

      const systemMessage = getDmMessageWithUser(sysMsg.id);
      if (!systemMessage) return sendError(reply, 500, 'message_lookup_failed');
      for (const member of allMembers) {
        connectionManager.sendToUser(member.id, {
          type: 'dm_message_created',
          message: systemMessage,
        });
      }
    }

    return reply.code(201).send(result);
  });

  // PATCH /api/dm/:id — Update group DM metadata (name + icon). Owner-only.
  // Body: { name?: string | null, icon?: string | null }
  // - name: trimmed; empty → cleared (null); otherwise length must be in
  //   [GROUP_DM_NAME_MIN_LENGTH, GROUP_DM_NAME_MAX_LENGTH].
  // - icon: null/empty → cleared; bare filename → must be an attachment
  //   uploaded by the caller, image/* mimetype, ≤ GROUP_DM_ICON_MAX_BYTES;
  //   absolute http(s) URL → validated external icon URL.
  app.patch<{ Params: { id: string }; Body: { name?: string | null; icon?: string | null } }>('/api/dm/:id', async (request, reply) => {
    const { id } = request.params;
    const body = request.body ?? {};
    const db = getDb();

    // Fetch channel
    const dmChannel = db.select()
      .from(schema.dmChannels)
      .where(and(eq(schema.dmChannels.id, id), isNull(schema.dmChannels.deletedAt)))
      .get();
    if (!dmChannel) {
      return sendError(reply, 404, 'dm_not_found');
    }

    // 1-on-1 DMs (ownerId=NULL) cannot have metadata
    if (!dmChannel.ownerId) {
      return sendError(reply, 400, 'dm_not_group');
    }

    // Caller must be a member
    if (!isDmMember(id, request.userId)) {
      return sendError(reply, 403, 'not_dm_member');
    }

    // Caller must be the owner
    if (dmChannel.ownerId !== request.userId) {
      return sendError(reply, 403, 'dm_owner_only');
    }

    const nameProvided = Object.prototype.hasOwnProperty.call(body, 'name');
    const iconProvided = Object.prototype.hasOwnProperty.call(body, 'icon');

    if (!nameProvided && !iconProvided) {
      // No fields to update — return the channel unchanged.
      return reply.code(200).send({ id: dmChannel.id, name: dmChannel.name, icon: dmChannel.icon, metadataUpdatedAt: dmChannel.metadataUpdatedAt });
    }

    const oldName = dmChannel.name ?? null;
    const oldIcon = dmChannel.icon ?? null;

    // ---- Resolve next name (with no-op short-circuit) ----
    let nextName: string | null = oldName;
    let nameChanged = false;
    if (nameProvided) {
      const raw = body.name;
      let candidate: string | null;
      if (raw === null || raw === undefined) {
        candidate = null;
      } else if (typeof raw !== 'string') {
        return sendError(reply, 400, 'validation_failed');
      } else {
        const trimmed = raw.trim();
        candidate = trimmed.length === 0 ? null : trimmed;
      }
      // Validate length only if the value is actually changing — a no-op repeat
      // of the stored value (even one that wouldn't pass current validation,
      // e.g. legacy data) must not 400.
      if (candidate !== oldName) {
        if (candidate !== null) {
          if (candidate.length < GROUP_DM_NAME_MIN_LENGTH || candidate.length > GROUP_DM_NAME_MAX_LENGTH) {
            return sendError(reply, 400, 'group_dm_name_length', { min: GROUP_DM_NAME_MIN_LENGTH, max: GROUP_DM_NAME_MAX_LENGTH });
          }
        }
        nextName = candidate;
        nameChanged = true;
      }
    }

    // ---- Resolve next icon (with no-op short-circuit) ----
    let nextIcon: string | null = oldIcon;
    let iconChanged = false;
    if (iconProvided) {
      const raw = body.icon;
      let candidate: string | null;
      if (raw === null || raw === undefined) {
        candidate = null;
      } else if (typeof raw !== 'string') {
        return sendError(reply, 400, 'validation_failed');
      } else {
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          candidate = null;
        } else if (!isValidAssetUrl(trimmed)) {
          return sendError(reply, 400, 'icon_url_invalid');
        } else if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          candidate = trimmed;
        } else {
          // Bare filename or `/api/uploads/<filename>` — normalize to bare filename.
          candidate = trimmed.startsWith('/api/uploads/') ? trimmed.slice('/api/uploads/'.length) : trimmed;
        }
      }
      // Only validate attachment ownership/mimetype/size when the icon is
      // actually changing AND the new value is a local filename (not an
      // absolute URL or null clear).
      if (candidate !== oldIcon) {
        if (candidate !== null
            && !candidate.startsWith('http://')
            && !candidate.startsWith('https://')) {
          const attachment = db.select()
            .from(schema.attachments)
            .where(eq(schema.attachments.filename, candidate))
            .get();

          if (!attachment) {
            return sendError(reply, 400, 'attachment_not_found');
          }
          if (attachment.uploaderId !== request.userId) {
            return sendError(reply, 403, 'attachment_not_owned');
          }
          if (attachment.messageId !== null || attachment.dmMessageId !== null) {
            return sendError(reply, 400, 'icon_url_invalid');
          }
          if (!attachment.mimetype.startsWith(GROUP_DM_ICON_MIME_PREFIX)) {
            return sendError(reply, 400, 'icon_not_image');
          }
          if (attachment.size > GROUP_DM_ICON_MAX_BYTES) {
            return sendError(reply, 400, 'icon_too_large', { max: Math.floor(GROUP_DM_ICON_MAX_BYTES / (1024 * 1024)) });
          }
        }
        nextIcon = candidate;
        iconChanged = true;
      }
    }

    // ---- No-op short-circuit ----
    if (!nameChanged && !iconChanged) {
      return reply.code(200).send({
        id: dmChannel.id,
        name: dmChannel.name,
        icon: dmChannel.icon,
        metadataUpdatedAt: dmChannel.metadataUpdatedAt,
      });
    }

    const systemMessageIds: string[] = [];

    // ---- Transaction: persist channel update + system message rows ----
    let metadataUpdatedAt = 0;
    db.transaction((tx) => {
      metadataUpdatedAt = Date.now();
      tx.update(schema.dmChannels)
        .set({ name: nextName, icon: nextIcon, metadataUpdatedAt })
        .where(eq(schema.dmChannels.id, id))
        .run();

      if (nameChanged) {
        const sysId = generateSnowflake();
        const content = dmSystemContent({ event: 'name_changed', oldName, newName: nextName });
        tx.insert(schema.dmMessages).values({
          id: sysId,
          dmChannelId: id,
          userId: request.userId,
          content,
          type: 'system',
          createdAt: metadataUpdatedAt,
        }).run();
        systemMessageIds.push(sysId);
      }

      if (iconChanged) {
        const sysId = generateSnowflake();
        const content = dmSystemContent({ event: 'icon_changed' });
        tx.insert(schema.dmMessages).values({
          id: sysId,
          dmChannelId: id,
          userId: request.userId,
          content,
          type: 'system',
          createdAt: metadataUpdatedAt,
        }).run();
        systemMessageIds.push(sysId);
      }
    });

    // ---- Broadcast channel update to local members ----
    connectionManager.sendToDmMembers(id, {
      type: 'dm_channel_updated',
      dmChannelId: id,
      name: nextName,
      icon: nextIcon,
    });

    // ---- Broadcast each new system message ----
    for (const messageId of systemMessageIds) {
      const message = getDmMessageWithUser(messageId);
      if (message) connectionManager.sendToDmMembers(id, { type: 'dm_message_created', message });
    }

    // ---- Old icons retain any surviving native message/profile holder. ----
    if (iconChanged && oldIcon && !oldIcon.startsWith('http')) {
      deleteUnreferencedUploadFiles([oldIcon]);
    }
    // Clean up the attachment record for the newly-set icon — the file is
    // now referenced via dm_channels.icon (protected by the storage janitor),
    // so the standalone attachment row is unnecessary. Mirrors users.ts:473.
    if (iconChanged && nextIcon && !nextIcon.startsWith('http')) {
      deleteAttachmentByFilename(nextIcon);
    }

    return reply.code(200).send({
      id,
      name: nextName,
      icon: nextIcon,
      metadataUpdatedAt,
    });
  });

  // DELETE /api/dm/:id - Close (hide) a DM channel for the requesting user
  app.delete<{ Params: { id: string } }>('/api/dm/:id', async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    // Verify the user is a member of this DM channel
    const membership = db.select()
      .from(schema.dmMembers)
      .where(and(
        eq(schema.dmMembers.dmChannelId, id),
        eq(schema.dmMembers.userId, request.userId),
      ))
      .get();

    if (!membership) {
      return sendError(reply, 403, 'not_dm_member');
    }

    // Soft close: set closed flag (preserves membership for future message delivery)
    setDmMemberClosed(db.$client, id, request.userId, true);

    // Broadcast dm_channel_closed to self for multi-tab sync
    connectionManager.sendToUser(request.userId, {
      type: 'dm_channel_closed',
      dmChannelId: id,
    });

    return reply.code(200).send({ success: true });
  });

  // POST /api/dm/:id/members - Add a user to an existing DM channel (group DM upgrade)
  app.post<{ Params: { id: string }; Body: AddDmMemberRequest }>('/api/dm/:id/members', async (request, reply) => {
    const { id } = request.params;
    const { userId: targetUserIdRaw } = request.body ?? {};
    if (typeof targetUserIdRaw !== 'string' || !targetUserIdRaw) {
      return sendError(reply, 400, 'dm_target_required');
    }
    const db = getDb();
    const targetUser = db.select().from(schema.users).where(and(eq(schema.users.id, targetUserIdRaw),eq(schema.users.isDeleted,0))).get();

    if (!targetUser) {
      return sendError(reply, 404, 'user_not_found');
    }

    const targetUserId = targetUser.id;

    // Validate caller is a member
    if (!isDmMember(id, request.userId)) {
      return sendError(reply, 403, 'not_dm_member');
    }

    // Fetch channel and enforce type + ownership constraints
    const dmChannel = db.select().from(schema.dmChannels).where(and(eq(schema.dmChannels.id, id), isNull(schema.dmChannels.deletedAt))).get();
    if (!dmChannel) {
      return sendError(reply, 404, 'dm_not_found');
    }
    // 1-on-1 DMs (ownerId=NULL) are immutable — cannot add members
    if (!dmChannel.ownerId) {
      return sendError(reply, 400, 'dm_not_group');
    }
    // Any group DM member can add friends (not just the owner)

    // Validate the adder and target are friends
    const friendship = db.select().from(schema.friends).where(
      or(
        and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, targetUserId)),
        and(eq(schema.friends.userId, targetUserId), eq(schema.friends.friendId, request.userId)),
      ),
    ).get();

    const isOwnBot = targetUser.isBot === 1 && targetUser.botOwnerId === request.userId;
    if (!friendship && !isOwnBot) {
      return sendError(reply, 403, 'not_a_friend');
    }

    // Validate target is not already a member
    const existingMembership = db.select()
      .from(schema.dmMembers)
      .where(and(
        eq(schema.dmMembers.dmChannelId, id),
        eq(schema.dmMembers.userId, targetUserId),
      ))
      .get();

    if (existingMembership) {
      return sendError(reply, 400, 'already_member');
    }

    // Validate member count < 10
    const currentMembers = db.select()
      .from(schema.dmMembers)
      .where(eq(schema.dmMembers.dmChannelId, id))
      .all();

    if (currentMembers.length >= 10) {
      return sendError(reply, 400, 'group_dm_too_many_members', { max: GROUP_DM_MAX_MEMBERS });
    }

    // Insert dm_members row for new user
    insertDmMember(db.$client, id, targetUserId);

    // The channel as the new member's sidebar gets it
    const result = loadDmChannelWire(db, id);
    if (!result) {
      return sendError(reply, 404, 'dm_not_found');
    }

    const newUser = sanitizeUser(targetUser);

    // Broadcast dm_member_added to all existing members (before the new one)
    for (const member of currentMembers) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_member_added',
        dmChannelId: id,
        user: newUser,
      });
    }

    // Send dm_channel_created to the new member so their sidebar picks it up
    connectionManager.sendToUser(targetUserId, {
      type: 'dm_channel_created',
      dmChannel: result,
    });

    // Insert & broadcast system message for member addition
    const addSysMsg = {
      id: generateSnowflake(),
      dmChannelId: id,
      userId: request.userId,
      content: dmSystemContent({
        event: 'member_added',
        targetUserId,
        targetDisplayName: dmSystemName(targetUser),
      }),
      type: 'system' as const,
      createdAt: Date.now(),
      user: db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get(),
      attachments: [],
      embeds: [],
      reactions: [],
    };

    db.insert(schema.dmMessages).values({
      id: addSysMsg.id,
      dmChannelId: addSysMsg.dmChannelId,
      userId: addSysMsg.userId,
      content: addSysMsg.content,
      type: 'system',
      createdAt: addSysMsg.createdAt,
    }).run();

    const systemMessage = getDmMessageWithUser(addSysMsg.id);
    if (systemMessage) connectionManager.sendToDmMembers(id, { type: 'dm_message_created', message: systemMessage });

    // Active call sync: if there's an active call in this DM, notify the new member
    const room = connectionManager.getRoom(id);
    if (room && room.roomType === 'dm') {
      const meta = room.metadata as { state: string; callerId: string };
      if (meta.state === 'active' || meta.state === 'ringing') {
        // Look up caller name
        const callerRow = db.select().from(schema.users).where(eq(schema.users.id, meta.callerId)).get();
        const callerName = callerRow?.displayName ?? callerRow?.username ?? meta.callerId;
        connectionManager.sendToUser(targetUserId, {
          type: 'dm_call_incoming',
          dmChannelId: id,
          callerId: meta.callerId,
          callerName,
        });
      }
    }

    return reply.code(200).send(result);
  });

  // DELETE /api/dm/:id/members - Leave a group DM
  app.delete<{ Params: { id: string } }>('/api/dm/:id/members', async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    // Validate caller is a member
    if (!isDmMember(id, request.userId)) {
      return sendError(reply, 403, 'not_dm_member');
    }

    // Fetch channel — 1-on-1 DMs (ownerId=NULL) cannot be left, only closed
    const dmChannel = db.select().from(schema.dmChannels).where(and(eq(schema.dmChannels.id, id), isNull(schema.dmChannels.deletedAt))).get();
    if (!dmChannel) {
      return sendError(reply, 404, 'dm_not_found');
    }
    if (!dmChannel.ownerId) {
      return sendError(reply, 400, 'dm_not_group');
    }

    // If user is in this DM's VoiceRoom, leave it first
    evictUserFromDmVoiceRoom(id, request.userId);

    removeDmMember(id, request.userId, request.userId, 'leave');

    // Send dm_channel_closed to the leaving user
    connectionManager.sendToUser(request.userId, {
      type: 'dm_channel_closed',
      dmChannelId: id,
    });

    return reply.code(200).send({ success: true });
  });

  // DELETE /api/dm/:id/members/:targetUserId - Owner kicks a member from a group DM.
  app.delete<{
    Params: { id: string; targetUserId: string };
  }>('/api/dm/:id/members/:targetUserId', async (request, reply) => {
    const { id, targetUserId: rawTargetSegment } = request.params;
    const db = getDb();
    const targetUserRow = db.select().from(schema.users).where(eq(schema.users.id, rawTargetSegment)).get();

    if (!targetUserRow) {
      return sendError(reply, 404, 'user_not_found');
    }

    const targetUserId = targetUserRow.id;

    // Channel must exist (and not be soft-deleted)
    const dmChannel = db.select().from(schema.dmChannels).where(and(eq(schema.dmChannels.id, id), isNull(schema.dmChannels.deletedAt))).get();
    if (!dmChannel) {
      return sendError(reply, 404, 'dm_not_found');
    }

    // 1-on-1 DM rejection (ownerId=NULL signals 1-on-1)
    if (!dmChannel.ownerId) {
      return sendError(reply, 400, 'dm_not_group');
    }

    // Caller must be the owner
    if (dmChannel.ownerId !== request.userId) {
      return sendError(reply, 403, 'dm_owner_only');
    }

    // Owner cannot kick themselves
    if (targetUserId === request.userId) {
      return sendError(reply, 400, 'owner_cannot_kick_self');
    }

    // Target must be a current member
    if (!isDmMember(id, targetUserId)) {
      return sendError(reply, 404, 'target_not_dm_member');
    }

    // If kicked user is in this DM's voice room, evict them first so the call state stays consistent
    evictUserFromDmVoiceRoom(id, targetUserId);

    removeDmMember(id, request.userId, targetUserId, 'kick');

    // Notify the kicked user that they no longer have access to this channel
    connectionManager.sendToUser(targetUserId, {
      type: 'dm_channel_closed',
      dmChannelId: id,
    });

    return reply.code(200).send({ success: true });
  });

  // POST /api/dm/:id/transfer - Owner transfers ownership to another group member without leaving.
  app.post<{
    Params: { id: string };
    Body: { newOwnerId?: unknown };
  }>('/api/dm/:id/transfer', async (request, reply) => {
    const { id } = request.params;
    const body = request.body ?? {};
    const rawNewOwnerId = body.newOwnerId;
    if (typeof rawNewOwnerId !== 'string' || !rawNewOwnerId) {
      return sendError(reply, 400, 'new_owner_required');
    }

    const db = getDb();

    const newOwnerRow = db.select().from(schema.users).where(and(eq(schema.users.id, rawNewOwnerId),eq(schema.users.isDeleted,0))).get();

    if (!newOwnerRow) {
      return sendError(reply, 404, 'user_not_found');
    }

    const newOwnerId = newOwnerRow.id;

    // Channel must exist (and not be soft-deleted)
    const dmChannel = db.select().from(schema.dmChannels).where(and(eq(schema.dmChannels.id, id), isNull(schema.dmChannels.deletedAt))).get();
    if (!dmChannel) {
      return sendError(reply, 404, 'dm_not_found');
    }

    // 1-on-1 DM rejection (ownerId=NULL signals 1-on-1)
    if (!dmChannel.ownerId) {
      return sendError(reply, 400, 'dm_not_group');
    }

    // Caller must be the current owner
    if (dmChannel.ownerId !== request.userId) {
      return sendError(reply, 403, 'dm_owner_only');
    }

    // Self-transfer is a no-op
    if (newOwnerId === dmChannel.ownerId) {
      return sendError(reply, 400, 'already_owner');
    }

    // Target must be a current member
    if (!isDmMember(id, newOwnerId)) {
      return sendError(reply, 400, 'target_not_dm_member');
    }

    const previousOwnerId = dmChannel.ownerId;
    transferGroupDmOwnership(id, previousOwnerId, newOwnerId);

    return reply.code(200).send({ success: true });
  });

  // GET /api/dm/:id/messages - Get DM messages with cursor pagination
  // (before or after; see docs/systems/api.md, "Message history paging")
  app.get<{ Params: { id: string }; Querystring: PaginatedQuery }>('/api/dm/:id/messages', async (request, reply) => {
    const { id } = request.params;

    const parsed = parseHistoryPage(request.query);
    if (!parsed.ok) {
      return sendError(reply, 400, parsed.code);
    }
    const { page } = parsed;

    if (!isDmMember(id, request.userId)) {
      return sendError(reply, 403, 'not_dm_member');
    }

    const db = getDb();
    const messageRows = selectHistoryPage(page, schema.dmMessages, (cursor, orderBy, limit) =>
      db.select()
        .from(schema.dmMessages)
        .where(and(eq(schema.dmMessages.dmChannelId, id), cursor))
        .orderBy(...orderBy)
        .limit(limit)
        .all(),
    );

    markHistoryPageHonoured(reply, page);
    return reply.code(200).send(hydrateDmMessages(id, messageRows));
  });

  // POST /api/dm/space-invite — Send a space invite card to a friend via DM.
  // Trust model: read the current instance's snapshot, never client-supplied data.
  app.post<{ Body: SpaceInviteRequest }>('/api/dm/space-invite', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '60 seconds',
        // The HTTP hook runs after this plugin's authentication hook.
      },
    },
  }, async (request, reply) => {
    const body = request.body;
    if (!body || !body.spaceId || !body.inviteCode || !body.target) {
      return sendError(reply, 400, 'invalid_body');
    }

    const db = getDb();
    const callerId = request.userId;

    // 1. Resolve an existing local friend, without creating identities.
    if (typeof body.target.userId !== 'string' || !body.target.userId) {
      return sendError(reply, 400, 'invalid_target');
    }
    const targetUser = db.select().from(schema.users)
      .where(and(eq(schema.users.id, body.target.userId),eq(schema.users.isDeleted,0))).get();

    if (!targetUser) {
      return sendError(reply, 404, 'user_not_found');
    }
    if (targetUser.id === callerId) {
      return sendError(reply, 400, 'cannot_invite_self');
    }

    // 2. Friendship check (anti-spam, NOT a permission gate — see spec).
    const friendship = db.select().from(schema.friends).where(
      or(
        and(eq(schema.friends.userId, callerId), eq(schema.friends.friendId, targetUser.id)),
        and(eq(schema.friends.userId, targetUser.id), eq(schema.friends.friendId, callerId)),
      ),
    ).get();
    if (!friendship) {
      return sendError(reply, 400, 'not_a_friend');
    }

    // 3. Never discard a supplied foreign host and act on a colliding local code.
    const spaceOrigin = new URL(getPublicOrigin()).origin;
    if (body.spaceInstanceOrigin) {
      try {
        if (new URL(body.spaceInstanceOrigin).origin !== spaceOrigin) return sendError(reply, 400, 'invite_invalid');
      } catch { return sendError(reply, 400, 'invite_invalid'); }
    }
    const snapshot = getLocalInviteSnapshot(body.inviteCode);
    if (!snapshot) {
      return sendError(reply, 400, 'invite_invalid');
    }
    if (snapshot.spaceId !== body.spaceId) {
      // spaceId mismatch — code points at a different space than the client claimed.
      return sendError(reply, 400, 'invite_invalid');
    }

    // Validate the persisted system content through its shared parser.
    const invite = parseDmSystemEvent(JSON.stringify({
      event: 'space_invite',
      spaceId: body.spaceId,
      spaceInstanceOrigin: spaceOrigin,
      inviteCode: body.inviteCode,
      snapshot: {
        spaceName: snapshot.spaceName,
        icon: snapshot.icon,
        avatarColor: snapshot.avatarColor,
        memberCount: snapshot.memberCount,
        description: snapshot.description,
        instanceName: snapshot.instanceName,
      },
    } satisfies SpaceInviteSystemPayload));
    if (!invite || invite.event !== 'space_invite') {
      return sendError(reply, 400, 'invite_invalid');
    }

    // 4. Resolve / create the 1-on-1 DM (delegate to dedup helper).
    const dmChannelId = ensureOneOnOneDmChannel(callerId, targetUser, db);

    // 5. Insert the system message.
    const now = Date.now();
    const messageId = generateSnowflake();
    db.insert(schema.dmMessages).values({
      id: messageId,
      dmChannelId,
      userId: callerId,
      content: dmSystemContent(invite),
      type: 'system',
      createdAt: now,
    }).run();

    // 6. Hydrate + broadcast locally.
    const message = getDmMessageWithUser(messageId);
    if (!message) {
      return sendError(reply, 500, 'message_lookup_failed');
    }
    broadcastDmMessage(dmChannelId, message);

    const response: SpaceInviteResponse = { dmChannelId, messageId, message };
    return reply.code(200).send(response);
  });

  // POST /api/dm/:id/messages - Send a DM message
  app.post<{ Params: { id: string }; Body: CreateDmMessageRequest }>('/api/dm/:id/messages', async (request, reply) => {
    const { id } = request.params;

    const check = checkDmMessageCreate(id, request.userId, request.body ?? {});
    if (!check.ok) {
      return sendError(reply, check.refusal.status, check.refusal.code, check.refusal.details);
    }
    const { content, attachmentIds, replyToId } = check.value;

    const retryAfter = consumeMessageCreate(request.userId);
    if (retryAfter > 0) return sendRateLimit(reply, retryAfter, 'action');

    const db = getDb();
    const messageId = generateSnowflake();
    const now = Date.now();

    // Insert message and link attachments atomically
    db.transaction((tx) => {
      tx.insert(schema.dmMessages).values({
        id: messageId,
        dmChannelId: id,
        userId: request.userId,
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

    const message = getDmMessageWithUser(messageId);
    if (!message) {
      return sendError(reply, 500, 'message_create_failed');
    }

    // Broadcast to all DM members (including those who closed the channel)
    broadcastDmMessage(id, message);

    // Resolve embeds asynchronously after responding
    setImmediate(() => {
      resolveEmbeds(messageId, content, id, true, null).catch(() => {});
    });

    return reply.code(201).send(message);
  });

  // PATCH /api/dm/messages/:id - Edit a DM message
  app.patch<{ Params: { id: string }; Body: { content: string } }>('/api/dm/messages/:id', async (request, reply) => {
    const { id } = request.params;

    const check = checkDmMessageEdit(id, request.userId, request.body?.content);
    if (!check.ok) {
      return sendError(reply, check.refusal.status, check.refusal.code, check.refusal.details);
    }
    const { message: msg, content } = check.value;

    const db = getDb();
    const now = Date.now();
    db.update(schema.dmMessages)
      .set({ content, editedAt: now })
      .where(eq(schema.dmMessages.id, id))
      .run();

    // Delete old embeds synchronously so the broadcast reflects the edit
    db.delete(schema.embeds).where(eq(schema.embeds.dmMessageId, id)).run();

    const updated = getDmMessageWithUser(id);
    if (!updated) {
      return sendError(reply, 500, 'message_update_failed');
    }

    // Broadcast to all DM members
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
      resolveEmbeds(id, content, msg.dmChannelId, true, null).catch(() => {});
    });

    return reply.code(200).send(updated);
  });

  // DELETE /api/dm/messages/:id - Delete a DM message
  app.delete<{ Params: { id: string } }>('/api/dm/messages/:id', async (request, reply) => {
    const { id } = request.params;

    const check = checkDmMessageDelete(id, request.userId);
    if (!check.ok) {
      return sendError(reply, check.refusal.status, check.refusal.code, check.refusal.details);
    }
    const msg = check.value;
    const db = getDb();

    // Collect attachment filenames before deleting
    const attachmentRows = db.select({ filename: schema.attachments.filename })
      .from(schema.attachments)
      .where(eq(schema.attachments.dmMessageId, id))
      .all();

    // Delete attachments, reactions, and message atomically
    db.transaction((tx) => {
      tx.delete(schema.attachments)
        .where(eq(schema.attachments.dmMessageId, id))
        .run();

      tx.delete(schema.dmReactions)
        .where(eq(schema.dmReactions.dmMessageId, id))
        .run();

      tx.delete(schema.dmMessages)
        .where(eq(schema.dmMessages.id, id))
        .run();
    });

    // Clean up files from disk after transaction commits
    deleteAttachmentFiles(attachmentRows);

    // Broadcast to all DM members
    const dmMembers = db.select()
      .from(schema.dmMembers)
      .where(eq(schema.dmMembers.dmChannelId, msg.dmChannelId))
      .all();

    for (const member of dmMembers) {
      connectionManager.sendToUser(member.userId, {
        type: 'dm_message_deleted',
        messageId: id,
        dmChannelId: msg.dmChannelId,
      });
    }

    return reply.code(200).send({ success: true });
  });
}
