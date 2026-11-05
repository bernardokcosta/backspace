# Spec: Juno participant reports

## Objective and decisions

Replace the automatic missed-JUNO draw with a participant-triggered two-card
penalty. The user confirmed **two cards**, selected the proposed no-pause
approach and explicitly approved this design and its defaults.

Approved defaults: ten seconds start when a play
leaves one unannounced card; only other seated human players may report; computers
do not automatically report; a changed hand, departure or finished round closes
the opportunity early. No pause, extra turn delay or delayed victory is introduced.
Keep the current explicit JUNO button and legacy play.announce behavior: the
announcement must precede/accompany the play down to one, not repair a miss later.

Success means that forgetting alone never draws cards. With no valid report the
player keeps that one card and ordinary play continues.

## Scope and architectural note

The existing authoritative round, authenticated channel POST, revision checks,
one-second room sweep, private views, origin-aware store and shared table already
own this behavior. Extend them; do not introduce a report service, database table,
new route, WS/S2S event, timer per player or dependency. Alternatives considered:
pausing every turn for ten seconds harms the requested pace; retaining an
automatic timeout penalty contradicts the requested opt-in report.

One capability crosses the existing shared contract, engine/route and UI. Human
XP/settlement and practice's no-persistence rule are unchanged. This is local
feature work: approval of this spec alone did not authorize publishing. The user's
subsequent instruction explicitly authorizes commit/push on master, v1.16.5 tag/
release and deployment to the same VM only after implementation, tests and review
pass. Keep the completed 1.16.4 intact until that gated deployment.

## Rule and concurrency contract

- A legal play leaving exactly one card without an accepted JUNO announcement
  creates a unique report opportunity with a server deadline `playedAt + 10_000`.
  There is no immediate draw. Announced plays create no opportunity.
- Any other seated human in the same authorized voice game may report, even out
  of turn. Spectators, the accused, outsiders and computer actor ids may not.
- A report is valid only while the round is playing, that specific opportunity is
  active, the accused still has one unannounced card, and `now < deadline` on the
  server. At exactly ten seconds it is invalid, including between sweep ticks.
- The first valid report consumes that opportunity and draws two using the
  existing recycle/deck-availability rules. Duplicate/concurrent reports cannot
  apply another penalty; never fabricate cards if fewer than two can be drawn.
- Reporting does not advance/reverse a turn, skip anyone, reset its timer, change
  the top/color, or erase the current player's drawn-card restriction.
- Multiple players may have independent opportunities within the same ten-second
  interval. Another player's ordinary play does not cancel them. Expiry, the
  accused gaining cards/leaving, a successful report or round completion does.
  A later separate missed call gets a different opportunity id.
- If the accused legally plays their last card before the window expires, ordinary
  immediate victory still ends the round and all report opportunities. Reports
  never reopen a finished game or alter a frozen/credited scoreboard.
- Keep expected revision validation. Stale requests refresh state but never retry
  mutations automatically. Invalid reports add no penalty to either participant.
- Existing computers still announce on their plays and use only their own hand/
  public state. This change does not add automated accusations or new AI behavior.

## Additive interfaces and presentation

Extend existing JunoAction with `report { targetUserId, opportunityId }`; validate
bounded ids in the current POST schema, resolving the reporter only from the
authenticated host-instance identity. Never accept a reporter id from the client.

Add optional `supportsReports` and a bounded list of public opportunities
`{ id, targetUserId, remainingMs }` to JunoView. Only serialize ids/public timing,
never hidden hands or draw order. At most one opportunity per seated player.
Anchor the client countdown to the existing observedAt/second beat, not absolute
client time. An absent capability on an older host hides report UI and retains
that host's existing rules; rule text must match the host's capability.

Use a stable confirmed public report move with reporter, target and actual drawn
amount, reusing the existing lastMove/id feedback channel. Add a compact accessible
**Denunciar** action at the eligible opponent's existing seat, with remaining
seconds and localized target name. Disable while disconnected/pending/expired;
never show an actionable report for self or spectators. Reports are explicit
button actions, not avatar clicks that replace opening the real profile.
Confirm who reported whom and the cards actually drawn; no optimistic penalty or
replayed effect on polling/initial mount. Reuse current effects/reduced motion,
original artwork, actual mosaic height/width containment and five catalogs.

## Files and code style

- `packages/shared/src/juno.ts`: additive types, report duration constant.
- `packages/server/src/games/juno.ts`, `juno.test.ts`, `junoReports.test.ts`,
  `junoBot.test.ts`: authority,
  private projection, expiry/lifecycle and practice regressions.
- `packages/server/src/routes/juno.ts`, `juno.test.ts`, `test/juno-e2e.test.ts`:
  current schema/auth/voice/revision gates and real HTTP/WS reporting.
- `packages/web/src/components/games/`: Match/Effects/rules, CSS and focused tests;
  existing `junoStore`/tests as needed for origin/stale/countdown behavior.
- Five voice catalogs; `docs/systems/{juno,api,client-federation}.md` where their
  actual contracts change. No design-system/schema/voice transport changes.

Keep strict TypeScript, no any, existing naming/error codes and synchronous
transitions. Example shape, not a new abstraction:

```ts
if (now >= opportunity.deadline) refuse('juno_invalid_move');
```

## Validation and commands

Use the existing audited explicit-file Vitest launcher, temporary DB/uploads/
backups and fake engine time; never run default dotenv-sensitive test discovery.
Commands from the repository root in the established Windows environment:

```bash
node C:/Users/berna/AppData/Local/Temp/opencode/juno-upgrade-20261105/run-tests.cjs server src/games/juno.test.ts src/games/junoReports.test.ts src/games/junoBot.test.ts src/routes/juno.test.ts test/juno-e2e.test.ts
node C:/Users/berna/AppData/Local/Temp/opencode/juno-upgrade-20261105/run-tests.cjs web src/components/games/JunoMatch.test.tsx src/components/games/JunoEffects.test.tsx src/stores/junoStore.test.ts
pnpm build
pnpm typecheck
pnpm --filter @backspace/server typecheck:e2e
pnpm --filter @backspace/desktop build:ts
pnpm lint
```

Test no immediate/expired automatic penalty, 9,999/10,000ms boundary without a
sweep, report outside one's turn, duplicates/races/stale ids, multiple targets,
own/spectator/bot/unauthorized actors, card conservation/recycle, unchanged turn/
timer/drawn restriction, new missed-call identities, departure/expiry/rematch,
immediate victory/frozen XP and no practice persistence. Cover capability fallback,
privacy, countdown with client clock skew, accessible seat action, pending/error
and confirmed feedback. Exercise actual MainContent/MobileVoiceFullScreen mosaic
at short/mobile/scaled sizes and inspect screenshots; do not claim real media.

## Boundaries and approval

- Always: reuse existing authority, host-instance identities, origin routing,
  validation, UI geometry, localization and isolated tests; final external Sol review.
- Ask first: change the proposed rule defaults, add dependencies/schema, change
  XP/computer AI, or publish/deploy a new release.
- Never: automatic missed-call draws, false-report penalties, client-enforced
  deadlines, hidden-hand exposure, production test games or runtime data edits.

**Status:** design approved by the user; implementation plan follows separately.
