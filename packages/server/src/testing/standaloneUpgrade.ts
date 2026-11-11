import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../db/migrationRunner.js';

export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function buildNativeDatabase(db: Database.Database): void {
  runMigrations(db, { migrationsFolder, beforeChanges: () => {} });
}

/** Exact pre-retirement fixtures; no applied SQL/history is invented or edited. */
export function buildOldDatabase(db: Database.Database, options: {
  legacy?: boolean; through?: number; omitPrefix?: number;
} = {}): void {
  const through = options.through ?? 49;
  const migrations = readMigrationFiles({ migrationsFolder }).slice(0, through);
  if (options.legacy) db.exec(fs.readFileSync(path.join(migrationsFolder, '../test/fixtures/pre-squash-schema.sql'), 'utf8'));
  for (const migration of migrations.slice(options.legacy ? 21 : 0)) {
    for (const statement of migration.sql) db.exec(statement);
  }
  db.exec('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)');
  const record = db.prepare('INSERT INTO __drizzle_migrations (hash,created_at) VALUES (?,?)');
  for (const migration of migrations.slice(options.omitPrefix ?? 0)) record.run(migration.hash, migration.folderMillis);
  db.pragma('foreign_keys = ON');
}

export function seedNativeUser(db: Database.Database, id: string): void {
  db.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,1)')
    .run(id, id, `synthetic-credential-${id}`);
}

export function seedNativeDm(db: Database.Database, id: string, key: string | null, members: string[], at = 1, owner: string | null = null): void {
  db.prepare('INSERT INTO dm_channels (id,owner_id,federated_id,created_at) VALUES (?,?,?,?)').run(id,owner,key,at);
  for (const user of members) db.prepare('INSERT INTO dm_members (dm_channel_id,user_id) VALUES (?,?)').run(id,user);
}

/** Logical snapshots include schema/history and private values only in memory. */
export function snapshotDatabase(db: Database.Database): unknown {
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
  return { objects, rows: Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}" ORDER BY rowid`).all()])) };
}
