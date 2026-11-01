# Remove Desktop Minimum Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Remove desktop compatibility enforcement without disabling optional updates or authentication.

**Architecture:** Remove the policy at its existing client/server integration points. Start pending messages with the app instead of a compatibility subtree; retain independent lifecycle/account guards.

**Tech Stack:** Existing TypeScript, React, Zustand, Fastify and Vitest; no dependencies added.

**Spec:** `docs/superpowers/specs/2026-11-01-remove-desktop-minimum.md`

## Global Constraints

- No database, Electron security, capture capability or release-validation changes.
- Keep per-origin routing, authentication, transfer cancellation and delivery receipts.

## Review Focus

- Old/unknown desktop versions must authenticate and connect normally.
- Leftover environment values must not enforce policy or prevent boot.
- Invalid credentials and foreign upload ownership must still be refused.
- Optional updater initialization and pending-message orchestration must still run.
- Late results after account changes must not overwrite the active session.

### Task 1: Retire server policy

Files: server config, auth utilities/routes, files/sticker-store/instance routes,
WS handler, shared policy module/constants/types/errors, and corresponding tests.

- [x] Replace rejection tests with acceptance tests for old/unknown shells on HTTP, tus and WS; assert invalid credentials stay unauthorized.
- [x] Run the tests to establish the old behavior fails those expectations.
- [x] Remove guards/config/advertisement and policy-only shared contracts.
- [x] Run affected server tests and e2e typecheck.

### Task 2: Retire renderer policy

Files: `App.tsx`, compatibility components/store/utilities, API client,
WebSocket hook, auth/instance/transfer/pending-message stores, invitation helper,
updater store, desktop UA helper, locale catalogs and associated tests.

- [x] Remove the screen/store/polling and policy-only transport/transfer hooks.
- [x] Initialize pending-message orchestration directly in App; keep the existing optional updater surfaces.
- [x] Keep account guards and bootstrap coalescing independent of desktop policy; update their tests.
- [x] Add an App test proving old/missing version bridges and policy-fetch failure do not block routes.
- [x] Run affected renderer and desktop tests.

### Task 3: Documentation and validation

- [x] Update desktop/API/WS/deployment/localization system specifications and `.env.example`.
- [x] Run build (shared → server → web), lint, e2e/desktop typechecks and affected tests.
- [x] Start both dev servers and inspect/screenshot the ordinary UI; test legacy desktop bridges separately.
- [x] Obtain the mandatory external final review and resolve concrete findings.

## Validation ledger

- Red: instance-info regression failed against the original minimum field.
- Green: 21 server policy-retirement tests, 53 auth/upload/sticker tests,
  288 affected renderer tests, 11 invitation modal tests, 80 updater/recovery tests.
- Build (shared → server → web), e2e typecheck and desktop TypeScript build passed.
- Initial broad test commands forwarded `--` through Vitest 5 and ran unintended
  full suites, timing out under parallel load; targeted `exec vitest run` commands
  above passed, including the invitation modal failures from that run. The full
  server run also reported a federation-handshake failure outside the changed code;
  full-suite success is not claimed.
- Both development servers started using disposable database/uploads under
  the approved temporary directory, separate from production state.
  API boot succeeded with the legacy minimum set to `invalid`, and instance info
  returned 200 without a minimum. Missing ffmpeg/ffprobe is an environment warning.
- Login rendered in the in-app browser with no console errors and a screenshot
  was captured in the session's temporary evidence directory.
  Old/missing/failing version bridges are covered by App tests; a separate
  Playwright legacy-host visual probe timed out, so no installed-host claim is made.
- Lint found two newly unused bindings after removal; those bindings were removed.
