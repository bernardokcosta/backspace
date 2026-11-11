import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import type { SpaceWithChannelsAndMembers } from '@veyvox/shared';

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

function seedNativeSpace(spaceId: string): void {
  testDb.insert(schema.spaces).values({
    id: spaceId,
    name: `Space ${spaceId}`,
    ownerId: OWNER_ID,
    inviteCode: `inv-${spaceId}`,
    visibility: 'public',
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
    createdAt: now,
  }).run();
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.close();
});

describe('ready payload discovery retirement', () => {
  it('omits the retired flag and retains both native spaces without its database column', async () => {
    const { buildReadyPayload } = await import('./handler.js');
    seedNativeSpace('sp-listed');
    seedNativeSpace('sp-unlisted');

    const message = JSON.parse(JSON.stringify({ type: 'ready', ...buildReadyPayload(OWNER_ID) })) as ReadyMessage;
    expect(message.spaces).toHaveLength(2);
    for (const space of message.spaces) expect(space).not.toHaveProperty('directoryListed');
    expect(testDb.select({ id: schema.spaces.id }).from(schema.spaces).all()).toEqual([
      { id: 'sp-listed' }, { id: 'sp-unlisted' },
    ]);
    expect((sqlite.pragma('table_info(spaces)') as Array<{ name: string }>).map(column => column.name)).not.toContain('directory_listed');
  });
  it('has no peer, approval or alternate identity maps and does not mutate native state', async () => {
    const { buildReadyPayload } = await import('./handler.js');
    seedNativeSpace('native-space');
    testDb.insert(schema.users).values({ id: 'friend', username: 'friend', passwordHash: 'synthetic', customStatus: 'Native activity', createdAt: now }).run();
    testDb.insert(schema.friends).values({ userId: OWNER_ID, friendId: 'friend', createdAt: now }).run();
    const before = sqlite.serialize();
    const ready = buildReadyPayload(OWNER_ID);
    for (const field of ['userActivityIdentities', 'rejectedPeerOrigins', 'awaitingApprovalPeerOrigins', 'activePeerOrigins', 'pendingApprovalCount']) expect(ready).not.toHaveProperty(field);
    for (const field of ['homeInstance', 'homeUserId', 'replicatedInstances']) expect(ready.user).not.toHaveProperty(field);
    expect(ready.userActivities.friend).toEqual([{ type: 'custom', name: 'Native activity' }]);
    expect(sqlite.serialize()).toEqual(before);
  });
});
