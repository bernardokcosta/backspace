import type { AvatarColor, InvitePreview, SpaceVisibility } from '@veyvox/shared';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

export interface SpaceInviteSnapshot {
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;
  instanceName: string;
}

/**
 * The invite preview for a code on this instance, or null when no space holds
 * it. This is what `GET /api/spaces/invite/:code/preview` answers: the
 * snapshot fields plus the space's current visibility, read on every call so
 * a link follows the space's visibility at the time it is opened.
 */
export function getLocalInvitePreview(inviteCode: string): InvitePreview | null {
  const db = getDb();
  const space = db.select().from(schema.spaces)
    .where(eq(schema.spaces.inviteCode, inviteCode)).get();
  if (!space) return null;

  const memberCount = db.select().from(schema.spaceMembers)
    .where(eq(schema.spaceMembers.spaceId, space.id)).all().length;

  const settings = db.select().from(schema.instanceSettings)
    .where(eq(schema.instanceSettings.id, 1)).get();
  const instanceName = settings?.instanceName ?? 'Veyvox';

  return {
    spaceId: space.id,
    spaceName: space.name,
    description: space.description ?? null,
    icon: space.icon ?? null,
    avatarColor: (space.avatarColor as AvatarColor | null) ?? null,
    memberCount,
    instanceName,
    visibility: (space.visibility ?? 'private') as SpaceVisibility,
  };
}

/**
 * Build a local invite snapshot directly from the DB. Used when the space
 * lives on this instance — avoids an HTTP roundtrip through our own domain
 * (which fails inside Docker due to NAT loopback) and is faster anyway.
 *
 * Does not perform network requests, even when the public host is unavailable.
 */
export function getLocalInviteSnapshot(inviteCode: string): SpaceInviteSnapshot | null {
  const preview = getLocalInvitePreview(inviteCode);
  if (!preview) return null;
  return {
    spaceId: preview.spaceId,
    spaceName: preview.spaceName,
    description: preview.description,
    icon: preview.icon,
    avatarColor: preview.avatarColor,
    memberCount: preview.memberCount,
    instanceName: preview.instanceName,
  };
}
