# Safe periodic frontend update checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop unhandled periodic update-check failures without weakening voice-safe updates or desktop service-worker clearing.

**Architecture:** The existing component owns one checker for its registered worker. A React effect owns timer cleanup, a per-effect in-flight guard avoids overlap, and registration re-resolution handles replacement rather than repeatedly calling a stale worker.

**Tech Stack:** Existing React19, vite-plugin-pwa, Service Worker API, Web Locks, Vitest/jsdom.

**Spec:** `docs/superpowers/specs/2026-11-10-sw-update-lifecycle.md`

## Global Constraints

**Execution:** Tasks1–2 implemented and locally validated; see
[validation](2026-11-10-operational-resilience-validation.md). The original step
recipe is retained below; the complete change passed external final review.

- No dependency, bridge, new update channel, storage reset, CSP relaxation or visual redesign.
- Preserve own-build tracking, waiting-worker activation and all cross-tab voice locks.
- No production worker changes, reloads or publication. Leave changes uncommitted.

## Review Focus

- Registration callback fires after unmount: do not schedule a leaked timer; Task1.
- A promise rejects after replacement: it cannot cancel the new checker; Task1.
- A check lasts longer than60s: do not overlap; Task1.
- Offline interval followed by reconnect: resume normal checks without a retry storm; Task1.
- Another tab starts voice while checking: no activation/reload outside existing locks; Task2.

## File structure

Modify `packages/web/src/components/ui/SwUpdatePrompt.tsx` and its colocated
tests. Extract `swUpdateCheck.ts` beside the component only if necessary to
keep timer ownership readable. Update the existing deployment/desktop update
documentation if the polling lifecycle description changes.

### Task 1: Own and recover the periodic checker

**Interfaces:** keep `SwAutoUpdate`'s public interface and60,000ms period;
registration state is local to the component. `onRegisteredSW` records a
registration; a cleanup-owned effect checks `navigator.onLine`, re-resolves
`navigator.serviceWorker.getRegistration(registration.scope)` and awaits
`update()`. A disposed/in-flight flag prevents overlap/stale work. Expected
InvalidStateError from stale registration does not become an unhandled promise;
other failures get a bounded existing warning, reset after success/replacement.

- [ ] Extend the existing fake registration to model scope/active/installing/waiting and rejected/synchronous update calls. Add successful periodic check, rejected InvalidStateError, network rejection, offline, slow/in-flight, replacement and unmount/remount assertions; no call after cleanup or stale completion.
- [ ] Run `pnpm --filter @veyvox/web test -- SwUpdatePrompt`; verify RED demonstrates leaked timer/unhandled update behavior.
- [ ] Implement owned polling, cancellation and bounded failure reporting without changing update activation.
- [ ] Rerun focused suite; require GREEN including actual callback-driven regression rather than only testing a helper in isolation.

### Task 2: Preserve update/voice guarantees

**Files:** same tests; touched update lifecycle documentation only.

- [ ] Keep/extend tests proving no SKIP_WAITING/reload during this tab's voice, another tab's voice lock or a session starting between checks. Update checking must not itself activate a waiting worker.
- [ ] Run the complete web suite, i18n check, typecheck, lint and sequential build with the other module plans. Exercise a local browser update check; record unavailable desktop/hardware checks explicitly.
- [ ] Include all changes in the single whole-change external review; no per-task reviewer or automatic commit.

## Self-review and handoff

The tests cover every lifecycle edge in Review Focus. There is no new shared
interface consumed by the rate-limit or media plan. Approval permits native
inline execution after the rate-limit plan; production remains untouched.
