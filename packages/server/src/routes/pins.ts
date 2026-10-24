import type { FastifyInstance } from 'fastify';
import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { hasPermission, getChannelSpaceId, PermissionBits } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { sendError } from '../utils/httpErrors.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { buildMessageWithUser } from './messages.js';
import { MAX_PINS_PER_CHANNEL, type PinnedMessage, type PinWithMessage } from '@backspace/shared';

function toPinnedMessage(row: typeof schema.pinnedMessages.$inferSelect): PinnedMessage {
  return {
    id: row.id,
    channelId: row.channelId,
    messageId: row.messageId,
    pinnedById: row.pinnedById,
    createdAt: row.createdAt,
  };
}

/**
 * Light hydration for pin previews: author + attachments, no embeds (no
 * network), no reactions, no reply chains. A pin whose message row is gone
 * (deleted-message sweep pending) hydrates to null rather than 404ing the
 * whole list.
 */
function hydratePins(rows: (typeof schema.pinnedMessages.$inferSelect)[]): PinWithMessage[] {
  const db = getDb();
  const messageIds = [...new Set(rows.map((r) => r.messageId))];
  const messageRows = messageIds.length > 0
    ? db.select().from(schema.messages).where(inArray(schema.messages.id, messageIds)).all()
    : [];
  const messageMap = new Map(messageRows.map((m) => [m.id, m]));
  const userIds = [...new Set(messageRows.map((m) => m.userId))];
  const users = userIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all()
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const attachments = messageIds.length > 0
    ? db.select().from(schema.attachments).where(inArray(schema.attachments.messageId, messageIds)).all()
    : [];
  const attachmentMap = new Map<string, (typeof schema.attachments.$inferSelect)[]>();
  for (const att of attachments) {
    const mid = att.messageId ?? '';
    if (!attachmentMap.has(mid)) attachmentMap.set(mid, []);
    attachmentMap.get(mid)!.push(att);
  }
  return rows.map((row) => {
    const message = messageMap.get(row.messageId);
    const user = message ? userMap.get(message.userId) : undefined;
    return {
      ...toPinnedMessage(row),
      message: message && user ? buildMessageWithUser(message, user, attachmentMap.get(message.id) ?? []) : null,
    };
  });
}

function channelGate(channelId: string): { spaceId: string } | null {
  const spaceId = getChannelSpaceId(channelId);
  if (!spaceId) return null;
  const channel = getDb().select().from(schema.channels).where(eq(schema.channels.id, channelId)).get();
  if (!channel || channel.type !== 'text') return null;
  return { spaceId };
}

export async function pinRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/channels/:id/pins - List a text channel's pins, oldest first.
  app.get<{ Params: { id: string } }>('/api/channels/:id/pins', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const gate = channelGate(id);
    if (!gate) {
      return sendError(reply, 404, 'channel_not_found');
    }
    if (!hasPermission(request.userId, gate.spaceId, PermissionBits.VIEW_CHANNEL | PermissionBits.READ_MESSAGE_HISTORY, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'VIEW_CHANNEL or READ_MESSAGE_HISTORY' });
    }
    const rows = getDb().select().from(schema.pinnedMessages)
      .where(eq(schema.pinnedMessages.channelId, id))
      .orderBy(schema.pinnedMessages.createdAt, schema.pinnedMessages.id)
      .all();
    return reply.code(200).send({ pins: hydratePins(rows) });
  });

  // POST /api/channels/:id/pins - Pin a message. MANAGE_MESSAGES. Idempotent:
  // pinning an already-pinned message returns the existing pin.
  app.post<{ Params: { id: string }; Body: { messageId?: unknown } }>('/api/channels/:id/pins', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const gate = channelGate(id);
    if (!gate) {
      return sendError(reply, 404, 'channel_not_found');
    }
    if (!hasPermission(request.userId, gate.spaceId, PermissionBits.MANAGE_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    }
    const messageId = typeof request.body?.messageId === 'string' ? request.body.messageId : '';
    const message = getDb().select().from(schema.messages)
      .where(and(eq(schema.messages.id, messageId), eq(schema.messages.channelId, id))).get();
    if (!message) {
      return sendError(reply, 404, 'message_not_found');
    }
    const db = getDb();
    const existing = db.select().from(schema.pinnedMessages)
      .where(eq(schema.pinnedMessages.messageId, messageId)).get();
    if (existing) {
      return reply.code(200).send({ pin: toPinnedMessage(existing) });
    }
    const total = db.select({ total: count() }).from(schema.pinnedMessages)
      .where(eq(schema.pinnedMessages.channelId, id)).get()?.total ?? 0;
    if (total >= MAX_PINS_PER_CHANNEL) {
      return sendError(reply, 409, 'pin_limit_reached', { max: MAX_PINS_PER_CHANNEL });
    }
    const row = {
      id: generateSnowflake(),
      channelId: id,
      messageId,
      pinnedById: request.userId,
      createdAt: Date.now(),
    };
    db.insert(schema.pinnedMessages).values(row).run();
    connectionManager.sendToChannel(gate.spaceId, id, {
      type: 'message_pinned',
      channelId: id,
      messageId,
      pinnedById: request.userId,
    });
    return reply.code(201).send({ pin: toPinnedMessage(row) });
  });

  // DELETE /api/channels/:id/pins/:messageId - Unpin. The pinner themself, or MANAGE_MESSAGES.
  app.delete<{ Params: { id: string; messageId: string } }>('/api/channels/:id/pins/:messageId', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, messageId } = request.params;
    const gate = channelGate(id);
    if (!gate) {
      return sendError(reply, 404, 'channel_not_found');
    }
    const db = getDb();
    const pin = db.select().from(schema.pinnedMessages)
      .where(and(eq(schema.pinnedMessages.channelId, id), eq(schema.pinnedMessages.messageId, messageId))).get();
    if (!pin) {
      return sendError(reply, 404, 'pin_not_found');
    }
    const isPinner = pin.pinnedById !== null && pin.pinnedById === request.userId;
    if (!isPinner && !hasPermission(request.userId, gate.spaceId, PermissionBits.MANAGE_MESSAGES, id)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_MESSAGES' });
    }
    db.delete(schema.pinnedMessages).where(eq(schema.pinnedMessages.id, pin.id)).run();
    connectionManager.sendToChannel(gate.spaceId, id, {
      type: 'message_unpinned',
      channelId: id,
      messageId,
    });
    return reply.code(200).send({ success: true });
  });
}
