import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { runMigrations } from './migrationRunner.js';
import { config } from '../config.js';
import * as schema from './schema.js';
import { ensureDefaults, backfillOneOnOneDmMembership } from './migrate.js';
import { normalizeAllRolePositions } from './rolePositions.js';
import { normalizeStoredPermissions } from './permissionStrings.js';
import { setWorkerId } from '../utils/snowflake.js';
import { backfillOneOnOneKeys } from '../utils/dmConversation.js';
import { retryRetirementFiles } from './retirementFiles.js';
import { createSnapshot } from '../utils/backup.js';
import { mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let sqlite: Database.Database;

function ensureDirectory(filePath: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

export function initDatabase() {
  ensureDirectory(config.dbPath);
  // Capture existence BEFORE opening — new Database() creates the file, so a
  // post-open check would always report "exists" and snapshot a 0-row DB on first boot.
  const dbExisted = existsSync(config.dbPath);

  sqlite = new Database(config.dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const migrationsFolder = resolve(__dirname, '../../drizzle');

  // Snapshot before migrating — but only when there is a real DB AND a migration
  // is actually pending. History is stable across most boots, so this avoids
  // churning the pre-migration retention with identical copies on every restart.
  let snapshotTaken = false;
  const beforeMigrationChanges = (): void => {
    if (config.backup.disabled || !dbExisted || snapshotTaken) return;
    try {
      const snap = createSnapshot(sqlite, 'pre-migration');
      snapshotTaken = true;
      console.log(`[backup] pre-migration snapshot written: ${snap}`);
    } catch (err) {
      console.error(`[backup] pre-migration snapshot FAILED — aborting migration to protect data: ${(err as Error).message}`);
      throw err;
    }
  };

  const db = drizzle(sqlite, { schema });
  const retirementFiles = { dbPath: config.dbPath, uploadDir: config.uploadDir };
  const finishPendingCleanup = (): void => {
    const result = retryRetirementFiles(sqlite, retirementFiles);
    if (result.pending !== 0) throw new Error(`Targeted retirement cleanup incomplete (${result.pending} files pending)`);
  };
  // Retry committed work or discard a proven uncommitted sidecar before a new
  // attempt. No defaults/backfills/routes may run with incomplete cleanup.
  finishPendingCleanup();
  runMigrations(sqlite, { migrationsFolder, beforeChanges: beforeMigrationChanges, retirementFiles });
  finishPendingCleanup();

  // Ensure data invariants (settings row, worker ID, first admin)
  ensureDefaults(sqlite);
  // Recover pre-fix broken 1-on-1 DM threads (deleted partner's membership row
  // lost before the tombstone fix). Idempotent — safe no-op on every later boot.
  backfillOneOnOneDmMembership(sqlite);
  // A boot pass that rewrites rows takes the same snapshot as a migration
  // before its first change (unless this boot already took one); a failed
  // snapshot aborts the boot, as it does for migrations. Each pass calls this
  // only when it is about to change something.
  const snapshotBefore = (pass: string) => (): void => {
    if (config.backup.disabled || snapshotTaken) return;
    try {
      const snap = createSnapshot(sqlite, 'pre-migration');
      snapshotTaken = true;
      console.log(`[backup] pre-migration snapshot before the ${pass} written: ${snap}`);
    } catch (err) {
      console.error(`[backup] snapshot before the ${pass} FAILED, aborting to protect data: ${(err as Error).message}`);
      throw err;
    }
  };

  // Native pair identity repair is idempotent and preserves duplicate history.
  backfillOneOnOneKeys(sqlite, { beforeChanges: snapshotBefore('1-on-1 DM key backfill') });

  // Give every role its own position, in the order the role list already
  // shows them, so the role hierarchy has something to compare. Roles created
  // before positions were maintained all sit at 0. No-op once applied.
  normalizeAllRolePositions(sqlite);

  // Store every permissions value in the canonical form the routes write, with
  // the meaning it already had (permissions.md, "Stored form"). No-op once applied.
  const permissionValuesRewritten = normalizeStoredPermissions(sqlite, {
    beforeChanges: snapshotBefore('permission value normalisation'),
  });
  if (permissionValuesRewritten > 0) {
    console.log(`[permissions] rewrote ${permissionValuesRewritten} stored permission value(s) to canonical form`);
  }

  // Initialize Snowflake worker ID from persisted value
  const settings = sqlite.prepare('SELECT worker_id FROM instance_settings WHERE id = 1').get() as { worker_id: number } | undefined;
  if (settings?.worker_id !== undefined && settings.worker_id !== null) {
    setWorkerId(settings.worker_id);
    console.log(`Snowflake worker ID: ${settings.worker_id}`);
  } else {
    throw new Error('Snowflake worker_id not found in instance_settings — migration failed');
  }

  console.log(`Database initialized at ${config.dbPath}`);
  return db;
}

export type DB = ReturnType<typeof initDatabase>;

/**
 * A handle queries can run on: either the root database or an open
 * transaction. `DB` itself carries drizzle's `$client` property, which a
 * transaction handle does not have, so a helper that accepts `db ?? tx` must
 * be typed against the shared query surface rather than against `DB`.
 */
export type DBHandle = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

let db: DB;

export function getDb(): DB {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

export function getRawDb(): Database.Database {
  return sqlite;
}

export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
  }
}

export { schema };
