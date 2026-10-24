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

function seedSpace(spaceId: string, afkChannelId: string | null, afkTimeoutSeconds: number): void {
  testDb.insert(schema.spaces).values({
    id: spaceId,
    name: `Space ${spaceId}`,
    ownerId: OWNER_ID,
    inviteCode: `inv-${spaceId}`,
    visibility: 'public',
    afkChannelId,
    afkTimeoutSeconds,
    createdAt: now,
  }).run();
  testDb.insert(schema.spaceMembers).values({ spaceId, userId: OWNER_ID, joinedAt: now }).run();
}

interface ReadyMessage {
  type: string;
  spaces: SpaceWithChannelsAndMembers[];
}

beforeEach(() => {
  const sqlite = new Database(':memory:');
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
});

describe('ready payload AFK projection', () => {
  it('carries the configured channel and timeout, with defaults when unset', async () => {
    const { buildReadyPayload } = await import('./handler.js');
    seedSpace('sp-afk', 'voice-1', 900);
    seedSpace('sp-plain', null, 300);

    const message = JSON.parse(JSON.stringify({ type: 'ready', ...buildReadyPayload(OWNER_ID) })) as ReadyMessage;
    const configured = message.spaces.find(s => s.id === 'sp-afk');
    const plain = message.spaces.find(s => s.id === 'sp-plain');
    expect(configured?.afkChannelId).toBe('voice-1');
    expect(configured?.afkTimeoutSeconds).toBe(900);
    expect(plain?.afkChannelId).toBeNull();
    expect(plain?.afkTimeoutSeconds).toBe(300);
  });
});
