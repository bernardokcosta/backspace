import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import type { DB } from '../db/index.js';
import { buildJunoStandings } from './junoStandings.js';
import type { JunoSettlement } from './junoProgression.js';

export function junoTestSettlement(roundId = 'round', spaceId = 'space'): JunoSettlement {
  return { roundId, spaceId, channelId: spaceId === 'space' ? 'voice' : null, finishedAt: 100, scoringVersion: 1, result: 'emptyHand',
    standings: buildJunoStandings(['a', 'b', 'c', 'd'].map(userId => ({ userId, name: userId })),
      [0, 2, 2, 7].map((cardCount, i) => ({ userId: ['a', 'b', 'c', 'd'][i]!, cardCount })), 'a', 'emptyHand') };
}

export function createJunoTestDb(filename = ':memory:'): { sqlite: Database.Database; db: DB } {
  const sqlite = new Database(filename);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle/', import.meta.url)) });
  return { sqlite, db };
}
export function seedJunoTestDb(db: ReturnType<typeof createJunoTestDb>['db']): void {
  for (const id of ['a', 'b', 'c', 'd', 'watcher']) db.insert(schema.users).values({ id, username: id,
    passwordHash: 'test-not-a-password', displayName: id.toUpperCase(), avatar: `${id}.webp`, createdAt: 1 }).run();
  for (const id of ['space', 'other']) {
    db.insert(schema.spaces).values({ id, name: id, ownerId: 'a', createdAt: 1 }).run();
    for (const userId of ['a', 'b', 'c', 'd', 'watcher']) db.insert(schema.spaceMembers).values({ spaceId: id, userId, joinedAt: 1 }).run();
  }
  db.insert(schema.channels).values({ id: 'voice', spaceId: 'space', name: 'voice', type: 'voice', createdAt: 1 }).run();
}
