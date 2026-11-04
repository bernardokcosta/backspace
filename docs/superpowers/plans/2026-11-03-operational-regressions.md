# Operational Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair demonstrated soundboard/reconnect/pins failures and retain enough safe diagnostic context to investigate remaining production events.

**Architecture:** Reuse the existing WS ready handler, soundboard routes and client API/store paths. Keep all security checks and media lifecycle boundaries. No production mutation.

**Tech Stack:** TypeScript, React 19, Zustand 5, Fastify 5, SQLite, LiveKit, Vitest, pnpm 10.

**Spec:** `docs/superpowers/specs/2026-11-03-operational-regressions-design.md`

## Global Constraints

- TypeScript strict; no new dependencies or migrations.
- No persistent client diagnostics or identifying diagnostic fields.
- No permission bypass, hardcoded home origin, automatic sound replay or production restart.
- Build shared → server → web; all user-visible strings use the five catalogs.

## Review Focus

- Reconnect while the server still lists the voice participant: rebind without duplicate leave/join.
- A permission refresh, unrelated origin or displaced tab must not steal active voice.
- Room cooldown refusal must not extend the user's own waiting period.
- Unknown channel metadata becoming known must load text pins but never voice pins.
- API/runtime diagnostics retain only allowlisted metadata, even for malicious error bodies and URLs.

### Task 1: Diagnostic context

**Files:** `packages/web/src/api/client.ts`, `packages/web/src/utils/diagnostics.ts`,
`packages/shared/src/diagnostics.ts`, adjacent tests, `docs/systems/diagnostics.md`.

**Interfaces:** Existing `DiagnosticEvent.errorCode`, `diagnosticError`,
`normalizeDiagnostic`, `recordDiagnostic`; add only a closed WS error event and
safe script-location extraction if necessary.

- [ ] Add failing tests for HTTP 403/429 errorCode, WS coded/uncoded refusals and ErrorEvent filename fallback (including path/query/privacy bounds).
- [ ] Run targeted web/server diagnostic suites and record the failures.
- [ ] Parse each HTTP error body once; capture only recognized codes. Record structured WS errors; safely retain fallback code locations.
- [ ] Run affected tests and update diagnostics/WS contracts.

### Task 2: Voice resume and lifecycle

**Files:** `packages/web/src/hooks/useWebSocket.ts`, `useWebSocket.refreshReady.test.ts`,
`packages/web/src/hooks/useLiveKit.ts`, `useLiveKit.capture.test.ts`, existing server voice grace tests.

**Interfaces:** Existing `wsSend`, `broadcastVoiceStatus`, `getActiveRoom`,
`ConnectionState`, `connectionManager.getVoiceWs`.

- [ ] Add failing ready tests for server-known participant, same-socket refresh, remote identity, disconnected intent and unrelated origin.
- [ ] Add failing signal-reconnect/disconnected UI-state tests and current-room guards where demonstrated.
- [ ] Run affected tests before changes.
- [ ] Reassert space voice on a new ready only for live local intent; correct lifecycle status mapping without changing reconnect policy.
- [ ] Run voice regression suites; document exact recovery behavior.

### Task 3: Soundboard authorization and cooldown

**Files:** `packages/server/src/routes/soundboard.ts`, `soundboard.test.ts`,
`packages/server/src/utils/fixedWindowLimit.ts` and tests if extending its existing interface;
client soundboard store/library/controller and adjacent tests; error catalogs if needed.

**Interfaces:** Existing voice ownership/membership/permission checks, API soundboard.play,
fixed-window limit, `HttpError`/`RateLimitError`.

- [ ] Add failing tests for closed/rebound voice socket, self mute, every refusal code, per-room cooldown without phantom user consumption and real Retry-After.
- [ ] Add failing client tests proving shared button/shortcut in-flight/cooldown handling, no replay, and rejected stale/restricted sessions.
- [ ] Run tests before minimal fixes.
- [ ] Keep authorization; use actionable existing/closed codes; make cooldown consumption atomic and share playback submission state through the existing soundboard store.
- [ ] Run server/client soundboard suites and update soundboard/API/localization docs for changed contracts.

### Task 4: Pin lifecycle

**Files:** `packages/web/src/stores/chatStore.ts`, `chatStore.pins.test.ts`,
`packages/web/src/components/layout/MainContent.tsx` and any directly affected tests.

**Interfaces:** Existing `spaceChannelIndex`, `loadPins`, `pinnedByChannel`, channel/session cleanup.

- [ ] Add failing tests for unknown/deleted/voice channels, late responses and out-of-order loads.
- [ ] Verify index arrival triggers the initial load for the open text channel.
- [ ] Implement minimal guards/generations using existing lifecycle state.
- [ ] Run pin, channel-event and layout tests.

### Task 5: Complete validation and evidence disposition

- [ ] Run affected tests, full server/web tests, sequential build, lint and i18n checks; e2e typecheck where available.
- [ ] Start both local dev services with isolated temporary runtime state, then run browser/smoke checks without production accounts or data.
- [ ] Record status for all historical groups, including unresolved SDK/network/runtime evidence. Never call better instrumentation a root-cause repair.
- [ ] Invoke exactly `review_final_gpt56` for all changes, address concrete findings, and report what is not production-validated.

No commit or release is required by the operator's request; leave changes reviewable.

## Execution ledger

Base: `9fd1dec7`; branch: `fix/operational-regressions`. The checkout was clean
before this work. No pre-existing changes were overwritten.

- Ruling: use the existing checkout on a dedicated feature branch rather than
  migrate the session to another worktree. The linked skill's shared workspace
  scripts are not installed; this checked-in ledger records progress. Cost if
  wrong: changes share the current checkout, not a separately isolated directory.
- Ruling: use `corepack pnpm ... exec vitest run <paths> --maxWorkers=2` for
  focused tests. `test -- <paths>` forwarded a literal `--` to Vitest 5 and ran
  whole suites; those initial overloaded runs timed out. Subsequent targeted and
  complete runs passed. For nested pnpm build/dev scripts, prepend the existing
  Corepack shims to that command's PATH, without changing global configuration.
- Pre-flight: Tasks 1/3 share existing ErrorCode/HttpError contracts; additive
  soundboard codes are localized in every catalog. Tasks 2/3 share voice socket
  ownership; keep server authority and fix the client's missing resume signal.
- Task 1: complete. Watched five web and two server diagnostic assertions fail,
  then pass (21 targeted web tests, 20 targeted server diagnostic tests).
- Task 2: complete. Watched four reconnect/state regressions fail, then pass;
  46 affected web tests and 26 server voice/soundboard tests passed.
- Task 3: complete. Watched eight server limiter/playback failures and four
  client submission failures before fixes; 25 targeted server tests passed.
  Client store/library/shortcut coverage is included in the passing 44-test run.
- Task 4: complete. Watched six metadata/pin-lifecycle failures, then pass with
  the 44-test pin/layout/soundboard group. No generic 404 suppression was added.
- Task 5: initial main validation complete. Full web: 352 files,
  3,325 tests passed. Full server: 290 files, 3,189 tests passed. Sequential build,
  lint, i18n and server e2e typecheck passed. 31 added regression cases in total.
- Local dev services started with a fresh database/uploads under
  `C:/Users/berna/AppData/Local/Temp/opencode/backspace-operational-smoke-20261103`.
  Existing port 5173 was not disturbed; this run's web service used 5174.
- Browser smoke: real WS replacement ready still listed the participant;
  exactly one voice_join resumed it, and playback returned success. Component
  playback returned HTTP 200, disabled during cooldown and later re-enabled.
  Media state was simulated, not a real WebRTC/desktop call.
- Diagnostic smoke: POST returned 204; available=true, dropped=0,
  writeFailures=0. Runtime fallback persisted only `smoke.js:12:34`; private
  message, hostname and query canaries were absent from all temporary logs.
- Ruling: do not classify unrecoverable historical WS/runtime/SDK events or
  network packet warnings as fixed, nor deploy or modify production for further
  observation without separate approval. Cost: those groups need new evidence
  after a separately authorized rollout. See the spec's disposition table.
- Screenshot limitation: the in-app screenshot backend required a visible
  desktop window and was unavailable; no screenshot evidence is claimed.

### Final external review and correction pass

GPT-6.1 Sol reviewed all tracked/new changes and reran 98 web and 43 server
tests, lint, i18n and typechecks. Its initial verdict requested two corrections:

- Final: fixed cross-origin soundboard cooldown. The reviewer demonstrated that
  an unexposed Retry-After header made the existing client fall back to 60s.
  The server now also returns numeric `retryAfter` in its existing JSON error
  contract; no global CORS configuration was widened. The server JSON assertion
  was RED→GREEN; a client boundary test confirms it uses JSON with no visible
  header (the existing parser already supported it).
- Final: fixed authority-as-basename diagnostic leakage. Treated the reviewer's
  P3 as important because it violates the privacy contract. URLs now contribute
  only their parsed pathname, and protocol-relative input is refused. The
  hostname/query canary regression was RED→GREEN.
- These corrections stay within the already reviewed interfaces and add no
  global mechanism, dependency or permission change; validated the focused
  correction diff and all affected/full suites rather than another reviewer.
- Final full web: 352 files / **3,326 tests passed**. Final full server: 290 files /
  **3,190 tests passed**. Total **6,516 tests**, including **33 new regression
  cases** compared with the starting tree. Final sequential build, lint, i18n
  and server e2e typecheck passed. Desktop TS compilation and precache-size
  checks also passed.
- Local test account was signed out, browser tab closed, and only this task's
  two identified dev process trees were stopped. Temporary smoke data remains
  available for inspection; no production or third-party process was stopped.
- A final read-only VM check at 21:35 UTC confirmed the old production image
  1.16.0 remained healthy, both containers had zero restarts, and new reports
  were additional occurrences of the same WS/RTC/runtime/soundboard groups.
- The smoke's genuine ResizeObserver-loop report remains open with no observer
  identified. It is distinct from the intentionally generated PRIVATE_CANARY
  ErrorEvent. The spec explicitly records this limitation and the unresolved
  historical groups; the task must not be described as 100% root-cause complete.
