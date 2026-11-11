import { afterEach, describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasPendingMigrations } from './pendingMigrations.js';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../../drizzle');
const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function memoryDatabase(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  return db;
}

describe('hasPendingMigrations', () => {
  it('returns true when __drizzle_migrations is missing', () => {
    const db = memoryDatabase();
    expect(hasPendingMigrations(db, migrationsFolder)).toBe(true);
  });

  it('returns true when a valid migration suffix is pending', () => {
    const db = memoryDatabase();
    db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)');
    const first = readMigrationFiles({ migrationsFolder })[0]!;
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(first.hash, first.folderMillis);
    expect(hasPendingMigrations(db, migrationsFolder)).toBe(true);
  });

  it('accepts a supported missing earliest prefix without inventing pending migrations', () => {
    const db = memoryDatabase();
    db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)');
    const insert = db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
    for (const migration of readMigrationFiles({ migrationsFolder }).slice(2)) insert.run(migration.hash, migration.folderMillis);
    expect(hasPendingMigrations(db, migrationsFolder)).toBe(false);
  });

  it('refuses an unknown migration instead of treating its row count as history', () => {
    const db = memoryDatabase();
    db.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC)');
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('unrecognized', 1);
    expect(() => hasPendingMigrations(db, migrationsFolder)).toThrow(/history/i);
  });
});
