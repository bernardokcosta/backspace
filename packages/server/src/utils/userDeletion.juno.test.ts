import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import { createJunoTestDb, seedJunoTestDb, junoTestSettlement } from '../games/junoTestDb.js';
let fixture: ReturnType<typeof createJunoTestDb>;
vi.mock('../db/index.js', () => ({ getDb: () => fixture.db, getRawDb: () => fixture.sqlite, schema }));
import { settleJunoRound } from '../games/junoProgression.js';
import { tombstoneUser } from './userDeletion.js';
beforeEach(() => { fixture = createJunoTestDb(); seedJunoTestDb(fixture.db); });
afterEach(() => fixture.sqlite.close());
describe('Juno account erasure', () => {
  it('scrubs stats and participant records, keeping the dedup key and other awards', () => {
    settleJunoRound(junoTestSettlement());
    tombstoneUser('b', { purgeContent: false });
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoRoundParticipants).where(eq(schema.junoRoundParticipants.userId, 'b')).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoRoundResults).all()).toHaveLength(1);
    settleJunoRound(junoTestSettlement());
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).get()?.totalXp).toBe(120);
  });
  it('does not revive an erased account from a delayed frozen settlement', () => {
    const pending = junoTestSettlement(); tombstoneUser('b', { purgeContent: false });
    expect(settleJunoRound(pending).standings.some(r => r.userId === 'b')).toBe(false);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).all()).toEqual([]);
  });
});
