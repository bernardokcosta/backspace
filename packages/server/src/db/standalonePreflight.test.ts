import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import path from 'node:path';
import fs from 'node:fs';
import { prepareFederationRetirement, retireFederationData } from './retireFederation.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(legacy = false): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  // Exact old schema, independent of later generated retirement migrations.
  if (legacy) db.exec(fs.readFileSync(path.resolve('test/fixtures/pre-squash-schema.sql'), 'utf8'));
  for (const migration of readMigrationFiles({ migrationsFolder: path.resolve('drizzle') }).slice(legacy ? 21 : 0, 49)) {
    for (const statement of migration.sql) db.exec(statement);
  }
  db.pragma('foreign_keys = ON');
  return db;
}

function user(db: Database.Database, id: string, home: string | null = null, detached = 0): void {
  db.prepare('INSERT INTO users (id, username, password_hash, home_instance, home_user_id, federation_home_orphaned, created_at) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(id, `${id}${home ? '@elsewhere.test' : ''}`, `synthetic-hash-${id}`, home, home ? `original-${id}` : null, detached);
}

function space(db: Database.Database, owner: string): void {
  db.prepare('INSERT INTO spaces (id, name, owner_id, created_at) VALUES (?, ?, ?, 1)').run(`space-${owner}`, 'Synthetic', owner);
  db.prepare('INSERT INTO channels (id, space_id, name, type, created_at) VALUES (?, ?, ?, ?, 1)').run(`channel-${owner}`, `space-${owner}`, 'text', 'text');
}

function erase(db: Database.Database): void {
  const plan = prepareFederationRetirement(db);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      retireFederationData(db, plan);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    }).immediate();
  } finally { db.pragma('foreign_keys = ON'); }
}

describe('old-schema federation retirement preflight', () => {
  it('is read-only and preserves native, bot and sovereign detached credentials/ids', () => {
    const db = fixture();
    user(db, 'native');
    user(db, 'detached', 'old-home.test', 1);
    user(db, 'bot');
    db.prepare("UPDATE users SET is_bot = 1, bot_owner_id = 'native' WHERE id = 'bot'").run();
    space(db, 'native');
    const before = db.serialize();
    const plan = prepareFederationRetirement(db);
    expect(db.serialize()).toEqual(before);
    expect(plan.removedUserIds).toEqual([]);
    expect(new Set(plan.retainedUserIds)).toEqual(new Set(['native', 'detached', 'bot']));
    erase(db);
    expect(db.prepare('SELECT id, password_hash FROM users ORDER BY id').all()).toEqual([
      { id: 'bot', password_hash: 'synthetic-hash-bot' },
      { id: 'detached', password_hash: 'synthetic-hash-detached' },
      { id: 'native', password_hash: 'synthetic-hash-native' },
    ]);
  });

  it('deletes a disjoint remote graph and a non-loginable stub without touching local content', () => {
    const db = fixture();
    user(db, 'native'); user(db, 'remote', 'elsewhere.test'); user(db, 'stub');
    db.prepare("UPDATE users SET password_hash = '!federation-replicated' WHERE id = 'stub'").run();
    space(db, 'native'); space(db, 'remote');
    db.prepare("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ('native-message', 'channel-native', 'native', 'private local bytes', 1), ('remote-message', 'channel-remote', 'remote', 'remote bytes', 1)").run();
    db.prepare("INSERT INTO attachments (id, message_id, uploader_id, filename, original_name, mimetype, size, created_at) VALUES ('remote-file', 'remote-message', 'remote', 'remote.webp', 'image', 'image/webp', 12, 1)").run();
    erase(db);
    expect(db.prepare('SELECT id FROM users').all()).toEqual([{ id: 'native' }]);
    expect(db.prepare('SELECT id, content FROM messages').all()).toEqual([{ id: 'native-message', content: 'private local bytes' }]);
    expect(db.prepare('SELECT id FROM spaces').all()).toEqual([{ id: 'space-native' }]);
    expect(db.prepare('SELECT id FROM attachments').all()).toEqual([]);
  });

  it.each([
    "INSERT INTO space_members (space_id, user_id, joined_at) VALUES ('space-native', 'remote', 1)",
    "INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ('mixed', 'channel-native', 'remote', 'must stay', 1)",
    "INSERT INTO friends (user_id, friend_id, created_at) VALUES ('native', 'remote', 1)",
    "INSERT INTO channel_overrides (channel_id, target_type, target_id) VALUES ('channel-native', 'member', 'remote')",
    "INSERT INTO bans (space_id, user_id, banned_by, created_at) VALUES ('space-native', 'remote', 'native', 1)",
    "INSERT INTO pinned_messages (id, channel_id, message_id, pinned_by_id, created_at) VALUES ('pin', 'channel-native', 'native-message', 'remote', 1)",
    "INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at) VALUES ('remote', 'channel-native', 'native-message', 1)",
    "UPDATE users SET bot_owner_id = 'remote', is_bot = 1 WHERE id = 'native'",
    "UPDATE messages SET content = '<@remote>' WHERE id = 'native-message'",
    "UPDATE messages SET type = 'system', content = '{\"event\":\"channel_poke\",\"targetUserId\":\"remote\",\"targetDisplayName\":\"synthetic\"}' WHERE id = 'native-message'",
  ])('refuses mixed FK/non-FK/structured references without mutation: %s', sql => {
    const db = fixture();
    user(db, 'native'); user(db, 'remote', 'elsewhere.test'); space(db, 'native');
    db.prepare("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ('native-message', 'channel-native', 'native', 'private local bytes', 1)").run();
    db.exec(sql);
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed|unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it('refuses ambiguous ownerless UUID groups and malformed native layout JSON', () => {
    const db = fixture();
    user(db, 'native');
    db.prepare("INSERT INTO dm_channels (id, federated_id, created_at) VALUES ('legacy-group', '00000000-0000-0000-0000-000000000000', 1)").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
    db.prepare('DELETE FROM dm_channels').run();
    db.prepare("INSERT INTO user_space_layout (user_id, layout, updated_at) VALUES ('native', '{broken', 1)").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
  });

  it('prunes only proven removed-space folder/layout links while preserving native folder ids/order', () => {
    const db = fixture();
    user(db, 'native'); user(db, 'remote', 'elsewhere.test'); space(db, 'native'); space(db, 'remote');
    db.prepare("INSERT INTO space_folders (id, user_id, name, position, created_at) VALUES ('kept-folder', 'native', 'Keep', 7, 1)").run();
    db.prepare("INSERT INTO space_folder_members (folder_id, space_id, position) VALUES ('kept-folder', 'space-native', 3), ('kept-folder', 'space-remote', 8)").run();
    db.prepare('INSERT INTO user_space_layout (user_id, layout, updated_at) VALUES (?, ?, 9)').run('native', JSON.stringify([{ t: 's', id: 'space-remote' }, { t: 'f', id: 'kept-folder' }, { t: 's', id: 'space-native' }]));
    erase(db);
    expect(db.prepare('SELECT id, name, position FROM space_folders').get()).toEqual({ id: 'kept-folder', name: 'Keep', position: 7 });
    expect(db.prepare('SELECT space_id, position FROM space_folder_members').all()).toEqual([{ space_id: 'space-native', position: 3 }]);
    expect(db.prepare('SELECT layout, updated_at FROM user_space_layout').get()).toEqual({ layout: JSON.stringify([{ t: 'f', id: 'kept-folder' }, { t: 's', id: 'space-native' }]), updated_at: 9 });
  });

  it('refuses native installed replica packs instead of deleting local collections', () => {
    const db = fixture(); user(db, 'native');
    db.prepare("INSERT INTO sticker_packs (id, name, origin_type, source_instance, source_pack_id, status, created_at, updated_at) VALUES ('replica', 'Remote', 'replica', 'elsewhere.test', 'original', 'active', 1, 1)").run();
    db.prepare("INSERT INTO user_installed_packs (user_id, pack_id, installed_at) VALUES ('native', 'replica', 1)").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed/i);
  });

  it.each(['collection', 'message', 'pack'] as const)('refuses replica assets referenced by native %s', reference => {
    const db = fixture(); user(db, 'native'); space(db, 'native');
    const asset = 'a'.repeat(64);
    db.prepare('INSERT INTO sticker_assets (id, created_at) VALUES (?, 1)').run(asset);
    db.prepare("INSERT INTO sticker_packs (id, name, origin_type, source_instance, source_pack_id, cover_asset_id, status, created_at, updated_at) VALUES ('replica', 'Remote', 'replica', 'elsewhere.test', 'original', ?, 'active', 1, 1)").run(asset);
    if (reference === 'collection') db.prepare('INSERT INTO personal_stickers (user_id, sticker_id, name, created_at) VALUES (?, ?, ?, 1)').run('native', asset, 'Native name');
    if (reference === 'message') db.prepare('INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, 1)').run('native-message', 'channel-native', 'native', `sticker:https://current.test/api/stickers/assets/${asset}.webp`);
    if (reference === 'pack') db.prepare("INSERT INTO sticker_packs (id, name, creator_id, cover_asset_id, created_at, updated_at) VALUES ('native-pack', 'Native', 'native', ?, 1, 1)").run(asset);
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed/i);
    expect(db.serialize()).toEqual(before);
  });

  it.each([
    "UPDATE users SET federation_home_orphaned = 2 WHERE id = 'remote'",
    "UPDATE users SET federation_home_orphaned = 1, password_hash = '!federation-replicated' WHERE id = 'remote'",
    "UPDATE users SET home_instance = NULL, home_user_id = NULL, detached_home_instance = 'unproven.test' WHERE id = 'remote'",
    "INSERT INTO channel_overrides (channel_id, target_type, target_id) VALUES ('channel-remote', 'unknown', 'remote')",
  ])('refuses unclassifiable provenance/permission targets without mutation: %s', sql => {
    const db = fixture(); user(db, 'remote', 'elsewhere.test'); space(db, 'remote');
    db.exec(sql);
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it('refuses ownerless three-member groups even without a legacy UUID', () => {
    const db = fixture(); user(db, 'a'); user(db, 'b'); user(db, 'c');
    db.prepare("INSERT INTO dm_channels (id, created_at) VALUES ('ambiguous-group', 1)").run();
    db.prepare("INSERT INTO dm_members (dm_channel_id, user_id) VALUES ('ambiguous-group', 'a'), ('ambiguous-group', 'b'), ('ambiguous-group', 'c')").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
  });

  it('requires an active FK-suspended transaction and refuses a stale classification', () => {
    const db = fixture(); user(db, 'remote', 'elsewhere.test');
    const plan = prepareFederationRetirement(db);
    expect(() => retireFederationData(db, plan)).toThrow(/transaction/i);
    user(db, 'native');
    db.pragma('foreign_keys = OFF');
    expect(() => db.transaction(() => retireFederationData(db, plan)).immediate()).toThrow(/changed|stale/i);
    db.pragma('foreign_keys = ON');
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 2 });
  });

  it('attributes only removed-record files and unshared asset registrations, without a general orphan sweep', () => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test');
    const sticker = 'c'.repeat(64), game = 'd'.repeat(64), unrelated = 'e'.repeat(64);
    db.prepare("UPDATE users SET avatar = 'remote-avatar.webp', banner = 'https://elsewhere.test/not-a-local-path.webp' WHERE id = 'remote'").run();
    db.prepare('INSERT INTO sticker_assets (id, created_at) VALUES (?, 1), (?, 1)').run(sticker, unrelated);
    db.prepare('INSERT INTO personal_stickers (user_id, sticker_id, name, created_at) VALUES (?, ?, ?, 1)').run('remote', sticker, 'Remote');
    db.prepare('INSERT INTO game_icon_assets (id, created_at) VALUES (?, 1)').run(game);
    db.prepare('INSERT INTO game_icons (user_id, icon_id, created_at) VALUES (?, ?, 1)').run('remote', game);
    const plan = prepareFederationRetirement(db);
    expect(new Set(plan.fileCandidates)).toEqual(new Set(['remote-avatar.webp', `stickers/${sticker}.webp`, `stickers/${sticker}_preview.webp`, `game-icons/${game}.webp`]));
    erase(db);
    expect(db.prepare('SELECT id FROM sticker_assets').all()).toEqual([{ id: unrelated }]);
    expect(db.prepare('SELECT id FROM game_icon_assets').all()).toEqual([]);
  });

  it('preserves a content-addressed asset still claimed by a native collection', () => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test');
    const asset = 'f'.repeat(64);
    db.prepare('INSERT INTO sticker_assets (id, created_at) VALUES (?, 1)').run(asset);
    db.prepare("INSERT INTO personal_stickers (user_id, sticker_id, name, created_at) VALUES ('native', ?, 'Native', 1), ('remote', ?, 'Remote', 1)").run(asset, asset);
    expect(prepareFederationRetirement(db).fileCandidates).not.toContain(`stickers/${asset}.webp`);
    erase(db);
    expect(db.prepare('SELECT id FROM sticker_assets').all()).toEqual([{ id: asset }]);
    expect(db.prepare('SELECT user_id FROM personal_stickers').all()).toEqual([{ user_id: 'native' }]);
  });

  it('preserves asset registration needed by an encoded native message URL even without a surviving upload claim', () => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test'); space(db, 'native');
    const asset = '1'.repeat(64);
    db.prepare('INSERT INTO game_icon_assets (id, created_at) VALUES (?, 1)').run(asset);
    db.prepare("INSERT INTO game_icons (user_id, icon_id, created_at) VALUES ('remote', ?, 1)").run(asset);
    db.prepare("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ('native-message', 'channel-native', 'native', ?, 1)").run(`https://current.test/api/game-icons/assets/${'%31'.repeat(64)}.webp`);
    erase(db);
    expect(db.prepare('SELECT id FROM game_icon_assets').all()).toEqual([{ id: asset }]);
  });

  it('refuses a removed record with an unsafe local filename before any database rewrite', () => {
    const db = fixture(); user(db, 'remote', 'elsewhere.test');
    db.prepare("UPDATE users SET avatar = '../not-a-basename.webp' WHERE id = 'remote'").run();
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/path|filename/i);
    expect(db.serialize()).toEqual(before);
  });

  it('accounts for the supported pre-squash missing reaction FK as a logical reference', () => {
    const db = fixture(true); user(db, 'native'); user(db, 'remote-a', 'elsewhere.test'); user(db, 'remote-b', 'elsewhere.test');
    db.prepare("INSERT INTO dm_channels (id, created_at) VALUES ('remote-dm', 1)").run();
    db.prepare("INSERT INTO dm_members (dm_channel_id, user_id) VALUES ('remote-dm', 'remote-a'), ('remote-dm', 'remote-b')").run();
    db.prepare("INSERT INTO dm_messages (id, dm_channel_id, user_id, content, created_at) VALUES ('remote-message', 'remote-dm', 'remote-a', 'remote', 1)").run();
    db.prepare("INSERT INTO dm_reactions (id, dm_message_id, user_id, emoji, created_at) VALUES ('native-reaction', 'remote-message', 'native', 'x', 1)").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed/i);
  });

  it('supports the exact inert pre-squash extras without changing native account data', () => {
    const db = fixture(true); user(db, 'native');
    const before = db.serialize();
    expect(prepareFederationRetirement(db).removedUserIds).toEqual([]);
    expect(db.serialize()).toEqual(before);
  });

  it('refuses unknown extra native columns before a generated table rebuild can discard them', () => {
    const db = fixture(); user(db, 'native');
    db.exec("ALTER TABLE users ADD unknown_native_setting text DEFAULT 'must survive'");
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it('refuses an unexpected missing FK instead of silently omitting its reference from classification', () => {
    const db = fixture();
    const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'messages'").get() as { sql: string }).sql;
    const changed = definition.replace(/,\s*FOREIGN KEY \(`user_id`\) REFERENCES `users`\(`id`\) ON UPDATE no action ON DELETE no action/i, '');
    expect(changed).not.toBe(definition);
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE messages'); db.exec(changed);
    db.pragma('foreign_keys = ON');
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it.each([
    "CREATE TRIGGER unknown_native_trigger AFTER DELETE ON users BEGIN UPDATE users SET bio = 'must not mutate'; END",
    'CREATE VIEW unknown_native_view AS SELECT home_instance FROM users',
  ])('refuses unclassified schema objects before any trigger/view can affect native data: %s', sql => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test');
    db.exec(sql);
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it('refuses an unclassifiable redemption audit instead of guessing from its username snapshot', () => {
    const db = fixture(); user(db, 'remote', 'elsewhere.test');
    db.prepare("INSERT INTO invite_links (id, token, name, created_by, created_at) VALUES ('invite', 'token', 'Remote', 'remote', 1)").run();
    db.prepare("INSERT INTO invite_redemptions (id, invite_id, registrant_username, redeemed_at) VALUES ('audit', 'invite', 'unclassifiable-old-name', 1)").run();
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
  });

  it('retains native interaction history whose stored option names a removed identity', () => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test');
    db.prepare("INSERT INTO interactions (id, bot_id, user_id, command, options, created_at, expires_at) VALUES ('interaction', 'native', 'native', 'command', ?, 1, 2)").run(JSON.stringify({ target: 'remote' }));
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed|unclassifiable/i);
  });

  it('orders explicit dependent-row deletion before roots without relying on disabled-FK cascades', () => {
    const db = fixture();
    const order = prepareFederationRetirement(db).deletionOrder;
    expect(order.indexOf('attachments')).toBeLessThan(order.indexOf('dm_messages'));
    expect(order.indexOf('dm_messages')).toBeLessThan(order.indexOf('dm_channels'));
    expect(order.indexOf('channels')).toBeLessThan(order.indexOf('spaces'));
    expect(order.indexOf('spaces')).toBeLessThan(order.indexOf('users'));
    expect(order.indexOf('federation_outbox')).toBeLessThan(order.indexOf('federation_peers'));
  });

  it.each([
    "INSERT INTO category_overrides (category_id, target_type, target_id) VALUES ('native-category', 'role', 'remote-role')",
    "INSERT INTO channel_overrides (channel_id, target_type, target_id) VALUES ('channel-native', 'role', 'remote-role')",
    "INSERT INTO member_roles (space_id, user_id, role_id) VALUES ('space-remote', 'native', 'remote-role')",
    "INSERT INTO notification_settings (user_id, space_id, channel_id, updated_at) VALUES ('native', 'space-remote', 'channel-remote', 1)",
    "INSERT INTO join_requests (id, space_id, user_id, decided_by, created_at) VALUES ('join', 'space-remote', 'remote', 'native', 1)",
    "INSERT INTO voice_restrictions (space_id, user_id, restriction_type, moderator_id, created_at) VALUES ('space-remote', 'remote', 'mute', 'native', 1)",
    "INSERT INTO bot_seat_restrictions (channel_id, bot_id, restriction_type, moderator_id, created_at) VALUES ('channel-remote', 'remote', 'mute', 'native', 1)",
    "INSERT INTO invite_links (id, token, name, created_by, created_at) VALUES ('invite', 'token', 'Remote', 'remote', 1); INSERT INTO invite_redemptions (id, invite_id, user_id, registrant_username, redeemed_at) VALUES ('audit', 'invite', 'native', 'native', 1)",
    "INSERT INTO soundboard_sounds (id, space_id, uploader_id, name, emoji, filename, duration_seconds, created_at) VALUES ('sound', 'space-remote', 'native', 'Native', 'x', 'native.wav', 1, 1)",
    "INSERT INTO juno_round_results (round_id, space_id, channel_id, finished_at, scoring_version) VALUES ('round', 'space-remote', 'channel-remote', 1, 1); INSERT INTO juno_round_participants (round_id, user_id, xp, outcome) VALUES ('round', 'native', 0, 'completed')",
    "INSERT INTO juno_player_stats (space_id, user_id) VALUES ('space-remote', 'native')",
    "INSERT INTO interactions (id, bot_id, user_id, channel_id, command, created_at, expires_at) VALUES ('interaction', 'remote', 'native', 'channel-remote', 'command', 1, 2)",
    "INSERT INTO sticker_packs (id, name, creator_id, reviewed_by, created_at, updated_at) VALUES ('pack', 'Reviewed', 'remote', 'native', 1, 1)",
    "INSERT INTO attachments (id, message_id, uploader_id, filename, original_name, mimetype, size, created_at) VALUES ('file', 'remote-message', 'native', 'native.webp', 'Native', 'image/webp', 1, 1)",
    "UPDATE dm_members SET user_id = 'native' WHERE dm_channel_id = 'remote-dm' AND user_id = 'remote-b'",
    "INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at) VALUES ('native', 'remote-dm', 'remote-dm-message', 1)",
    "INSERT INTO reactions (id, message_id, user_id, emoji, created_at) VALUES ('reaction', 'remote-message', 'native', 'x', 1)",
  ])('preserves the full local permission/audit/content reference matrix: %s', sql => {
    const db = fixture(); user(db, 'native'); user(db, 'remote', 'elsewhere.test'); user(db, 'remote-b', 'elsewhere.test');
    space(db, 'native'); space(db, 'remote');
    db.prepare("INSERT INTO channel_categories (id, space_id, name, created_at) VALUES ('native-category', 'space-native', 'Native', 1)").run();
    db.prepare("INSERT INTO roles (id, space_id, name, created_at) VALUES ('remote-role', 'space-remote', 'Remote', 1)").run();
    db.prepare("INSERT INTO messages (id, channel_id, user_id, content, created_at) VALUES ('native-message', 'channel-native', 'native', 'native bytes', 1), ('remote-message', 'channel-remote', 'remote', 'remote bytes', 1)").run();
    db.prepare("INSERT INTO dm_channels (id, created_at) VALUES ('remote-dm', 1)").run();
    db.prepare("INSERT INTO dm_members (dm_channel_id, user_id) VALUES ('remote-dm', 'remote'), ('remote-dm', 'remote-b')").run();
    db.prepare("INSERT INTO dm_messages (id, dm_channel_id, user_id, content, created_at) VALUES ('remote-dm-message', 'remote-dm', 'remote', 'remote bytes', 1)").run();
    db.exec(sql);
    const before = db.serialize();
    expect(() => prepareFederationRetirement(db)).toThrow(/mixed|unclassifiable/i);
    expect(db.serialize()).toEqual(before);
  });

  it.each([
    'CREATE INDEX unknown_native_index ON users(display_name)',
    'DROP INDEX idx_users_home_user_id; CREATE INDEX idx_users_home_user_id ON users(username)',
  ])('refuses unclassified/changed indexes before a table rebuild can remove user-owned schema: %s', sql => {
    const db = fixture(); db.exec(sql);
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
  });

  it('refuses an additional native CHECK constraint instead of silently discarding it', () => {
    const db = fixture();
    const definition = (db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get() as { sql: string }).sql;
    const changed = definition.replace(/\)\s*$/, ', CHECK (length(username) > 0))');
    db.pragma('foreign_keys = OFF'); db.exec('DROP TABLE users'); db.exec(changed); db.pragma('foreign_keys = ON');
    expect(() => prepareFederationRetirement(db)).toThrow(/unclassifiable/i);
  });
});
