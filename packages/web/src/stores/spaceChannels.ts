import type { Channel } from '@veyvox/shared';

/** Native channels visible to the current session, whether their space is open or not. */
export interface SpaceChannelEntry {
  readonly spaceId: string;
  readonly type: Channel['type'];
}
export type SpaceChannelIndex = ReadonlyMap<string, SpaceChannelEntry>;
export interface SpaceChannelTables {
  readonly index: SpaceChannelIndex;
  readonly permissions: ReadonlyMap<string, string>;
  /** Shared with DM last-message entries; these operations touch only space channels. */
  readonly lastMessageIds: ReadonlyMap<string, string>;
}

/** Immutable writes preserve permissions/last-message fields an event omitted. */
export function putChannels(tables: SpaceChannelTables, spaceId: string, channels: readonly Channel[]): SpaceChannelTables {
  return putSpaceListings(tables, [{ id: spaceId, channels }]);
}
export function putSpaceListings(tables: SpaceChannelTables, spaces: ReadonlyArray<{ readonly id: string; readonly channels: readonly Channel[] }>): SpaceChannelTables {
  if (spaces.every(space => space.channels.length === 0)) return tables;
  const index = new Map(tables.index), permissions = new Map(tables.permissions), lastMessageIds = new Map(tables.lastMessageIds);
  for (const space of spaces) for (const channel of space.channels) {
    index.set(channel.id, { spaceId: space.id, type: channel.type });
    if (channel.myPermissions) permissions.set(channel.id, channel.myPermissions);
    if (channel.type !== 'voice' && channel.lastMessageId) lastMessageIds.set(channel.id, channel.lastMessageId);
  }
  return { index, permissions, lastMessageIds };
}
export function dropChannels(tables: SpaceChannelTables, channelIds: Iterable<string>): SpaceChannelTables {
  const ids = [...channelIds].filter(id => tables.index.has(id));
  if (ids.length === 0) return tables;
  const index = new Map(tables.index), permissions = new Map(tables.permissions), lastMessageIds = new Map(tables.lastMessageIds);
  for (const id of ids) { index.delete(id); permissions.delete(id); lastMessageIds.delete(id); }
  return { index, permissions, lastMessageIds };
}
export function channelIdsWhere(index: SpaceChannelIndex, match: (entry: SpaceChannelEntry) => boolean): string[] {
  const ids: string[] = [];
  for (const [id, entry] of index) if (match(entry)) ids.push(id);
  return ids;
}
export function inSpace(entry: SpaceChannelEntry, spaceId: string): boolean { return entry.spaceId === spaceId; }

/** Replace the complete visible set for one space, returning IDs that disappeared. */
export function replaceSpaceChannels(tables: SpaceChannelTables, spaceId: string, channels: readonly Channel[]): { tables: SpaceChannelTables; dropped: string[] } {
  const listed = new Set(channels.map(channel => channel.id));
  const dropped = channelIdsWhere(tables.index, entry => inSpace(entry, spaceId)).filter(id => !listed.has(id));
  return { tables: putChannels(dropChannels(tables, dropped), spaceId, channels), dropped };
}
export interface ChannelLookups {
  readonly channelToSpaceMap: ReadonlyMap<string, string>;
  readonly voiceChannelIds: ReadonlySet<string>;
}
export function deriveChannelLookups(index: SpaceChannelIndex): ChannelLookups {
  const channelToSpaceMap = new Map<string, string>(), voiceChannelIds = new Set<string>();
  for (const [id, entry] of index) {
    channelToSpaceMap.set(id, entry.spaceId);
    if (entry.type === 'voice') voiceChannelIds.add(id);
  }
  return { channelToSpaceMap, voiceChannelIds };
}
