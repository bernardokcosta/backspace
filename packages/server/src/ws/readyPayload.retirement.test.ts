import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import type { SpaceWithChannelsAndMembers } from '@backspace/shared';

setWorkerId(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let testDb: TestDb;
let sqlite: Database.Database;

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  schema,
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const stmt of sql.split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

const OWNER_ID = 'owner';
const now = 1_700_000_000_000;

function seedListedSpace(spaceId: string, directoryListed: 0 | 1): void {
  testDb.insert(schema.spaces).values({
    id: spaceId,
    name: `Space ${spaceId}`,
    ownerId: OWNER_ID,
    inviteCode: `inv-${spaceId}`,
    visibility: 'public',
    directoryListed,
    createdAt: now,
  }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId, userId: OWNER_ID, joinedAt: now }).run();
}

interface ReadyMessage {
  type: string;
  spaces: SpaceWithChannelsAndMembers[];
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  testDb = drizzle(sqlite, { schema });
  applyMigrations(sqlite);
  testDb.insert(schema.users).values({
    id: OWNER_ID,
    username: OWNER_ID,
    passwordHash: 'x',
    homeUserId: OWNER_ID,
    homeInstance: null,
    createdAt: now,
  }).run();
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('ready payload discovery retirement', () => {
  it('omits the retired flag without changing either stored value', async () => {
    const { buildReadyPayload } = await import('./handler.js');
    seedListedSpace('sp-listed', 1);
    seedListedSpace('sp-unlisted', 0);

    const message = JSON.parse(JSON.stringify({ type: 'ready', ...buildReadyPayload(OWNER_ID) })) as ReadyMessage;
    expect(message.spaces).toHaveLength(2);
    for (const space of message.spaces) expect(space).not.toHaveProperty('directoryListed');
    expect(testDb.select({ id: schema.spaces.id, listed: schema.spaces.directoryListed }).from(schema.spaces).all()).toEqual([
      { id: 'sp-listed', listed: 1 }, { id: 'sp-unlisted', listed: 0 },
    ]);
  });
});
