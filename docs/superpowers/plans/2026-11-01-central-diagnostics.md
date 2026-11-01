# Central Diagnostics 1.15.9 Implementation Plan

> **For agentic workers:** Use executing-plans inline; one external final review covers this plan and the desktop-minimum removal plan.

**Goal:** Publish 1.15.9 with server-only, privacy-safe bounded diagnostics and no desktop gate.
**Architecture:** Shared normalization, existing Fastify logger plus a bounded JSONL store, limited diagnostic ingestion and a memory-only renderer collector. Reuse existing desktop snapshots rather than adding privileged IPC.
**Tech Stack:** Current strict TypeScript, Fastify, React, Electron, Vitest; no dependencies added.
**Spec:** `docs/superpowers/specs/2026-11-01-central-diagnostics.md`

## Global constraints and review focus

- Never persist client diagnostics locally or collect secrets/content/raw error text.
- Central files ≤4,500,000,000 bytes; three Compose services ≤450,000,000 bytes.
- Untrusted reports, offline/disk failure, recursion, bursts and old servers must not break chat.
- Preserve auth, federation origins, capture permissions, DB and release safeguards.

### Task 1: Contract and server storage

- [x] Add `packages/shared/src/diagnostics.ts` and its export; tests in server utils.
- [x] Add `packages/server/src/utils/diagnosticLogs.ts` with budgeted rotation and safe logger adapter; test tiny budgets, restarts, symlinks and errors.
- [x] Add limited diagnostic routes and admin statistics using existing rate/auth flows.
- [x] Wire server logger/startup, console failure capture and Compose rotation; update system docs.

### Task 2: Memory-only client capture

- [x] Add `packages/web/src/utils/diagnostics.ts` and tests for sanitization, buffering, retries, deduplication, disposal and no persistence.
- [x] Start capture before ordinary application imports; record App ErrorBoundary, API, WS, voice and existing desktop snapshot failures.
- [x] Fix voice-channel pin queries with a regression test.

### Task 3: Release and verification

- [x] Bump version using `scripts/bump-version.mjs 1.15.9`, add release notes and update specs.
- [x] Run affected tests, build, lint, e2e/desktop typechecks and browser smoke.
- [x] Obtain the mandatory final Sol review across all task changes; resolve findings.
- [ ] Commit, tag v1.15.9 and push to origin without force; observe publication workflows.

## Prior operational inspection

Inspected deployment: Backspace 1.15.8 healthy, no HTTP 5xx/version refusals in
24-hour logs, disk 34%, no failed systemd units. Voice pin GETs caused 21 HTTP
404s; one soundboard 429 is expected rate limiting. LiveKit recorded DTLS timeout
disconnects and a failed participant resume: cause not established. Installed
Windows app is 1.15.8, no persistent application log files or recent Windows
crash events found. Do not restart it with local-file logging flags.

## Validation ledger

- Red/green: shared/store tests failed before implementation; voice-pin tests
  reproduced both home/remote requests before the guard and passed afterward.
- Build (shared → server → web), lint, precache budget, server e2e typecheck and
  desktop TypeScript build passed. Full web: 352 files / 3302 tests passed.
  Full desktop: 31 files, 553 passed / 18 skipped.
- Disposable server booted 1.15.9 with a malformed legacy minimum setting.
  Real public ingestion returned 204, admin statistics 200, no drops/failures.
  Browser login rendered 1.15.9 without a gate and a synthetic TypeError reached
  the server. Two diagnostic records were stored; secret/message/password
  canaries were absent from every stored record.
- Production-build browser smoke used `http://127.0.0.1:3005`, not localhost:5173:
  that browser hostname resolved to a different running app during the later
  check. No unrelated app was modified. The latest screenshot attempt was blocked
  because the Review window was not visible; DOM/network/storage checks succeeded.
- Production VM has not been changed/restarted. Its existing 1.15.8 containers
  have no Docker log rotation; the new Compose limits require recreation after
  publication in a maintenance window. No local diagnostic-file logging was
  enabled in the installed client.
- Full server run: 289 files passed, one chosen-status e2e assertion raced the
  observer's WS delivery after the DB commit; reproduced in isolation and fixed
  by waiting for the real offline event (no relaxed assertion or longer grace).
  The run also exposed a Windows-path false pass in the CORS source scan;
  replaced shell grep/`|| true` with native traversal and fail-on-read-error.
- Full repeat passed: 290 server files / 3175 tests. Full web repeat passed:
  352 files / 3303 tests. The external review then found two privacy leaks:
  Node's default fatal printer and message text disguised as stack locations.
  Both were reproduced, replaced with sanitized fatal exit / verified-frame
  extraction, and covered with subprocess/message-canary regressions. A malformed
  object-valued level also reproduced 500 instead of 400; strict string checking
  corrects that input-validation edge case.
- Final external recheck approved all 100 staged files with no remaining
  blockers. Independent checks passed: server26/26, web17/17, lint, server
  typecheck and diff check; extra subprocess probes verified safe fatal exit
  even when sanitization/storage fail. Full-suite counts above precede those
  focused privacy corrections; affected checks were repeated afterward.
