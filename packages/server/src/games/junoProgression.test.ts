import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createJunoTestDb, seedJunoTestDb, junoTestSettlement as settlement } from './junoTestDb.js';
import * as schema from '../db/schema.js';
import { settleJunoRound } from './junoProgression.js';
let fixture: ReturnType<typeof createJunoTestDb>;
beforeEach(() => { fixture = createJunoTestDb(); seedJunoTestDb(fixture.db); });
afterEach(() => fixture.sqlite.close());
describe('durable Juno progression', () => {
  it('accepts the expanded rare-card deck without changing XP and still refuses impossible hand counts', () => {
    const input = settlement(); input.standings = input.standings.slice(0, 2); input.standings[1]!.cardCount = 109;
    expect(settleJunoRound(input, fixture.db).standings[1]).toMatchObject({ place: 2, xp: 80, cardCount: 109 });
    const invalid = settlement('invalid'); invalid.standings[1]!.cardCount = 111;
    expect(() => settleJunoRound(invalid, fixture.db)).toThrow('Invalid Juno award');
  });
  it('never writes any progression for a computer practice settlement', () => {
    const input = settlement(); input.standings[1]!.computer = 1;
    expect(settleJunoRound(input, fixture.db)).toMatchObject({ status: 'unranked' });
    expect(fixture.db.select().from(schema.junoRoundResults).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoRoundParticipants).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
  });
  it('credits original native participants even if obsolete redirect data is supplied', () => {
    const input = { ...settlement(), recipientIds: new Map([['a', 'b']]) };
    const result = settleJunoRound(input, fixture.db);
    expect(result.standings.find(row => row.userId === 'a')).toMatchObject({ place: 1, xp: 120 });
    expect(result.standings.find(row => row.userId === 'b')).toMatchObject({ place: 2, xp: 80 });
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).get())
      .toMatchObject({ totalXp: 80, wins: 0, completedRounds: 1 });
    // Every participant retains their own frozen award across retries.
    expect(result.standings.find(row => row.userId === 'd')).toMatchObject({ place: 4, xp: 20 });
    for (let i = 0; i < 100; i++) settleJunoRound(input, fixture.db);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'b')).get()?.totalXp).toBe(80);
  });
  it('keeps abandoned starters after ranked finishers without awarding counters', () => {
    const input = settlement();
    input.standings = [input.standings[0]!, input.standings[1]!,
      { ...input.standings[2]!, place: null, xp: 0, cardCount: null, outcome: 'abandoned' },
      { ...input.standings[3]!, place: 3, xp: 40 }];
    const result = settleJunoRound(input, fixture.db);
    expect(result.standings.map(row => row.userId)).toEqual(['a', 'b', 'd', 'c']);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'c')).all()).toEqual([]);
  });
  it('records one credit across 100 retries and never trusts a changed duplicate proposal', () => {
    const input = settlement();
    for (let i = 0; i < 100; i++) expect(settleJunoRound(input, fixture.db).status).toBe('credited');
    const repeated = settlement(); repeated.standings[0]!.xp = 999;
    expect(settleJunoRound(repeated, fixture.db).standings[0]!.xp).toBe(120);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).get())
      .toMatchObject({ totalXp: 120, wins: 1, completedRounds: 1 });
    expect(fixture.db.select().from(schema.junoRoundParticipants).all()).toHaveLength(4);
  });
  it('combines different rounds without mixing spaces', () => {
    settleJunoRound(settlement('one'), fixture.db); settleJunoRound(settlement('two'), fixture.db);
    settleJunoRound(settlement('three', 'other'), fixture.db);
    const rows = fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).all();
    expect(rows.map(r => [r.spaceId, r.totalXp]).sort()).toEqual([['other', 120], ['space', 240]]);
    expect(() => settleJunoRound(settlement('one', 'other'), fixture.db)).toThrow();
  });
  it('rolls the whole settlement back on a real SQLite failure, then retries once', () => {
    fixture.sqlite.exec("CREATE TRIGGER fail_juno BEFORE INSERT ON juno_round_participants WHEN NEW.user_id = 'b' BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    expect(() => settleJunoRound(settlement(), fixture.db)).toThrow('injected failure');
    expect(fixture.db.select().from(schema.junoRoundResults).all()).toEqual([]);
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
    fixture.sqlite.exec('DROP TRIGGER fail_juno');
    expect(settleJunoRound(settlement(), fixture.db).status).toBe('credited');
  });
  it('does not award no-winner results or resurrect deleted people/spaces', () => {
    const input = settlement(); input.result = 'playersLeft';
    expect(settleJunoRound(input, fixture.db).status).toBe('unranked');
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
    fixture.db.update(schema.users).set({ isDeleted: 1 }).where(eq(schema.users.id, 'a')).run();
    expect(settleJunoRound(settlement(), fixture.db).standings.some(r => r.userId === 'a')).toBe(false);
    expect(fixture.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).all()).toEqual([]);
    fixture.db.delete(schema.spaces).where(eq(schema.spaces.id, 'space')).run();
    expect(settleJunoRound(settlement('later'), fixture.db).status).toBe('unranked');
  });
  it('keeps XP when a channel is deleted and removes it with the space', () => {
    settleJunoRound(settlement(), fixture.db);
    fixture.db.delete(schema.channels).where(eq(schema.channels.id, 'voice')).run();
    expect(fixture.db.select().from(schema.junoRoundResults).get()?.channelId).toBeNull();
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toHaveLength(4);
    fixture.db.delete(schema.spaces).where(eq(schema.spaces.id, 'space')).run();
    expect(fixture.db.select().from(schema.junoPlayerStats).all()).toEqual([]);
  });
  it('survives reopening SQLite and interleaved writes from two connections', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'juno-durable-')); const filename = path.join(directory, 'test.db');
    const first = createJunoTestDb(filename); seedJunoTestDb(first.db);
    const second = createJunoTestDb(filename);
    try {
      settleJunoRound(settlement('first'), first.db); settleJunoRound(settlement('second'), second.db);
      settleJunoRound(settlement('first'), second.db);
    } finally { first.sqlite.close(); second.sqlite.close(); }
    const reopened = createJunoTestDb(filename);
    try { expect(reopened.db.select().from(schema.junoPlayerStats).where(eq(schema.junoPlayerStats.userId, 'a')).get()?.totalXp).toBe(240); }
    finally { reopened.sqlite.close(); }
  });
});
