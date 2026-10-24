import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'node:fs';
import path from 'node:path';
import { insertDmMember } from '../utils/dmMemberClosed.js';

/**
 * Ensure data invariants after schema migration. Idempotent — safe to run
 * on every boot. Uses raw better-sqlite3 handle (not Drizzle ORM).
 */
export function ensureDefaults(db: Database.Database): void {
  // 1. Ensure the single-row instance_settings row exists
  const row = db.prepare('SELECT id FROM instance_settings WHERE id = 1').get();
  if (!row) {
    db.prepare(
      `INSERT OR IGNORE INTO instance_settings
        (id, max_bitrate_kbps, min_bitrate_kbps, bitrate_step_kbps,
         allowed_resolutions, allowed_framerates, max_resolution, max_framerate, updated_at)
       VALUES (1, 20000, 500, 500, ?, ?, 1080, 60, ?)`
    ).run('540,720,1080', '30,45,60', Date.now());
    console.log('[defaults] Inserted default instance_settings row');
  }

  // 2. Ensure a unique Snowflake worker ID is persisted (0-1023)
  const settings = db.prepare('SELECT worker_id FROM instance_settings WHERE id = 1').get() as
    { worker_id: number | null } | undefined;
  if (!settings || settings.worker_id === null) {
    const workerId = crypto.randomInt(0, 1024);
    db.prepare('UPDATE instance_settings SET worker_id = ? WHERE id = 1').run(workerId);
    console.log(`[defaults] Generated Snowflake worker ID: ${workerId}`);
  }

  // 2b. Ensure a persistent instance epoch (incarnation UUID) exists. A fresh
  // DB mints a new one — this is the discriminator for detecting resets.
  // The id=1 row is guaranteed by step 1's INSERT OR IGNORE above.
  const epochRow = db.prepare('SELECT instance_id FROM instance_settings WHERE id = 1').get() as
    { instance_id: string | null } | undefined;
  if (!epochRow || epochRow.instance_id === null) {
    const instanceId = crypto.randomUUID();
    const res = db.prepare('UPDATE instance_settings SET instance_id = ? WHERE id = 1').run(instanceId);
    if (res.changes !== 1) throw new Error('ensureDefaults: instance_settings id=1 row missing — cannot mint epoch');
    console.log('[defaults] Generated instance epoch');
  }

  // 2c. Ensure installed_at is set. Existing databases get the oldest local
  // account's creation time, a fresh one gets now. Never overwritten.
  const installedRow = db.prepare('SELECT installed_at FROM instance_settings WHERE id = 1').get() as
    { installed_at: number | null } | undefined;
  if (!installedRow || installedRow.installed_at === null) {
    const oldest = db.prepare(
      'SELECT created_at FROM users WHERE home_instance IS NULL AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY created_at ASC LIMIT 1',
    ).get() as { created_at: number } | undefined;
    const installedAt = oldest?.created_at ?? Date.now();
    db.prepare('UPDATE instance_settings SET installed_at = ? WHERE id = 1').run(installedAt);
    console.log('[defaults] Recorded installed_at');
  }

  // 3. Ensure at least one admin exists (promote earliest registered user)
  const anyAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
  if (!anyAdmin) {
    const firstUser = db.prepare(
      'SELECT id FROM users ORDER BY created_at ASC LIMIT 1'
    ).get() as { id: string } | undefined;
    if (firstUser) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(firstUser.id);
      console.log(`[defaults] Promoted first user ${firstUser.id} to admin`);
    }
  }
}

/**
 * One-time, idempotent recovery of 1-on-1 DM threads broken before the DM
 * tombstone fix: those had the deleted partner's dm_members row removed, making
 * the thread UI-unreachable. For each ownerId-NULL channel with exactly one
 * member, re-insert membership for any distinct dm_messages author that is
 * missing from dm_members and still exists in users. Safe to run every boot.
 */
export function backfillOneOnOneDmMembership(db: Database.Database): void {
  const broken = db.prepare(`
    SELECT dc.id AS channelId
    FROM dm_channels dc
    WHERE dc.owner_id IS NULL
      AND (SELECT COUNT(*) FROM dm_members dm WHERE dm.dm_channel_id = dc.id) = 1
  `).all() as { channelId: string }[];
  if (broken.length === 0) return;

  const missingAuthors = db.prepare(`
    SELECT DISTINCT msg.user_id AS userId
    FROM dm_messages msg
    JOIN users u ON u.id = msg.user_id
    WHERE msg.dm_channel_id = ?
      AND msg.user_id NOT IN (SELECT user_id FROM dm_members WHERE dm_channel_id = ?)
  `);

  let restored = 0;
  const run = db.transaction(() => {
    for (const { channelId } of broken) {
      const authors = missingAuthors.all(channelId, channelId) as { userId: string }[];
      for (const { userId } of authors) { insertDmMember(db, channelId, userId); restored++; }
    }
  });
  run();
  if (restored > 0) console.log(`[backfill] restored ${restored} deleted-partner DM membership row(s)`);
}

/** Reconcile a size column left by an unreleased build. 0045 also creates pack
 * tables: never skip it merely because that column exists. Missing objects and
 * the actual generated journal entry are applied in one rollback-safe step. */
export function healSkippedStickerSizeMigration(db: Database.Database, migrationsFolder: string): void {
  const settingsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'instance_settings'").get();
  if (!settingsTable) return;

  const cols = db.prepare("PRAGMA table_info('instance_settings')").all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
  if (!cols.some((c) => c.name === 'max_sticker_size_bytes')) return;

  const migrationsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  if (!migrationsTableExists) return;

  const tag = '0045_flawless_mister_sinister';
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const entry = journal.entries.find(e => e.tag === tag);
  if (!entry) return;
  const recorded = db.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at = ?');
  if (recorded.get(entry.when)) return;
  // Refuse to jump over any older pending migration.
  if (journal.entries.some(e => e.when < entry.when && !recorded.get(e.when))) {
    throw new Error('Cannot recover sticker migration before earlier migrations are applied');
  }
  const column = cols.find(c => c.name === 'max_sticker_size_bytes')!;
  if (column.type.toLowerCase() !== 'integer' || column.notnull !== 0 || column.dflt_value !== null) {
    throw new Error('Cannot recover divergent max_sticker_size_bytes column');
  }
  const sql = fs.readFileSync(path.join(migrationsFolder, `${tag}.sql`), 'utf8');
  const canonical = (sql: string) => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ').toLowerCase();
  db.transaction(() => {
    for (const part of sql.split(/-->\s*statement-breakpoint/)) {
      const statement = part.trim();
      if (!statement) continue;
      if (/^ALTER TABLE `instance_settings` ADD `max_sticker_size_bytes` integer;?$/i.test(statement)) continue;
      const created = /^CREATE (TABLE|(?:UNIQUE )?INDEX) `([^`]+)`/i.exec(statement);
      if (!created) throw new Error(`Unsupported sticker recovery statement: ${statement.slice(0, 80)}`);
      const existing = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(created[2]) as { sql: string } | undefined;
      if (existing) {
        if (canonical(existing.sql) !== canonical(statement)) throw new Error(`Cannot recover divergent sticker object: ${created[2]}`);
      } else db.exec(statement);
    }
    db.prepare('INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)')
      .run(crypto.createHash('sha256').update(sql).digest('hex'), entry.when);
  }).immediate();
  console.log(`[migrate] Reconciled ${tag} and its generated journal entry`);
}

