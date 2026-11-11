import type Database from 'better-sqlite3';

/** Native DM visibility is a local membership flag, not a replicated clock. */
export function insertDmMember(
  rawDb: Database.Database, channelId: string, userId: string, options: { closed?: boolean } = {},
): void {
  rawDb.prepare('INSERT INTO dm_members (dm_channel_id, user_id, closed) VALUES (?, ?, ?)')
    .run(channelId, userId, options.closed ? 1 : 0);
}

/** Return whether the exact native membership changed its closed state. */
export function setDmMemberClosed(
  rawDb: Database.Database, channelId: string, userId: string, closed: boolean,
): boolean {
  return rawDb.prepare('UPDATE dm_members SET closed = ? WHERE dm_channel_id = ? AND user_id = ? AND closed IS NOT ?')
    .run(closed ? 1 : 0, channelId, userId, closed ? 1 : 0).changes > 0;
}

/** New native content reopens this conversation for its closed members. */
export function reopenClosedDmMembers(rawDb: Database.Database, channelId: string): string[] {
  const rows = rawDb.prepare('SELECT user_id FROM dm_members WHERE dm_channel_id = ? AND closed = 1').all(channelId) as Array<{ user_id: string }>;
  const reopen = rawDb.prepare('UPDATE dm_members SET closed = 0 WHERE dm_channel_id = ? AND user_id = ? AND closed = 1');
  return rows.filter(row => reopen.run(channelId, row.user_id).changes > 0).map(row => row.user_id);
}
