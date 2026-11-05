# Spec: juno-progression

Status: approved by the user on 2026-11-05. Common objective, stack, paths, commands, style and boundaries
are in [README.md](README.md).

## Objective

Produce a trustworthy final scoreboard and a persistent Juno ranking for the
space hosting the match, reusing the existing authoritative engine/transport.
Clients never submit placements, hand counts, points, user ids or a space id to
claim rewards; the server derives them from authenticated room/round state.

## Final standings and counters

- Freeze the starter roster and a unique round identity. Reuse the existing
  per-round table UUID where suitable; a rematch never reuses the award key.
- On a normal `emptyHand` finish, the winner is first. Remaining non-abandoned
  players are ordered by final hand count, **after** final-card draw penalties.
- Use competition ranks: `1, 2, 2, 4`, not `1, 2, 2, 3`. The two second-place
  players both earn 80 XP; the fourth earns 20. With two players award 120/80.
- A player removed before settlement is marked abandoned, with no place, zero
  XP and no completed-round/win increment. They do not reserve a ranked place.
  Presence within the existing reconnect grace retains eligibility.
- Every eligible finisher receives one completed-round increment. Only the
  winner receives one win. All three totals are nonnegative integers.
- `playersLeft`, `stalemate`, `expired`, disposal/restart and cancellation do not
  award XP or increment completed-round/win totals. Do not invent a winner.
- Final standings/awards are immutable: later leaves, host succession, channel
  deletion, rematches, refreshes or snapshot reads cannot recalculate them.
- Do not persist hands, card order, IP addresses, voice/media or display-name/
  avatar snapshots. Counts/outcomes are enough; live profile data is resolved
  through existing platform projections.

## Persistence and settlement seam

Keep SQLite/Drizzle out of the pure card rules. The room lifecycle crosses a
small internal settlement seam which owns atomicity, idempotency and ranking.
Use the existing SQLite transaction mechanism, not an external job/queue.

Proposed additive data model, with generated migration:

| Table | Required meaning |
|---|---|
| `juno_round_results` | Unique round id, hosting space FK/cascade, optional channel reference/set-null, finish time and scoring version |
| `juno_round_participants` | Unique (round id, host user id), eligible/abandoned outcome, place if any, final card count if applicable, awarded XP; round/user FKs |
| `juno_player_stats` | Unique (space id, host user id), total XP, wins, completed rounds; space/user FKs and ranking index |

Insert the round marker, participant rows and all aggregate increments in one
transaction. A repeated settlement must return the original outcome without
incrementing counters. Distinct rounds finishing in different channels of the
same space add atomically without lost updates.

Only present XP as credited after commit. On a write failure, do not falsely
show successful awards, discard the pending outcome, or replace the round with
a rematch. Retrying the same settlement uses the same key; no client mutation
is automatically replayed. A crash before durable confirmation may lose the
unconfirmed ephemeral round, but never a committed award or count it twice.

Deleting a channel does not erase its committed space XP. Deleting a space
cascades its rankings/results. A normal leave/kick hides the former member from
the ranking, but retains their totals if the same account later rejoins. Account
deletion, including soft tombstones, explicitly removes that account's stats and
participant records through the existing deletion flow; do not rely only on an
FK cascade when a user row is retained. Keep nonpersonal round deduplication keys.
Check existing account reattachment/detachment/merge paths so one host identity
does not lose or duplicate awards; reuse those flows, never match by display name.

## Public interface and access

- Extend the existing private game projection with an optional, backwards-
  compatible final-scoreboard field: round identity, authoritative per-player
  place/count/outcome/XP and whether credit is confirmed. Old hosts may omit it;
  the UI must not invent XP for them.
- Add authenticated `GET /api/spaces/:spaceId/juno/ranking?limit=25&offset=0`.
  Validate finite integer pagination (limit 1–50, nonnegative bounded offset).
  Return rows, total ranked members, pagination and the viewer's own summary/
  rank even when outside the page. A member with no games has zero totals and
  no rank; only members with at least one credited round occupy ranking rows.
- Rank by total XP descending. Equal XP shares a competition rank; stable
  ordering within that tie uses wins descending then host user id, without
  pretending that order is a distinct rank.
- Reads require an authenticated human who is a current member of that space;
  nonmembers/banned/deleted users and bots cannot read. Reading the ranking does
  not require joining voice. Game endpoints keep their stricter voice/channel
  permission gates unchanged. Existing rate limits still apply.
- Return current public player identity/avatar data through existing sanitized
  user projections and upload URLs. Do not expose private fields, historical
  channel ids/names, private-channel participation or opponent card faces.
- The space's host owns all writes/reads. Clients call `getApiForOrigin` for that
  space and use that host's user row id. There is no global XP merge/new S2S
  relay. Equal ids from different origins/spaces must remain isolated.
- Reuse `juno_updated` for table invalidation. Re-read ranking on open and after
  a confirmed result; do not add a broad WS event unless a concrete need is
  established. Keep ranking fetches keyed by account/origin/space with stale-
  response guards and permission-loss/logout cleanup, not persisted privately.

## Success criteria and tests

Use existing colocated Vitest suites plus isolated real SQLite and HTTP/WS
acceptance; mock-only tests are not sufficient for persistence.

1. Award tables, all 2–4-player placements, ties, final action penalties,
   abandonment/reconnect, spectators and every no-winner finish match the rules.
2. A hundred repeated reads/settlement attempts and stale mutations do not change
   credited totals. Separate concurrent channel finishes add correctly.
3. Force a persistence failure: there is no partial increment/false success;
   retry credits exactly once. Committed results survive reopening the DB.
4. First install and upgrade migrations work without changing existing runtime
   records; channel/space deletion, member leave/rejoin and account tombstoning
   follow the retention rules above.
5. Auth, membership/bans/bots, malformed pagination, private-field exclusion,
   federation identities and same-id/different-origin/space cases are covered.
6. Pagination, tied ranks across page boundaries and the off-page viewer's rank
   agree. Client races never install another account/space/origin's ranking.
7. The existing game rules/privacy and mixed-version clients/hosts still work;
   historical ephemeral games never acquire fabricated retroactive XP.
