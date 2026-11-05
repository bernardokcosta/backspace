import { and, asc, desc, eq, gt, inArray, notExists, or, sql } from 'drizzle-orm';
import type { JunoPerson, JunoRankingPage, JunoScoreboard, JunoSnapshot, JunoStanding, JunoView } from '@backspace/shared/src/juno.js';
import { getDb, schema, type DB, type DBHandle } from '../db/index.js';
import { buildJunoStandings } from './junoStandings.js';
import { sanitizeUser } from '../utils/sanitize.js';

/** Application-local only: emitted after the proof-authorized DB merge commits. */
export const JUNO_ACCOUNT_MERGED_EVENT = 'juno:account-merged';

export interface JunoSettlement {
  roundId: string;
  spaceId: string;
  channelId: string | null;
  finishedAt: number;
  scoringVersion: 1;
  result: NonNullable<JunoView['result']>;
  standings: JunoStanding[];
  /** Private per-round redirects; never accepted from a game command or serialized. */
  recipientIds?: ReadonlyMap<string, string>;
}

function unranked(input: JunoSettlement): JunoScoreboard {
  return { roundId: input.roundId, status: 'unranked', standings: input.standings.map(row => ({
    userId: row.userId, name: row.name, place: null, xp: 0, cardCount: row.cardCount,
    outcome: row.outcome === 'abandoned' ? 'abandoned' : 'unranked',
  })) };
}

function storedScoreboard(db: DBHandle, roundId: string): JunoScoreboard {
  const rows = db.select({ award: schema.junoRoundParticipants, user: schema.users }).from(schema.junoRoundParticipants)
    .innerJoin(schema.users, eq(schema.users.id, schema.junoRoundParticipants.userId))
    .where(and(eq(schema.junoRoundParticipants.roundId, roundId), eq(schema.users.isDeleted, 0)))
    .orderBy(sql`${schema.junoRoundParticipants.place} IS NULL`, asc(schema.junoRoundParticipants.place), asc(schema.junoRoundParticipants.userId)).all();
  return { roundId, status: 'credited', standings: rows.map(({ award, user }) => ({
    userId: user.id, name: user.displayName ?? user.username, place: award.place,
    cardCount: award.cardCount, xp: award.xp, outcome: award.outcome,
  })) };
}

/** The round key, all awards and arithmetic counters commit together, or not at all. */
export function settleJunoRound(input: JunoSettlement, database?: DB): JunoScoreboard {
  if (input.standings.some(row => row.computer)) return { roundId: input.roundId, status: 'unranked', standings: input.standings.map(row => ({ ...row, xp: 0 })) };
  if (input.result !== 'emptyHand') return unranked(input);
  const db = database ?? getDb();
  return db.transaction(tx => {
    const existing = tx.select().from(schema.junoRoundResults).where(eq(schema.junoRoundResults.roundId, input.roundId)).get();
    if (existing) {
      if (existing.spaceId !== input.spaceId) throw new Error('Juno round belongs to another space');
      return storedScoreboard(tx, input.roundId);
    }
    if (!tx.select({ id: schema.spaces.id }).from(schema.spaces).where(eq(schema.spaces.id, input.spaceId)).get()) return unranked(input);
    const winner = input.standings.find(row => row.place === 1 && row.outcome === 'completed');
    if (!winner || winner.cardCount !== 0 || input.standings.length < 2 || input.standings.length > 4
      || new Set(input.standings.map(row => row.userId)).size !== input.standings.length) throw new Error('Invalid Juno settlement');
    const computed = buildJunoStandings(input.standings,
      input.standings.filter(row => row.outcome !== 'abandoned').map(row => ({ userId: row.userId, cardCount: row.cardCount! })),
      winner.userId, input.result);
    for (const row of computed) {
      const proposed = input.standings.find(p => p.userId === row.userId)!;
      if (row.place !== proposed.place || row.xp !== proposed.xp || row.outcome !== proposed.outcome
        || row.cardCount !== null && (!Number.isInteger(row.cardCount) || row.cardCount < 0 || row.cardCount > 108)) throw new Error('Invalid Juno award');
    }
    const channel = input.channelId ? tx.select().from(schema.channels).where(eq(schema.channels.id, input.channelId)).get() : undefined;
    if (channel && channel.spaceId !== input.spaceId) throw new Error('Juno channel belongs to another space');
    tx.insert(schema.junoRoundResults).values({ roundId: input.roundId, spaceId: input.spaceId,
      channelId: channel?.id ?? null, finishedAt: input.finishedAt, scoringVersion: input.scoringVersion }).run();
    const awards = new Map<string, JunoStanding>();
    for (const row of computed) {
      const userId = input.recipientIds?.get(row.userId) ?? row.userId;
      const existingAward = awards.get(userId);
      // Reattachment can consolidate two frozen starters. Keep their best award,
      // not two increments, without recalculating anyone else's frozen place.
      if (!existingAward || row.xp > existingAward.xp) awards.set(userId, { ...row, userId });
    }
    for (const row of awards.values()) {
      const user = tx.select().from(schema.users).where(eq(schema.users.id, row.userId)).get();
      // A delayed settlement may outlive account erasure. Never recreate its data.
      if (!user || user.isDeleted || user.isBot) continue;
      tx.insert(schema.junoRoundParticipants).values({ roundId: input.roundId, userId: row.userId,
        place: row.place, cardCount: row.cardCount, xp: row.xp, outcome: row.outcome }).run();
      if (row.outcome !== 'completed') continue;
      const wins = row.place === 1 ? 1 : 0;
      tx.insert(schema.junoPlayerStats).values({ spaceId: input.spaceId, userId: row.userId,
        totalXp: row.xp, wins, completedRounds: 1 }).onConflictDoUpdate({
        target: [schema.junoPlayerStats.spaceId, schema.junoPlayerStats.userId], set: {
          totalXp: sql`${schema.junoPlayerStats.totalXp} + ${row.xp}`,
          wins: sql`${schema.junoPlayerStats.wins} + ${wins}`,
          completedRounds: sql`${schema.junoPlayerStats.completedRounds} + 1`,
        },
      }).run();
    }
    return storedScoreboard(tx, input.roundId);
  }, { behavior: 'immediate' });
}

/** Membership filtering and window rank precede slicing, including the viewer's rank. */
export function readJunoRanking(spaceId: string, viewerId: string, query: { limit: number; offset: number }, database?: DB): JunoRankingPage {
  const db = database ?? getDb();
  return db.transaction(tx => {
    const eligible = and(eq(schema.users.isDeleted, 0), eq(schema.users.isBot, 0),
      notExists(tx.select({ id: schema.bans.userId }).from(schema.bans)
        .where(and(eq(schema.bans.spaceId, spaceId), eq(schema.bans.userId, schema.users.id)))));
    const viewer = tx.select({ user: schema.users, nickname: schema.spaceMembers.nickname }).from(schema.spaceMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.spaceMembers.userId))
      .where(and(eq(schema.spaceMembers.spaceId, spaceId), eq(schema.users.id, viewerId), eligible)).get();
    if (!viewer) throw new Error('Juno ranking viewer is not a current human member');
    const ranked = tx.select({ userId: schema.junoPlayerStats.userId, totalXp: schema.junoPlayerStats.totalXp,
      wins: schema.junoPlayerStats.wins, completedRounds: schema.junoPlayerStats.completedRounds,
      rank: sql<number>`rank() over (order by ${schema.junoPlayerStats.totalXp} desc)`.as('rank'),
    }).from(schema.junoPlayerStats)
      .innerJoin(schema.users, eq(schema.users.id, schema.junoPlayerStats.userId))
      .innerJoin(schema.spaceMembers, and(eq(schema.spaceMembers.userId, schema.users.id), eq(schema.spaceMembers.spaceId, spaceId)))
      .where(and(eq(schema.junoPlayerStats.spaceId, spaceId), gt(schema.junoPlayerStats.completedRounds, 0), eligible)).as('ranked');
    const entries = tx.select({ stats: { rank: ranked.rank, totalXp: ranked.totalXp, wins: ranked.wins, completedRounds: ranked.completedRounds },
      user: schema.users, nickname: schema.spaceMembers.nickname }).from(ranked)
      .innerJoin(schema.users, eq(schema.users.id, ranked.userId))
      .innerJoin(schema.spaceMembers, and(eq(schema.spaceMembers.userId, ranked.userId), eq(schema.spaceMembers.spaceId, spaceId)))
      .orderBy(desc(ranked.totalXp), desc(ranked.wins), asc(ranked.userId)).limit(query.limit).offset(query.offset).all()
      .map(({ stats, user, nickname }) => ({ user: sanitizeUser(user), nickname, rank: stats.rank,
        totalXp: stats.totalXp, wins: stats.wins, completedRounds: stats.completedRounds }));
    const total = tx.select({ value: sql<number>`count(*)` }).from(ranked).get()!.value;
    const own = tx.select().from(ranked).where(eq(ranked.userId, viewerId)).get();
    return { spaceId, ...query, total, entries, me: { user: sanitizeUser(viewer.user), nickname: viewer.nickname,
      rank: own?.rank ?? null, totalXp: own?.totalXp ?? 0, wins: own?.wins ?? 0, completedRounds: own?.completedRounds ?? 0 } };
  });
}

/** Profiles are current platform projections, never persisted names/avatars on the award ledger. */
export function hydrateJunoSnapshot(snapshot: JunoSnapshot, spaceId: string, database?: DB): JunoSnapshot {
  if (!snapshot.game) return snapshot;
  const db = database ?? getDb(); const game = snapshot.game;
  const ids = [...new Set([...game.players, ...(game.scoreboard?.standings ?? [])].map(p => p.userId))];
  if (!ids.length) return snapshot;
  const profiles = db.select({ user: schema.users, nickname: schema.spaceMembers.nickname }).from(schema.users)
    .leftJoin(schema.spaceMembers, and(eq(schema.spaceMembers.userId, schema.users.id), eq(schema.spaceMembers.spaceId, spaceId)))
    .where(inArray(schema.users.id, ids)).all();
  const hydrate = <T extends JunoPerson>(person: T): T => {
    if (person.computer) return person;
    const profile = profiles.find(p => p.user.id === person.userId);
    if (!profile || profile.user.isDeleted) return { ...person, name: 'Deleted User', user: profile ? sanitizeUser(profile.user) : undefined, nickname: null };
    return { ...person, name: profile.nickname ?? profile.user.displayName ?? profile.user.username,
      user: sanitizeUser(profile.user), nickname: profile.nickname };
  };
  return { ...snapshot, game: { ...game, players: game.players.map(hydrate),
    ...(game.scoreboard ? { scoreboard: { ...game.scoreboard, standings: game.scoreboard.standings.map(hydrate) } } : {}) } };
}

/** Called only inside the existing proof-authorized reattach transaction. */
export function mergeJunoProgression(db: DBHandle, sourceId: string, targetId: string): void {
  if (sourceId === targetId) return;
  const source = db.select().from(schema.junoRoundParticipants).where(eq(schema.junoRoundParticipants.userId, sourceId)).all();
  for (const award of source) {
    const target = db.select().from(schema.junoRoundParticipants)
      .where(and(eq(schema.junoRoundParticipants.roundId, award.roundId), eq(schema.junoRoundParticipants.userId, targetId))).get();
    if (target && target.xp >= award.xp) continue;
    if (target) db.delete(schema.junoRoundParticipants)
      .where(and(eq(schema.junoRoundParticipants.roundId, award.roundId), eq(schema.junoRoundParticipants.userId, targetId))).run();
    db.insert(schema.junoRoundParticipants).values({ ...award, userId: targetId }).run();
  }
  db.delete(schema.junoRoundParticipants).where(eq(schema.junoRoundParticipants.userId, sourceId)).run();
  db.delete(schema.junoPlayerStats).where(or(eq(schema.junoPlayerStats.userId, sourceId), eq(schema.junoPlayerStats.userId, targetId))).run();
  const totals = db.select({ spaceId: schema.junoRoundResults.spaceId,
    totalXp: sql<number>`sum(${schema.junoRoundParticipants.xp})`,
    wins: sql<number>`sum(case when ${schema.junoRoundParticipants.place} = 1 then 1 else 0 end)`,
    completedRounds: sql<number>`count(*)`,
  }).from(schema.junoRoundParticipants).innerJoin(schema.junoRoundResults, eq(schema.junoRoundResults.roundId, schema.junoRoundParticipants.roundId))
    .where(and(eq(schema.junoRoundParticipants.userId, targetId), eq(schema.junoRoundParticipants.outcome, 'completed')))
    .groupBy(schema.junoRoundResults.spaceId).all();
  for (const total of totals) db.insert(schema.junoPlayerStats).values({ ...total, userId: targetId }).run();
}
