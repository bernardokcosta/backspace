import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { generateSnowflake } from './snowflake.js';
import { insertDmMember, setDmMemberClosed } from './dmMemberClosed.js';

/** A native account is identified by its row here, including a tombstone. */
export interface LocalDmUser { id: string }

/** Private uniqueness key. Native pairs keep the original sorted-id SHA bytes. */
export function oneOnOneKey(a: LocalDmUser, b: LocalDmUser): string {
  return crypto.createHash('sha256').update([a.id, b.id].sort().join(':')).digest('hex').slice(0, 32);
}

export function mayBeOneOnOneRow(row: { owner_id: string | null }): boolean { return row.owner_id === null; }
export function isGroupConversation(row: { owner_id: string | null }): boolean { return row.owner_id !== null; }

/** Move a person's pointer with their conversation, keeping the newer numeric
 * snowflake (not its lexicographically larger string). */
export function keepNewerReadPointer(
  rawDb: Database.Database,
  from: { userId: string; channelId: string },
  to: { userId: string; channelId: string },
): void {
  if (from.userId === to.userId && from.channelId === to.channelId) return;
  const read = rawDb.prepare('SELECT last_read_message_id AS last, updated_at AS updatedAt FROM read_states WHERE user_id = ? AND channel_id = ?');
  const moving = read.get(from.userId, from.channelId) as { last: string; updatedAt: number } | undefined;
  if (!moving) return;
  const held = read.get(to.userId, to.channelId) as { last: string; updatedAt: number } | undefined;
  rawDb.prepare('DELETE FROM read_states WHERE user_id = ? AND channel_id = ?').run(from.userId, from.channelId);
  if (!held) {
    rawDb.prepare('INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at) VALUES (?, ?, ?, ?)')
      .run(to.userId, to.channelId, moving.last, moving.updatedAt);
  } else if (isNewerMessageId(moving.last, held.last)) {
    rawDb.prepare('UPDATE read_states SET last_read_message_id = ?, updated_at = ? WHERE user_id = ? AND channel_id = ?')
      .run(moving.last, Math.max(moving.updatedAt, held.updatedAt), to.userId, to.channelId);
  }
}

function isNewerMessageId(a: string, b: string): boolean {
  try { return BigInt(a) > BigInt(b); } catch { return a > b; }
}

export interface DmReconcileResult {
  action: 'noop' | 'rekeyed' | 'merged';
  channelId: string;
  targetChannelId: string;
  affectedUserIds: string[];
}
export interface DbWithClient { $client: Database.Database }
export interface OneOnOneOptions { open: 'both' | 'first' }
export interface OneOnOneResult { channelId: string; created: boolean; reconciled: DmReconcileResult[] }

interface ChannelRow { id: string; owner_id: string | null; pair_key: string | null; deleted_at: number | null }
interface MemberRow { user_id: string; closed: number }
function members(rawDb: Database.Database, channelId: string): MemberRow[] {
  return rawDb.prepare('SELECT user_id, closed FROM dm_members WHERE dm_channel_id = ? ORDER BY user_id').all(channelId) as MemberRow[];
}
function holdingKey(rawDb: Database.Database, key: string): ChannelRow | undefined {
  return rawDb.prepare('SELECT id, owner_id, pair_key, deleted_at FROM dm_channels WHERE pair_key = ?').get(key) as ChannelRow | undefined;
}
function assertHistory(rawDb: Database.Database, channelId: string, pair: readonly string[]): void {
  if (pair.length !== 2 || new Set(pair).size !== 2) throw new Error('DM integrity requires two distinct participants');
  if (rawDb.prepare('SELECT 1 FROM dm_messages WHERE dm_channel_id = ? AND user_id NOT IN (?, ?) LIMIT 1').get(channelId, pair[0], pair[1]) ||
    rawDb.prepare('SELECT 1 FROM read_states WHERE channel_id = ? AND user_id NOT IN (?, ?) LIMIT 1').get(channelId, pair[0], pair[1])) {
    throw new Error('DM history has an unclassifiable participant');
  }
}

function reconcilePair(rawDb: Database.Database, channelId: string, trace: DmReconcileResult[], visiting: Set<string>): DmReconcileResult {
  const noop: DmReconcileResult = { action: 'noop', channelId, targetChannelId: channelId, affectedUserIds: [] };
  const channel = rawDb.prepare('SELECT id, owner_id, pair_key, deleted_at FROM dm_channels WHERE id = ?').get(channelId) as ChannelRow | undefined;
  if (!channel || channel.deleted_at !== null || !mayBeOneOnOneRow(channel)) return noop;
  const sourceMembers = members(rawDb, channelId);
  if (sourceMembers.length > 2) throw new Error('DM integrity has more than two native participants');
  if (sourceMembers.length !== 2) return noop;
  const pair = sourceMembers.map(member => member.user_id);
  assertHistory(rawDb, channelId, pair);
  const key = oneOnOneKey({ id: pair[0]! }, { id: pair[1]! });
  if (key === channel.pair_key) return noop;
  if (visiting.has(channelId)) throw new Error('DM pair-key integrity cycle');
  visiting.add(channelId);
  try {
    // Clear a drifted label before resolving another drifted label. Swapped
    // keys can then settle without a transient UNIQUE violation or data deletion.
    rawDb.prepare('UPDATE dm_channels SET pair_key = NULL WHERE id = ?').run(channelId);
    let target = holdingKey(rawDb, key);
    while (target) {
      if (target.owner_id !== null || target.deleted_at !== null) throw new Error('DM pair key belongs to an invalid conversation');
      const targetMembers = members(rawDb, target.id);
      if (targetMembers.every(member => pair.includes(member.user_id))) break;
      const previous = target.id;
      reconcilePair(rawDb, previous, trace, visiting);
      target = holdingKey(rawDb, key);
      if (target?.id === previous) throw new Error('DM pair-key integrity cannot be reconciled');
    }
    if (!target) {
      rawDb.prepare('UPDATE dm_channels SET pair_key = ? WHERE id = ?').run(key, channelId);
      const result: DmReconcileResult = { action: 'rekeyed', channelId, targetChannelId: channelId, affectedUserIds: pair };
      trace.push(result); return result;
    }
    assertHistory(rawDb, target.id, pair);
    rawDb.prepare('UPDATE dm_messages SET dm_channel_id = ? WHERE dm_channel_id = ?').run(target.id, channelId);
    // Pending bot responses are a non-FK local conversation reference too.
    rawDb.prepare('UPDATE interactions SET dm_channel_id = ? WHERE dm_channel_id = ?').run(target.id, channelId);
    const held = new Map(members(rawDb, target.id).map(member => [member.user_id, member]));
    for (const member of sourceMembers) {
      const existing = held.get(member.user_id);
      if (existing) {
        if (member.closed === 0 && existing.closed !== 0) setDmMemberClosed(rawDb, target.id, member.user_id, false);
        rawDb.prepare('DELETE FROM dm_members WHERE dm_channel_id = ? AND user_id = ?').run(channelId, member.user_id);
      } else {
        rawDb.prepare('UPDATE dm_members SET dm_channel_id = ? WHERE dm_channel_id = ? AND user_id = ?').run(target.id, channelId, member.user_id);
      }
    }
    const pointers = rawDb.prepare('SELECT user_id FROM read_states WHERE channel_id = ?').all(channelId) as Array<{ user_id: string }>;
    for (const pointer of pointers) keepNewerReadPointer(rawDb, { userId: pointer.user_id, channelId }, { userId: pointer.user_id, channelId: target.id });
    rawDb.prepare('DELETE FROM dm_channels WHERE id = ?').run(channelId);
    const result: DmReconcileResult = { action: 'merged', channelId, targetChannelId: target.id, affectedUserIds: pair };
    trace.push(result); return result;
  } finally { visiting.delete(channelId); }
}

/** Low-level repair composes with the owned migration or find/create transaction. */
export function reconcileDmChannelPairKey(rawDb: Database.Database, channelId: string): DmReconcileResult {
  if (!rawDb.inTransaction) throw new Error('DM reconciliation requires an active transaction');
  return reconcilePair(rawDb, channelId, [], new Set());
}

/** One local backfill, preserving existing correct key holders and all history. */
export function backfillOneOnOneKeys(rawDb: Database.Database, options: { beforeChanges?: () => void } = {}): void {
  const rows = rawDb.prepare(`SELECT c.id, c.pair_key, m.user_id FROM dm_channels c
    JOIN dm_members m ON m.dm_channel_id = c.id
    WHERE c.owner_id IS NULL AND c.deleted_at IS NULL ORDER BY c.created_at, c.id, m.user_id`).all() as Array<{ id: string; pair_key: string | null; user_id: string }>;
  const pairs = new Map<string, { key: string | null; users: string[] }>();
  for (const row of rows) {
    const pair = pairs.get(row.id) ?? { key: row.pair_key, users: [] };
    pair.users.push(row.user_id); pairs.set(row.id, pair);
  }
  const candidates = [...pairs].filter(([, pair]) => pair.users.length === 2 &&
    oneOnOneKey({ id: pair.users[0]! }, { id: pair.users[1]! }) !== pair.key).map(([id]) => id);
  if (candidates.length === 0) return;
  options.beforeChanges?.();
  const trace: DmReconcileResult[] = [];
  rawDb.transaction(() => { for (const id of candidates) reconcilePair(rawDb, id, trace, new Set()); }).immediate();
  if (trace.length) console.log('[db] local DM pair backfill: keyed %d, merged %d', trace.filter(result => result.action === 'rekeyed').length, trace.filter(result => result.action === 'merged').length);
}

/** The sole transactional lookup/insert path for two distinct native accounts. */
export function findOrCreateOneOnOne(db: DbWithClient, a: LocalDmUser, b: LocalDmUser, options: OneOnOneOptions): OneOnOneResult {
  if (a.id === b.id) throw new Error('DM pair requires two distinct users, not self');
  const rawDb = db.$client;
  const key = oneOnOneKey(a, b);
  const pair = [a.id, b.id];
  return rawDb.transaction((): OneOnOneResult => {
    const reconciled: DmReconcileResult[] = [];
    let keyed = holdingKey(rawDb, key);
    if (keyed) {
      if (keyed.owner_id !== null || keyed.deleted_at !== null) throw new Error('DM pair key belongs to an invalid conversation');
      if (members(rawDb, keyed.id).some(member => !pair.includes(member.user_id))) {
        reconcilePair(rawDb, keyed.id, reconciled, new Set());
        keyed = holdingKey(rawDb, key);
      }
    }
    if (keyed) {
      assertHistory(rawDb, keyed.id, pair);
      const held = members(rawDb, keyed.id);
      if (held.some(member => !pair.includes(member.user_id))) throw new Error('DM pair-key integrity has another participant');
      for (const party of [a, b]) {
        if (!held.some(member => member.user_id === party.id)) insertDmMember(rawDb, keyed.id, party.id, { closed: options.open === 'first' && party.id === b.id });
      }
      return { channelId: keyed.id, created: false, reconciled };
    }
    const byMembers = rawDb.prepare(`SELECT c.id FROM dm_channels c WHERE c.owner_id IS NULL AND c.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM dm_members m WHERE m.dm_channel_id = c.id AND m.user_id = ?)
      AND EXISTS (SELECT 1 FROM dm_members m WHERE m.dm_channel_id = c.id AND m.user_id = ?)
      AND (SELECT COUNT(*) FROM dm_members m WHERE m.dm_channel_id = c.id) = 2
      ORDER BY c.created_at, c.id LIMIT 1`).get(a.id, b.id) as { id: string } | undefined;
    if (byMembers) {
      const result = reconcilePair(rawDb, byMembers.id, reconciled, new Set());
      return { channelId: result.targetChannelId, created: false, reconciled };
    }
    const channelId = generateSnowflake();
    rawDb.prepare('INSERT INTO dm_channels (id, owner_id, pair_key, created_at) VALUES (?, NULL, ?, ?)').run(channelId, key, Date.now());
    insertDmMember(rawDb, channelId, a.id);
    insertDmMember(rawDb, channelId, b.id, { closed: options.open === 'first' });
    return { channelId, created: true, reconciled };
  }).immediate();
}
