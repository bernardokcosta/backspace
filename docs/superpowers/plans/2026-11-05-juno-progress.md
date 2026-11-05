# SDD ledger — plan: docs/superpowers/plans/2026-11-05-juno.md

## Decisions

- Ruling: execute on a new `feat/juno-voice-game` branch in the initially clean
  checkout, not master — no implementation work exists on another branch; no
  dependency reinstall or copy of runtime state is needed.
- Ruling: native SVG card components replace generated/downloaded image packs —
  original editable artwork, no third-party licensing or asset dependency.
- Ruling: reuse `voice:juno` catalog keys and allowlist only the invariant brand
  name Juno, using the existing brand-name allowlist convention.
- Ruling: one global JunoSession owns current voice synchronization; the UI may
  unmount/minimize without ending a game or losing incoming invalidations.

## Completed checkpoints

- Task 1: complete — 21 engine tests including 60 randomized 2/3/4-player games,
  asserting deck conservation after every transition, plus privacy/lifecycle.
- Task 2: complete — route tests first observed missing-module failure, then
  passed; auth/membership/permissions/voice/human gates, stale commands and schemas.
- Task 3: complete — store and table tests observed missing-module failures then
  passed; targeted existing voice/mobile control tests passed (26 tests total).
- Real HTTP/WS acceptance: complete four-player game with five independent
  authenticated voice sockets; spectator secrecy and non-secret invalidations.
  Server engine/routes/e2e: 25 tests passed.
- Shared/server/web typechecks and server e2e typecheck passed.
- i18n and full-repository lint passed before final acceptance pass.

## Environment and remaining checks

- Context7 quota exhausted; consulted official Fastify and React docs directly.
- pnpm is not on PATH; cached pnpm 10.34.3 is available via its `bin/pnpm.cjs`.
  Root `build` cannot resolve nested pnpm commands; run its exact three package
  builds sequentially through that cached CLI instead.
- Vitest default pool hung in this Windows shell; tests pass with
  `--maxWorkers=1 --pool=threads`.
- Dev server uses a unique scratch DB/uploads under the approved OpenCode temp
  directory. Existing `data/` is never opened or modified.
- Real LiveKit media acceptance is unavailable without a running LiveKit service;
  real signaling/game HTTP+WS tests do not claim a four-device media test.
- Sequential production builds completed: shared → server → web. Existing Vite
  bundle-size/dynamic-import warnings remain; the build succeeds.
- Full-repository `pnpm lint`, direct workspace `pnpm -r typecheck` and i18n pass.
  The root typecheck script has the same nested-pnpm PATH limitation as build.
- Broader server regression suite: 329 tests in 31 files passed (WS lifecycle,
  soundboard, Juno engine/routes). The separate real Juno e2e passed as above.
- Native React table visually checked at 1,040px and 390px container widths.
  These are controlled UI fixtures, not an authenticated browser/media e2e.
- All affected subsystem docs updated, including Juno rules, privacy, capability
  negotiation, lifespan and limitations.
- Full server `src` regression suite: 2,930 tests across 259 files passed.
- Full web suite initially found that `App.test.tsx` needed to mock the newly
  mounted JunoSession, just like its existing controller mocks. Added that one
  mock; startup's four tests passed, then the complete web suite passed: 3,364
  tests across 358 files (`--maxWorkers=4 --pool=threads`). This is a test-only
  isolation adjustment, not an AudioWorklet shim or production behavior change.
- Desktop `build:ts` and server `typecheck:e2e` also passed. Root build-equivalent
  sequence and final web production rebuild both passed.
- External GPT review completed over the whole change, including the App test
  mock. One P2 finding: an older GET failure could erase a later successful POST
  snapshot. Reproduced it with a failing store test, then guarded the catch with
  the snapshot identity captured when the read began. Old failures cannot erase
  a later confirmation; current authorization/read failures still clear state.
  Added both regression cases, without mutation retries or transport changes.
- The reviewer independently passed 25 server/30 web tests, lint, i18n,
  workspace/e2e typechecks, diff check, and 58 direction/turn/departure combinations.
  No other concrete findings. This narrow race fix introduces no new contract
  or subsystem; the main agent verifies the corrective diff and affected tests
  under AGENTS.md rather than requesting another external review cycle.
- Final corrective validation passed: 32 affected web tests, then all 3,366 web
  tests/358 files; final web production build (including i18n + TypeScript), lint
  and diff whitespace checks also passed after the race fix. Remaining acceptance
  limitations are real LiveKit media and two-instance end-to-end federation;
  neither is represented as validated.
