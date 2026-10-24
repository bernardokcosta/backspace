import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { healSkippedStickerSizeMigration } from './migrate.js';

describe('sticker migration recovery', () => {
  it.each(['column', 'partial', 'divergent'] as const)('recovers %s state without skipping tables or committing partial failures', state => {
    const folder = mkdtempSync(path.join(tmpdir(), 'sticker-migration-'));
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    try {
      cpSync(path.resolve('drizzle'), folder, { recursive: true });
      const journalPath = path.join(folder, 'meta/_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; when: number; tag: string }> };
      writeFileSync(journalPath, JSON.stringify({ ...journal, entries: journal.entries.filter(e => e.idx < 45) }));
      migrate(drizzle(sqlite), { migrationsFolder: folder });
      sqlite.exec('ALTER TABLE instance_settings ADD max_sticker_size_bytes integer');
      sqlite.exec('INSERT INTO instance_settings (id, updated_at, max_sticker_size_bytes) VALUES (1, 1, 12345)');
      if (state === 'partial') {
        const statements = readFileSync(path.resolve('drizzle/0045_flawless_mister_sinister.sql'), 'utf8').split(/-->\s*statement-breakpoint/);
        // A matching object left by a previous interrupted attempt is retained.
        sqlite.exec(statements[0]!);
      }
      if (state === 'divergent') {
        sqlite.exec('CREATE TABLE sticker_peer_policies (unexpected text)');
        expect(() => healSkippedStickerSizeMigration(sqlite, path.resolve('drizzle'))).toThrow(/divergent/);
        // No journal entry and no preceding CREATEs from the failed recovery.
        expect(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sticker_packs'").get()).toBeUndefined();
        expect(sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at = ?').get(journal.entries.find(e => e.idx === 45)!.when)).toBeUndefined();
        return;
      }
      healSkippedStickerSizeMigration(sqlite, path.resolve('drizzle'));
      migrate(drizzle(sqlite), { migrationsFolder: path.resolve('drizzle') });
      expect(sqlite.prepare('SELECT max_sticker_size_bytes FROM instance_settings').get()).toEqual({ max_sticker_size_bytes: 12345 });
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sticker_pack%'").all()).toHaveLength(3);
      expect(sqlite.prepare('SELECT 1 FROM __drizzle_migrations WHERE created_at = ?').get(journal.entries.find(e => e.idx === 45)!.when)).toBeDefined();
      const count = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get();
      healSkippedStickerSizeMigration(sqlite, path.resolve('drizzle'));
      expect(sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get()).toEqual(count);
      expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally { sqlite.close(); rmSync(folder, { recursive: true, force: true }); }
  });
});
