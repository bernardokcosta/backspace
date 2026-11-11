import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseMentions } from '@veyvox/shared/src/mentions.js';
import { parseChannelSystemEvent } from '@veyvox/shared/src/channelSystemEvents.js';
import { parseDmSystemEvent } from '@veyvox/shared/src/dmSystemEvents.js';
import { findReferencedRetirementPaths, validateRetirementFilePath } from './retirementFiles.js';
import { oneOnOneKey, reconcileDmChannelPairKey } from '../utils/dmConversation.js';
import { insertDmMember } from '../utils/dmMemberClosed.js';

// This module only understands the old schema at the retirement boundary. It
// must never import a retired network/identity resolver or infer provenance from
// a username. No caller may use its plan outside the migration transaction.
const RETIRED_TABLES = new Set([
  'federation_peers', 'federation_sync_cursors', 'federation_sync_retry',
  'federation_applied_events', 'federation_subject_clocks', 'federation_reset_events',
  'federation_attach_proofs', 'peer_approval_requests', 'peer_approval_subscribers',
  'peer_approval_notifications', 'federation_outbox', 'federation_file_queue',
  'federation_mutation_log', 'user_federation_registry', 'user_federation_credentials',
  'bot_revocations', 'blocked_bots', 'sticker_peer_policies',
]);
const NATIVE_TABLES = new Set([
  'users', 'spaces', 'soundboard_settings', 'soundboard_sounds', 'space_members',
  'channel_categories', 'channels', 'juno_round_results', 'juno_round_participants',
  'juno_player_stats', 'messages', 'pinned_messages', 'attachments', 'embeds',
  'dm_channels', 'dm_members', 'dm_messages', 'friends', 'friend_requests',
  'reactions', 'dm_reactions', 'roles', 'member_roles', 'channel_overrides',
  'category_overrides', 'read_states', 'notification_settings', 'space_folders',
  'space_folder_members', 'user_space_layout', 'instance_settings', 'bans',
  'join_requests', 'voice_restrictions', 'bot_tokens', 'bot_seat_restrictions',
  'invite_links', 'invite_redemptions', 'bot_commands', 'interactions',
  'sticker_assets', 'personal_stickers', 'sticker_packs', 'sticker_pack_versions',
  'sticker_pack_items', 'user_installed_packs', 'game_icon_assets', 'game_icons',
]);
const SHARED_ASSET_TABLES = new Set(['sticker_assets', 'game_icon_assets']);
const BATCH = 128;
const RETIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  users: ['home_instance', 'home_user_id', 'replicated_instances', 'federation_registry_updated_at',
    'federation_heal_pending', 'federation_home_orphaned', 'detached_home_instance', 'detached_home_user_id'],
  attachments: ['source_url', 'federation_status', 'federation_meta'],
  dm_channels: ['federated_id', 'owner_home_user_id', 'owner_home_instance'],
  dm_messages: ['source_instance', 'source_message_id', 'encryption_version'],
  friend_requests: ['relay_message_id'],
  instance_settings: ['instance_id', 'federated_registration_open', 'federation_relay_enabled', 'federation_relay_ttl_days',
    'default_auto_rotate_interval_days', 'auto_accept_peering', 'ledger_started_at',
    'voice_bit_migrated', 'thumbnails_backfilled', 'tenor_api_key', 'profile_attachments_cleaned',
    'media_dimensions_backfilled', 'legacy_dm_sync_done'],
  sticker_packs: ['origin_type', 'source_instance', 'source_pack_id', 'synced_at'],
};

interface TableCheck { columns: readonly string[]; digest: string }
interface NativePair { channelId: string; targetChannelId: string; key: string }
interface RestoredMember { channelId: string; userId: string }

interface Row { [column: string]: unknown; __row: number }
interface Edge {
  child: string;
  column: string;
  parent: string;
  target: string;
  condition?: string;
  declared?: boolean;
}

export interface RetirementPlan {
  readonly removedUserIds: readonly string[];
  readonly retainedUserIds: readonly string[];
  readonly removedRows: ReadonlyMap<string, ReadonlySet<number>>;
  readonly rewrittenLayouts: ReadonlyMap<string, string>;
  readonly beforeDigest: string;
  readonly fileCandidates: readonly string[];
  readonly deletionOrder: readonly string[];
  readonly nativePairs: readonly NativePair[];
  readonly restoredMembers: readonly RestoredMember[];
  /** Filled only by the data phase, checked before and after generated SQL. */
  readonly retainedChecks: Map<string, TableCheck>;
  readonly finalChecks: Map<string, TableCheck>;
}

function refuse(category: string, count = 1): never {
  // Counts/categories only: never include handles, credentials or message bodies.
  throw new Error(`Federation retirement refused: ${category} (${count} records)`);
}

function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) refuse('unclassifiable schema identifier');
  return `"${value}"`;
}

function tables(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name").all() as Array<{ name: string }>)
    .map(row => row.name);
}

function fingerprint(db: Database.Database, names: readonly string[]): string {
  const digest = createHash('sha256');
  for (const row of db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').iterate()) {
    digest.update(JSON.stringify(row));
  }
  for (const name of names) {
    digest.update(name);
    for (const row of db.prepare(`SELECT rowid AS __row, * FROM ${identifier(name)} ORDER BY rowid`).iterate()) {
      digest.update(JSON.stringify(row));
    }
  }
  return digest.digest('hex');
}

function forBatches<T extends string | number>(values: Iterable<T>, run: (ids: T[], marks: string) => void): void {
  let batch: T[] = [];
  for (const value of values) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) refuse('unclassifiable row identity');
    batch.push(value);
    if (batch.length === BATCH) { run(batch, batch.map(() => '?').join(',')); batch = []; }
  }
  if (batch.length) run(batch, batch.map(() => '?').join(','));
}

function readEdges(db: Database.Database, names: readonly string[]): Edge[] {
  interface SnapshotForeignKey {
    tableTo: string; columnsFrom: string[]; columnsTo: string[];
    onDelete?: string; onUpdate?: string;
  }
  interface SnapshotTable {
    columns: Record<string, { type: string }>;
    foreignKeys: Record<string, SnapshotForeignKey>;
    indexes: Record<string, { columns: string[]; isUnique: boolean; where?: string }>;
    checkConstraints?: Record<string, unknown>;
  }
  // Use the immutable boundary snapshot, never the newly generated local-only
  // schema whose missing provenance is exactly what this preflight must inspect.
  const snapshot = JSON.parse(readFileSync(new URL('../../drizzle/meta/0048_snapshot.json', import.meta.url), 'utf8')) as {
    version: string; dialect: string; tables: Record<string, SnapshotTable>;
  };
  if (snapshot.version !== '6' || snapshot.dialect !== 'sqlite' || !snapshot.tables) refuse('unclassifiable boundary snapshot');
  const legacyExtras = new Set(['voice_bit_migrated', 'thumbnails_backfilled', 'tenor_api_key',
    'profile_attachments_cleaned', 'media_dimensions_backfilled', 'legacy_dm_sync_done']);
  const edges: Edge[] = [];
  for (const child of names) {
    const expected = snapshot.tables[child];
    if (!expected?.columns || !expected.foreignKeys) refuse('unclassifiable boundary table');
    const columns = db.prepare(`PRAGMA table_xinfo(${identifier(child)})`).all() as Array<{ name: string; type: string }>;
    if (Object.keys(expected.columns).some(name => !columns.some(column => column.name === name)) || columns.some(column => {
      const canonical = expected.columns[column.name];
      return canonical ? canonical.type.toLowerCase() !== column.type.toLowerCase() :
        child !== 'instance_settings' || !legacyExtras.has(column.name);
    })) refuse('unclassifiable old columns');
    const indexes = (db.prepare(`PRAGMA index_list(${identifier(child)})`).all() as Array<{
      name: string; unique: number; origin: string; partial: number;
    }>).map(index => ({ ...index, columns: (db.prepare(`PRAGMA index_info(${identifier(index.name)})`).all() as Array<{ name: string | null }>).map(column => column.name) }));
    const equivalent = (actual: typeof indexes[number], canonical: SnapshotTable['indexes'][string]): boolean =>
      actual.unique === Number(canonical.isUnique) && actual.partial === Number(!!canonical.where) &&
      actual.columns.length === canonical.columns.length && actual.columns.every((name, position) =>
        name === canonical.columns[position] || (name === null && canonical.columns[position]!.includes('(')));
    const knownIndexes = expected.indexes ?? {};
    for (const index of indexes) {
      if (index.origin === 'pk') continue;
      const candidates = index.origin === 'u' ? Object.values(knownIndexes).filter(index => index.isUnique) :
        knownIndexes[index.name] ? [knownIndexes[index.name]!] : [];
      if (!candidates.some(candidate => equivalent(index, candidate))) refuse('unclassifiable old index');
    }
    for (const [name, index] of Object.entries(knownIndexes)) {
      if (!indexes.some(actual => (actual.name === name || actual.origin === 'u') && equivalent(actual, index))) refuse('unclassifiable missing old index');
    }
    if (!RETIRED_TABLES.has(child)) {
      const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(child) as { sql: string }).sql;
      const count = (definition.match(/\bCHECK\s*\(/gi) ?? []).length;
      const compact = definition.replace(/\s+/g, '').toLowerCase();
      const knownLegacy = child === 'instance_settings' && count === 1 && compact.includes('check(id=1)') ||
        child === 'embeds' && count === 2 && compact.includes("check(embed_typein('generic','video','image','audio','rich'))") &&
        compact.includes('check((message_idisnotnullanddm_message_idisnull)or(message_idisnullanddm_message_idisnotnull))');
      if (count !== Object.keys(expected.checkConstraints ?? {}).length && !knownLegacy) refuse('unclassifiable old check constraint');
    }
    const fks = db.prepare(`PRAGMA foreign_key_list(${identifier(child)})`).all() as Array<{
      seq: number; table: string; from: string; to: string; on_delete: string; on_update: string;
    }>;
    const key = (parent: string, from: string, to: string, remove: string, update: string): string =>
      [parent, from, to, remove.toUpperCase(), update.toUpperCase()].join('|');
    const canonical = Object.values(expected.foreignKeys).map(fk => {
      if (fk.columnsFrom.length !== 1 || fk.columnsTo.length !== 1) refuse('unclassifiable composite foreign key');
      return { ...fk, from: fk.columnsFrom[0]!, to: fk.columnsTo[0]!,
        key: key(fk.tableTo, fk.columnsFrom[0]!, fk.columnsTo[0]!, fk.onDelete ?? 'no action', fk.onUpdate ?? 'no action') };
    });
    const actual = new Set(fks.map(fk => key(fk.table, fk.from, fk.to, fk.on_delete, fk.on_update)));
    if (fks.some(fk => fk.seq !== 0) || [...actual].some(value => !canonical.some(fk => fk.key === value)) ||
      canonical.some(fk => !actual.has(fk.key) && !(child === 'dm_reactions' &&
        fk.key === key('dm_messages', 'dm_message_id', 'id', 'cascade', 'no action')))) refuse('unclassifiable foreign-key edge');
    for (const fk of canonical) {
      if (!RETIRED_TABLES.has(child) && !NATIVE_TABLES.has(fk.tableTo)) refuse('unclassifiable native foreign-key target');
      // Pre-squash dm_reactions omitted the message FK. Its logical reference
      // still protects a native reaction on a remote-only message/root.
      edges.push({ child, column: fk.from, parent: fk.tableTo, target: fk.to, declared: true });
    }
  }
  // Non-FK/polymorphic ownership and audit edges are as important as declared FKs.
  const extras: Edge[] = [
    { child: 'users', column: 'bot_owner_id', parent: 'users', target: 'id' },
    { child: 'roles', column: 'managed_bot_id', parent: 'users', target: 'id' },
    { child: 'dm_channels', column: 'owner_id', parent: 'users', target: 'id' },
    { child: 'spaces', column: 'afk_channel_id', parent: 'channels', target: 'id' },
    { child: 'channels', column: 'category_id', parent: 'channel_categories', target: 'id' },
    { child: 'pinned_messages', column: 'pinned_by_id', parent: 'users', target: 'id' },
    { child: 'attachments', column: 'uploader_id', parent: 'users', target: 'id' },
    { child: 'space_folder_members', column: 'space_id', parent: 'spaces', target: 'id' },
    { child: 'read_states', column: 'channel_id', parent: 'channels', target: 'id' },
    { child: 'read_states', column: 'channel_id', parent: 'dm_channels', target: 'id' },
    { child: 'read_states', column: 'last_read_message_id', parent: 'messages', target: 'id' },
    { child: 'read_states', column: 'last_read_message_id', parent: 'dm_messages', target: 'id' },
    { child: 'interactions', column: 'channel_id', parent: 'channels', target: 'id' },
    { child: 'interactions', column: 'dm_channel_id', parent: 'dm_channels', target: 'id' },
  ];
  for (const child of ['channel_overrides', 'category_overrides']) {
    extras.push({ child, column: 'target_id', parent: 'users', target: 'id', condition: "c.target_type = 'member'" });
    extras.push({ child, column: 'target_id', parent: 'roles', target: 'id', condition: "c.target_type = 'role'" });
  }
  return [...edges, ...extras];
}

function dependentFirst(names: readonly string[], edges: readonly Edge[]): string[] {
  const remaining = new Set(names);
  const order: string[] = [];
  while (remaining.size) {
    const leaves = [...remaining].filter(parent => !edges.some(edge => edge.declared && edge.parent === parent && edge.child !== parent && remaining.has(edge.child)));
    if (!leaves.length) refuse('unclassifiable cyclic foreign-key graph');
    for (const name of leaves.sort()) { order.push(name); remaining.delete(name); }
  }
  return order;
}

function classifyInteractionOptions(db: Database.Database, removedRows: Map<string, Set<number>>, removedUsers: readonly string[], removedRoles: ReadonlySet<string>): void {
  const targets = new Set([...removedUsers, ...removedRoles]);
  forBatches(removedRows.get('channels')!, (ids, marks) => {
    for (const raw of db.prepare(`SELECT id FROM channels WHERE rowid IN (${marks})`).iterate(...ids)) targets.add((raw as { id: string }).id);
  });
  for (const raw of db.prepare('SELECT rowid AS __row, options FROM interactions').iterate()) {
    const row = raw as Row;
    if (!targets.size && !removedRows.get('interactions')!.has(row.__row)) continue;
    let options: unknown;
    try { options = JSON.parse(String(row.options)); } catch { refuse('unclassifiable interaction metadata'); }
    if (!options || typeof options !== 'object' || Array.isArray(options)) refuse('unclassifiable interaction metadata');
    for (const value of Object.values(options)) {
      if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) refuse('unclassifiable interaction option');
      if (typeof value === 'string' && targets.has(value)) removedRows.get('interactions')!.add(row.__row);
    }
    if (!removedRows.get('interactions')!.has(row.__row)) continue;
    // Old rows do not retain the subcommand path/immutable option definition.
    // A native target cannot safely be dismissed as a coincidental string.
    for (const value of Object.values(options)) {
      if (typeof value !== 'string') continue;
      for (const table of ['users', 'roles', 'channels']) {
        const target = db.prepare(`SELECT rowid AS __row FROM ${identifier(table)} WHERE id = ?`).get(value) as Row | undefined;
        if (target && !removedRows.get(table)!.has(target.__row)) refuse('mixed native interaction reference');
      }
    }
  }
}

function assertReplicaAssetsAreRemoteOnly(db: Database.Database, removedRows: ReadonlyMap<string, ReadonlySet<number>>): void {
  const assets = new Set((db.prepare(`
    SELECT cover_asset_id AS id FROM sticker_packs WHERE origin_type = 'replica' AND cover_asset_id IS NOT NULL
    UNION SELECT v.cover_asset_id AS id FROM sticker_pack_versions v JOIN sticker_packs p ON p.id = v.pack_id
      WHERE p.origin_type = 'replica' AND v.cover_asset_id IS NOT NULL
    UNION SELECT i.asset_id AS id FROM sticker_pack_items i JOIN sticker_packs p ON p.id = i.pack_id
      WHERE p.origin_type = 'replica'
  `).all() as Array<{ id: string }>).map(row => row.id));
  if (assets.size === 0) return;
  for (const [table, column] of [
    ['personal_stickers', 'sticker_id'], ['sticker_packs', 'cover_asset_id'],
    ['sticker_pack_versions', 'cover_asset_id'], ['sticker_pack_items', 'asset_id'],
  ] as const) {
    forBatches(assets, (ids, marks) => {
      const rows = db.prepare(`SELECT rowid AS __row FROM ${identifier(table)} WHERE ${identifier(column)} IN (${marks})`).all(...ids) as Row[];
      if (rows.some(row => !removedRows.get(table)!.has(row.__row))) refuse('mixed native sticker asset reference');
    });
  }
  for (const [table, column] of [
    ['messages', 'content'], ['dm_messages', 'content'],
    ['reactions', 'emoji'], ['dm_reactions', 'emoji'],
  ] as const) {
    for (const raw of db.prepare(`SELECT rowid AS __row, ${identifier(column)} AS content FROM ${identifier(table)}`).iterate()) {
      const row = raw as Row;
      if (removedRows.get(table)!.has(row.__row) || typeof row.content !== 'string') continue;
      for (const match of row.content.matchAll(/\/api\/stickers\/assets\/([a-f0-9]{64})\.webp\b/g)) {
        if (assets.has(match[1]!)) refuse('mixed native sticker history reference');
      }
    }
  }
}

function attributeRemovedFiles(db: Database.Database, removedRows: Map<string, Set<number>>): string[] {
  const filenames = new Set<string>();
  for (const [table, columns] of [
    ['users', ['avatar', 'banner']], ['spaces', ['icon', 'banner']],
    ['dm_channels', ['icon']], ['attachments', ['filename', 'thumbnail_filename']],
    ['soundboard_sounds', ['filename']], ['federation_file_queue', ['target_filename']],
  ] as const) {
    forBatches(removedRows.get(table)!, (ids, marks) => {
      for (const raw of db.prepare(`SELECT ${columns.map(identifier).join(',')} FROM ${identifier(table)} WHERE rowid IN (${marks})`).iterate(...ids)) {
        for (const value of Object.values(raw as Record<string, unknown>)) {
          if (value === null) continue;
          if (typeof value !== 'string' || !value) refuse('unclassifiable local filename');
          // An external avatar/icon is not a local basename. Never turn its URL
          // into a path, follow it, or use it to broaden the upload-root cleanup.
          if (/^https?:\/\//i.test(value)) continue;
          filenames.add(validateRetirementFilePath(value));
        }
      }
    });
  }
  interface AssetCandidate { table: string; id: string; rowid: number; paths: string[] }
  const assets = new Map<string, AssetCandidate>();
  for (const [table, column, assetTable, directory] of [
    ['personal_stickers', 'sticker_id', 'sticker_assets', 'stickers'],
    ['sticker_pack_items', 'asset_id', 'sticker_assets', 'stickers'],
    ['sticker_packs', 'cover_asset_id', 'sticker_assets', 'stickers'],
    ['sticker_pack_versions', 'cover_asset_id', 'sticker_assets', 'stickers'],
    ['game_icons', 'icon_id', 'game_icon_assets', 'game-icons'],
  ] as const) {
    forBatches(removedRows.get(table)!, (ids, marks) => {
      const query = `SELECT DISTINCT a.rowid AS __row, a.id FROM ${identifier(table)} c JOIN ${identifier(assetTable)} a ON c.${identifier(column)} = a.id WHERE c.rowid IN (${marks})`;
      for (const raw of db.prepare(query).iterate(...ids)) {
        const row = raw as { __row: number; id: string };
        if (!/^[a-f0-9]{64}$/.test(row.id)) refuse('unclassifiable asset identity');
        const paths = [`${directory}/${row.id}.webp`];
        if (directory === 'stickers') paths.push(`stickers/${row.id}_preview.webp`);
        assets.set(`${assetTable}:${row.id}`, { table: assetTable, id: row.id, rowid: row.__row, paths });
      }
    });
  }
  // Do not let an asset's own registry row count as a surviving reference to
  // itself. All actual surviving collections, packs and encoded/native message
  // values still protect both the registration and bytes, before either changes.
  const excluded = new Map([...removedRows].map(([name, rows]) => [name, new Set(rows)]));
  for (const asset of assets.values()) excluded.get(asset.table)!.add(asset.rowid);
  const protectedPaths = findReferencedRetirementPaths(db, [...assets.values()].flatMap(asset => asset.paths), excluded);
  for (const asset of assets.values()) {
    if (asset.paths.some(candidate => protectedPaths.has(candidate))) continue;
    removedRows.get(asset.table)!.add(asset.rowid);
    for (const candidate of asset.paths) filenames.add(candidate);
  }
  return [...filenames].sort();
}

function nativeDmPlan(db: Database.Database, removedRows: ReadonlyMap<string, ReadonlySet<number>>): {
  nativePairs: NativePair[]; restoredMembers: RestoredMember[];
} {
  const groups = new Map<string, Array<{ id: string; validKey: boolean }>>();
  const restoredMembers: RestoredMember[] = [];
  for (const raw of db.prepare('SELECT rowid AS __row, * FROM dm_channels ORDER BY created_at, id').iterate()) {
    const row = raw as Row;
    if (removedRows.get('dm_channels')!.has(row.__row) || row.owner_id !== null) continue;
    if (row.name !== null || row.icon !== null) refuse('unclassifiable ownerless DM metadata');
    const channelId = String(row.id);
    const users = (db.prepare('SELECT user_id FROM dm_members WHERE dm_channel_id = ? ORDER BY user_id').all(channelId) as Array<{ user_id: string }>).map(member => member.user_id);
    const authors = (db.prepare('SELECT DISTINCT user_id FROM dm_messages WHERE dm_channel_id = ?').all(channelId) as Array<{ user_id: string }>).map(author => author.user_id);
    // Recover the same provable pre-tombstone missing membership as the native
    // boot backfill, but refuse a third person instead of expanding a private pair.
    if (users.length === 1) {
      const missing = authors.filter(id => !users.includes(id));
      if (missing.length > 1) refuse('unclassifiable native DM history');
      if (missing.length === 1) {
        const user = db.prepare('SELECT rowid AS __row FROM users WHERE id = ?').get(missing[0]) as Row | undefined;
        if (!user || removedRows.get('users')!.has(user.__row)) refuse('mixed native DM history');
        users.push(missing[0]!);
        restoredMembers.push({ channelId, userId: missing[0]! });
      }
    }
    if (users.length > 2 || authors.some(id => !users.includes(id))) refuse('unclassifiable native DM history');
    if (users.length !== 2 || row.deleted_at !== null) continue;
    if (db.prepare('SELECT 1 FROM read_states WHERE channel_id = ? AND user_id NOT IN (?, ?) LIMIT 1').get(channelId, ...users)) refuse('unclassifiable native DM read participant');
    const key = oneOnOneKey({ id: users[0]! }, { id: users[1]! });
    const group = groups.get(key) ?? [];
    group.push({ id: channelId, validKey: row.federated_id === key }); groups.set(key, group);
  }
  const nativePairs: NativePair[] = [];
  for (const [key, channels] of groups) {
    const target = channels.find(channel => channel.validKey) ?? channels[0]!;
    for (const channel of channels) nativePairs.push({ channelId: channel.id, targetChannelId: target.id, key });
  }
  return { nativePairs, restoredMembers };
}

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${identifier(table)})`).all() as Array<{ name: string }>).map(column => column.name).sort();
}

/** Hash each projected row, then sort hashes: table rebuilds may renumber rowids,
 * and private bodies need never be accumulated in memory or printed. */
function tableCheck(db: Database.Database, table: string, columns: readonly string[], project?: (row: Record<string, unknown>) => Record<string, unknown> | null): TableCheck {
  const hashes: string[] = [];
  for (const raw of db.prepare(`SELECT * FROM ${identifier(table)}`).iterate()) {
    const row = project ? project(raw as Record<string, unknown>) : raw as Record<string, unknown>;
    if (row) hashes.push(createHash('sha256').update(JSON.stringify(columns.map(column => row[column]))).digest('hex'));
  }
  return { columns, digest: createHash('sha256').update(hashes.sort().join('')).digest('hex') };
}

function finalTableChecks(db: Database.Database, plan: RetirementPlan): void {
  const remap = new Map(plan.nativePairs.map(pair => [pair.channelId, pair.targetChannelId]));
  const keys = new Map(plan.nativePairs.map(pair => [pair.targetChannelId, pair.key]));
  for (const [table, check] of plan.retainedChecks) {
    if (table === 'dm_members' || table === 'read_states') continue;
    const columns = table === 'dm_channels' ? [...check.columns, 'pair_key'].sort() : check.columns;
    plan.finalChecks.set(table, tableCheck(db, table, columns, row => {
      if (table === 'dm_channels') {
        if (remap.has(String(row.id)) && remap.get(String(row.id)) !== row.id) return null;
        return { ...row, pair_key: keys.get(String(row.id)) ?? null };
      }
      if ((table === 'dm_messages' || table === 'interactions') && typeof row.dm_channel_id === 'string') {
        return { ...row, dm_channel_id: remap.get(row.dm_channel_id) ?? row.dm_channel_id };
      }
      return row;
    }));
  }
  // Duplicate pair membership is the union, open if any copy was open. Native
  // state-change timestamps are checked unchanged across SQL; a merge may stamp
  // the reopened survivor. Pointers retain the numerically newer message id.
  for (const table of ['dm_members', 'read_states']) {
    const columns = plan.retainedChecks.get(table)!.columns.filter(column => column !== (table === 'dm_members' ? 'closed_changed_at' : 'updated_at'));
    const channelColumn = table === 'dm_members' ? 'dm_channel_id' : 'channel_id';
    const merged = new Map<string, Record<string, unknown>>();
    for (const raw of db.prepare(`SELECT * FROM ${identifier(table)}`).iterate()) {
      const row = raw as Record<string, unknown>;
      const channel = String(row[channelColumn]);
      const target = remap.get(channel) ?? channel;
      const id = JSON.stringify([row.user_id, target]);
      const held = merged.get(id);
      const moving = { ...row, [channelColumn]: target };
      if (!held) merged.set(id, moving);
      else if (table === 'dm_members') held.closed = held.closed === 0 || row.closed === 0 ? 0 : held.closed;
      else {
        const a = String(row.last_read_message_id), b = String(held.last_read_message_id);
        const newer = /^\d+$/.test(a) && /^\d+$/.test(b) ? BigInt(a) > BigInt(b) : a > b;
        if (newer) merged.set(id, moving);
      }
    }
    const hashes = [...merged.values()].map(row => createHash('sha256').update(JSON.stringify(columns.map(column => row[column]))).digest('hex')).sort();
    plan.finalChecks.set(table, { columns, digest: createHash('sha256').update(hashes.join('')).digest('hex') });
  }
}

/** Read-only old-data preflight. The narrow allowed graph is inventoried above;
 * an unexpected schema or protected local reference stops before any deletion. */
export function prepareFederationRetirement(db: Database.Database): RetirementPlan {
  const names = tables(db);
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('trigger', 'view') LIMIT 1").get()) refuse('unclassifiable old schema objects');
  if (names.some(name => !NATIVE_TABLES.has(name) && !RETIRED_TABLES.has(name)) ||
    [...NATIVE_TABLES, ...RETIRED_TABLES].some(name => !names.includes(name))) {
    refuse('unclassifiable old schema');
  }
  const removedRows = new Map(names.map(name => [name, new Set<number>()]));
  const removedUserIds: string[] = [];
  const retainedUserIds: string[] = [];
  const retainedUserRows = new Set<number>();
  const add = (table: string, rowid: number): boolean => {
    if (!Number.isSafeInteger(rowid)) refuse('unclassifiable row identity');
    const rows = removedRows.get(table)!;
    if (rows.has(rowid)) return false;
    rows.add(rowid);
    return true;
  };
  for (const raw of db.prepare('SELECT rowid AS __row, * FROM users ORDER BY rowid').iterate()) {
    const row = raw as Row;
    if (typeof row.id !== 'string' || typeof row.password_hash !== 'string') refuse('unclassifiable identity');
    const detached = row.federation_home_orphaned === 1;
    const stub = row.password_hash === '!federation-replicated';
    const remote = typeof row.home_instance === 'string' && row.home_instance.trim().length > 0;
    if ((row.federation_home_orphaned !== null && row.federation_home_orphaned !== 0 && row.federation_home_orphaned !== 1) ||
      (!detached && row.is_deleted !== 1 && (row.detached_home_instance || row.detached_home_user_id))) {
      refuse('unclassifiable detached provenance');
    }
    if ((detached && stub) || (!remote && !detached && row.home_user_id && row.home_user_id !== row.id)) {
      refuse('unclassifiable identity');
    }
    if (stub || (remote && !detached)) {
      removedUserIds.push(row.id);
      add('users', row.__row);
    } else {
      retainedUserIds.push(row.id);
      retainedUserRows.add(row.__row);
    }
  }
  for (const table of RETIRED_TABLES) {
    for (const raw of db.prepare(`SELECT rowid AS __row FROM ${identifier(table)}`).iterate()) add(table, (raw as Row).__row);
  }
  for (const raw of db.prepare('SELECT rowid AS __row, * FROM dm_channels').iterate()) {
    const row = raw as Row;
    if (row.owner_id === null && row.federated_id !== null &&
      (typeof row.federated_id !== 'string' || !/^[a-f0-9]{32}$/.test(row.federated_id))) {
      refuse('unclassifiable ownerless group');
    }
  }
  if (db.prepare('SELECT 1 FROM dm_channels c WHERE c.owner_id IS NULL AND (SELECT COUNT(*) FROM dm_members m WHERE m.dm_channel_id = c.id) > 2 LIMIT 1').get()) {
    refuse('unclassifiable ownerless group membership');
  }
  for (const table of ['channel_overrides', 'category_overrides']) {
    if (db.prepare(`SELECT 1 FROM ${identifier(table)} WHERE target_type NOT IN ('member', 'role') LIMIT 1`).get()) refuse('unclassifiable permission target');
  }
  forBatches(removedRows.get('users')!, (ids, marks) => {
    const channels = db.prepare(`SELECT DISTINCT c.rowid AS __row FROM dm_channels c JOIN dm_members m ON m.dm_channel_id = c.id JOIN users u ON m.user_id = u.id WHERE u.rowid IN (${marks})`).all(...ids);
    for (const row of channels) add('dm_channels', (row as Row).__row);
  });
  for (const raw of db.prepare('SELECT rowid AS __row, * FROM sticker_packs').iterate()) {
    const row = raw as Row;
    if (row.origin_type === 'replica') add('sticker_packs', row.__row);
    else if (row.origin_type !== 'source' || row.source_instance || row.source_pack_id) refuse('unclassifiable sticker provenance');
  }
  for (const [table, predicate] of [
    ['dm_messages', 'source_instance IS NOT NULL OR source_message_id IS NOT NULL'],
    ['attachments', 'source_url IS NOT NULL'],
    ['friend_requests', 'relay_message_id IS NOT NULL'],
  ]) {
    for (const row of db.prepare(`SELECT rowid AS __row FROM ${identifier(table!)} WHERE ${predicate}`).iterate()) add(table!, (row as Row).__row);
  }
  const edges = readEdges(db, names);
  const deletionOrder = dependentFirst(names, edges);
  const propagate = (): void => {
    let changed: boolean;
    do {
      changed = false;
      for (const edge of edges) {
        if (RETIRED_TABLES.has(edge.child)) continue;
        forBatches(removedRows.get(edge.parent)!, (ids, marks) => {
          const rows = db.prepare(`SELECT c.rowid AS __row FROM ${identifier(edge.child)} c JOIN ${identifier(edge.parent)} p ON c.${identifier(edge.column)} = p.${identifier(edge.target)} WHERE p.rowid IN (${marks})${edge.condition ? ` AND ${edge.condition}` : ''}`).all(...ids);
          for (const row of rows) if (add(edge.child, (row as Row).__row)) changed = true;
        });
      }
    } while (changed);
  };
  propagate();
  const removedPeople = new Set(removedUserIds);
  const removedRoles = new Set<string>();
  forBatches(removedRows.get('roles')!, (ids, marks) => {
    for (const row of db.prepare(`SELECT id FROM roles WHERE rowid IN (${marks})`).all(...ids) as Array<{ id: string }>) removedRoles.add(row.id);
  });
  // Read incrementally: private native bodies never leave this connection/log.
  for (const table of ['messages', 'dm_messages']) {
    for (const raw of db.prepare(`SELECT rowid AS __row, content, type FROM ${identifier(table)}`).iterate()) {
      const row = raw as Row;
      const content = typeof row.content === 'string' ? row.content : null;
      if (row.type === 'system') {
        const event = table === 'messages' ? parseChannelSystemEvent(content) : parseDmSystemEvent(content);
        if (!event && !removedRows.get(table)!.has(row.__row)) refuse('unclassifiable system metadata');
        if (event && (('targetUserId' in event && removedPeople.has(event.targetUserId)) ||
          ('newOwnerId' in event && removedPeople.has(event.newOwnerId)))) add(table, row.__row);
      }
      const mentions = parseMentions(content);
      if ([...mentions.userIds].some(id => removedPeople.has(id)) || [...mentions.roleIds].some(id => removedRoles.has(id))) add(table, row.__row);
    }
  }
  classifyInteractionOptions(db, removedRows, removedUserIds, removedRoles);
  propagate();
  if ([...removedRows.get('users')!].some(row => retainedUserRows.has(row))) refuse('mixed native identity ownership');
  for (const edge of edges) {
    if (RETIRED_TABLES.has(edge.child)) continue;
    if (SHARED_ASSET_TABLES.has(edge.parent)) continue;
    // Folder entries are removal metadata, not ownership of the folder itself.
    if (edge.child === 'space_folder_members' && edge.parent === 'space_folders') continue;
    forBatches(removedRows.get(edge.child)!, (ids, marks) => {
      const rows = db.prepare(`SELECT p.rowid AS __row FROM ${identifier(edge.child)} c JOIN ${identifier(edge.parent)} p ON c.${identifier(edge.column)} = p.${identifier(edge.target)} WHERE c.rowid IN (${marks})${edge.condition ? ` AND ${edge.condition}` : ''}`).all(...ids);
      const protectedCount = rows.filter(row => !removedRows.get(edge.parent)!.has((row as Row).__row)).length;
      if (protectedCount) refuse('mixed native reference', protectedCount);
    });
  }
  forBatches(removedRows.get('invite_redemptions')!, (ids, marks) => {
    if (db.prepare(`SELECT 1 FROM invite_redemptions WHERE rowid IN (${marks}) AND user_id IS NULL LIMIT 1`).get(...ids)) refuse('unclassifiable redemption audit');
  });
  assertReplicaAssetsAreRemoteOnly(db, removedRows);
  const removedSpaces = new Set<string>();
  forBatches(removedRows.get('spaces')!, (ids, marks) => {
    for (const row of db.prepare(`SELECT id FROM spaces WHERE rowid IN (${marks})`).all(...ids) as Array<{ id: string }>) removedSpaces.add(row.id);
  });
  const rewrittenLayouts = new Map<string, string>();
  for (const raw of db.prepare('SELECT rowid AS __row, user_id, layout FROM user_space_layout').iterate()) {
    const row = raw as Row;
    if (removedRows.get('user_space_layout')!.has(row.__row)) continue;
    let layout: unknown;
    try { layout = JSON.parse(String(row.layout)); } catch { refuse('unclassifiable layout JSON'); }
    if (!Array.isArray(layout) || layout.some(item => !item || typeof item !== 'object' ||
      (item.t !== 's' && item.t !== 'f') || typeof item.id !== 'string')) refuse('unclassifiable layout shape');
    const items = layout as Array<{ t: 's' | 'f'; id: string }>;
    const kept = items.filter(item => item.t !== 's' || !removedSpaces.has(item.id));
    if (kept.length !== items.length) rewrittenLayouts.set(String(row.user_id), JSON.stringify(kept));
  }
  const fileCandidates = attributeRemovedFiles(db, removedRows);
  const dmPlan = nativeDmPlan(db, removedRows);
  return { removedUserIds, retainedUserIds, removedRows, rewrittenLayouts, fileCandidates, deletionOrder,
    ...dmPlan, retainedChecks: new Map(), finalChecks: new Map(), beforeDigest: fingerprint(db, names) };
}

/** Data-only part of the retirement; generated schema SQL and targeted file
 * bookkeeping remain owned by the enclosing migration boundary. */
export function retireFederationData(db: Database.Database, plan: RetirementPlan): void {
  if (!db.inTransaction || db.pragma('foreign_keys', { simple: true }) !== 0) {
    throw new Error('Retirement requires an active FK-suspended migration transaction');
  }
  if (fingerprint(db, tables(db)) !== plan.beforeDigest) throw new Error('Retirement classification is stale: database changed');
  for (const table of plan.deletionOrder) {
    const rows = plan.removedRows.get(table)!;
    forBatches(rows, (ids, marks) => { db.prepare(`DELETE FROM ${identifier(table)} WHERE rowid IN (${marks})`).run(...ids); });
  }
  const update = db.prepare('UPDATE user_space_layout SET layout = ? WHERE user_id = ?');
  for (const [userId, layout] of plan.rewrittenLayouts) update.run(layout, userId);
  for (const member of plan.restoredMembers) insertDmMember(db, member.channelId, member.userId);
  for (const table of NATIVE_TABLES) {
    const columns = tableColumns(db, table).filter(column => !RETIRED_COLUMNS[table]?.includes(column));
    plan.retainedChecks.set(table, tableCheck(db, table, columns));
  }
  finalTableChecks(db, plan);
}

/** Runs after generated SQL, still inside the same owned migration transaction.
 * No data may disappear/change in a table rebuild, beyond classified retirement
 * and the explicit, content-preserving native pair reconciliation. */
export function finishFederationRetirement(db: Database.Database, plan: RetirementPlan): void {
  if (!db.inTransaction || db.pragma('foreign_keys', { simple: true }) !== 0) throw new Error('Retirement finalization requires the migration transaction');
  if (plan.retainedChecks.size !== NATIVE_TABLES.size) refuse('missing native preservation witness');
  const names = tables(db);
  if (names.length !== NATIVE_TABLES.size || names.some(name => !NATIVE_TABLES.has(name))) refuse('retired schema remains');
  for (const [table, check] of plan.retainedChecks) {
    const expectedColumns = table === 'dm_channels' ? [...check.columns, 'pair_key'].sort() : check.columns;
    if (JSON.stringify(tableColumns(db, table)) !== JSON.stringify(expectedColumns) || tableCheck(db, table, check.columns).digest !== check.digest) {
      refuse('native data or columns changed during generated SQL');
    }
  }
  const seedKey = db.prepare('UPDATE dm_channels SET pair_key = ? WHERE id = ?');
  for (const pair of plan.nativePairs) if (pair.channelId === pair.targetChannelId) seedKey.run(pair.key, pair.channelId);
  for (const pair of plan.nativePairs) reconcileDmChannelPairKey(db, pair.channelId);
  for (const [table, check] of plan.finalChecks) {
    if (tableCheck(db, table, check.columns).digest !== check.digest) refuse('native data changed during pair reconciliation');
  }
}
