import type { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { eq, like, or, and, sql, gte, lte, asc, desc } from 'drizzle-orm';
import { authenticate, requireAdmin, hashPassword } from '../utils/auth.js';
import { getStorageStats, getOrphanedFiles, cleanupStorage, cleanupOldMedia, cleanupStaleTusSessions } from '../utils/storageJanitor.js';
import { getDb, schema } from '../db/index.js';
import { connectionManager } from '../ws/handler.js';
import { checkVoicePermissions } from '../ws/events.js';
import { tombstoneUser, collectDeletionBroadcastTargets } from '../utils/userDeletion.js';
import { deleteUnreferencedUploadFiles } from '../utils/fileCleanup.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { sendError, ERROR_MESSAGES } from '../utils/httpErrors.js';
import type { AdminUser, AdminUserListResponse, AdminResetPasswordResponse } from '@veyvox/shared';

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toAdminUser(row: typeof schema.users.$inferSelect): AdminUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatar: row.avatar,
    avatarColor: row.avatarColor,
    status: row.status ?? 'offline',
    isAdmin: row.isAdmin === 1,
    isBot: row.isBot === 1,
    isDeleted: row.isDeleted === 1,
    createdAt: row.createdAt,
  };
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ─── Storage Management ──────────────────────────────────────────────────

  // GET /api/admin/storage/stats — storage overview
  app.get('/api/admin/storage/stats', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    try {
      const stats = getStorageStats();
      return reply.code(200).send(stats);
    } catch (err: unknown) {
      return sendError(reply, 500, 'storage_stats_failed', { reason: reasonOf(err) });
    }
  });

  // GET /api/admin/storage/orphans — list orphaned files
  app.get('/api/admin/storage/orphans', { preHandler: [authenticate, requireAdmin] }, async (_request, reply) => {
    try {
      const orphans = getOrphanedFiles();
      return reply.code(200).send({ orphans });
    } catch (err: unknown) {
      return sendError(reply, 500, 'storage_orphans_failed', { reason: reasonOf(err) });
    }
  });

  // POST /api/admin/storage/cleanup — delete orphaned files
  app.post<{ Body: { dryRun?: boolean } }>('/api/admin/storage/cleanup', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const dryRun = request.body?.dryRun ?? false;
      const result = cleanupStorage(dryRun);
      return reply.code(200).send(result);
    } catch (err: unknown) {
      return sendError(reply, 500, 'storage_cleanup_failed', { reason: reasonOf(err) });
    }
  });

  // POST /api/admin/storage/cleanup-media — delete chat media older than N days
  app.post<{ Body: { maxAgeDays: number; dryRun?: boolean } }>('/api/admin/storage/cleanup-media', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const maxAgeDays = Number(request.body?.maxAgeDays);
      if (isNaN(maxAgeDays) || maxAgeDays < 1) {
        return sendError(reply, 400, 'cleanup_age_invalid', { field: 'maxAgeDays' });
      }
      const dryRun = request.body?.dryRun ?? false;
      const result = cleanupOldMedia(maxAgeDays, dryRun);
      return reply.code(200).send(result);
    } catch (err: unknown) {
      return sendError(reply, 500, 'media_cleanup_failed', { reason: reasonOf(err) });
    }
  });

  // POST /api/admin/storage/cleanup-tus — admin-driven sweep of stale tus
  // upload sessions. Defaults: maxAgeHours=1 (matches the staleTusSessions
  // display threshold), dryRun=false. Per-file unlink errors are surfaced via
  // CleanupResult.errors. No DB rows touched — `.tus/` is filesystem-only.
  app.post<{ Body: { maxAgeHours?: number; dryRun?: boolean } }>('/api/admin/storage/cleanup-tus', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    try {
      const rawAge = request.body?.maxAgeHours;
      const maxAgeHours = rawAge === undefined ? 1 : Number(rawAge);
      if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
        return sendError(reply, 400, 'cleanup_age_invalid', { field: 'maxAgeHours' });
      }
      const dryRun = request.body?.dryRun ?? false;
      const thresholdMs = maxAgeHours * 60 * 60 * 1000;
      const result = cleanupStaleTusSessions(thresholdMs, dryRun);
      return reply.code(200).send({
        dryRun,
        deletedFiles: result.deletedFiles,
        freedBytes: result.freedBytes,
        deletedAttachmentRecords: 0,
        errors: result.errors,
      });
    } catch (err: unknown) {
      return sendError(reply, 500, 'upload_session_cleanup_failed', { reason: reasonOf(err) });
    }
  });

  // ─── User Management ────────────────────────────────────────────────────

  // GET /api/admin/users — paginated user list with search
  app.get<{ Querystring: { q?: string; page?: string; pageSize?: string; showDeleted?: string; role?: string; joinedAfter?: string; joinedBefore?: string; sort?: string } }>(
    '/api/admin/users',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const db = getDb();
      const q = request.query.q?.trim() || '';
      const page = Math.max(1, parseInt(request.query.page || '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize || '50', 10) || 50));
      const showDeleted = request.query.showDeleted === 'true';

      const conditions = [];
      if (!showDeleted) {
        conditions.push(eq(schema.users.isDeleted, 0));
      }
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(or(
          like(schema.users.username, pattern),
          like(schema.users.displayName, pattern),
        )!);
      }

      // Role filter
      const roleFilter = request.query.role;
      if (roleFilter === 'admin') {
        conditions.push(eq(schema.users.isAdmin, 1));
      } else if (roleFilter === 'non-admin') {
        conditions.push(eq(schema.users.isAdmin, 0));
      } else if (roleFilter === 'bot') {
        conditions.push(eq(schema.users.isBot, 1));
      }

      // Date range filter
      const joinedAfter = request.query.joinedAfter;
      if (joinedAfter) {
        const ts = new Date(joinedAfter).getTime();
        if (!isNaN(ts)) conditions.push(gte(schema.users.createdAt, ts));
      }
      const joinedBefore = request.query.joinedBefore;
      if (joinedBefore) {
        const ts = new Date(joinedBefore + 'T23:59:59.999Z').getTime();
        if (!isNaN(ts)) conditions.push(lte(schema.users.createdAt, ts));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      // Dynamic sort
      const sortParam = request.query.sort || 'newest';
      let orderByClause;
      switch (sortParam) {
        case 'oldest': orderByClause = asc(schema.users.createdAt); break;
        case 'az': orderByClause = asc(schema.users.username); break;
        case 'za': orderByClause = desc(schema.users.username); break;
        default: orderByClause = desc(schema.users.createdAt); break;
      }

      const countResult = db.select({ count: sql<number>`count(*)` })
        .from(schema.users)
        .where(where)
        .get();
      const total = countResult?.count ?? 0;

      const rows = db.select()
        .from(schema.users)
        .where(where)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .all();

      const response: AdminUserListResponse = {
        users: rows.map(toAdminUser),
        total,
        page,
        pageSize,
      };

      return reply.code(200).send(response);
    },
  );

  // PATCH /api/admin/users/:id/role — promote/demote admin
  app.patch<{ Params: { id: string }; Body: { isAdmin: boolean } }>(
    '/api/admin/users/:id/role',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const { id: targetId } = request.params;
      const { isAdmin } = request.body;

      if (typeof isAdmin !== 'boolean') {
        return sendError(reply, 400, 'field_not_boolean', { field: 'isAdmin' });
      }

      const db = getDb();
      const target = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get();
      if (!target) {
        return sendError(reply, 404, 'user_not_found');
      }
      if (target.isDeleted === 1) {
        return sendError(reply, 400, 'deleted_user_role_change');
      }

      // Demote: prevent removing the last admin
      if (!isAdmin && target.isAdmin === 1) {
        const adminCount = db.select({ count: sql<number>`count(*)` })
          .from(schema.users)
          .where(and(eq(schema.users.isAdmin, 1), eq(schema.users.isDeleted, 0)))
          .get();
        if ((adminCount?.count ?? 0) <= 1) {
          return sendError(reply, 400, 'last_admin_cannot_be_demoted');
        }
      }

      db.update(schema.users)
        .set({ isAdmin: isAdmin ? 1 : 0 })
        .where(eq(schema.users.id, targetId))
        .run();

      const updated = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get()!;

      // Broadcast user_updated so the target's UI reflects the isAdmin change
      connectionManager.sendToUser(targetId, {
        type: 'user_updated',
        user: sanitizeUser(updated),
      });

      // An instance admin holds every permission in every space on this
      // instance, so the target's own permissions changed in each space they
      // belong to. Nobody else's did: only the target refetches those spaces.
      if (target.isAdmin !== updated.isAdmin) {
        const spaceIds = db.select({ spaceId: schema.spaceMembers.spaceId })
          .from(schema.spaceMembers)
          .where(eq(schema.spaceMembers.userId, targetId))
          .all()
          .map(m => m.spaceId);
        connectionManager.announceUserAccessChange(targetId, spaceIds);
        for (const spaceId of spaceIds) checkVoicePermissions(spaceId);
      }

      return reply.code(200).send(toAdminUser(updated));
    },
  );

  // POST /api/admin/users/:id/reset-password — generate temporary password
  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/reset-password',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const { id: targetId } = request.params;
      const db = getDb();

      const target = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get();
      if (!target) {
        return sendError(reply, 404, 'user_not_found');
      }
      if (target.isDeleted === 1) {
        return sendError(reply, 400, 'deleted_user_password_reset');
      }

      const temporaryPassword = crypto.randomBytes(12).toString('base64url');
      const hash = await hashPassword(temporaryPassword);

      db.update(schema.users)
        .set({ passwordHash: hash, passwordChangedAt: Date.now() })
        .where(eq(schema.users.id, targetId))
        .run();

      // Force re-auth by disconnecting all sessions
      connectionManager.forceDisconnectUser(targetId);

      const response: AdminResetPasswordResponse = { temporaryPassword };
      return reply.code(200).send(response);
    },
  );

  // DELETE /api/admin/users/:id — tombstone a user account.
  app.delete<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: [authenticate, requireAdmin] },
    async (request, reply) => {
      const { id: targetId } = request.params;
      const db = getDb();

      if (targetId === request.userId) {
        return sendError(reply, 400, 'admin_cannot_delete_self');
      }

      const target = db.select().from(schema.users).where(eq(schema.users.id, targetId)).get();
      if (!target) {
        return sendError(reply, 404, 'user_not_found');
      }
      if (target.isDeleted === 1) {
        return sendError(reply, 400, 'user_already_deleted');
      }

      // Check if user owns any spaces
      const ownedSpaces = db.select({ id: schema.spaces.id, name: schema.spaces.name })
        .from(schema.spaces)
        .where(eq(schema.spaces.ownerId, targetId))
        .all();
      if (ownedSpaces.length > 0) {
        // Carries the list of spaces on top of the shared error shape, so the
        // panel can name them; sendError has no slot for extra fields.
        return reply.code(400).send({
          error: ERROR_MESSAGES.user_owns_spaces,
          code: 'user_owns_spaces',
          statusCode: 400,
          ownedSpaces,
        });
      }

      // Collect broadcast targets BEFORE tombstone deletes DB rows
      const { memberSpaceIds, targetUserIds } = collectDeletionBroadcastTargets(targetId);

      const filesToDelete = tombstoneUser(targetId);
      deleteUnreferencedUploadFiles(filesToDelete);

      // Broadcast member_left to each space
      for (const spaceId of memberSpaceIds) {
        connectionManager.sendToSpace(spaceId, {
          type: 'member_left',
          spaceId,
          userId: targetId,
        });
      }

      // Broadcast user_updated with sanitized deleted user data
      const deletedRow = getDb().select().from(schema.users).where(eq(schema.users.id, targetId)).get();
      if (deletedRow) {
        const deletedUser = sanitizeUser(deletedRow);
        const userUpdatedEvent = { type: 'user_updated' as const, user: deletedUser };
        for (const uid of targetUserIds) {
          connectionManager.sendToUser(uid, userUpdatedEvent);
        }
      }

      connectionManager.forceDisconnectUser(targetId);

      return reply.code(200).send({ success: true });
    },
  );

}
