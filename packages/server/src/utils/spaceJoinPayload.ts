import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { computePermissions, PermissionBits, permissionsToString } from './permissions.js';
import { sanitizeUser } from './sanitize.js';
import { memberRolesView, rolesForViewer } from './permissionDataView.js';
import type { Channel, MemberWithUser, SpaceWithChannelsAndMembers } from '@backspace/shared';

/** Full joined-space payload, with channels and role data shaped for its recipient. */
export function buildJoinedSpace(spaceId: string, forUserId: string): SpaceWithChannelsAndMembers | null {
  const db = getDb();
  const space = db.select().from(schema.spaces).where(eq(schema.spaces.id, spaceId)).get();
  if (!space) return null;

  const channels = db.select().from(schema.channels).where(eq(schema.channels.spaceId, spaceId)).all();
  const categories = db.select().from(schema.channelCategories)
    .where(eq(schema.channelCategories.spaceId, spaceId)).orderBy(schema.channelCategories.position).all()
    .map(c => ({ id: c.id, spaceId: c.spaceId, name: c.name, position: c.position ?? 0, createdAt: c.createdAt }));
  const roles = db.select().from(schema.roles).where(eq(schema.roles.spaceId, spaceId)).orderBy(schema.roles.position).all();
  const memberRows = db.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.spaceId, spaceId)).all();
  const memberUserIds = memberRows.map(m => m.userId);
  const users = memberUserIds.length > 0
    ? db.select().from(schema.users).where(inArray(schema.users.id, memberUserIds)).all() : [];
  const userMap = new Map(users.map(u => [u.id, u]));
  const memberRoleRows = db.select().from(schema.memberRoles).where(eq(schema.memberRoles.spaceId, spaceId)).all();

  const members: MemberWithUser[] = memberRows.map(m => {
    const u = userMap.get(m.userId);
    if (!u) return null;
    const assignedRoleIds = new Set(memberRoleRows.filter(mr => mr.userId === m.userId).map(mr => mr.roleId));
    return { spaceId: m.spaceId, userId: m.userId, nickname: m.nickname, joinedAt: m.joinedAt,
      user: sanitizeUser(u), roles: memberRolesView(roles, assignedRoleIds) };
  }).filter((m): m is MemberWithUser => m !== null);

  const spacePerms = computePermissions(forUserId, spaceId);
  const visibleChannels: Channel[] = [];
  for (const ch of channels) {
    const chPerms = computePermissions(forUserId, spaceId, ch.id);
    const hasView = (chPerms & PermissionBits.VIEW_CHANNEL) !== 0n || (chPerms & PermissionBits.ADMINISTRATOR) !== 0n;
    if (hasView) visibleChannels.push({ id: ch.id, spaceId: ch.spaceId, name: ch.name, type: ch.type as Channel['type'],
      topic: ch.topic, position: ch.position ?? 0, categoryId: ch.categoryId ?? null, createdAt: ch.createdAt,
      myPermissions: permissionsToString(chPerms) });
  }

  return {
    id: space.id, name: space.name, icon: space.icon, banner: space.banner ?? null,
    avatarColor: (space.avatarColor as SpaceWithChannelsAndMembers['avatarColor']) ?? null,
    ownerId: space.ownerId, ownerTitle: space.ownerTitle, inviteCode: space.inviteCode,
    visibility: (space.visibility ?? 'private') as SpaceWithChannelsAndMembers['visibility'],
    directoryListed: space.directoryListed === 1, description: space.description ?? null, createdAt: space.createdAt,
    channels: visibleChannels, categories, members, roles: rolesForViewer(roles, spacePerms),
    myPermissions: permissionsToString(spacePerms),
  };
}
