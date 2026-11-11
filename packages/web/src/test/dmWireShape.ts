import type { DmChannel } from '@veyvox/shared';

/**
 * DM channel fixtures in the shapes servers really send.
 *
 * Current servers put every `DmChannel` on the wire through one serializer
 * (server `utils/dmChannelWire.ts`), so ready, `GET /api/dm` and
 * `dm_channel_created` all carry native IDs and group metadata, never private
 * pair keys or external identity/copy fields.
 */

/** A DM exactly as a current server sends it: every nullable field present. */
export function wireDm(fields: Pick<DmChannel, 'id' | 'createdAt' | 'members'> & Partial<DmChannel>): DmChannel {
  return {
    ownerId: null,
    name: null,
    icon: null,
    metadataUpdatedAt: 0,
    lastMessage: null,
    ...fields,
  };
}

/** Deep copy, so a fake API never hands out the fixture objects themselves. */
export function copyDm(dm: DmChannel): DmChannel {
  return { ...dm, members: dm.members.map(m => ({ ...m })) };
}
