# Windows SDR Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an opt-in, real HDR-to-SDR Windows screen-share track without changing the monitor's HDR setting.

**Architecture:** Capture high-precision scRGB through Windows Graphics Capture in a Node-API addon loaded only by privileged desktop code. Use Windows Direct2D HDR tone mapping, white-level adjustment and color management to produce SDR GPU textures, then transfer authorized frames through Electron's managed sharedTexture interface to a generated video track. Keep audio and publication in the existing screen-share lifecycle.

**Tech Stack:** Windows SDK C++/WinRT, Node-API, Direct3D11, Direct2D, Electron 45, TypeScript, WebCodecs, Vitest.

**Spec:** [Windows SDR capture](../specs/2026-10-24-windows-sdr-capture.md); [initiative constraints and order](2026-10-24-desktop-1.15.1.md).

## Global Constraints

- Force SDR defaults off, is saved per device and requires a fresh capture to change; no desktop restart.
- Windows x64/arm64 only; preserve ordinary capture and audio elsewhere.
- Keep sandbox/context isolation/fuses intact; never send raw native handles to the remote page.
- Corrected preview and publication use the same track; failures never silently publish the raw HDR capture.
- Native packaging, safe transport and real HDR validation are release gates, not optional smoke tests.

## Review Focus

1. Sandbox or cross-world VideoFrame incompatibility: prove transfer through the actual preload, not a privileged test renderer.
2. Receiver stalls/held frames/repeated sessions: retain at most three native output textures process-wide, without premature reuse.
3. Mixed HDR/SDR displays and a window crossing them: use the selected source's color data or reject an unsupported ambiguous source truthfully.
4. Direct `track.stop()`, cancel, navigation and device loss: release native sessions even though local track.stop does not emit `ended`.
5. arm64 compilation is not arm64 execution: verify PE architecture and separately boot/load on a matching host.

---

### Task N1: Prove native SDR texture → sandboxed video transport

**Files:**
- Create: `packages/desktop/native/sdr-capture/sdr-capture.vcxproj`, `addon.cpp`, `sdr_texture.cpp`, `sdr_texture.h`, `sdr_texture_test.cpp`.
- Create: `packages/desktop/scripts/build-sdr-capture.mjs`, `run-sdr-capture-smoke.mjs`.
- Create: `packages/desktop/test/sdr-capture/{main.cjs,preload.cjs,renderer.html}`.
- Create: `packages/desktop/src/sdrCaptureTypes.ts`, `sdrCaptureTransport.ts`, `sdrCaptureTransport.test.ts`.
- Record: `docs/superpowers/validation/2026-10-24-desktop-1.15.1.md` (commands, platform/architecture, measured results and blockers; no secrets).

**Interfaces:**
- Private addon: `createTestFrame(input: Float32Array, width: number, height: number, whiteNits: number, maxNits: number): NativeSdrFrame`; `releaseFrame(frameId: string): void`.
- `NativeSdrFrame` stays privileged: `{ frameId: string; ntHandle: Buffer; width: number; height: number; timestampUs: number }`.
- Transport: `sendSdrFrame(target: Electron.WebFrameMain, sessionId: string, frame: NativeSdrFrame): Promise<void>`; failure releases unsent references, never silently falls back.
- New script commands: `node packages/desktop/scripts/build-sdr-capture.mjs --arch x64 --test`, same with `arm64`; `node packages/desktop/scripts/run-sdr-capture-smoke.mjs --arch x64 --mode synthetic`, same with `arm64`.

- [ ] **Step 1: Add failing native and transport tests.** With SDR white/max both 80 nits, linear neutral inputs 0, 0.18 and 1 must become sRGB codes 0, 118 and 255 (tolerance two 8-bit levels), without changing the monitor. With HDR white 203/max 1000 nits, FP16 neutral inputs 0, 0.18, 1, 4 and 12.5 must yield finite bounded neutral output and distinct ordered highlight levels rather than clipping 1/4/12.5 to one white; check output size/metadata, negative/out-of-gamut and non-finite handling. Transport tests reject a foreign/destroyed frame, close references on import/send failure and never recycle a held texture. The fixture asserts sandbox on, isolation on, renderer Node off, `VideoFrame` consumable by the video-track generator and cleanup after renderer closure.
- [ ] **Step 2: Run the new tests before implementation.** `pnpm --filter @backspace/desktop test -- sdrCaptureTransport` and the new build/synthetic commands above must initially fail on absent implementation, not be skipped as a success.
- [ ] **Step 3: Implement build, conversion and managed transport.** Use the existing MSVC/Windows SDK toolchain and stable Node-API C interface, avoiding a new runtime dependency. Resolve the actual Node 24 headers/import library from the official distribution with checksum verification; fail clearly for missing SDK/toolchain or architecture mismatch. Emit `native/sdr-capture/build/win32-<arch>/sdr_capture.node` and native test executable. Require Windows Graphics Capture's supported desktop APIs (Windows 10 1903 or newer) and the required Direct2D effects; capability failures are explicit.
- [ ] **Step 4: Implement the synthetic conversion through Windows effects.** Keep HDR source and intermediate surfaces FP16. Use `CLSID_D2D1HdrToneMap` in SDR mode, `CLSID_D2D1WhiteLevelAdjustment` and `CLSID_D2D1ColorManagement` in Microsoft's documented order; use source SDR-white/MaxCLL inputs and an SDR target. Emit BGRA8 sRGB/BT.709 full-range output, not a clipped FP16→UNORM copy. SDR-only inputs take a correctly normalized color-managed SDR path rather than unnecessary HDR compression. Add deterministic native readback assertions with checked-in expected sample ranges; record actual values before accepting the curve.
- [ ] **Step 5: Prove transport with the real security settings.** Native handles are local NT handles, retained until Electron's `allReferencesReleased` signals GPU completion. Preload registers `setSharedTextureReceiver`, obtains a VideoFrame and transfers that frame via a same-window message to the page; expose no imported-texture object or native handle. Check the pinned Electron's actual transfer/ownership behavior. The renderer validates source/origin/session and consumes each VideoFrame, closing it after write. A maximum three-slot pool bounds held resources across stopped sessions. Do not disable isolation or substitute CPU brightness processing if this path fails.
- [ ] **Step 6: Run and record both architecture gates.** Run native tests and synthetic video smoke on matching Windows x64 and arm64 hosts. A cross-compile host may build without `--test`; `--test`/smoke must fail explicitly when runtime architecture does not match. Missing ARM hardware/runner or unusable GPU is pending evidence, not a pass. Stop dependent native work if the sandbox transport is unviable. Commit only the passing foundation and its honest evidence.

**Grounding:** [Microsoft HDR effect](https://learn.microsoft.com/en-us/windows/win32/direct2d/hdr-tone-map-effect), [white-level effect](https://learn.microsoft.com/en-us/windows/win32/direct2d/white-level-adjustment-effect), and Electron 45's `lib/renderer/api/module-list.ts` and `spec/fixtures/api/shared-texture/managed/`. Electron's own `api-shared-texture.spec.ts` currently limits its tests to macOS arm64; its example is not Windows proof.

### Task N2: Authorized native capture with bounded lifecycle

**Files:**
- Create: `packages/desktop/native/sdr-capture/{capture_session.cpp,capture_session.h,source_color.cpp,source_color.h}`.
- Create: `packages/desktop/src/sdrCapture.ts`, `sdrCapturePolicy.ts`, `sdrCapturePolicy.test.ts`, `sdrCapture.test.ts`.
- Modify: `packages/desktop/src/main.ts`, `preload.ts`, `screenSharePolicy.ts`, `screenSharePolicy.test.ts` and N1's addon/project/fixtures.
- Update: `docs/systems/desktop-security.md`, `docs/systems/desktop.md`.

**Interfaces:**
- `SdrCaptureCapability = { supported: true } | { supported: false; reason: 'platform' | 'system' | 'module' | 'transport' }`.
- `SdrCaptureConstraints = { width: number; height: number; frameRate: number }`; width/height zero mean source-native dimensions.
- Native session methods: `startCapture(source: AuthorizedSdrSource, constraints: SdrCaptureConstraints, onFrame: (frame: NativeSdrFrame) => void, onError: (code: string) => void): string`, `configureCapture(sessionId: string, constraints: SdrCaptureConstraints): void`, `stopCapture(sessionId: string): void`.
- `AuthorizedSdrSource` is privileged data resolved from the existing main-process enumeration, never supplied as a pointer/handle by the renderer.
- Renderer bridge additions: `getSdrCaptureCapability(): Promise<SdrCaptureCapability>`, `startSdrCapture(constraints): Promise<{ sessionId: string }>`, `configureSdrCapture(sessionId, constraints): Promise<void>`, `stopSdrCapture(sessionId): Promise<void>`, `onSdrCaptureEnded(callback): () => void`. Frame packets contain only `{ type: 'backspace-sdr-frame'; sessionId: string; frame: VideoFrame }`.
- Extend `preselectScreenSource(sourceId, shareAudio, videoOptions?: { forceSdr: boolean })` compatibly. Main grants one 30-second, one-use native start authorization only after the corresponding display-media request is accepted for the current main frame and source.

- [ ] **Step 1: Write policy/lifecycle tests.** Cover missing/expired/consumed authorization, foreign sender/subframe, navigation generation change, denied/vanished source and focus lost before initiation. After legitimate start, alt-tab must not stop an authorized share. Cover cancellation after start resolves late, repeated stop, renderer loss, callback exceptions, resize/display removal/device loss and 100 stop/restart attempts with retained old frames; live texture slots never exceed three.
- [ ] **Step 2: Run** `pnpm --filter @backspace/desktop test -- sdrCapture screenSharePolicy`; expect new assertions to fail before implementation.
- [ ] **Step 3: Implement the source/session adapter.** Resolve the selected display/window using main's trusted enumeration and verified native mapping; never interpret an arbitrary renderer string as an HWND/HMONITOR. Capture `R16G16B16A16_FLOAT` through `Direct3D11CaptureFramePool.CreateFreeThreaded`, using the selected display's HDR/SDR-white metadata (`DisplayConfigGetDeviceInfo`/DXGI). A window spanning incompatible display color/white levels is rejected as source-color-unsupported until a correct conversion is supported, rather than selecting an unrelated monitor. Use a bounded worker/Node-API delivery queue, monotonic timestamps, cursor handling and GPU synchronization before N1 imports a frame.
- [ ] **Step 4: Wire narrow IPC and teardown.** Validate sender and senderFrame, source generation, constraints and session ownership; consume the grant once. Validate source frame bounds and finite color metadata. Acquire no microphone. On resize reconfigure buffers safely; on source/device/transport loss stop capture and emit an ended reason, without fallback. Navigation, window destruction and application exit revoke grants and stop sessions. Retired textures remain bounded and unreusable until their release callback, including across new session attempts.
- [ ] **Step 5: Run unit and real source smoke.** `node packages/desktop/scripts/run-sdr-capture-smoke.mjs --arch x64 --mode capture`, and matching arm64, must exercise explicit selection, resize, cancellation and cleanup. Record Windows build, GPU, selected source and resource counts without screenshots of unrelated windows. Update security/lifecycle docs and commit the validated capture adapter.

### Task N3: Screen-share integration, packaging and real HDR acceptance

**Files:**
- Create: `packages/web/src/utils/sdrScreenCapture.ts`, `sdrScreenCapture.test.ts`.
- Modify: `packages/web/src/platform/electron.d.ts`, `stores/voiceStore.ts`, `utils/screenShare.ts`, `hooks/useLiveKit.ts`, `components/voice/ScreenShareSetup.tsx`, `components/voice/StreamQualityControls.tsx`.
- Modify/test: `packages/web/src/components/voice/StreamQualityControls.test.tsx`, existing screen-share capture, stop-path, live-audio and store migration suites; add `packages/web/src/utils/screenShare.sdr.test.ts`.
- Modify: `packages/desktop/electron-builder.yml`, `scripts/afterPack.js`; create `packages/desktop/scripts/verify-sdr-capture-package.mjs` and its Node test.
- Modify: `.github/workflows/ci.yml` (required Windows native build/load job); release packaging is completed by R1.
- Modify: `packages/web/src/locales/{en,de,ru,pt,zh}/voice.json`; update `docs/systems/voice.md`, `desktop.md`, `desktop-security.md`, `localization.md`.

**Interfaces:**
- Add `forceSdr: boolean` to `ScreenShareConfig`, migrated to false when absent.
- `acquireSdrScreenCapture(raw: MediaStream, constraints: SdrCaptureConstraints): Promise<MediaStream>` returns one corrected video track plus the existing audio tracks; no raw video publication.
- `configureSdrScreenCapture(stream: MediaStream, constraints: SdrCaptureConstraints): Promise<boolean>` reports whether it owns the stream; ordinary captures continue using current constraints.
- `disposeSdrScreenCapture(stream: MediaStream): void` is idempotent and stops its host session. Every local stop path calls it explicitly; do not depend on `ended` firing for track.stop().
- `node packages/desktop/scripts/verify-sdr-capture-package.mjs --resources <path> --arch x64|arm64` verifies packaged native presence/PE architecture. It does not claim a runtime load check.

- [ ] **Step 1: Add failing integration/component tests.** Assert migration false, persisted choice, unsupported-platform truthful effective state, old bridge capability detection, live toggle disabled with restart-share copy, and no application restart. Cover first-frame/start failure and late completion after cancel; all acquired tracks and host sessions stop, and a raw capture is never published. Assert corrected preview/publication share the track, system-audio identity stays unchanged and microphone capture is never duplicated.
- [ ] **Step 2: Run** `pnpm --filter @backspace/web test -- sdrScreenCapture screenShare.sdr StreamQualityControls`; expect failures for the missing feature.
- [ ] **Step 3: Implement the guarded track adapter and controls.** Register/validate the frame receiver before starting native capture; write frames to the supported generator with backpressure, closing VideoFrames on all paths. Replace raw video only after a corrected first frame, preserving audio. Keep capability separate from the saved preference: unsupported platforms show the option unavailable/effectively off without overwriting a saved Windows preference. A supported Force SDR attempt that fails raises a visible error and requires explicit disable/retry. Route staged/live quality changes through the owning adapter; call disposal on every setup/live/unpublish/reconnect-ending path.
- [ ] **Step 4: Package and gate both native architectures.** Build x64 and arm64 before Windows packaging; include only the matching binary as `resources/sdr-capture/sdr_capture.node`, without adding executable code to the remote renderer. afterPack verifies presence/architecture before fuse checks. Add a Windows CI native build/test job and include it in the existing aggregate gate; lack of an available matching ARM runtime remains a release-blocking acceptance item, not a skipped green load test. Real packaged boot/load is performed against a temporary local test instance with an isolated OS test account/profile, never the user's installed production profile.
- [ ] **Step 5: Run regressions and capture evidence.** Run the affected tests, desktop TypeScript, i18n and lint. Verify native package architecture for each unpacked Windows app, then boot each on a matching host. On actual HDR hardware compare Force SDR off/on, preview and an SDR receiver, with Windows HDR still enabled; also test an SDR monitor, window/display selection, source changes, 1080p60 and a supported high-resolution mode. Record duration, dropped frames, memory/handle counts and visible highlights/grays. Missing HDR/ARM evidence is pending: do not tag or activate the minimum. Update docs/validation ledger and commit only the complete feature with truthful verification status.
