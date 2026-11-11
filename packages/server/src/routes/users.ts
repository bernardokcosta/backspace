import type { FastifyInstance } from 'fastify';
import { sendError, errorText } from '../utils/httpErrors';
import { eq, or, and, inArray, isNull } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { authenticate, verifyPassword, hashPassword, signJwt } from '../utils/auth.js';
import { connectionManager } from '../ws/handler.js';
import type { UpdateUserRequest, VerifyPasswordRequest, VerifyPasswordResponse, ChangePasswordRequest, ChangePasswordResponse, DeleteAccountRequest, SpaceLayoutItem, SpaceFolder } from '@veyvox/shared';
import { AVATAR_COLORS, isChosenUserStatus, type ChosenUserStatus } from '@veyvox/shared';
import { PASSWORD_MIN_LENGTH, PROFILE_BIO_MAX_LENGTH } from '@veyvox/shared/src/constants.js';
import { sanitizeUser } from '../utils/sanitize.js';
import { applyChosenStatus } from '../ws/presence.js';
import { presenceUpdateFor } from '../ws/presenceEvent.js';
import { deleteAttachmentByFilename, isOwnLooseUpload, isValidAssetUrl, normalizeAssetUrl,
  getProfileReferencedFilenames, deleteUnreferencedUploadFiles } from '../utils/fileCleanup.js';
import { tombstoneUser, collectDeletionBroadcastTargets, collectProfileBroadcastTargetIds } from '../utils/userDeletion.js';
import { generateSnowflake } from '../utils/snowflake.js';
import { resizeProfileImage } from '../utils/thumbnail.js';
import { config } from '../config.js';
import path from 'path';

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/users/@me', { preHandler: authenticate }, async (request, reply) => {
    const db = getDb();

    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user || user.isDeleted) {
      return sendError(reply, 401, 'account_deleted');
    }

    return reply.code(200).send(sanitizeUser(user, true));
  });

  // POST /api/users/@me/verify-password — verify password matches current account
  app.post<{ Body: VerifyPasswordRequest }>('/api/users/@me/verify-password', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '2 minutes' } },
  }, async (request, reply) => {
    const { password } = request.body ?? {};

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) {
      return sendError(reply, 404, 'user_not_found');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    const response: VerifyPasswordResponse = { valid };
    return reply.code(200).send(response);
  });

  // POST /api/users/@me/change-password — change account password
  app.post<{ Body: ChangePasswordRequest }>('/api/users/@me/change-password', {
    preHandler: authenticate,
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body ?? {};

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < PASSWORD_MIN_LENGTH) {
      return sendError(reply, 400, 'password_too_short', { min: PASSWORD_MIN_LENGTH });
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) {
      return sendError(reply, 404, 'user_not_found');
    }

    if (!currentPassword || typeof currentPassword !== 'string') {
      return sendError(reply, 400, 'password_required');
    }
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return sendError(reply, 403, 'current_password_incorrect');
    }

    const newHash = await hashPassword(newPassword);
    const passwordChangedAt = Math.max(Date.now(), (user.passwordChangedAt ?? 0) + 1);
    // The async verification/hash work cannot overwrite a later reset or issue
    // a new session after deletion. Compare the credential epoch atomically.
    const changed = db.update(schema.users).set({ passwordHash: newHash, passwordChangedAt }).where(and(
      eq(schema.users.id, request.userId), or(eq(schema.users.isDeleted, 0), isNull(schema.users.isDeleted)), eq(schema.users.passwordHash, user.passwordHash),
      user.passwordChangedAt === null ? isNull(schema.users.passwordChangedAt) : eq(schema.users.passwordChangedAt, user.passwordChangedAt),
    )).run();
    if (changed.changes !== 1) return sendError(reply, 401, 'unauthorized');

    // Issue fresh JWT
    const token = signJwt({ userId: user.id, username: user.username, iat: passwordChangedAt / 1000 });
    connectionManager.forceDisconnectUser(user.id);
    const response: ChangePasswordResponse = { token };
    return reply.code(200).send(response);
  });

  // DELETE /api/users/@me — delete (tombstone) account
  app.delete<{ Body: DeleteAccountRequest }>('/api/users/@me', {
    preHandler: authenticate,
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
  }, async (request, reply) => {
    const { password, username } = request.body ?? {};

    if (!username || typeof username !== 'string') {
      return sendError(reply, 400, 'username_confirmation_required');
    }

    const db = getDb();
    const user = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!user) {
      return sendError(reply, 404, 'user_not_found');
    }

    // Verify username matches (confirmation safeguard)
    if (user.username !== username) {
      return sendError(reply, 400, 'username_confirmation_mismatch');
    }

    if (!password || typeof password !== 'string') {
      return sendError(reply, 400, 'password_required');
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return sendError(reply, 403, 'account_deletion_password_incorrect');
    }

    // Check if user owns any spaces
    const ownedSpaces = db.select({ id: schema.spaces.id, name: schema.spaces.name })
      .from(schema.spaces)
      .where(eq(schema.spaces.ownerId, request.userId))
      .all();
    if (ownedSpaces.length > 0) {
      // Not sendError: the dialog needs the list of spaces next to the code.
      return reply.code(400).send({
        error: errorText('account_deletion_blocked_owned_spaces'),
        code: 'account_deletion_blocked_owned_spaces',
        statusCode: 400,
        ownedSpaces,
      });
    }

    // Collect broadcast targets BEFORE tombstone deletes DB rows
    const { memberSpaceIds, targetUserIds } = collectDeletionBroadcastTargets(request.userId);

    // Tombstone the account (transaction handles all DB cleanup)
    const filesToDelete = tombstoneUser(request.userId);

    // Clean up files from disk after transaction commits
    deleteUnreferencedUploadFiles(filesToDelete);

    // Broadcast member_left to each space
    for (const spaceId of memberSpaceIds) {
      connectionManager.sendToSpace(spaceId, {
        type: 'member_left',
        spaceId,
        userId: request.userId,
      });
    }

    // Broadcast user_updated with sanitized deleted user data
    const deletedRow = getDb().select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (deletedRow) {
      const deletedUser = sanitizeUser(deletedRow);
      const userUpdatedEvent = { type: 'user_updated' as const, user: deletedUser };
      for (const uid of targetUserIds) {
        connectionManager.sendToUser(uid, userUpdatedEvent);
      }
    }

    // Force-close all WebSocket connections
    connectionManager.forceDisconnectUser(request.userId);

    return reply.code(200).send({ success: true });
  });

  app.patch<{ Body: UpdateUserRequest }>('/api/users/@me', { preHandler: authenticate }, async (request, reply) => {
    const { displayName, avatar, banner, accentColor, avatarColor, bio, customStatus, status, discoverable, showActivity, developerMode } = request.body ?? {};
    const db = getDb();

    const updateData: Record<string, string | null | undefined> = {};

    // Fetch the verified local account before validating owner-only bot fields.
    const DURABLE_PROFILE_FIELDS = ['displayName', 'avatar', 'banner', 'accentColor', 'avatarColor', 'bio'] as const;
    const preUpdateUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!preUpdateUser) {
      return sendError(reply, 404, 'user_not_found');
    }

    // A bot's profile belongs to its owner (PATCH /api/bots/:id). Its own token
    // must not rename it: profile fields are owner-only.
    if (preUpdateUser.isBot === 1) {
      const touchesProfile = DURABLE_PROFILE_FIELDS.some(f => (request.body as Record<string, unknown>)[f] !== undefined);
      if (touchesProfile) {
        return sendError(reply, 403, 'bot_profile_owner_only');
      }
    }

    if (displayName !== undefined) {
      if (displayName !== null && typeof displayName === 'string') {
        const trimmed = displayName.trim();
        if (trimmed.length > 32) {
          return sendError(reply, 400, 'display_name_too_long', { max: 32 });
        }
        updateData.displayName = trimmed || null;
      } else {
        updateData.displayName = null;
      }
    }

    const oldAvatar = normalizeAssetUrl(preUpdateUser.avatar);
    const oldBanner = normalizeAssetUrl(preUpdateUser.banner);

    if (avatar !== undefined) {
      if (!isValidAssetUrl(avatar)) {
        return sendError(reply, 400, 'avatar_url_invalid');
      }
      updateData.avatar = normalizeAssetUrl(avatar);
    }

    if (banner !== undefined) {
      if (!isValidAssetUrl(banner)) {
        return sendError(reply, 400, 'banner_url_invalid');
      }
      updateData.banner = normalizeAssetUrl(banner);
    }

    const newImages: Array<{ filename: string; kind: 'avatar' | 'banner' }> = [];
    if (avatar !== undefined || banner !== undefined) {
      const referenced = getProfileReferencedFilenames();
      for (const field of ['avatar', 'banner'] as const) {
        const filename = updateData[field], old = field === 'avatar' ? oldAvatar : oldBanner;
        if (!filename || filename === old || filename.startsWith('http://') || filename.startsWith('https://')) continue;
        if (!isOwnLooseUpload(filename, request.userId) || referenced.has(filename) || newImages.some(image => image.filename === filename)) {
          return sendError(reply, 400, field === 'avatar' ? 'avatar_url_invalid' : 'banner_url_invalid');
        }
        newImages.push({ filename, kind: field });
      }
    }

    if (accentColor !== undefined) {
      if (accentColor && typeof accentColor === 'string' && accentColor.trim().length > 0) {
        const hex = accentColor.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
          return sendError(reply, 400, 'accent_color_invalid');
        }
        updateData.accentColor = hex;
      } else {
        updateData.accentColor = null;
      }
    }

    if (avatarColor !== undefined) {
      if (avatarColor && typeof avatarColor === 'string' && avatarColor.trim().length > 0) {
        const trimmed = avatarColor.trim();
        if (!(AVATAR_COLORS as readonly string[]).includes(trimmed)) {
          return sendError(reply, 400, 'avatar_color_invalid');
        }
        updateData.avatarColor = trimmed;
      } else {
        updateData.avatarColor = null;
      }
    }

    if (bio !== undefined) {
      if (bio && typeof bio === 'string') {
        const trimmed = bio.trim();
        if (trimmed.length > PROFILE_BIO_MAX_LENGTH) {
          return sendError(reply, 400, 'bio_too_long', { max: PROFILE_BIO_MAX_LENGTH });
        }
        updateData.bio = trimmed || null;
      } else {
        updateData.bio = null;
      }
    }

    if (customStatus !== undefined) {
      if (customStatus !== null && typeof customStatus === 'string') {
        const trimmed = customStatus.trim();
        if (trimmed.length > 128) {
          return sendError(reply, 400, 'custom_status_too_long', { max: 128 });
        }
        updateData.customStatus = trimmed || null;
      } else {
        updateData.customStatus = null;
      }
    }

    // A status is a choice among online/idle/dnd; 'offline' only ever means
    // "no connection" and is not something a user can pick. It is applied
    // after the row update below, through applyChosenStatus.
    let chosenStatus: ChosenUserStatus | undefined;
    if (status !== undefined) {
      if (!isChosenUserStatus(status)) {
        return sendError(reply, 400, 'status_invalid');
      }
      chosenStatus = status;
    }

    if (discoverable !== undefined) {
      if (typeof discoverable !== 'boolean') {
        return sendError(reply, 400, 'validation_failed', { field: 'discoverable', reason: 'must be a boolean' });
      }
      (updateData as Record<string, unknown>).discoverable = discoverable ? 1 : 0;
    }

    if (showActivity !== undefined) {
      if (typeof showActivity !== 'boolean') {
        return sendError(reply, 400, 'validation_failed', { field: 'showActivity', reason: 'must be a boolean' });
      }
      (updateData as Record<string, unknown>).showActivity = showActivity ? 1 : 0;
    }

    if (developerMode !== undefined) {
      if (typeof developerMode !== 'boolean') {
        return sendError(reply, 400, 'validation_failed', { field: 'developerMode', reason: 'must be a boolean' });
      }
      (updateData as Record<string, unknown>).developerMode = developerMode ? 1 : 0;
    }

    if (Object.keys(updateData).length === 0 && chosenStatus === undefined) {
      return sendError(reply, 400, 'no_fields_to_update');
    }

    // Detect profile changes and stamp timestamp
    const hasProfileChange = ['displayName', 'avatar', 'banner', 'accentColor', 'avatarColor', 'bio', 'customStatus'].some(f => f in updateData);
    const hasDurableChange = DURABLE_PROFILE_FIELDS.some(f => f in updateData);
    if (hasDurableChange) {
      (updateData as Record<string, unknown>).profileUpdatedAt = Date.now();
    }

    if (Object.keys(updateData).length > 0) {
      db.update(schema.users).set(updateData).where(eq(schema.users.id, request.userId)).run();
    }
    // Writes chosen_status (and the live status while connected), then tells
    // local observers.
    if (chosenStatus !== undefined) applyChosenStatus(request.userId, chosenStatus);

    // Update activity visibility cache and broadcast clear when toggled off
    if (showActivity !== undefined) {
      connectionManager.setUserShowActivity(request.userId, showActivity);
      if (!showActivity) {
        connectionManager.clearUserActivities(request.userId);
        const clearPayload = presenceUpdateFor(request.userId, connectionManager.getUserStatus(request.userId), []);
        const clearTargets = collectProfileBroadcastTargetIds(request.userId);
        for (const uid of clearTargets) connectionManager.sendToUser(uid, clearPayload);
        connectionManager.sendToUser(request.userId, clearPayload);

      }
    }

    // Claim uploads before any asynchronous resize: a message cannot claim the
    // same attachment after its reference has moved to this native profile.
    for (const image of newImages) deleteAttachmentByFilename(image.filename);
    if (avatar !== undefined || banner !== undefined) {
      const replaced: string[] = [];
      for (const field of ['avatar', 'banner'] as const) {
        const old = field === 'avatar' ? oldAvatar : oldBanner;
        if (updateData[field] !== undefined && old && old !== updateData[field]) replaced.push(old);
      }
      deleteUnreferencedUploadFiles(replaced);
    }
    for (const image of newImages) await resizeProfileImage(path.join(config.uploadDir, image.filename), image.kind);

    const updatedUser = db.select().from(schema.users).where(eq(schema.users.id, request.userId)).get();
    if (!updatedUser) {
      return sendError(reply, 404, 'user_not_found');
    }

    const sanitized = sanitizeUser(updatedUser, true);

    // Developer Mode is private to the account: only its own sockets hear of it,
    // so another device switches the Bots tab without a reload.
    if (developerMode !== undefined && !hasProfileChange) {
      connectionManager.sendToUser(sanitized.id, { type: 'user_updated' as const, user: sanitized });
    }

    // Broadcast user_updated for profile field changes
    if (hasProfileChange) {
      const targetUserIds = collectProfileBroadcastTargetIds(sanitized.id);
      targetUserIds.add(sanitized.id); // Include self (for other tabs/connections)
      for (const uid of targetUserIds) {
        connectionManager.sendToUser(uid, { type: 'user_updated', user: uid === sanitized.id ? sanitized : sanitizeUser(updatedUser) });
      }
    }

    return reply.code(200).send(sanitized);
  });

  // PUT /api/users/@me/space-layout — save sidebar layout (reorder, folders)
  app.put<{ Body: { items: SpaceLayoutItem[]; folders: Record<string, { name: string | null; color: string | null; spaceIds: string[] }>; updatedAt?: number } }>(
    '/api/users/@me/space-layout', { preHandler: authenticate }, async (request, reply) => {
    const { items, folders, updatedAt: incomingTs } = request.body ?? {};
    const userId = request.userId;

    if (!Array.isArray(items)) {
      return sendError(reply, 400, 'validation_failed', { field: 'items', reason: 'must be an array' });
    }
    if (!folders || typeof folders !== 'object' || Array.isArray(folders)) {
      return sendError(reply, 400, 'validation_failed', { field: 'folders', reason: 'must be an object' });
    }
    if (incomingTs !== undefined && (typeof incomingTs !== 'number' || !Number.isSafeInteger(incomingTs) || incomingTs < 0)) {
      return sendError(reply, 400, 'validation_failed', { field: 'updatedAt', reason: 'must be a nonnegative safe integer' });
    }

    // Validate items
    for (const item of items) {
      if (!item || (item.t !== 's' && item.t !== 'f') || typeof item.id !== 'string' || !item.id) {
        return sendError(reply, 400, 'validation_failed', { field: 'items', reason: 'each item needs t ("s" or "f") and an id string' });
      }
    }

    // Validate folders
    for (const [key, folder] of Object.entries(folders)) {
      if (!folder || typeof folder !== 'object' || Array.isArray(folder) || !Array.isArray(folder.spaceIds)
          || folder.spaceIds.some(id => typeof id !== 'string' || !id)
          || new Set(folder.spaceIds).size !== folder.spaceIds.length) {
        return sendError(reply, 400, 'validation_failed', { field: `folders.${key}.spaceIds`, reason: 'must be an array' });
      }
      if ((folder.name !== null && typeof folder.name !== 'string') || (folder.color !== null && typeof folder.color !== 'string')) {
        return sendError(reply, 400, 'validation_failed', { field: `folders.${key}`, reason: 'name and color must be strings or null' });
      }
    }

    const db = getDb();

    // LWW guard: reject stale layout writes
    if (incomingTs !== undefined && typeof incomingTs === 'number') {
      const existingLayout = db.select().from(schema.userSpaceLayout)
        .where(eq(schema.userSpaceLayout.userId, userId)).get();
      if (existingLayout && incomingTs < existingLayout.updatedAt) {
        // Incoming layout is older — return current state without updating
        const currentItems: SpaceLayoutItem[] = JSON.parse(existingLayout.layout);
        const currentFolderRows = db.select().from(schema.spaceFolders)
          .where(eq(schema.spaceFolders.userId, userId))
          .orderBy(schema.spaceFolders.position)
          .all();
        const currentFolders: SpaceFolder[] = currentFolderRows.map(folder => {
          const memberRows = db.select()
            .from(schema.spaceFolderMembers)
            .where(eq(schema.spaceFolderMembers.folderId, folder.id))
            .orderBy(schema.spaceFolderMembers.position)
            .all();
          return {
            id: folder.id,
            userId: folder.userId,
            name: folder.name,
            color: folder.color,
            position: folder.position ?? 0,
            spaceIds: memberRows.map(m => m.spaceId),
          };
        });
        return reply.code(200).send({ items: currentItems, folders: currentFolders, updatedAt: existingLayout.updatedAt });
      }
    }

    // Native layouts may only name the caller's memberships and owned folders.
    // new:* is the sole creation path; client-chosen IDs are not imported.
    const ownedFolderIds = new Set(db.select({ id: schema.spaceFolders.id }).from(schema.spaceFolders)
      .where(eq(schema.spaceFolders.userId, userId)).all().map(folder => folder.id));
    const memberSpaceIds = new Set(db.select({ id: schema.spaceMembers.spaceId }).from(schema.spaceMembers)
      .where(eq(schema.spaceMembers.userId, userId)).all().map(member => member.id));
    for (const [key, folder] of Object.entries(folders)) {
      if ((!key.startsWith('new:') && !ownedFolderIds.has(key)) || key === 'new:'
          || folder.spaceIds.some(id => !memberSpaceIds.has(id))) {
        return sendError(reply, 400, 'validation_failed', { field: 'folders', reason: 'folder or space is not owned by this account' });
      }
    }
    if (items.some(item => item.t === 's' ? !memberSpaceIds.has(item.id) : !Object.hasOwn(folders, item.id))) {
      return sendError(reply, 400, 'validation_failed', { field: 'items', reason: 'contains an unavailable space or folder' });
    }

    // Resolve the effective timestamp for this write
    const effectiveTs = (incomingTs !== undefined && typeof incomingTs === 'number') ? incomingTs : Date.now();

    // Map new:* folder keys to server-generated IDs
    const newIdMap = new Map<string, string>();
    for (const key of Object.keys(folders)) {
      if (key.startsWith('new:')) {
        newIdMap.set(key, generateSnowflake());
      }
    }

    db.transaction((tx) => {
      // Get existing folder IDs for this user
      const existingFolders = tx.select({ id: schema.spaceFolders.id })
        .from(schema.spaceFolders)
        .where(eq(schema.spaceFolders.userId, userId))
        .all();
      const existingFolderIds = new Set(existingFolders.map(f => f.id));

      // Determine which folders to keep (ones in the request, with resolved IDs)
      const keepFolderIds = new Set<string>();
      for (const [key, folder] of Object.entries(folders)) {
        const resolvedId = newIdMap.get(key) ?? key;
        keepFolderIds.add(resolvedId);

        if (key.startsWith('new:')) {
          // Create new folder
          tx.insert(schema.spaceFolders).values({
            id: resolvedId,
            userId,
            name: folder.name,
            color: folder.color,
            position: 0,
            createdAt: Date.now(),
          }).run();
        } else if (existingFolderIds.has(key)) {
          // Update existing folder
          tx.update(schema.spaceFolders)
            .set({ name: folder.name, color: folder.color })
            .where(and(eq(schema.spaceFolders.id, key), eq(schema.spaceFolders.userId, userId)))
            .run();
        }

        // Clear and re-insert folder members with position
        tx.delete(schema.spaceFolderMembers)
          .where(eq(schema.spaceFolderMembers.folderId, resolvedId))
          .run();

        for (let i = 0; i < folder.spaceIds.length; i++) {
          const spaceId = folder.spaceIds[i];
          if (!spaceId) continue;
          tx.insert(schema.spaceFolderMembers).values({
            folderId: resolvedId,
            spaceId,
            position: i,
          }).run();
        }
      }

      // Delete folders that are no longer in the request
      for (const existingId of existingFolderIds) {
        if (!keepFolderIds.has(existingId)) {
          tx.delete(schema.spaceFolderMembers)
            .where(eq(schema.spaceFolderMembers.folderId, existingId))
            .run();
          tx.delete(schema.spaceFolders)
            .where(and(eq(schema.spaceFolders.id, existingId), eq(schema.spaceFolders.userId, userId)))
            .run();
        }
      }

      // Replace new:* keys in items array with server-generated IDs
      const finalItems: SpaceLayoutItem[] = items.map(item => {
        if (item.t === 'f' && newIdMap.has(item.id)) {
          return { t: 'f' as const, id: newIdMap.get(item.id)! };
        }
        return item;
      });

      // Upsert user_space_layout
      const existing = tx.select().from(schema.userSpaceLayout)
        .where(eq(schema.userSpaceLayout.userId, userId)).get();
      if (existing) {
        tx.update(schema.userSpaceLayout)
          .set({ layout: JSON.stringify(finalItems), updatedAt: effectiveTs })
          .where(eq(schema.userSpaceLayout.userId, userId))
          .run();
      } else {
        tx.insert(schema.userSpaceLayout).values({
          userId,
          layout: JSON.stringify(finalItems),
          updatedAt: effectiveTs,
        }).run();
      }
    });

    // Build response: fetch final state
    const finalLayout = db.select().from(schema.userSpaceLayout)
      .where(eq(schema.userSpaceLayout.userId, userId)).get();
    const finalItems: SpaceLayoutItem[] = finalLayout ? JSON.parse(finalLayout.layout) : [];

    const finalFolderRows = db.select().from(schema.spaceFolders)
      .where(eq(schema.spaceFolders.userId, userId))
      .orderBy(schema.spaceFolders.position)
      .all();

    const responseFolders: SpaceFolder[] = [];
    for (const folder of finalFolderRows) {
      const memberRows = db.select()
        .from(schema.spaceFolderMembers)
        .where(eq(schema.spaceFolderMembers.folderId, folder.id))
        .orderBy(schema.spaceFolderMembers.position)
        .all();
      responseFolders.push({
        id: folder.id,
        userId: folder.userId,
        name: folder.name,
        color: folder.color,
        position: folder.position ?? 0,
        spaceIds: memberRows.map(m => m.spaceId),
      });
    }

    const layoutUpdatedAt = finalLayout?.updatedAt ?? effectiveTs;

    // Broadcast to user's other connections (multi-tab sync)
    connectionManager.sendToUser(userId, {
      type: 'space_layout_updated',
      layout: finalItems,
      folders: responseFolders,
      updatedAt: layoutUpdatedAt,
    });

    return reply.code(200).send({ items: finalItems, folders: responseFolders, updatedAt: layoutUpdatedAt });
  });

  app.get<{ Params: { id: string } }>('/api/users/:id', { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    if (!user) {
      return sendError(reply, 404, 'user_not_found');
    }

    return reply.code(200).send(sanitizeUser(user));
  });

  app.get<{ Params: { id: string } }>(
    '/api/users/:id/mutuals', { preHandler: authenticate }, async (request, reply) => {
    const { id: targetId } = request.params;
    const myId = request.userId;
    const db = getDb();

    const resolvedTargetId = targetId;

    // Mutual friends: users who are friends with both me and the target
    const myFriendRows = db.select().from(schema.friends).where(
      or(eq(schema.friends.userId, myId), eq(schema.friends.friendId, myId))
    ).all();
    const targetFriendRows = db.select().from(schema.friends).where(
      or(eq(schema.friends.userId, resolvedTargetId), eq(schema.friends.friendId, resolvedTargetId))
    ).all();
    const myFriendIds = new Set(myFriendRows.map(f => f.userId === myId ? f.friendId : f.userId));
    const targetFriendIds = new Set(targetFriendRows.map(f => f.userId === resolvedTargetId ? f.friendId : f.userId));
    const mutualFriendIds = [...myFriendIds].filter((id) => targetFriendIds.has(id));

    const mutualFriends = mutualFriendIds.length > 0
      ? db.select().from(schema.users).where(inArray(schema.users.id, mutualFriendIds)).all().map(u => sanitizeUser(u))
      : [];

    // Mutual spaces: spaces both me and the target are members of
    const myMemberships = db.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, myId)).all();
    const targetMemberships = db.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, resolvedTargetId)).all();
    const mySpaceIds = new Set(myMemberships.map((m) => m.spaceId));
    const targetSpaceIds = new Set(targetMemberships.map((m) => m.spaceId));
    const mutualSpaceIds = [...mySpaceIds].filter((id) => targetSpaceIds.has(id));

    const mutualSpaces = mutualSpaceIds.length > 0
      ? db.select({ id: schema.spaces.id, name: schema.spaces.name, icon: schema.spaces.icon, avatarColor: schema.spaces.avatarColor })
          .from(schema.spaces)
          .where(inArray(schema.spaces.id, mutualSpaceIds))
          .all()
      : [];

    return reply.code(200).send({ mutualFriends, mutualSpaces });
  });
}
