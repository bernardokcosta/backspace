import type { FastifyInstance } from 'fastify';
import { eq, and, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { isMember, isBanned, isSpaceOwner, hasPermission, PermissionBits } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendError } from '../utils/httpErrors.js';
import { buildJoinedSpace } from '../utils/spaceJoinPayload.js';
import type {
  JoinRequest,
  MemberWithUser,
} from '@backspace/shared';

function rowToJoinRequest(
  row: typeof schema.joinRequests.$inferSelect,
  user?: ReturnType<typeof sanitizeUser>,
): JoinRequest {
  return {
    id: row.id,
    spaceId: row.spaceId,
    userId: row.userId,
    message: row.message,
    status: row.status as JoinRequest['status'],
    decidedBy: row.decidedBy,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    user: user ?? undefined,
  };
}

/**
 * Find all online users for a space who have MANAGE_SPACE or are the owner.
 * Used to route join_request_received events.
 */
function getSpaceManagers(spaceId: string): string[] {
  const db = getDb();
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return [];

  const memberRows = db.select()
    .from(schema.spaceMembers)
    .where(eq(schema.spaceMembers.spaceId, spaceId))
    .all();

  const managers: string[] = [];
  for (const member of memberRows) {
    if (member.userId === space.ownerId || hasPermission(member.userId, spaceId, PermissionBits.MANAGE_SPACE)) {
      managers.push(member.userId);
    }
  }
  return managers;
}

export async function joinRequestRoutes(app: FastifyInstance): Promise<void> {

  // POST /api/spaces/:id/request-join — request to join a request-only space
  app.post<{ Params: { id: string }; Body: { message?: string } }>('/api/spaces/:id/request-join', {
    preHandler: authenticate,
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (space.visibility !== 'request') {
      return sendError(reply, 403, 'space_not_requestable');
    }

    if (isBanned(id, request.userId)) {
      return sendError(reply, 403, 'user_banned');
    }

    if (isMember(id, request.userId)) {
      return sendError(reply, 409, 'already_member');
    }

    // Check for existing pending request
    const existingRequest = db.select().from(schema.joinRequests)
      .where(and(
        eq(schema.joinRequests.spaceId, id),
        eq(schema.joinRequests.userId, request.userId),
        eq(schema.joinRequests.status, 'pending'),
      ))
      .get();

    if (existingRequest) {
      return sendError(reply, 409, 'join_request_pending');
    }

    const requestId = generateSnowflake();
    const now = Date.now();
    const msgText = request.body?.message?.trim().slice(0, 500) ?? null;

    db.insert(schema.joinRequests).values({
      id: requestId,
      spaceId: id,
      userId: request.userId,
      message: msgText,
      status: 'pending',
      createdAt: now,
    }).run();

    const joiningUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    const joinRequest = rowToJoinRequest(
      db.select().from(schema.joinRequests).where(eq(schema.joinRequests.id, requestId)).get()!,
      joiningUser ? sanitizeUser(joiningUser) : undefined,
    );

    // Send WS event to space managers (owner + MANAGE_SPACE users)
    const managers = getSpaceManagers(id);
    for (const managerId of managers) {
      connectionManager.sendToUser(managerId, {
        type: 'join_request_received',
        request: joinRequest,
      });
    }

    return reply.code(201).send(joinRequest);
  });

  // GET /api/spaces/:id/join-requests — list join requests for a space
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>('/api/spaces/:id/join-requests', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isSpaceOwner(id, request.userId) && !hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }

    const statusFilter = request.query.status ?? 'pending';
    if (!['pending', 'accepted', 'declined'].includes(statusFilter)) {
      return sendError(reply, 400, 'validation_failed');
    }
    const rows = db.select().from(schema.joinRequests)
      .where(and(
        eq(schema.joinRequests.spaceId, id),
        eq(schema.joinRequests.status, statusFilter),
      ))
      .all();

    // Populate user data
    const userIds = rows.map(r => r.userId);
    const users = userIds.length > 0
      ? db.select().from(schema.users).where(inArray(schema.users.id, userIds)).all()
      : [];
    const userMap = new Map(users.map(u => [u.id, sanitizeUser(u)]));

    const requests: JoinRequest[] = rows.map(r => rowToJoinRequest(r, userMap.get(r.userId)));

    return reply.code(200).send({ requests });
  });

  // PATCH /api/spaces/:id/join-requests/:requestId — accept or decline
  app.patch<{ Params: { id: string; requestId: string }; Body: { action: 'accept' | 'decline' } }>('/api/spaces/:id/join-requests/:requestId', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id, requestId } = request.params;
    const { action } = request.body;
    const db = getDb();

    if (!action || (action !== 'accept' && action !== 'decline')) {
      return sendError(reply, 400, 'validation_failed');
    }

    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) {
      return sendError(reply, 404, 'space_not_found');
    }

    if (!isSpaceOwner(id, request.userId) && !hasPermission(request.userId, id, PermissionBits.MANAGE_SPACE)) {
      return sendError(reply, 403, 'missing_permission', { permission: 'MANAGE_SPACE' });
    }

    const joinReq = db.select().from(schema.joinRequests).where(eq(schema.joinRequests.id, requestId)).get();
    if (!joinReq || joinReq.spaceId !== id) {
      return sendError(reply, 404, 'join_request_not_found');
    }

    if (joinReq.status !== 'pending') {
      return sendError(reply, 400, 'join_request_decided');
    }

    const now = Date.now();

    if (action === 'accept') {
      // Insert member and update request atomically
      db.transaction((tx) => {
        tx.insert(schema.spaceMembers).values({
          spaceId: id,
          userId: joinReq.userId,
          joinedAt: now,
        }).run();

        tx.update(schema.joinRequests).set({
          status: 'accepted',
          decidedBy: request.userId,
          decidedAt: now,
        }).where(eq(schema.joinRequests.id, requestId)).run();
      });

      // Register in connectionManager
      connectionManager.addUserSpace(joinReq.userId, id);

      // Broadcast member_joined to space
      const joiningUser = db.select().from(schema.users).where(eq(schema.users.id, joinReq.userId)).get();
      if (joiningUser) {
        const memberPayload: MemberWithUser = {
          spaceId: id,
          userId: joinReq.userId,
          nickname: null,
          joinedAt: now,
          user: sanitizeUser(joiningUser),
          roles: [],
        };
        connectionManager.sendToSpace(id, {
          type: 'member_joined',
          spaceId: id,
          member: memberPayload,
        });
      }

      // Build full space for the accepted user
      const fullSpace = buildJoinedSpace(id, joinReq.userId);

      const updatedRow = db.select().from(schema.joinRequests).where(eq(schema.joinRequests.id, requestId)).get()!;
      const updatedRequest = rowToJoinRequest(updatedRow, joiningUser ? sanitizeUser(joiningUser) : undefined);

      // Send join_request_accepted to the requesting user
      if (fullSpace) {
        connectionManager.sendToUser(joinReq.userId, {
          type: 'join_request_accepted',
          request: updatedRequest,
          space: fullSpace,
        });
      }

      return reply.code(200).send(updatedRequest);
    } else {
      // Decline
      db.update(schema.joinRequests).set({
        status: 'declined',
        decidedBy: request.userId,
        decidedAt: now,
      }).where(eq(schema.joinRequests.id, requestId)).run();

      const updatedRow = db.select().from(schema.joinRequests).where(eq(schema.joinRequests.id, requestId)).get()!;
      const updatedRequest = rowToJoinRequest(updatedRow);

      // Send join_request_declined to the requesting user
      connectionManager.sendToUser(joinReq.userId, {
        type: 'join_request_declined',
        request: updatedRequest,
      });

      return reply.code(200).send(updatedRequest);
    }
  });

  // GET /api/users/@me/join-requests — list the current user's join requests
  app.get<{ Querystring: { status?: string } }>('/api/users/@me/join-requests', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const statusFilter = request.query.status;

    let rows;
    if (statusFilter) {
      rows = db.select().from(schema.joinRequests)
        .where(and(
          eq(schema.joinRequests.userId, request.userId),
          eq(schema.joinRequests.status, statusFilter),
        ))
        .all();
    } else {
      rows = db.select().from(schema.joinRequests)
        .where(eq(schema.joinRequests.userId, request.userId))
        .all();
    }

    const requests: JoinRequest[] = rows.map(r => rowToJoinRequest(r));

    return reply.code(200).send({ requests });
  });
}
