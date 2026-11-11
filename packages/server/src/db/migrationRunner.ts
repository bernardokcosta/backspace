import type Database from 'better-sqlite3';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { healSkippedStickerSizeMigration } from './migrate.js';
import { prepareFederationRetirement, retireFederationData, finishFederationRetirement } from './retireFederation.js';
import { stageRetirementFiles } from './retirementFiles.js';

export interface MigrationState {
  readonly all: readonly MigrationMeta[];
  readonly pending: readonly MigrationMeta[];
}

/** The generated timestamp/hash pair, not row counts or synthetic ledger IDs,
 * identifies an applied migration. Supported pre-squash histories may omit an
 * earliest prefix, but cannot contain a gap within their recorded suffix. */
export function readMigrationState(db: Database.Database, folder: string): MigrationState {
  const journal: unknown = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'));
  if (!journal || typeof journal !== 'object' || !('entries' in journal) || !Array.isArray(journal.entries)) {
    throw new Error('Invalid migration history: generated journal is malformed');
  }
  let previous = -1;
  for (const [index, entry] of journal.entries.entries()) {
    if (!entry || typeof entry !== 'object' || !('idx' in entry) || entry.idx !== index ||
      !('when' in entry) || typeof entry.when !== 'number' || !Number.isSafeInteger(entry.when) || entry.when <= previous ||
      !('tag' in entry) || typeof entry.tag !== 'string' || !/^\d{4}_[a-zA-Z0-9_-]+$/.test(entry.tag)) {
      throw new Error('Invalid migration history: generated ordering is contradictory');
    }
    previous = entry.when;
  }
  const all = readMigrationFiles({ migrationsFolder: folder });
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get()) {
    return { all, pending: all };
  }
  const recorded = db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all() as Array<{
    hash: unknown; created_at: unknown;
  }>;
  let lastIndex = -1;
  for (const row of recorded) {
    const index = all.findIndex(m => m.folderMillis === row.created_at && m.hash === row.hash);
    if (index < 0 || (lastIndex >= 0 && index !== lastIndex + 1)) {
      throw new Error('Invalid migration history: unknown, duplicate, future or missing interior entry');
    }
    lastIndex = index;
  }
  return { all, pending: all.slice(lastIndex + 1) };
}

/** One connection owns the complete generated upgrade transaction. Never wrap
 * Drizzle's synchronous migrator: it issues its own literal BEGIN/COMMIT. */
export function runMigrations(db: Database.Database, options: {
  migrationsFolder: string;
  beforeChanges: () => void;
  retirementFiles?: { dbPath: string; uploadDir: string };
}): void {
  if (db.inTransaction) throw new Error('Migration requires no active transaction');
  try {
    const state = readMigrationState(db, options.migrationsFolder);
    if (state.pending.length === 0) return;
    options.beforeChanges();
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-read under the write lock: no second writer can move the ledger
      // between choosing migrations and recording them.
      const pending = readMigrationState(db, options.migrationsFolder).pending;
      db.exec('CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
      const insert = db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
      for (const migration of pending) {
        // The only known partial-release repair keeps using its actual generated
        // statements/hash. Its nested better-sqlite3 transaction is a savepoint.
        const journal: { entries: Array<{ tag: string; when: number }> } = JSON.parse(
          readFileSync(path.join(options.migrationsFolder, 'meta/_journal.json'), 'utf8'),
        );
        const tag = journal.entries.find(entry => entry.when === migration.folderMillis)?.tag;
        if (tag === '0045_flawless_mister_sinister') {
          healSkippedStickerSizeMigration(db, options.migrationsFolder);
          if (db.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at = ?').get(migration.folderMillis)) continue;
        }
        // The exact generated boundary owns the only provenance-aware data
        // transition. Neither general migration plugins nor runtime relay code.
        const retirement = tag === '0049_standalone_core' ? prepareFederationRetirement(db) : undefined;
        if (retirement) retireFederationData(db, retirement);
        for (const statement of migration.sql) {
          const sql = statement.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--[^\r\n]*/gm, '').trim();
          if (!sql) continue;
          if (/^PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF|1|0)\s*;?$/i.test(sql)) continue;
          // Statement-breakpoint chunks can contain several SQL statements.
          // Inspect every structural statement, ignoring quoted data/identifiers,
          // so an embedded COMMIT cannot escape the outer rollback boundary.
          const structuralSql = sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]/g, 'quoted');
          if (/(?:^|;)\s*(?:BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE)\b/i.test(structuralSql)) {
            throw new Error('Unsupported transaction control in generated migration');
          }
          db.exec(statement);
        }
        if (retirement) {
          finishFederationRetirement(db, retirement);
          if (retirement.fileCandidates.length > 0) {
            if (!options.retirementFiles) throw new Error('Retirement file cleanup context is required');
            stageRetirementFiles(db, { ...options.retirementFiles, migrationHash: migration.hash, filenames: retirement.fileCandidates });
          }
        }
        insert.run(migration.hash, migration.folderMillis);
      }
      if ((db.pragma('foreign_key_check') as unknown[]).length !== 0) {
        throw new Error('Migration foreign-key integrity check failed');
      }
      db.exec('COMMIT');
    } catch (error) {
      if (db.inTransaction) db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new Error('Migration could not restore foreign-key enforcement');
    }
  }
}
