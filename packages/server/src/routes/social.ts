import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, or, ne, like, sql, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';
import { exchangeFriendPresence } from '../ws/presence.js';
import type { Friend, FriendRequest, SendFriendRequest, UpdateFriendRequest, DiscoverUser } from '@veyvox/shared';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendError } from '../utils/httpErrors.js';

/** Exact local username, including a retained sovereign legacy handle. Never
 * strip a host from an unknown name and act on a different local account. */
function findLocalUserByUsername(db: ReturnType<typeof getDb>, username: string): typeof schema.users.$inferSelect | undefined {
  return db.select().from(schema.users).where(and(
    eq(schema.users.username, username.toLowerCase()), eq(schema.users.isDeleted, 0),
  )).get();
}

async function handleLocalFriendRequest(
  db: ReturnType<typeof getDb>, request: FastifyRequest, reply: FastifyReply,
  targetUser: typeof schema.users.$inferSelect | undefined,
  sender: typeof schema.users.$inferSelect,
): Promise<unknown> {
  if (!targetUser) return sendError(reply, 404, 'user_not_found');
  if (targetUser.id === request.userId) return sendError(reply, 400, 'cannot_friend_self');
  if (targetUser.isBot === 1) return sendError(reply, 400, 'bots_no_friends');

  const existingFriend = db.select().from(schema.friends).where(or(
    and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, targetUser.id)),
    and(eq(schema.friends.userId, targetUser.id), eq(schema.friends.friendId, request.userId)),
  )).get();
  if (existingFriend) return sendError(reply, 400, 'already_friends');

  const existingRequest = db.select().from(schema.friendRequests).where(and(
    or(
      and(eq(schema.friendRequests.fromId, request.userId), eq(schema.friendRequests.toId, targetUser.id)),
      and(eq(schema.friendRequests.fromId, targetUser.id), eq(schema.friendRequests.toId, request.userId)),
    ), eq(schema.friendRequests.status, 'pending'),
  )).get();
  if (existingRequest) return sendError(reply, 400, 'friend_request_pending');

  const id = generateSnowflake(), now = Date.now();
  db.insert(schema.friendRequests).values({ id, fromId: request.userId, toId: targetUser.id, status: 'pending', createdAt: now }).run();
  const receivedPayload: FriendRequest = { id, fromId: request.userId, toId: targetUser.id, status: 'pending', createdAt: now, user: sanitizeUser(sender) };
  const sentPayload: FriendRequest = { ...receivedPayload, user: sanitizeUser(targetUser) };
  connectionManager.sendToUser(targetUser.id, { type: 'friend_request_received', request: receivedPayload });
  connectionManager.sendToUser(request.userId, { type: 'friend_request_sent', request: sentPayload });
  return reply.code(201).send({ success: true, requestId: id });
}

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/social/friends', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const friendRows = db.select().from(schema.friends).where(or(
      eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, request.userId),
    )).all();
    if (friendRows.length === 0) return reply.code(200).send([]);
    const friendIds = friendRows.map(f => f.userId === request.userId ? f.friendId : f.userId);
    const friendUsers = db.select().from(schema.users).where(or(...friendIds.map(id => eq(schema.users.id, id)))).all();
    const friends: Friend[] = friendUsers.map(user => ({
      ...sanitizeUser(user), addedAt: friendRows.find(f => f.userId === user.id || f.friendId === user.id)?.createdAt ?? Date.now(),
    }));
    return reply.code(200).send(friends);
  });

  app.get('/api/social/requests', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();
    const requests = db.select().from(schema.friendRequests).where(and(
      or(eq(schema.friendRequests.fromId, request.userId), eq(schema.friendRequests.toId, request.userId)),
      eq(schema.friendRequests.status, 'pending'),
    )).all();
    if (requests.length === 0) return reply.code(200).send([]);
    const ids = requests.map(row => row.fromId === request.userId ? row.toId : row.fromId);
    const users = db.select().from(schema.users).where(or(...ids.map(id => eq(schema.users.id, id)))).all();
    const userMap = new Map(users.map(user => [user.id, user]));
    const result: FriendRequest[] = requests.map(row => {
      const other = userMap.get(row.fromId === request.userId ? row.toId : row.fromId);
      return { id: row.id, fromId: row.fromId, toId: row.toId, status: 'pending', createdAt: row.createdAt, user: other ? sanitizeUser(other) : undefined };
    });
    return reply.code(200).send(result);
  });

  app.post<{ Body: SendFriendRequest }>('/api/social/requests', { preHandler: authenticate }, async (request, reply) => {
    const username = typeof request.body?.username === 'string' ? request.body.username.trim() : '';
    if (!username) return sendError(reply, 400, 'username_required');
    const db = getDb();
    const sender = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!sender || sender.isDeleted === 1) return sendError(reply, 401, 'unauthorized');
    if (sender.isBot === 1) return sendError(reply, 403, 'bots_native_only');
    return handleLocalFriendRequest(db, request, reply, findLocalUserByUsername(db, username), sender);
  });

  app.patch<{ Params: { id: string }; Body: UpdateFriendRequest }>('/api/social/requests/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params, { status } = request.body ?? {};
    if (status !== 'accepted' && status !== 'declined') return sendError(reply, 400, 'validation_failed');
    const db = getDb();
    const friendRequest = db.select().from(schema.friendRequests).where(eq(schema.friendRequests.id, id)).get();
    if (!friendRequest) return sendError(reply, 404, 'friend_request_not_found');
    if (friendRequest.toId !== request.userId) return sendError(reply, 403, 'friend_request_not_recipient');
    if (friendRequest.status !== 'pending') return sendError(reply, 400, 'friend_request_not_pending');

    if (status === 'accepted') {
      const now = Date.now();
      db.transaction(tx => {
        tx.insert(schema.friends).values({ userId: friendRequest.fromId, friendId: friendRequest.toId, createdAt: now }).run();
        tx.update(schema.friendRequests).set({ status }).where(eq(schema.friendRequests.id, id)).run();
      });
      const acceptingUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
      if (acceptingUser) {
        const friend: Friend = { ...sanitizeUser(acceptingUser), addedAt: now };
        connectionManager.sendToUser(friendRequest.fromId, { type: 'friend_request_accepted', friend, requestId: id });
      }
      exchangeFriendPresence(friendRequest.fromId, friendRequest.toId);
    } else {
      db.update(schema.friendRequests).set({ status }).where(eq(schema.friendRequests.id, id)).run();
      connectionManager.sendToUser(friendRequest.fromId, { type: 'friend_request_declined', requestId: id, userId: request.userId });
    }
    return reply.code(200).send({ success: true });
  });

  app.delete<{ Params: { id: string } }>('/api/social/requests/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params, db = getDb();
    const friendRequest = db.select().from(schema.friendRequests).where(eq(schema.friendRequests.id, id)).get();
    if (!friendRequest) return sendError(reply, 404, 'friend_request_not_found');
    if (friendRequest.fromId !== request.userId) return sendError(reply, 403, 'friend_request_not_sender');
    if (friendRequest.status !== 'pending') return sendError(reply, 400, 'friend_request_not_pending');
    db.delete(schema.friendRequests).where(eq(schema.friendRequests.id, id)).run();
    connectionManager.sendToUser(friendRequest.toId, { type: 'friend_request_cancelled', requestId: id, userId: request.userId });
    return reply.code(200).send({ success: true });
  });

  app.delete<{ Params: { id: string } }>('/api/social/friends/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params, db = getDb();
    const pair = or(
      and(eq(schema.friends.userId, request.userId), eq(schema.friends.friendId, id)),
      and(eq(schema.friends.userId, id), eq(schema.friends.friendId, request.userId)),
    );
    if (!db.select().from(schema.friends).where(pair).get()) return sendError(reply, 404, 'not_friends');
    db.delete(schema.friends).where(pair).run();
    connectionManager.sendToUser(id, { type: 'friend_removed', userId: request.userId });
    return reply.code(200).send({ success: true });
  });

  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>('/api/social/discover', {
    preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const db = getDb(), q = request.query.q?.trim() || '', myId = request.userId;
    const limit = Math.min(Math.max(parseInt(request.query.limit || '24', 10) || 24, 1), 100);
    const offset = Math.max(parseInt(request.query.offset || '0', 10) || 0, 0);
    const conditions = [eq(schema.users.discoverable, 1), eq(schema.users.isDeleted, 0), ne(schema.users.id, myId)];
    if (q) conditions.push(or(like(schema.users.username, `%${q}%`), like(schema.users.displayName, `%${q}%`))!);
    const total = db.select({ count: sql<number>`count(*)` }).from(schema.users).where(and(...conditions)).get()?.count ?? 0;
    if (total === 0) return reply.code(200).send({ users: [], total: 0 });

    const myFriendRows = db.select().from(schema.friends).where(or(eq(schema.friends.userId, myId), eq(schema.friends.friendId, myId))).all();
    const myFriendIds = new Set(myFriendRows.map(f => f.userId === myId ? f.friendId : f.userId));
    const mySpaceRows = db.select({ spaceId: schema.spaceMembers.spaceId }).from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, myId)).all();
    const mySpaceIds = new Set(mySpaceRows.map(s => s.spaceId));
    const outboundRequests = db.select().from(schema.friendRequests).where(and(eq(schema.friendRequests.fromId, myId), eq(schema.friendRequests.status, 'pending'))).all();
    const outboundMap = new Map(outboundRequests.map(r => [r.toId, r.id]));
    const inboundRequests = db.select().from(schema.friendRequests).where(and(eq(schema.friendRequests.toId, myId), eq(schema.friendRequests.status, 'pending'))).all();
    const inboundMap = new Map(inboundRequests.map(r => [r.fromId, r.id]));
    const userRows = db.select().from(schema.users).where(and(...conditions)).orderBy(sql`created_at DESC`).limit(limit).offset(offset).all();
    const pageUserIds = userRows.map(r => r.id);
    const pageFriendRows = pageUserIds.length > 0 ? db.select().from(schema.friends).where(or(
      inArray(schema.friends.userId, pageUserIds), inArray(schema.friends.friendId, pageUserIds),
    )).all() : [];
    const friendIdsByUser = new Map<string, Set<string>>();
    for (const f of pageFriendRows) {
      if (pageUserIds.includes(f.userId)) {
        if (!friendIdsByUser.has(f.userId)) friendIdsByUser.set(f.userId, new Set());
        friendIdsByUser.get(f.userId)!.add(f.friendId);
      }
      if (pageUserIds.includes(f.friendId)) {
        if (!friendIdsByUser.has(f.friendId)) friendIdsByUser.set(f.friendId, new Set());
        friendIdsByUser.get(f.friendId)!.add(f.userId);
      }
    }
    const pageSpaceMembers = pageUserIds.length > 0 ? db.select({ userId: schema.spaceMembers.userId, spaceId: schema.spaceMembers.spaceId })
      .from(schema.spaceMembers).where(inArray(schema.spaceMembers.userId, pageUserIds)).all() : [];
    const spaceIdsByUser = new Map<string, Set<string>>();
    for (const member of pageSpaceMembers) {
      if (!spaceIdsByUser.has(member.userId)) spaceIdsByUser.set(member.userId, new Set());
      spaceIdsByUser.get(member.userId)!.add(member.spaceId);
    }
    const users: DiscoverUser[] = userRows.map(row => {
      const user = sanitizeUser(row);
      const theirFriendIds = friendIdsByUser.get(row.id) ?? new Set<string>();
      const theirSpaceIds = spaceIdsByUser.get(row.id) ?? new Set<string>();
      let relationship: DiscoverUser['relationship'] = 'none', requestId: string | undefined;
      if (myFriendIds.has(row.id)) relationship = 'friends';
      else if (outboundMap.has(row.id)) { relationship = 'outbound_pending'; requestId = outboundMap.get(row.id); }
      else if (inboundMap.has(row.id)) { relationship = 'inbound_pending'; requestId = inboundMap.get(row.id); }
      return {
        id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, banner: user.banner,
        avatarColor: user.avatarColor, bio: user.bio, status: user.status, customStatus: user.customStatus, createdAt: user.createdAt, isBot: user.isBot,
        mutualFriendCount: [...myFriendIds].filter(id => theirFriendIds.has(id)).length,
        mutualSpaceCount: [...mySpaceIds].filter(id => theirSpaceIds.has(id)).length,
        relationship, ...(requestId ? { requestId } : {}),
      };
    });
    users.sort((a, b) => b.mutualFriendCount - a.mutualFriendCount || b.createdAt - a.createdAt);
    return reply.code(200).send({ users, total });
  });

  app.get<{ Querystring: { q: string } }>('/api/social/search', {
    preHandler: authenticate, config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { q } = request.query;
    if (!q || q.length < 1) return reply.code(200).send([]);
    const users = getDb().select().from(schema.users).where(and(
      eq(schema.users.isDeleted, 0), eq(schema.users.discoverable, 1), ne(schema.users.id, request.userId),
      or(like(schema.users.username, `%${q}%`), like(schema.users.displayName, `%${q}%`)),
    )).limit(10).all();
    return reply.code(200).send(users.map(user => sanitizeUser(user)));
  });
}
