# Media-tool probe recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover optional media processing after a transient probe failure without restarting or spawning a process per upload.

**Architecture:** Keep the existing boolean interface and cached success. Coalesce probes with one in-flight promise and cache failure until a30-second retry deadline; retry only on later demand. Classify probe failure safely without retaining tool output or private paths.

**Tech Stack:** Existing Node24 execFile/promisify, TypeScript, Sharp, Vitest fake time.

**Spec:** `docs/superpowers/specs/2026-11-10-media-probe-recovery.md`

## Global Constraints

**Execution:** Tasks1–2 implemented and locally validated; see
[validation and platform limits](2026-11-10-operational-resilience-validation.md).
The original step recipe is retained below; external final review passed.

- No dependency/tool installation, shell invocation, root execution, DB migration or stored-media backfill.
- Keep `checkFfmpeg():Promise<boolean>` and non-fatal startup/upload fallback.
- Keep probe timeout5,000ms; explicitly bound stdout/stderr to64KiB.
- No production restart/configuration change; leave changes uncommitted.

## Review Focus

- Concurrent boot/upload callers during a slow probe: exactly one child process; Task1.
- Clock moves backward: failure cannot turn into a permanent disable or spawn storm; Task1.
- Child reports ENOENT vs timeout vs nonzero exit: safe distinct diagnostics, no output/path leak; Task1.
- Probe rejects: in-flight slot clears and later demand recovers; Task1.
- Tool becomes unavailable after cached success: existing per-operation failures remain non-fatal; Task2.

## File structure

Modify `packages/server/src/utils/thumbnail.ts`; add colocated
`thumbnail.test.ts`. Extend the shared diagnostic code allowlist/tests only to
recognize the fixed system code `ENOENT` if needed for absent-tool reporting.
Update `docs/systems/uploads.md` and diagnostics documentation if their safe
code vocabulary changes. Existing upload callers are reused unchanged.

### Task 1: Retryable single-flight availability

**Interfaces:** preserve `checkFfmpeg` and module-local cached-success flag;
add a retry deadline and one pending promise. Failure retries after30,000ms on
demand; success is cached. A backward wall-clock jump permits at most one new
probe and starts a new bounded deadline. Failures report fixed categories
ENOENT/ETIMEDOUT/other known error code through existing safe capture, never
arbitrary exception text or child output.

- [ ] Mock child_process before importing thumbnail and use fake time. Test first timeout→false, no call before30s, success at30s without restart; ten concurrent calls spawn once; missing binary/nonzero exit do not reject, cooldown applies; success stays cached; clock rollback remains bounded.
- [ ] Run `pnpm --filter @veyvox/server test -- thumbnail`; verify RED against permanent cached false.
- [ ] Implement the in-flight promise/deadline and sanitized failure classification. Use existing5s timeout plus64KiB maxBuffer. Do not add a background polling timer.
- [ ] Rerun tests, asserting arguments and maxBuffer explicitly; require GREEN and no leaked process/timer.

### Task 2: Preserve uploads and finish validation

**Files:** existing file/upload tests and touched docs.

- [ ] Test/retain valid upload success despite unavailable metadata, successful recovery through the existing caller, and non-fatal per-operation failure after cached success. No old files are scanned or rewritten.
- [ ] Run `pnpm --filter @veyvox/server test -- thumbnail files`, affected shared diagnostics tests, server e2e typecheck, root typecheck/lint/build together with the other plans. Verify a real ffprobe probe in a disposable Linux/local environment when available; record platform limits honestly.
- [ ] Document retry-on-demand, exact cooldown, single-flight behavior and non-fatal fallback. Include in the one complete external review after the other two plans.

## Self-review and handoff

All Review Focus cases are pinned by tests. No other plan depends on these
module-local fields. Approval permits native inline execution; this plan has no
commit, installation, deploy, restart or data-repair step.
