# Borderless Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit the Windows native SDR share only after supported borderless access, with explicit retry and fail-closed recovery.

**Architecture:** A cancellable native permission operation sits behind the existing privileged capture module. Main prepares an owner/source-bound selection before Chromium acquisition; native session configuration and web staging independently enforce the same result.

**Tech Stack:** Existing C++20/WinRT/Node-API, Electron main/preload, strict TypeScript and Vitest.

**Spec:** [borderless-capture](../specs/2026-10-25-borderless-capture.md).

## Global Constraints

Apply all [initiative constraints](2026-10-25-desktop-1.15.2.md#global-constraints).
This module affects the Windows native Force SDR path, not browser/macOS/Linux
capture or an automatic HDR conversion rewrite. Preserve the existing audio,
quality, one-use source grant and same-track preview/publication behavior.

## Review Focus

Exercise both WGC users, denial before Chromium acquisition, pending consent
cancellation, compatibility with old hosts and unchanged audio in B1/B2 tests.

## Task B1: Establish native permission and borderless feasibility

**Files:**
- Create: `packages/desktop/native/sdr-capture/borderless_access.{h,cpp}`, `borderless_access_test.cpp`.
- Modify: `native/sdr-capture/{capture_binding.h,capture_binding.cpp,capture_session.h,capture_session.cpp,capture_session_test.cpp,sdr-capture.vcxproj,sdr_texture_test.cpp}` under `packages/desktop/`.
- Modify: `packages/desktop/src/sdrCaptureTypes.ts` for privileged native types only.
- Modify: `packages/desktop/test/sdr-capture/{main.cjs,bridge-preload.cjs}` and `packages/desktop/scripts/run-sdr-capture-smoke.mjs` for an explicit `borderless` fixture mode.
- Update: `docs/systems/{desktop,desktop-security}.md`; record evidence in the initiative ledger.

**Interfaces:**
- Native-only `requestBorderlessAccess(requestId: string, onComplete: (result: NativeBorderlessAccessResult) => void): void` and `cancelBorderlessAccess(requestId: string): void`.
- `NativeBorderlessAccessResult` is `{ status: 'allowed' | 'denied-user' | 'denied-system' | 'not-declared' | 'unsupported' | 'cancelled' | 'timeout' | 'failed' }`. It contains no handles/pixels and never crosses to an arbitrary renderer.
- One OS permission request at a time; duplicate waiters share that operation. Cancellation retires a waiter's ownership; shutting down releases the operation without waiting forever for UI.
- A **60,000 ms** permission deadline is separate from the existing **10,000 ms** first-frame deadline. The latter starts only after permission/preselection succeeds. No app-persisted permission grant.
- The fixture watchdog for interactive borderless consent is **90,000 ms**, not the current 45-second synthetic-only budget. API availability/native permission methods are optional when loading old modules; B2 requires their presence before advertising strict borderless support.

- [ ] **Step 1: Add failing native lifecycle tests.** In `borderless_access_test.cpp`, cover every result, one completion per request ID, cancellation before/after reply, timeout, duplicate waiters, OS exceptions and shutdown with no reply. Assert denied/unsupported states cannot yield an allowed result and cancellation never invokes a later allowed callback.
- [ ] **Step 2: Observe RED.** Run `node packages/desktop/scripts/build-sdr-capture.mjs --arch x64 --test` on a matching host. Expect missing implementation/test failure, not an unrelated toolchain error presented as the test's RED result.
- [ ] **Step 3: Implement the native permission operation and session control.** Use official `GraphicsCaptureAccess.RequestAccessAsync(Borderless)`, API availability checks and completion/cancellation ownership. The capture binding/session consume only the current per-attempt Allowed preparation and configure `IsBorderRequired(false)` before starting; native start without that preparation fails. Do not call an unbounded `.get()` on the main event loop, a shutdown-joined worker or a TSFN finalizer. Keep request storage bounded; integrate module cleanup with the existing binding lifetime. Production web/main preparation is intentionally not wired until B2, so B1 is not an app-level release candidate.
- [ ] **Step 4: Add the controlled fixture.** Extend the runner's validated mode allowlist with `borderless`. Its source is a fixture-owned window. Exercise both native-only and the actual Chromium-video/native replacement combination, with audio off/on, and record access status, configuration result, late-cancel result and zero retained frames. A mode/fixture result must not claim that a property getter measures other applications' global indicators.
- [ ] **Step 5: Prove feasibility before B2.** Run `pnpm --filter @backspace/desktop build:ts`, the matching native test command, and `node packages/desktop/scripts/run-sdr-capture-smoke.mjs --arch x64 --mode borderless`. Obtain operator-visible outline evidence, not only a mocked Allowed result. Confirm the current Win32/unpackaged installer model does not require an unapproved MSIX/capability-platform migration. If permission/configuration or a second Backspace-owned capture prevents the requirement, stop this module and report the blocker; the native helper alone is not success.
- [ ] **Step 6: Commit the tested native module/fixture.** Stage these files and commit `feat(desktop): add cancellable borderless capture consent`. No distribution or production permission changes.

## Task B2: Integrate strict preparation, native start and explicit retry

**Files:**
- Modify: `packages/desktop/src/{sdrCapture.ts,sdrCaptureTypes.ts,sdrCapturePolicy.ts,main.ts,preload.ts}` and adjacent SDR tests.
- Modify: `packages/desktop/native/sdr-capture/{capture_session.h,capture_session.cpp,capture_binding.cpp,capture_session_test.cpp}`.
- Modify: `packages/web/src/platform/electron.d.ts`, `utils/{sdrScreenCapture.ts,screenShare.ts}`, `components/voice/ScreenShareSetup.tsx`, adjacent SDR/setup tests and `locales/*/voice.json`.
- Create: `packages/desktop/src/sdrCapture.borderless.test.ts`, `packages/web/src/components/voice/ScreenShareSetup.borderless.test.tsx`.
- Update: `docs/systems/{desktop,desktop-security,voice}.md`.

**Interfaces:**
- Extend `SdrCaptureCapability` supported result with literal `borderless: true`. Updated clients require that marker for strict Force SDR; legacy support without it is not sufficient.
- Main/controller `prepare(owner: WebFrameMain, source: NativeSdrSource): Promise<SdrCapturePreselectionResult>` and `confirmSelection(owner: WebFrameMain, source: NativeSdrSource): boolean` replace arming a native grant without consent. Reuse the existing controller's generation, focus, one-use grant and invalidation; do not create a second global permission mechanism.
- `SdrCapturePreselectionResult` is `{ ok: true } | { ok: false; reason: Exclude<NativeBorderlessAccessResult['status'], 'allowed'> }`. Propagate that result through existing `preselectScreenSource` only for a validated source/owner; no freestanding renderer permission IPC is added.
- `prepare` owns pending native request IDs and cancellation. `confirmSelection` proves the accepted display-media source matches that prepared owner/source, then allows the existing one-use native start. A mismatch, expiration or superseding selection cannot reuse consent preparation for another source.
- Extend public failure reason allowlists consistently with the denied/unavailable categories; retain `SdrCaptureError.reason` for localized UI. Unknown or old-host replies fail closed.

- [ ] **Step 1: Add failing main/controller and web integration tests.** A deferred denial must leave `getDisplayMedia`, native start and publication uncalled; a late Allowed reply after cancel/navigation/new source must not arm capture. Cover foreign/subframe/unfocused callers, grant expiration and repeated retry clicks.

  Required assertions through the actual staging/controller seam include:

  ```ts
  expect(getDisplayMedia).not.toHaveBeenCalled(); // consent still pending or denied
  expect(nativeStart).not.toHaveBeenCalled();
  expect(publishTrack).not.toHaveBeenCalled();
  ```

- [ ] **Step 2: Observe RED.** Run `pnpm --filter @backspace/desktop exec vitest run src/sdrCapture.borderless.test.ts` and `pnpm --filter @backspace/web exec vitest run src/components/voice/ScreenShareSetup.borderless.test.tsx src/utils/screenShare.sdr.test.ts`. Expect the current preselection/staging behavior to fail the new assertions.
- [ ] **Step 3: Prepare before acquisition.** Resolve/validate the explicit source first, await B1 permission and recheck owner/generation/focus before timestamping/arming the pending selection. Preserve legacy non-SDR preselection behavior. Return typed refusal instead of an IPC exception whose custom reason would be lost. `selectScreenSource(null)` and navigation must cancel pending preparation as well as revoke the grant.
- [ ] **Step 4: Enforce native configuration before frames.** A native session without the current prepared/confirmed authorization fails before `StartCapture`; set `IsBorderRequired(false)` only after Allowed and validate availability/failure. No raw/native fallback on refusal. Repeat the B1 duplicate-capture proof after integration; do not accept a solution that leaves Chromium's own outline alive. If a different audio/video acquisition design is required, stop and obtain a design amendment instead of introducing a new audio subsystem here.
- [ ] **Step 5: Wire localized recovery.** Preserve the failed source privately in setup state, clear active/staged tracks and disable publication. Render **Solicitar permissão novamente** for a retryable permission failure; each explicit click reruns source validation/preparation, coalesces while pending and never silently starts streaming. System denial/missing declaration/unsupported configurations have truthful guidance, not a guaranteed popup or invented Settings URL. Do not auto-retry on effects or capability polling. Missing borderless capability with saved Windows Force SDR blocks with recovery, never changes the saved setting or starts ordinary capture silently.
- [ ] **Step 6: Run regressions and real acceptance.** Run the complete desktop suite and web SDR/setup/voice suites, `pnpm check:i18n`, desktop/web typechecks and matching-host x64/ARM64 native tests. In the actual installed Windows app verify grant → outline-free staging/publication, deny → no capture, retry after permission changes, cancellation, resize, navigation/destruction, audio off/on, no retained frames and unchanged receiver SDR output. CI compilation/property tests cannot substitute for the operator-visible permission/outline evidence.
- [ ] **Step 7: Commit.** Stage the reviewed module files and commit `fix(desktop): require borderless consent before SDR sharing`.
