# Juno Playability Implementation Plan

> **For agentic workers:** Use executing-plans inline. One final external Sol
> review of all task changes; no implementation delegation.

**Goal:** Make Juno playable in its actual mosaic and add fair practice computers.
**Architecture:** Extend the existing authoritative rooms/actions and private-hand
projection; keep bot games out of persistence. Rework the current shared table
with size-container geometry and confirmed-move effects, retaining existing art.
**Tech Stack:** Existing strict TS/React/Zustand/Fastify/Vitest/CSS, no dependencies.
**Spec:** `../specs/2026-11-05-juno-playability/README.md` and its two module specs.

## Constraints and review focus

- User said to follow directly; practice computers earn no XP/counters.
- Keep existing human games, identities, voice lifecycle, ranking and old-host
  compatibility. Never expose CPU hands or treat ephemeral CPUs as user accounts.
- No new schema/dependency/WS event; additive REST actions need documented design
  and validation. Do not touch runtime/production or publish this iteration.
- Existing untracked deployment plan is prior work; preserve it, exclude it from
  this feature's review diff unless explaining the unchanged baseline.
- Tests use audited temporary launchers; no default test DB or checkout .env.

### Task 1: Authority and practice computers

**Files:** shared/juno.ts; server/games/juno.ts, new junoBot.ts and tests;
server/routes/juno.ts + tests; junoProgression.ts/tests; real Juno e2e suite.
- [x] Add RED tests: host management/stale/phase/capacity, CPU privacy/departure,
  bounded fair AI, no persistence, announcement semantics and HTTP validation.
- [x] Extend existing action/view types, pure own-information bot strategy and
  room sweep; preserve immutable ranked settlements and legacy announcement.
- [x] Run explicit isolated server tests and affected e2e/TypeScript.

### Task 2: Bounded visual table and motion

**Files:** existing JunoPlayerBadge/Lobby/Match/Result/Table/CSS and tests;
new small JunoEffects component/tests; VoiceGrid/MainContent; five voice catalogs.
- [x] Add RED tests for button/seat actions, old-host fallback, confirmed effects,
  quiet empty/turn states and real/fallback portrait geometry in browser fixture.
- [x] Implement height-aware grid, contained rules/ranking, CPU seats, direct
  announcement, action bursts and reduced-motion alternatives.
- [x] Exercise real VoiceGrid at short/desktop/mobile/scaled sizes; inspect images
  and assert no vertical scroll, correct centers and reachable essential controls.

### Task 3: Integration, docs and review

**Files:** docs/systems/{juno,api,mobile-ui,voice,bots,client-federation}.md; new
specs/plan and external evidence.
- [x] Update contracts/lifecycle/practice/motion documentation.
- [x] Run build, typecheck/i18n, lint, server e2e/desktop TS, affected tests,
  production asset checks and both dev startups using isolated temporary storage.
- [x] Review complete scope externally with Sol, fix concrete findings and report
  what was actually validated; do not infer production/media success.

## Ledger

- Approved direct execution; documented capability map and bounded architecture
  before implementation. Existing deployed 1.16.3 remains unchanged.
- RED: missing CPU strategy, rejected announce action, old checkbox and empty-seat
  text/absent CPU controls. GREEN: 91 isolated server tests in 11 files, including
  real HTTP/WS management/paced CPU action, privacy and unchanged ranking, plus
  complete practice rounds and a SQLite no-write guard. Ranked retry/merge/erasure
  and two-instance progression regressions remain green.
- UI reuses real MainContent and MobileVoiceFullScreen around VoiceGrid, seeded
  with controlled profiles, not production accounts or real LiveKit media. A
  virtual fixture cache initially retained old content; it was restarted and all
  acceptance rerun against actual call containers. Image-backed avatars use an
  existing diagnostic image; no supplied art or actual avatar data was changed.
- Fixed a real narrow Russian-header overflow with compact accessible icon
  controls, rather than clipping text or shrinking the whole game. Final Portuguese
  matrix: 72 states across eight viewport/scale combinations (2–4 seats, lobby,
  bots, large 85-card hand, result/pending/spectator); zero vertical/horizontal table
  overflow, essential bounds failures, avatar-center displacement or JS/HTTP errors.
  English/Russian/German/Chinese compact matrices add 18 states each, all passing.
- Confirmed JUNO/card feedback, reduced motion, wild Escape/focus and horizontal
  large-hand reachability passed. Captured/inspected desktop/mobile/short screenshots
  and the confirmed burst. Movement starts at the real announcing avatar center
  with existing interface-scale conversions; effects never accept pointer input.
- Build, root typecheck/i18n, lint, desktop/e2e TS and precache passed; isolated
  source API startup and all 67 built asset HTTP/SHA-256 checks passed.
  Context7 quota was unavailable; React effects were checked against react.dev.
- Whole isolated suites passed: 3,259 server tests/300 inventoried files and 3,421
  web tests/370 inventoried files, with no failing batches. Later affected UI/store/
  layout tests passed 69/69 across 13 files after the final control refinements.
- Screenshot inspection caught an additional short-view overlap that bounds-only
  assertions missed. Added explicit pile-vs-player/hand intersection assertions
  (RED), then reflowed all opponents into a compact top row and hand/actions into
  adjacent bottom cells (GREEN), preserving names/counts/cards instead of merely
  clipping them. Added drawn-card/pass and wild-picker bounds to all view matrices;
  the compact pass button uses an accessible icon to avoid locale-driven wrapping.
- Final browser evidence totals 144 states, zero overflow/essential-control bounds/
  pile overlap errors, centered image/fallback/computer avatars, reachable 85-card
  hands and wild choices, confirmed effects and reduced motion. All tests and
  fixtures use isolated fake state/storage; no authenticated real media session,
  native fullscreen Escape, Safari/Firefox or production deployment is claimed.
- Final external Sol review APPROVED all 40 task files and external helpers/
  evidence with no additional concrete findings. Independently passed 64 server
  tests, 76 web tests, ESLint/i18n/server/web/e2e TypeScript, whitespace checks and
  48 additional controlled browser cases; confirmed 144 recorded cases/screenshots,
  privacy/host rules, practice no-persistence and effect deduplication/cleanup.
  The prior deployment plan stayed unchanged. No source/release commit, push or
  new VM deployment was performed; the implementation is validated locally.
- Subsequent user authorization to commit, push, publish 1.16.4 and deploy to the
  same confirmed VM is recorded in `2026-11-05-release-deploy-1.16.4.md`; the
  local-only boundary above describes this completed feature-development phase.
