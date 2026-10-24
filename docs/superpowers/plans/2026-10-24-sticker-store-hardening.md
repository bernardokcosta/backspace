# Sticker store hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task, inline.

**Goal:** Fix all thirteen actionable review findings before publishing the PR integrations.

**Architecture:** Keep published packs separate from candidate versions using the existing tables. Bound I/O and normalize untrusted payloads before synchronous transactional writes.

**Tech Stack:** TypeScript, Fastify 5, Drizzle/better-sqlite3, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-24-sticker-store-hardening.md`

## Global Constraints
- No new dependencies; preserve fork identity, bots, AFK and pins.
- Do not hand-edit generated SQL. Do not push, tag or deploy this task.
- All UI copy uses catalogs; update subsystem documentation with contracts.

## Review Focus
- Chunked/anonymous uploads must not bypass byte budgets.
- Async image processing cannot write into reviewed versions or exceed 100 items.
- Invalid metadata and database failures must leave replicas intact.
- Candidate metadata/status must never leak into published content.
- Closing/reopening nested editors must preserve drafts and consume only one Escape.

## Tasks

### 1. Upload bounds and naming
Files: `routes/stickers.ts`, `routes/stickerStore.ts`, `utils/stickerUpload.ts` and tests.
- [x] Add regression tests for chunked overflow and invalid names on all three personal endpoints.
- [x] Authenticate uploads in onRequest; enforce a dynamic streaming limit before JSON parsing.
- [x] Restore normalizeStickerName; run focused tests.

### 2. Safe pack lifecycle
Files: `routes/stickerStore.ts`, `routes/stickerStoreAdmin.ts`, shared stickers types, tests.
- [x] Test 99+2 concurrent uploads, upload-vs-review, approved reorder refusal, v2 submit/reject retaining v1.
- [x] Recheck state/capacity at transactional insertion; constrain reorder; preserve publication on review.
- [x] Add PATCH candidate metadata; expose candidate status to creator/admin reads; test Bot authentication.

### 3. Federated sync and migration recovery
Files: `utils/stickerSync.ts`, bounded response helper, `db/migrate.ts` and tests.
- [x] Test malformed item names, oversized metadata, cancellations, rollback, partial 0045 recovery.
- [x] Normalize all input before I/O, bound all response streams, cancel abandoned bodies; transactionally replace replicas.
- [x] Recover generated migration components and journal timestamp/hash atomically; reject divergent schemas.

### 4. Editor behavior
Files: `StickerPackManageModal.tsx`, `StickerStoreModal.tsx`, `api/client.ts`, tests.
- [x] Test nested Escape, save-before-submit, persistence failure and resume of v2 drafts.
- [x] Save candidate metadata via PATCH; offer resume for candidates.

Ruling: keep the existing store/editor listeners with explicit layer ownership:
the store ignores Escape while its editor exists, and the editor consumes it in
capture phase. The existing picker host already defers to aria-modal dialogs;
no new global Escape mechanism is needed.

### 5. Validation and delivery
- [x] Update API/database/federation/upload docs; run focused and full suites with unfiltered retained logs and real exit codes.
- [x] Run typechecks, lint/i18n, sequential build and UI smoke checks.
- [x] Request the single permitted follow-up from review_final_gpt56; address concrete residual findings and report remaining limits.

## Verification ledger

- Web full: 353 files / 3577 tests passed (`--maxWorkers=2`).
- Server unit full, after the final cleanup correction: 263 files / 3020 tests
  passed (`src --maxWorkers=2`); sequential full build and lint also passed again.
- Build (shared → server → web), root typecheck, server e2e typecheck, lint and
  i18n passed. Default parallelism hit unrelated 5-second timeouts on this
  Windows machine; limiting workers resolves them without changing test limits.
- Real dev servers booted with a separate temporary DB/uploads. Browser smoke:
  resume v2, Escape closes only editor, edited name/description persist before
  submission, public v1 remains available. Screenshot in ignored
  `.playwright-mcp/sticker-editor-smoke.png`.
- Full multiprocess server test run is not green locally: Windows EBUSY/SIGTERM
  cleanup failures, a Windows path-separator assertion, and three federation
  assertions. Reproduced the path, restart, DM 403 and handshake failures on
  pre-integration commit `ba9ee23c` in an isolated baseline worktree. These are
  pre-existing limitations, not waived as a successful full test run.
- Logs retained in `C:/Users/berna/AppData/Local/Temp/opencode/stickers-*.log`;
  no push, release or deployment performed.
- Final reviewer confirmed the thirteen original findings addressed, and found
  one additional cleanup-vs-sync race. Fixed locally by reserving asset freshness
  before any await; two new tests (cached/missing file) failed before the change
  and exercise actual cleanup during download. The two-call review limit is
  reached: this final targeted correction is checked by the main agent, not a
  third external review. No claim of an externally approved final snapshot.
