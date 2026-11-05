import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createJunoTestDb, seedJunoTestDb } from './junoTestDb.js';
import * as schema from '../db/schema.js';
import { readJunoRanking } from './junoProgression.js';

let fixture: ReturnType<typeof createJunoTestDb>;
beforeEach(() => {
  fixture = createJunoTestDb(); seedJunoTestDb(fixture.db);
  for (const [i, id] of ['a', 'b', 'c', 'd'].entries()) fixture.db.insert(schema.junoPlayerStats).values({
    spaceId: 'space', userId: id, totalXp: [240, 160, 160, 40][i], wins: i === 2 ? 2 : 1, completedRounds: 2,
  }).run();
});
afterEach(() => fixture.sqlite.close());
describe('space Juno ranking', () => {
  it('computes shared ranks before pagination and includes an off-page self', () => {
    const page = readJunoRanking('space', 'a', { limit: 1, offset: 1 }, fixture.db);
    expect(page.entries.map(r => [r.user.id, r.rank])).toEqual([['c', 2]]);
    expect(page.me).toMatchObject({ rank: 1, totalXp: 240, wins: 1, completedRounds: 2 });
    expect(page.total).toBe(4);
    const next = readJunoRanking('space', 'a', { limit: 2, offset: 2 }, fixture.db);
    expect(next.entries.map(r => r.rank)).toEqual([2, 4]);
    expect(JSON.stringify(page)).not.toContain('passwordHash');
    expect(page.me.user.avatar).toBe('a.webp');
  });
  it('reports zero totals and no rank for a current member without games', () => {
    expect(readJunoRanking('space', 'watcher', { limit: 25, offset: 0 }, fixture.db).me)
      .toMatchObject({ rank: null, totalXp: 0, wins: 0, completedRounds: 0 });
    expect(readJunoRanking('other', 'a', { limit: 25, offset: 0 }, fixture.db).total).toBe(0);
  });
  it('hides leavers without deleting their XP, and excludes bots/deleted/banned users', () => {
    fixture.db.delete(schema.spaceMembers).where(and(eq(schema.spaceMembers.spaceId, 'space'), eq(schema.spaceMembers.userId, 'b'))).run();
    expect(readJunoRanking('space', 'a', { limit: 25, offset: 0 }, fixture.db).total).toBe(3);
    fixture.db.insert(schema.spaceMembers).values({ spaceId: 'space', userId: 'b', joinedAt: 2, nickname: 'Bee' }).run();
    expect(readJunoRanking('space', 'b', { limit: 25, offset: 0 }, fixture.db).me.nickname).toBe('Bee');
    fixture.db.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, 'b')).run();
    fixture.db.update(schema.users).set({ isBot: 1 }).where(eq(schema.users.id, 'c')).run();
    fixture.db.insert(schema.bans).values({ spaceId: 'space', userId: 'd', createdAt: 1 }).run();
    expect(readJunoRanking('space', 'a', { limit: 25, offset: 0 }, fixture.db).entries.map(r => r.user.id)).toEqual(['a']);
  });
});
