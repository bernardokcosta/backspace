import Database from 'better-sqlite3';
import { readMigrationState } from './migrationRunner.js';

/**
 * Inspect the same validated timestamp/hash history the runner uses. Old
 * installations may lack early journal rows; row counts cannot identify pending
 * migrations or distinguish them from contradictory/unknown history.
 */
export function hasPendingMigrations(db: Database.Database, migrationsFolder: string): boolean {
  return readMigrationState(db, migrationsFolder).pending.length !== 0;
}
