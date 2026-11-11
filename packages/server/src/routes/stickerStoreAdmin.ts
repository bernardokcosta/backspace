import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate, requireAdmin } from '../utils/auth.js';
import { sendError } from '../utils/httpErrors.js';
import type { StickerPackStatus } from '@veyvox/shared/src/stickers.js';
import { formatCoverUrl } from './stickerStore.js';

export async function stickerStoreAdminRoutes(app: FastifyInstance): Promise<void> {
  // ─── Native pack moderation ─────────────────────────────────────────────

  /**
   * Admin: List sticker packs waiting for review.
   */
  app.get('/api/admin/sticker-packs/reviews', {
    preHandler: [authenticate, requireAdmin],
  }, async () => {
    const db = getDb();
    const pendingPackIds = db.select({ packId: schema.stickerPackVersions.packId }).from(schema.stickerPackVersions)
      .where(eq(schema.stickerPackVersions.status, 'pending_review')).all().map(v => v.packId);
    if (!pendingPackIds.length) return [];
    const packs = db.select().from(schema.stickerPacks)
      .where(and(inArray(schema.stickerPacks.id, pendingPackIds), inArray(schema.stickerPacks.status, ['pending_review', 'approved'])))
      .orderBy(desc(schema.stickerPacks.updatedAt))
      .all();

    return packs.map(pack => {
      const version = db.select().from(schema.stickerPackVersions)
        .where(and(
          eq(schema.stickerPackVersions.packId, pack.id),
          eq(schema.stickerPackVersions.status, 'pending_review'),
        )).get();

      const items = version ? db.select().from(schema.stickerPackItems)
        .where(and(
          eq(schema.stickerPackItems.versionId, version.id),
          eq(schema.stickerPackItems.status, 'active'),
        )).all() : [];

      return {
        id: pack.id,
        name: version?.name ?? pack.name,
        description: version ? version.description : pack.description,
        creatorId: pack.creatorId,
        creatorName: pack.creatorName,
        coverAssetId: version?.coverAssetId ?? null,
        coverUrl: formatCoverUrl(version?.coverAssetId ?? null),
        currentVersion: pack.currentVersion,
        editingVersion: version?.version,
        editingStatus: 'pending_review',
        status: 'pending_review' as const,
        itemCount: items.length,
        createdAt: pack.createdAt,
        updatedAt: pack.updatedAt,
      };
    });
  });

  /**
   * Admin: Approve a sticker pack and its pending version.
   */
  app.post<{ Params: { id: string } }>('/api/admin/sticker-packs/:id/approve', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const db = getDb();
    const pack = db.select().from(schema.stickerPacks).where(eq(schema.stickerPacks.id, request.params.id)).get();

    if (!pack || !['pending_review', 'approved'].includes(pack.status)) {
      return sendError(reply, 404, 'sticker_pack_not_found');
    }

    const pendingVersion = db.select().from(schema.stickerPackVersions)
      .where(and(
        eq(schema.stickerPackVersions.packId, pack.id),
        eq(schema.stickerPackVersions.status, 'pending_review'),
      )).get();

    const now = Date.now();
    if (!pendingVersion) return sendError(reply, 400, 'sticker_pack_invalid_state');
    db.transaction(() => {
      db.update(schema.stickerPackVersions).set({
        status: 'approved', reviewNotes: null, reviewedBy: request.userId, reviewedAt: now,
      }).where(eq(schema.stickerPackVersions.id, pendingVersion.id)).run();

      db.update(schema.stickerPacks).set({
        name: pendingVersion.name,
        description: pendingVersion.description,
        coverAssetId: pendingVersion.coverAssetId,
        currentVersion: pendingVersion.version,
        status: 'approved',
        reviewNotes: null,
        reviewedBy: request.userId,
        reviewedAt: now,
        updatedAt: now,
      }).where(eq(schema.stickerPacks.id, pack.id)).run();
    });

    return { success: true, status: 'approved' };
  });

  /**
   * Admin: Reject a sticker pack and its pending version.
   */
  app.post<{ Params: { id: string }; Body?: { reviewNotes?: string } }>('/api/admin/sticker-packs/:id/reject', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const db = getDb();
    const pack = db.select().from(schema.stickerPacks).where(eq(schema.stickerPacks.id, request.params.id)).get();

    if (!pack || !['pending_review', 'approved'].includes(pack.status)) {
      return sendError(reply, 404, 'sticker_pack_not_found');
    }

    const now = Date.now();
    const notes = request.body?.reviewNotes?.trim() || null;

    const pendingVersion = db.select().from(schema.stickerPackVersions)
      .where(and(
        eq(schema.stickerPackVersions.packId, pack.id),
        eq(schema.stickerPackVersions.status, 'pending_review'),
      )).get();

    if (!pendingVersion) return sendError(reply, 400, 'sticker_pack_invalid_state');
    const nextStatus = pack.status === 'approved' ? 'approved' : 'rejected';
    db.transaction(() => {
      db.update(schema.stickerPackVersions).set({
        status: 'rejected', reviewNotes: notes, reviewedBy: request.userId, reviewedAt: now,
      }).where(eq(schema.stickerPackVersions.id, pendingVersion.id)).run();

    db.update(schema.stickerPacks).set({
      status: nextStatus,
      ...(nextStatus === 'rejected' ? { reviewNotes: notes, reviewedBy: request.userId, reviewedAt: now } : {}),
      updatedAt: now,
    }).where(eq(schema.stickerPacks.id, pack.id)).run();
    });

    return { success: true, status: nextStatus };
  });

  /**
   * Admin: List all packs across all statuses.
   */
  app.get<{ Querystring: { status?: string; q?: string } }>('/api/admin/sticker-packs', {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const db = getDb();
    const { status, q } = request.query;

    const queryFilters = [];
    if (status) queryFilters.push(eq(schema.stickerPacks.status, status));

    const rows = queryFilters.length > 0
      ? db.select().from(schema.stickerPacks).where(and(...queryFilters)).orderBy(desc(schema.stickerPacks.updatedAt)).all()
      : db.select().from(schema.stickerPacks).orderBy(desc(schema.stickerPacks.updatedAt)).all();

    const filtered = q?.trim()
      ? rows.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()))
      : rows;

    return filtered.map(pack => {
      const version = db.select().from(schema.stickerPackVersions)
        .where(and(
          eq(schema.stickerPackVersions.packId, pack.id),
          eq(schema.stickerPackVersions.version, pack.currentVersion),
        )).get();

      const items = version ? db.select().from(schema.stickerPackItems)
        .where(and(
          eq(schema.stickerPackItems.versionId, version.id),
          eq(schema.stickerPackItems.status, 'active'),
        )).all() : [];

      return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        creatorId: pack.creatorId,
        creatorName: pack.creatorName,
        coverAssetId: pack.coverAssetId,
        coverUrl: formatCoverUrl(pack.coverAssetId),
        currentVersion: pack.currentVersion,
        status: pack.status as StickerPackStatus,
        itemCount: items.length,
        createdAt: pack.createdAt,
        updatedAt: pack.updatedAt,
      };
    });
  });

  /**
   * Admin: Set a sticker pack's administrative status (e.g. block / disable / active).
   */
  app.post<{ Params: { id: string }; Body: { status: 'approved' | 'blocked' | 'disabled' | 'active' } }>('/api/admin/sticker-packs/:id/status', {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const db = getDb();
    const pack = db.select().from(schema.stickerPacks).where(eq(schema.stickerPacks.id, request.params.id)).get();

    if (!pack) {
      return sendError(reply, 404, 'sticker_pack_not_found');
    }

    const { status } = request.body;
    if (!['approved', 'blocked', 'disabled', 'active'].includes(status)) {
      return sendError(reply, 400, 'validation_failed');
    }

    const now = Date.now();
    db.update(schema.stickerPacks).set({
      status,
      updatedAt: now,
    }).where(eq(schema.stickerPacks.id, pack.id)).run();

    return { success: true, status };
  });

}
