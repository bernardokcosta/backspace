# Juno progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the parent plan's execution approval gate.

**Goal:** Record final Juno awards once and expose a trustworthy per-space ranking.

**Architecture:** A pure standings function feeds a small synchronous persistence/
ranking module. The existing Juno room owns its pending result and crosses that
module's settlement seam; current routes still own auth and public projections.

**Tech Stack:** Existing shared TypeScript, Fastify, Drizzle/better-sqlite3, Vitest.

**Spec:** [juno-progression](../specs/2026-11-05-juno-upgrade/SPEC-juno-progression.md).

## Global constraints and review focus

Inherit every item from [the parent plan](2026-11-05-juno-upgrade.md).
No implementation is authorized until that plan and these task lists are approved.
Generated migration/meta files are the only necessary exception to the usual
small task file count; never split a migration from the schema it describes.

## File/responsibility map and interfaces

- `packages/shared/src/juno.ts`: additive optional scoreboard/profile fields and
  ranking response types. Keep commands/colors/card ids unchanged.
- `packages/server/src/games/junoStandings.ts`: pure, no DB/clock/randomness.
- `packages/server/src/games/junoProgression.ts`: record/re-read awards and query
  ranking; accept the existing `DB`/`DBHandle` where appropriate, not a new repo
  abstraction or an independently managed SQLite connection.
- `packages/server/src/games/juno.ts`: freeze starter roster and final outcome,
  pending-settlement retry and immutable public projection.
- `packages/server/src/routes/juno.ts`: existing game gates and new member-only
  ranking GET, host metadata capture and current sanitized player profiles.
- `packages/server/src/db/schema.ts` and generated `packages/server/drizzle/`:
  `junoRoundResults`, `junoRoundParticipants`, `junoPlayerStats`.
- Existing `utils/userDeletion.ts` and `routes/federation/handlers/attach.ts`:
  scrub/protect progression inside the transactions they already own.
- Colocated tests plus `packages/server/test/juno-e2e.test.ts` and a new
  `packages/server/test/juno-progression.federation-e2e.test.ts`: behavior checks.

### Provider contracts (define once in P1/P2/P4)

```ts
type JunoPlace = 1 | 2 | 3 | 4;
interface JunoStanding extends JunoPerson {
  place: JunoPlace | null;
  cardCount: number | null;
  xp: number;
  outcome: 'completed' | 'abandoned' | 'unranked';
}
interface JunoScoreboard {
  roundId: string;
  status: 'pending' | 'credited' | 'unranked';
  standings: JunoStanding[];
}
interface JunoRankingMember {
  user: User;
  nickname: string | null;
  rank: number | null;
  totalXp: number;
  wins: number;
  completedRounds: number;
}
interface JunoRankingPage {
  spaceId: string;
  limit: number;
  offset: number;
  total: number;
  entries: (JunoRankingMember & { rank: number })[];
  me: JunoRankingMember;
}
```

Extend `JunoPerson` with optional `user?: User` and `nickname?: string | null`
for a **server-hydrated current public profile**, and `JunoView` with
`scoreboard?: JunoScoreboard | null`. The pure engine never accepts a client
profile and never needs to keep a User record in its authority. Hydration is
after game projection and also applies to scoreboard rows, including leavers.

Server-only `JunoSettlement` is `{ roundId, spaceId, channelId, finishedAt,
scoringVersion: 1, result, standings }`; `channelId` may be null, and `result`
is a non-null `JunoView['result']`. DB rows store only ids/counts/outcomes/XP,
not these transient name/profile fields.

### P1: Define additive contracts and pure standings

**Files:** modify `packages/shared/src/juno.ts`; create
`packages/server/src/games/{junoStandings.ts,junoStandings.test.ts}`.

**Produces:** `buildJunoStandings(starters: readonly JunoPerson[], finishers:
readonly { userId: string; cardCount: number }[], winnerId: string | null,
result: NonNullable<JunoView['result']>): JunoStanding[]`.

- [ ] Write `ranks [0,2,2,7] as [1,2,2,4] with [120,80,80,20]`, 2/3-player,
  abandoned-starter, no-winner and immutable-input tests. An absent starter gets
  null place/count, zero XP and abandoned; present players in no-winner rounds
  get null place/zero XP/unranked. Spectators are never starters.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/games/junoStandings.test.ts`; observe RED
  on the missing function, not an environment/import configuration failure.
- [ ] Add the contracts above and implement the function using counts alone.
  Stable order inside a count tie follows the starter order; place is not
  changed by that order. Return copies, never mutate inputs or inspect faces.
- [ ] Rerun the test command and shared typecheck; expect GREEN. Record evidence.

### P2: Add generated schema and atomic award persistence

**Files:** modify `packages/server/src/db/schema.ts`; generated next SQL,
snapshot and `_journal.json` in `packages/server/drizzle/`; create
`packages/server/src/games/{junoProgression.ts,junoProgression.test.ts}`;
extend `packages/server/src/db/preSquashUpgrade.test.ts` if its schema assertions
need explicit coverage of these new tables.

**Produces:** `settleJunoRound(input: JunoSettlement, db?: DB): JunoScoreboard`.
The omitted DB uses `getDb()`; tests inject an actual isolated Drizzle/SQLite DB.

- [ ] Write SQLite-backed tests: repeating one round 100 times credits one
  120-XP win/one completed round, distinct rounds combine, different spaces
  stay isolated, no-winner rounds never change aggregates, reopen DB retains
  committed totals, deleting channel preserves XP and deleting space removes it.
- [ ] Observe RED. Add the three approved tables, FKs/unique keys and ranking
  index. Run `pnpm --filter @backspace/server db:generate`; inspect the generated
  delta for additive changes only. Do not assume the next migration's random
  tag in advance or edit its SQL/meta. Record generated paths in the ledger.
- [ ] Record normal winning rounds, per-user award rows and arithmetic aggregate
  increments atomically. A conflicting round key re-reads its original result,
  not its caller's new proposal. Do not recount deleted participants or accept
  the same key under another space. Unranked no-winner results have zero awards
  and need no artificial XP history. Load current names/profiles outside stored
  award fields; committed counts/places/XP are the immutable source of truth.
- [ ] Force a transaction failure after an earlier participant write (SQLite
  trigger/constraint or test injection into a real transaction), then assert no
  marker/partial rows/increments survived. Retrying credits once. Cover two
  DB handles/interleaved distinct settlements without lost increments.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/games/junoProgression.test.ts` and
  `pnpm --filter @backspace/server exec vitest run src/db/preSquashUpgrade.test.ts`; expect GREEN on
  fresh, existing squashed and pre-squash fixtures. No real runtime DB is used.

### P3: Freeze final results and integrate pending settlement

**Files:** modify `packages/server/src/games/{juno.ts,juno.test.ts}` and
`packages/server/src/routes/{juno.ts,juno.test.ts}`.

**Consumes:** P1 standings and P2 `settleJunoRound`.
**Produces:** optional `scoreboard` on existing game replies. Extend internal
`RoomOptions` with `spaceIdForChannel(channelId): string | null` and
`settle(input: JunoSettlement): JunoScoreboard` hooks, optional for existing
pure-engine fixtures; production routes always configure them. No wire command
accepts space/profile/XP. Capture space id at creation, not during a later retry.

- [ ] Add room tests for normal finish/final +2/+4 penalties, pre-finish
  departures, grace, winner/loser leaving after finish, rematch/new round key,
  no-winner causes, and 100 repeated reads. Start four players, remove one
  before the winning play and verify the frozen original starter still has
  an `abandoned` line with null place/count, zero XP and zero counter increment.
  Verify final placements never drift.
- [ ] Add failure tests: first persistence callback throws; result stays pending,
  no rematch can replace it, subsequent reads/ticks retry the **same frozen
  result**, even after the last seated player leaves. The final card is never
  played again. Observe RED before implementation.
- [ ] Capture the immutable starter roster in `start`, before any in-round
  presence cleanup can remove a person. At the normal-finish transition freeze
  counts/outcomes against that original roster, before subsequent presence
  pruning can rewrite the finishers. A departure before this transition is
  abandonment; after it, it is not. Keep card-rule functions free of DB effects.
  Retain the pending result in its existing room lifecycle, not a second queue.
- [ ] Wire the hooks to existing authenticated channel metadata and P2. Catch
  persistence failures at the existing integration seam so the interval stays
  alive, emit privacy-safe existing diagnostics, and expose pending rather than
  false credit. One retry per room settlement pass is sufficient; no new worker.
  Never resurrect a deleted user or space from a frozen pending result.
- [ ] Keep no-persistence engine fixtures compatible: omit scoreboard there,
  never claim a fake credited result. Production results become credited only
  after P2 succeeds; unranked no-winner results remain zero. Existing GET/POST
  schema/revision/error gates still refuse unauthorized/stale actions.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/games/juno.test.ts src/games/junoStandings.test.ts src/games/junoProgression.test.ts src/routes/juno.test.ts`; expect all engine,
  standings, persistence and route cases GREEN, including old privacy tests.

### P4: Read paginated member rankings consistently

**Files:** extend `packages/server/src/games/junoProgression.ts`; create
`packages/server/src/games/junoRanking.test.ts`.

**Produces:** `readJunoRanking(spaceId: string, viewerId: string,
query: { limit: number; offset: number }, db?: DB): JunoRankingPage`.

- [ ] Test `[240,160,160,40]` XP yields ranks `[1,2,2,4]`, including a tied group
  split by pagination, stable wins/id ordering without changing rank, an off-page
  viewer, and an unranked member with zero totals/null rank. Observe RED.
- [ ] Query stats joined to live human users/current space membership, excluding
  banned members as well as deleted/nonmembers. Compute ranks over the full
  filtered space population **before** slicing; `me` uses that same population.
  Use a consistent DB read for page/total/self. Never read every participant's
  hand or infer ranking from the four current players.
- [ ] Test leave/rejoin retention, deleted/bot/banned exclusion, different-space
  isolation and current nickname/avatar projection. Use `sanitizeUser`, never
  return a database user row/password hash. No channel ids/times or history in
  this response. Reuse existing asset-origin conventions, not a new resolver.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/games/junoRanking.test.ts`; expect GREEN.

### P5: Expose authorized ranking and current player profiles

**Files:** extend `packages/server/src/routes/juno.ts` and its existing test;
create `packages/server/src/routes/junoRanking.test.ts`.

**Consumes:** P4 read method and P1 response types.
**Produces:** `GET /api/spaces/:spaceId/juno/ranking` with defaults limit=25,
offset=0; limit 1–50, offset 0–1,000,000, finite integers only; `Cache-Control:
no-store`. It requires authenticated current human membership, not a voice socket.

- [ ] Add auth/nonmember/deleted/bot/banned and malformed query tests, plus
  a valid member not in voice; game GET/POST must still require live voice and
  VIEW_CHANNEL/CONNECT. Test attempts to post XP/result/profile fields remain
  rejected by the unchanged closed game command schema. Observe RED.
- [ ] Implement GET using existing auth/member/ban checks and error contract;
  do not add an award endpoint. Hydrate current game/scoreboard people using
  host row ids, the exact space membership/nickname and `sanitizeUser`; unknown
  or tombstoned profiles are not replaced with somebody from another origin.
- [ ] Check old clients can ignore additive fields and newer clients can see an
  old response without scoreboard/profiles. Preserve current `juno_updated`
  invalidation; no new WS event/capability flag is needed for this HTTP read.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/games/juno.test.ts src/games/junoStandings.test.ts src/games/junoProgression.test.ts src/games/junoRanking.test.ts src/routes/juno.test.ts src/routes/junoRanking.test.ts`; expect GREEN; server
  tsc passes and no private fields/opponent faces appear in route JSON fixtures.

### P6: Scrub account data and preserve authorized identity merges

**Files:** extend `packages/server/src/utils/userDeletion.ts`; create
`packages/server/src/utils/userDeletion.juno.test.ts`; extend
`packages/server/src/routes/federation/handlers/attach.ts`,
`packages/server/src/routes/federation.reattach.test.ts` and the progression module
only if a shared internal helper is needed by the transaction owner.

**Consumes:** P2 ledger/aggregate rows and existing deletion/reattach transactions.
**Produces:** cleanup inside `tombstoneUser`, and Juno row consolidation inside
the existing `mergeAndRebind` transaction **before** deleting a merged stub.

- [ ] Write actual-DB tombstone tests: stats/participant rows disappear while
  nonpersonal round marker remains; a pending frozen award cannot reintroduce
  the deleted participant. Observe RED, then add targeted deletes in the
  existing transaction, not a new asynchronous cleanup.
- [ ] Add reattach tests for unchanged host row id, stub-only progression,
  disjoint rounds on both identities, duplicate same-round rows, and rollback
  if the existing handle-claim guard refuses the reattach. Observe RED.
- [ ] Preserve separate-round awards; for a same-round identity collision keep
  one best credited row (higher XP/better place), not the sum. Rebuild affected
  totals from that person's deduplicated award rows inside the existing merge
  transaction; remove old-id aggregates before its cascade. Do not change auth,
  proof/handle guards, DM merging, or resolve identity by a name.
- [ ] Run `pnpm --filter @backspace/server exec vitest run src/utils/userDeletion.juno.test.ts` and
  `pnpm --filter @backspace/server exec vitest run src/routes/federation.reattach.test.ts`; expect GREEN.

### P7: Prove end-to-end durability and hosting-origin isolation

**Files:** extend `packages/server/test/juno-e2e.test.ts`; create
`packages/server/test/juno-progression.federation-e2e.test.ts`. Reuse existing
`test/helpers/{twoInstanceHarness,testUsers,wsListener,federationE2E}.ts` without
forking a second server/auth harness.

- [ ] Add HTTP/WS assertions to the real four-player game: result places/counts/
  XP match server state, spectator gets no award, ranking reflects it once, stale
  POST/duplicate GETs do not change it, and it is readable without joining voice.
- [ ] Reopen the host using the same isolated DB/secret: committed XP remains,
  running rooms do not. Add a second voice channel round in the same space and
  a second space; totals combine only in the first space. Observe RED first.
- [ ] In the two-instance harness use actual authenticated host-row identities;
  verify the remote member reads/earns on the space host while another space/
  host remains independent, and foreign ids/credentials cannot claim points.
  Never infer that an HTTP/WS fixture proves live multi-device media.
- [ ] Run `pnpm --filter @backspace/server exec vitest run test/juno-e2e.test.ts` and
  `pnpm --filter @backspace/server exec vitest run test/juno-progression.federation-e2e.test.ts` with
  suitable 180s+ runner limits, then `pnpm --filter @backspace/server typecheck:e2e`.
  Expect GREEN, cleaned-up own fixture processes, and no runtime-data access.

## Module completion

- [ ] P1–P7 evidence is in the parent execution ledger. No unresolved integrity,
  privacy, permission or identity finding; publish provider names exactly as
  defined here for the UI plan. No commit/release/deploy without authorization.
