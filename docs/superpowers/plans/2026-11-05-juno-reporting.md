# Juno Participant Reporting Implementation Plan

> **For agentic workers:** Use executing-plans inline, task by task. Preserve the
> current native execution method; no implementation delegation. The final
> external Sol review covers all task files and helpers, not only the last edit.

**Goal:** Replace automatic missed-JUNO penalties with an explicit two-card report
within ten seconds, without pausing play.
**Architecture:** Extend the existing round, revision-guarded channel POST, room
sweep and private views. Add a capability-gated action at existing opponent seats;
keep the origin-aware store, UI geometry, artwork and progression boundaries.
**Tech Stack:** Existing strict TypeScript, Fastify, React, Zustand, Vitest and CSS.
**Spec:** `docs/superpowers/specs/2026-11-05-juno-reporting.md` (user approved).

## Global constraints

- Two cards; `now < playedAt + 10_000`; no pause or delayed victory.
- Other seated humans only, including out of turn; never self/spectator/bot actors.
- No automatic report or missed-call draw; computers retain their existing policy.
- No dependency/schema/new route/WS/S2S event, XP rule or runtime-storage changes.
- Host-instance actor identity, existing voice/permissions/revision gates and
  origin routing remain mandatory; never expose hidden cards or replay mutations.
- Develop/test locally first. Subsequent user authorization permits master commit/
  push, version 1.16.5, tag/release and same-VM deployment after all gates pass.
- Tests use the audited explicit-file isolated launchers, never checkout .env/data.

## Review focus

1. Exactly ten seconds without a sweep: server must reject an expired report.
2. Two reports or old opportunity replay: at most one draw for that particular miss.
3. Accused is current player or another player has drawn: preserve turn/timer and
   drawn-card eligibility; reporting is not a normal turn action.
4. Rapid last-card win/departure/rematch: no reopened result or changed XP proposal.
5. Slow/stale clients and short Russian/German UI: no automatic retry, false local
   deadline authority, broken real profiles or off-mosaic report controls.

## Task 1: Authoritative opportunities and transport

**Files:** shared/src/juno.ts; server/src/games/{juno.ts,juno.test.ts,junoReports.test.ts,
junoBot.test.ts}; server/src/routes/{juno.ts,juno.test.ts};
server/test/juno-e2e.test.ts (all under `packages/`).
**Interfaces:** Preserve `actInRound(round, userId, action, now): void` and
`JunoRooms.command/read/tick`. Add `JUNO_REPORT_MS = 10_000`,
`JunoReportOpportunity { id, targetUserId, remainingMs }`, optional view
`supportsReports` / `reportOpportunities`; action
`{ type: 'report', targetUserId: string, opportunityId: string }`;
move type `report` with reporter `userId`, optional `targetUserId`, actual `amount`.
Internal `JunoRound.reportWindows` stores `{ id, targetUserId, deadline }[]`.

- [x] RED: replace automatic-penalty expectation with one remaining card for a
  missed call; assert a different player reports at 9,999ms and draws exactly two,
  a report at 10,000ms fails without needing tick, and silence never draws.
- [x] RED: pin duplicate reports, old ids after a later miss, simultaneous windows,
  self/spectator/computer/outsider rejection, and announced-call immunity.
- [x] RED: report out of turn/current accused without changing turn/deadline/top/
  color/drawn restriction; conserve/recycle cards and handle fewer than two cards.
- [x] GREEN: initialize bounded windows at start, create only on missed down-to-one
  plays, dispatch reports before the regular turn-only gate, consume once and use
  drawCards. Expire through existing sweep/read/action checks; clear on gaining
  cards/departure/round completion. Keep immediate wins and settlement unchanged.
- [x] RED/GREEN: schema requires both bounded report ids, rejects reporter spoofing,
  preserves voice/auth/revision gates and invalidation; test 409 stale conflicts.
- [x] Extend actual HTTP/WS e2e with real human seats using isolated state:
  confirm no automatic draw, report snapshot/card delta, duplicate rejection and
  private-hand isolation. Computers remain non-reporting practice participants.
- [x] GREEN checks: run the spec's explicit isolated server command; also include
  `src/games/junoProgression.test.ts`, `src/games/junoStandings.test.ts` and
  `test/juno-progression.federation-e2e.test.ts`. Cover immediate winner/expired/
  departed target cleanup and frozen ranked/practice settlement regressions.

## Task 2: Seat action, countdown and confirmed feedback

**Files:** packages/web/src/components/games/{JunoMatch.tsx,JunoMatch.test.tsx,
JunoEffects.tsx,JunoEffects.test.tsx,JunoTable.tsx,JunoTable.test.tsx,juno.css};
packages/web/src/locales/{en,pt,de,ru,zh}/voice.json; existing store tests as needed.
**Interfaces:** Consume Task 1's optional capability/opportunities and use existing
`command(action)` plus observedAt/second beat; no second command transport/store.

- [x] RED: eligible other human seat gets a keyboard-accessible localized report
  button and remaining seconds; no self/spectator/old-host action. Clicking sends
  exact target/opportunity once, even when it is not the reporter's turn.
- [x] RED: fake client time versus observedAt countdown, expiry/refresh, pending and
  disconnect disable, stale-id reconciliation without mutation retry; keep profile
  opening separate and existing wild/JUNO controls functional.
- [x] GREEN: integrate compact seat button/countdown into existing layout. Gate
  rules text by supportsReports; retain old-host automatic-rule copy. Localize
  report action, timer, rule and confirmed reporter/target/actual-draw feedback in
  all five catalogs; never present a penalty before server confirmation.
- [x] RED/GREEN: add report to existing JunoEffects with drawing motion anchored
  to the target, stable move id cleanup/no polling replay and reduced motion.
  Keep screen-reader confirmation with reporter/target names; no new sound/art.
- [x] GREEN checks: run the spec's isolated web command plus JunoTable tests and
  relevant MainContent/VoiceGrid/MobileVoiceFullScreen/store regressions.

## Task 3: Integration, evidence and final review

**Files:** docs/systems/{juno,api,client-federation}.md as their actual contracts
change; approved spec/this ledger; scoped temporary fixtures/evidence only.

- [x] Document report command/capability/expiry, no automatic penalty, old-host
  fallback and unchanged practice/settlement. Preserve historical 1.16.4 notes.
- [x] Adapt existing isolated real-mosaic browser fixture, never production: inspect
  report controls at desktop/mobile/short sizes and 50/100/200% scale, five locales,
  multiple opportunities, zero-time/pending states and reduced motion; assert no
  overflow/seat-pile overlap, correct focus/profile action and countdown behavior.
- [x] Run pnpm build (shared → server → web), pnpm typecheck, pnpm lint, server
  typecheck:e2e and desktop build:ts; affected tests above, precache budget and
  isolated API startup/67 asset hashes. Record failures and genuine limitations.
- [ ] Inventory every changed/new Git file plus external helper/evidence paths.
  Obtain final review only from the same chosen Sol (spec review session
  `ses_e5210455bffeHg546HMjukD2wK`); fix concrete findings and validate affected
  checks. No publishing, deployment or claim of real media acceptance.

## Ledger and handoff

- User approved two cards, no pause and the complete rule/default design.
- External Sol approved the proposed spec before that human approval; no product
  code changed. User subsequently authorized inline testing/implementation and,
  only when ready, master commit/push, tag/release 1.16.5 and same-VM deployment.
- Self-review: Task 1 owns all deadline/race/deck/lifecycle/permission cases;
  Task 2 owns capability/origin/countdown/feedback behavior; Task 3 owns actual
  container geometry, docs and whole-task validation. No independent new module
  or additional transport is needed.
- Ruling: reuse the current feat/games-picker checkout, with only this task's two
  new docs at start, and audited isolated test storage — no other user work is
  present and no implementation runs on master. The referenced sdd-workspace
  script is not installed; this plan's ledger plus approved temporary evidence
  directory records progress without inventing tooling or touching runtime data.
- Task 1 RED: 11 failures reproduced the old immediate draw and absent windows/
  reporting. GREEN: 70 isolated server tests across eight files passed, including
  real authenticated HTTP/WS reporting and unchanged progression/federation/practice.
- Task 2 RED: six UI failures reproduced absent action/countdown/confirmed report
  and host-specific rules. GREEN: 37 isolated UI/store/copy tests across five files,
  root typecheck/i18n and ESLint passed. Browser checks caught a real landscape
  overlap; compact report actions were moved alongside profiles, not clipped.
  Browser validation is in progress. Context7 quota unavailable; existing React
  effects were checked against react.dev.
- Browser GREEN: 280 controlled states across five languages and eight viewport/
  scale combinations passed overflow, essential bounds and seat/report/hand-vs-pile
  overlap assertions, plus explicit keyboard reporting, confirmed target-anchored
  feedback and reduced motion. Inspected mobile/Russian/zoomed screenshots.
  A second narrow-screen refinement preserves full names/card counts by putting
  reports below seats only when width is short as well. The initial reduced-motion
  check wrongly awaited a deliberately hidden card; corrected the fixture assertion
  to require hidden travel plus visible, unanimated draw amount. No product motion
  exception was added. The owned fixture server is stopped.
- Added no-card-available/current-accused engine regressions and a stale origin-aware
  store report test. Whole isolated server/web suites are running; e2e/desktop TS
  also passed. Release metadata is not yet version-bumped while those suites run.
- Whole isolated suites subsequently passed: **3,276 server tests/301 files** and
  **3,433 web tests/370 files**, every batch green. At 1.16.5, sequential build,
  root typecheck/i18n/lint, e2e and desktop TypeScript, 55 affected/version server
  tests/5 files, 61 affected UI/store/layout tests/9 files, 565 desktop tests/32
  files (18 platform skips) and 28 tooling tests passed. Precache budget and
  isolated source API startup/HTTP SHA checks of all 67 Juno assets passed.
- Release authorization/procedure and current 1.16.5 interruption consent are
  tracked in `2026-11-05-release-deploy-1.16.5.md` and sanitized temporary evidence.
  No release/deployment has been performed yet; final whole-task review is next.

## Authorized follow-up: release and deployment

- [ ] After feature gates, bump five manifests with the existing version script
  to 1.16.5, write truthful release notes/eight installer links and retest version/
  desktop/tooling/build gates. Reuse prior 1.16.4 operational paths and immutable
  tag@verified-amd64-digest fix; do not overwrite earlier evidence.
- [ ] Inventory the complete implementation/release scope and exact helper hashes;
  obtain the same Sol's final whole-task review before publication. The initial
  review covered the draft spec only, not future code or release artefacts.
- [ ] Stage only inventoried files, commit and push master/feature without force;
  require exact-commit CI/Security/CodeQL, then create/push immutable v1.16.5 once.
- [ ] Await desktop/native/container gates, verify all 16 anonymous downloads,
  updater hashes, notes/latest and amd64/arm64 revision/version before deployment.
- [ ] Recheck VM/calls and obtain current interruption approval if calls remain.
  Use enabled backup.sh/update.sh with private rollback, bound to approved digest;
  recreate only Backspace, preserving all other configuration, data and LiveKit.
- [ ] Verify live version/commit/digest/health, database/identity/migrations/uploads,
  unchanged unrelated services and paced public frontend/67 asset hashes. Actual
  deployment must follow the reviewed helper hashes/scope; stop on new risk or
  deviations instead of bypassing gates or adding unbounded review cycles.
