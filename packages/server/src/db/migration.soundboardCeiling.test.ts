import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, '../../drizzle');
const CEILING_MIGRATION = '0042_past_millenium_guard.sql';

function apply(db: Database.Database, file: string): void {
  const text = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  for (const stmt of text.split(/-->\s*statement-breakpoint/)) {
    const clean = stmt.trim();
    if (clean) db.exec(clean);
  }
}

function migrateUpTo(db: Database.Database, stopAt: string): void {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  expect(files).toContain(stopAt);
  for (const f of files) {
    if (f === stopAt) break;
    apply(db, f);
  }
}

describe(`migration ${CEILING_MIGRATION}`, () => {
  it('backfills legacy null caps to 30 and keeps explicit caps', () => {
    const db = new Database(':memory:');
    migrateUpTo(db, CEILING_MIGRATION);
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare(
      "INSERT INTO soundboard_settings (space_id, enabled, allow_member_uploads, max_duration_seconds, max_sounds) VALUES ('s-null', 1, 1, NULL, 50)",
    ).run();
    db.prepare(
      "INSERT INTO soundboard_settings (space_id, enabled, allow_member_uploads, max_duration_seconds, max_sounds) VALUES ('s-old', 1, 1, 86400, 100)",
    ).run();
    // FK stays off through apply: the legacy rows dangle (no spaces rows),
    // and the migration itself must not toggle enforcement (see 0042 header).

    apply(db, CEILING_MIGRATION);

    const rows = db.prepare(
      'SELECT space_id AS spaceId, max_duration_seconds AS cap, max_sounds AS sounds FROM soundboard_settings ORDER BY space_id',
    ).all();
    expect(rows).toEqual([
      { spaceId: 's-null', cap: 30, sounds: 50 },
      { spaceId: 's-old', cap: 86400, sounds: 100 },
    ]);
  });

  it('is registered in the journal, so migrate() applies it', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain('0042_past_millenium_guard');
  });
});
