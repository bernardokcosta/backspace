import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb, getRawDb, schema } from '../db/index.js';
import { authenticate } from '../utils/auth.js';
import { isMember, isBanned } from '../utils/permissions.js';
import { connectionManager } from '../ws/handler.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendError } from '../utils/httpErrors.js';
import { buildJoinedSpace } from '../utils/spaceJoinPayload.js';
import type { ExploreSpace, MemberWithUser } from '@backspace/shared';

export async function exploreRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>('/api/spaces/explore', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const db = getDb();
    const settings = db.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
    if (!settings || settings.discoveryEnabled === 0) {
      return reply.code(200).send({ spaces: [], total: 0, discoveryEnabled: false });
    }
    const q = request.query.q?.trim() ?? '';
    const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 100);
    const offset = Math.max(parseInt(request.query.offset ?? '0', 10) || 0, 0);
    const myMemberships = db.select({ spaceId: schema.spaceMembers.spaceId })
      .from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, request.userId)).all();
    const mySpaceIds = new Set(myMemberships.map(m => m.spaceId));
    const rawDb = getRawDb();
    const totalAllRow = rawDb.prepare(
      `SELECT COUNT(DISTINCT s.id) as total FROM spaces s WHERE s.visibility IN ('public', 'request')`
    ).get() as { total: number };
    let countSql = `SELECT COUNT(DISTINCT s.id) as total FROM spaces s WHERE s.visibility IN ('public', 'request')`;
    let querySql = `
      SELECT s.id, s.name, s.icon, s.banner, s.avatar_color, s.description, s.visibility, s.created_at,
             COUNT(sm.user_id) as member_count
      FROM spaces s
      LEFT JOIN space_members sm ON sm.space_id = s.id
      WHERE s.visibility IN ('public', 'request')
    `;
    const params: (string | number)[] = [];
    if (q) {
      const likePattern = `%${q}%`;
      querySql += ` AND (s.name LIKE ? COLLATE NOCASE OR s.description LIKE ? COLLATE NOCASE)`;
      countSql += ` AND (s.name LIKE ? COLLATE NOCASE OR s.description LIKE ? COLLATE NOCASE)`;
      params.push(likePattern, likePattern);
    }
    querySql += ` GROUP BY s.id ORDER BY member_count DESC, s.created_at DESC LIMIT ? OFFSET ?`;
    const totalRow = rawDb.prepare(countSql).get(...params) as { total: number };
    const rows = rawDb.prepare(querySql).all(...params, limit, offset) as {
      id: string; name: string; icon: string | null; banner: string | null; avatar_color: string | null;
      description: string | null; visibility: string; created_at: number; member_count: number;
    }[];
    const spaces: ExploreSpace[] = rows.map(r => ({
      id: r.id, name: r.name, icon: r.icon, banner: r.banner, avatarColor: (r.avatar_color as ExploreSpace['avatarColor']) ?? null,
      description: r.description, visibility: r.visibility as ExploreSpace['visibility'], memberCount: r.member_count,
      createdAt: r.created_at, joined: mySpaceIds.has(r.id),
    }));
    return reply.code(200).send({ spaces, total: totalRow.total, totalAll: totalAllRow.total, discoveryEnabled: true });
  });

  app.post<{ Params: { id: string } }>('/api/spaces/:id/public-join', {
    preHandler: authenticate,
  }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();
    const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, id)).get();
    if (!space) return sendError(reply, 404, 'space_not_found');
    if (space.visibility !== 'public') return sendError(reply, 403, 'space_not_public');
    if (isBanned(id, request.userId)) return sendError(reply, 403, 'user_banned');
    if (isMember(id, request.userId)) return sendError(reply, 409, 'already_member');
    const now = Date.now();
    db.insert(schema.spaceMembers).values({ spaceId: id, userId: request.userId, joinedAt: now }).run();
    connectionManager.addUserSpace(request.userId, id);
    const joiningUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (joiningUser) {
      const memberPayload: MemberWithUser = { spaceId: id, userId: request.userId, nickname: null,
        joinedAt: now, user: sanitizeUser(joiningUser), roles: [] };
      connectionManager.sendToSpace(id, { type: 'member_joined', spaceId: id, member: memberPayload });
    }
    const fullSpace = buildJoinedSpace(id, request.userId);
    if (!fullSpace) return sendError(reply, 500, 'space_load_failed');
    return reply.code(200).send(fullSpace);
  });
}
