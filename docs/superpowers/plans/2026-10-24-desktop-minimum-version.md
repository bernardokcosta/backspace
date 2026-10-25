# Desktop Minimum Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block the entire ordinary desktop experience below 1.15.1 while retaining browser access and a usable update path.

**Architecture:** Centralize semantic-version and desktop-identification decisions behind shared helpers. The server exposes an optional minimum and checks identifiable desktop REST/WebSocket sessions; the instance-served frontend checks the installed host through the existing updater bridge before mounting session effects. Policy enforcement remains disabled by default and does not become a device-attestation or authorization mechanism.

**Tech Stack:** TypeScript strict, Fastify 5, React 19, Zustand 5, Electron/electron-updater, Vitest.

**Spec:** [Desktop minimum version](../specs/2026-10-24-desktop-minimum-version.md); [initiative constraints and order](2026-10-24-desktop-1.15.1.md).

## Global Constraints

- `BACKSPACE_MIN_DESKTOP_VERSION` is optional/disabled by default; deployment's approved minimum is **1.15.1**.
- Browser/mobile web, bot and federation access remain available; preserve account credentials and drafts.
- The serving instance owns the policy; remote peers cannot replace the global floor or updater feed.
- Work with the older getVersion/updater bridges, not only the new desktop binary.
- No Later/Escape/route bypass; install only an actually ready compatible version. Manual/external update ownership stays truthful.
- Unavailable old-client/active-call evidence blocks activation, not permission to claim instant enforcement.

## Review Focus

1. Electron's version is not the app's version: capture real packaged 1.14.2/1.15.0 identification before fixing a parser.
2. Old bundles retaining LiveKit media must not evade the policy indefinitely; test per-session teardown without ejecting another valid browser/bot session.
3. Fetch/IPC timeout and stale async replies must not unlock a blocked client or strand recovery after an operator disables the policy.
4. Upload/background send paths outside the ordinary app layout must not mutate data while blocked; preserve queued contents for later recovery.
5. Remote-only policy refusal must stop that origin's reconnect loop, not overwrite the serving instance's policy or log out all accounts.

---

### Task M1: Legacy identification evidence and shared policy contract

**Files:**
- Create: `scripts/probe-desktop-compatibility.mjs`, `scripts/fixtures/desktop-compatibility/README.md` (safe local probe instructions and sanitized header samples).
- Create: `packages/shared/src/desktopCompatibility.ts`; modify `packages/shared/package.json`, `src/types.ts`, `src/constants.ts`, `src/errors.ts`.
- Create: `packages/server/src/utils/desktopCompatibility.test.ts`, `packages/server/src/config.desktopMinimumVersion.test.ts`.
- Modify: `packages/server/src/config.ts`, `src/routes/instance.ts`, `src/utils/httpErrors.ts`, `.env.example`.
- Modify: `packages/web/src/i18n/errors.ts`, `src/locales/{en,de,ru,pt,zh}/errors.json`.
- Update: `docs/systems/api.md`, `deployment.md`, `localization.md` and the validation ledger from N1.

**Interfaces:**
- Shared export paths: `@backspace/shared/src/desktopCompatibility` and its `.js` alias.
- `compareDesktopVersions(left: string, right: string): -1 | 0 | 1 | null`; null means invalid input, not equivalent/current.
- `parseMinimumDesktopVersion(value: unknown): string | null` accepts absent/null as disabled and a valid stable SemVer string as configured; throws on other input, including an empty remote field. Server config trims its environment setting and converts blank/unset to null before calling it; malformed remote policy is caught by the frontend as a failure.
- `identifyDesktop(userAgent: string): { kind: 'desktop'; version: string | null } | { kind: 'other' }`, based on observed fork desktop formats plus the new explicit `BackspaceFork/<version>` token.
- `desktopCompatibilityDecision(current: string | null, minimum: string | null): 'allowed' | 'update-required' | 'unknown-version'`.
- `InstanceInfoResponse.minimumDesktopVersion?: string | null`; `config.minimumDesktopVersion: string | null`; error code `desktop_update_required` with details `{ minimumVersion, currentVersion? }` (omit unknown currentVersion to preserve `ErrorDetails`' existing string/number values); WebSocket close constant `DESKTOP_UPDATE_REQUIRED_CLOSE_CODE = 4406`.
- Probe command: `node scripts/probe-desktop-compatibility.mjs --listen 127.0.0.1 --port 3088 --output <approved-temp-path>`; loopback only, records app UA/handshake client metadata but redacts credentials/tokens/content.

- [ ] **Step 1: Add failing helper/config/instance tests.** Assert disabled/missing policy, valid `1.15.1`, invalid configured prerelease/malformed values, numeric ordering (`1.15.10 > 1.15.2`), `1.15.1-beta.1 < 1.15.1`, build-metadata equivalence, invalid/leading-zero/oversized values and unknown installed version. Assert optional instance field and configured null, without breaking older fixtures.
- [ ] **Step 2: Run** `pnpm --filter @backspace/server test -- desktopCompatibility config.desktopMinimumVersion`; expect failures before implementation.
- [ ] **Step 3: Probe actual shipped hosts before accepting identification rules.** Obtain 1.14.2/1.15.0 installers through trusted release assets and verify their digests. Run in a disposable OS account/VM, pointed only at the loopback probe, without touching the user's installed app/profile. Record actual headers/WS metadata at startup and reconnect. Also verify how the service worker and an active legacy call behave across an instance deployment. If app-version identification or bounded transition cannot be established, stop M2/R3 and report the precise gap; do not infer it from Electron's version or invent successful legacy evidence.
- [ ] **Step 4: Implement bounded shared parsing and optional configuration.** Use a small strict SemVer parser/comparator without new runtime dependencies; bound accepted input lengths and compare numeric identifiers safely. Implement the proven desktop formats; a recognized fork/Electron host lacking an app version is unknown, not allowed when a floor exists. Export the new optional field/error/close constant, populate the public endpoint and validate the environment at startup. Add the explicit fork/version UA token in `packages/desktop/src/main.ts` without destroying the existing UA/browser tokens; include its exact headers in the probe fixtures.
- [ ] **Step 5: Validate and document the contract.** Run M1's tests, `pnpm typecheck`, `pnpm check:i18n`; update API/deployment/error docs and the validation ledger. Record any legacy active-call limitation as a blocking result, not an accepted reduction of the specification. Commit the disabled-by-default policy contract.

### Task M2: Consistent REST, raw-upload and WebSocket enforcement

**Files:**
- Create: `packages/server/src/utils/desktopAccess.ts`, `desktopAccess.test.ts`.
- Modify: `packages/server/src/utils/auth.ts`, `src/routes/auth.ts`, `src/routes/files.ts`, `src/ws/handler.ts`; modify optional-auth guards only where they resolve a human session outside authenticate (`src/routes/stickerStore.ts`).
- Modify: `packages/server/src/routes/livekit.ts` and the existing voice teardown module only if the legacy probe proves an existing media grant needs targeted revocation; no broad user-wide ejection.
- Create: `packages/server/test/desktop-compatibility.test.ts`.
- Modify: `packages/web/src/hooks/useWebSocket.ts`, `src/api/client.ts`; create `packages/web/src/utils/desktopPolicyEvents.ts` and its test.
- Update: `docs/systems/{api,websocket,desktop,deployment,voice}.md` and validation ledger.

**Interfaces:**
- `requireCompatibleDesktop(userAgent: string | undefined, principal: { isBot: boolean }, minimumVersion: string | null): void` throws an `AuthError`-compatible error with status 426/code/details on a rejected desktop, never replaces authentication/authorization.
- Resolve bot status from the verified principal (including JWT-backed/federated bots), not an unverified token prefix or clientKind claim. Extend internal verified identity with `isBot: boolean` as needed.
- Human public login/register checks use the same desktop decision without requiring an existing account; public/static/recovery endpoints do not invoke the restriction.
- WebSocket error uses existing `type: 'error'` with `code: 'desktop_update_required'` and validated version details, followed by close 4406 before session registration. Extend the shared error-event details shape compatibly if required.
- `onDesktopPolicyRefused(listener: (origin: string) => void): () => void` and `noteDesktopPolicyRefused(origin: string): void` are a local, validated refusal notification; they do not accept a peer-selected global minimum/update URL.

- [ ] **Step 1: Add failing server-path and client reconnect tests.** Cover old/unknown/current desktop, disabled policy, browser/mobile, real bot credentials and federation traffic. Exercise login/register, authenticated mutation, optional human auth, tus create/PATCH/HEAD/DELETE and livekit token acquisition; blocked mutations write nothing. WS refusal must not register presence/telemetry/voice. Updated clients stop 4406 reconnect attempts. A remote-only refusal affects only that origin. Include an active legacy media session and a simultaneous valid browser/bot voice session to prove teardown does not eject the wrong participant.
- [ ] **Step 2: Run** `pnpm --filter @backspace/server test -- desktopAccess desktop-compatibility` and `pnpm --filter @backspace/web test -- desktopPolicyEvents`; expect new enforcement assertions to fail.
- [ ] **Step 3: Enforce at actual identity seams.** Apply the shared decision after access-token verification in authenticate, equivalent raw tus hooks and human optional-auth flows; keep unauthorized requests unauthorized and existing permission/ownership checks intact. Public human auth routes check recognized desktop compatibility before account mutations. Check WS after verified bot/human classification and before adding a connection. Map refusal through the standard error contract; preserve tus protocol-required response shape while retaining a stable update-required result where supported.
- [ ] **Step 4: Prove bounded existing-session behavior.** Use M1's observed legacy behavior, current voice-owning socket and existing LiveKit controls for targeted cleanup only when necessary. Never revoke another valid session merely because the same user id was seen on an old desktop. If pre-existing media grants cannot be safely identified/revoked across restart, keep activation blocked and revisit that seam explicitly; do not claim REST/WS refusal alone stops an already-valid media connection. Updated frontend home-origin refusal triggers M3 policy recheck and teardown; peer refusal does not overwrite the home floor.
- [ ] **Step 5: Validate enforcement and regressions.** Run affected auth/bot, federation, uploads, voice and WS tests plus `pnpm --filter @backspace/server typecheck:e2e`. Execute the real old-client/browser transition test, recording the time to refusal/recovery and media termination, then update subsystem docs and commit the complete enforcement path. Do not enable the production setting.

### Task M3: Blocking updater root and guarded background lifecycle

**Files:**
- Create: `packages/web/src/stores/desktopCompatibilityStore.ts`, its `.test.ts`.
- Create: `packages/web/src/components/desktop/DesktopCompatibilityGate.tsx`, `RequiredDesktopUpdate.tsx`, and matching `.test.tsx` files.
- Modify: `packages/web/src/main.tsx`, `src/App.tsx`, `src/stores/updateStore.ts`, `src/stores/pendingMessageRehydrate.ts`, `src/components/ui/UpdateToast.tsx` where shared subscriptions require it; create `packages/web/src/stores/pendingMessageRehydrate.test.ts` for the lifecycle regressions.
- Modify: `packages/web/src/locales/{en,de,ru,pt,zh}/desktop.json` and `common.json` only for genuinely shared copy; update `docs/systems/{desktop,localization}.md`.

**Interfaces:**
- Store state: `{ phase: 'checking' | 'allowed' | 'required' | 'failed'; currentVersion: string | null; minimumVersion: string | null; error: string | null }`, with `initialize(): () => void` and `retry(): void`. Browser returns allowed without IPC/policy lookup.
- `DesktopCompatibilityGate({ children }: { children: React.ReactNode })` mounts children only after allow, otherwise renders the required/retry screen with usable titlebar controls.
- `canInstallRequiredUpdate(snapshot: DesktopUpdateSnapshot | null, minimumVersion: string): boolean` requires auto capability, ready phase and a valid satisfying version, irrespective of dismissal.
- Change `startPendingMessageOrchestrator(): () => void` to return complete teardown; keep backward callers valid when ignoring the return. Teardown stops subscriptions/listeners and prevents late deferred dispatch without erasing bubbles/drafts.

- [ ] **Step 1: Add failing root/store/updater tests.** Cover zero browser IPC calls; below/equal/newer/prerelease desktop; policy absent/null/disabled; bridge/network timeout, malformed policy, late response after retry/dispose; and successful policy removal after a failure. Assert no protected children/session effects/pending replay before allow. Required UI has no Later/Escape/backdrop/route bypass, ignores dismissals, exposes real progress and enables restart only for a compatible ready auto update. Manual/external modes show their working update paths; failed/insufficient downloads remain blocked.
- [ ] **Step 2: Add background lifecycle regressions and run failing tests.** Seed a pending bubble and completed upload, then fire transfer, ready, online and late promise callbacks while required and after gate teardown; no outgoing send occurs and saved contents remain. Test re-allow/start twice under StrictMode/HMR does not duplicate sends. Run `pnpm --filter @backspace/web test -- desktopCompatibilityStore DesktopCompatibilityGate RequiredDesktopUpdate pendingMessageRehydrate`.
- [ ] **Step 3: Implement policy state and update screen.** Query only the serving instance's public info and existing getVersion bridge; use an 8-second bounded lookup, a single 60-second refresh timer plus focus/refusal retries, generation/abort guards and explicit retry. On initial uncertainty remain failed/checking with recovery; preserve a known required floor across failures. A successful fresh disabled policy may unlock. Use existing actual updater snapshots/capabilities and trusted fork release-page action, not a remote executable/feed URL. Start the updater bridge outside protected app mounts; render localized Aether Drift UI with keyboard/window controls and a browser-open action for the current serving origin.
- [ ] **Step 4: Move startup and teardown behind the gate.** Remove unconditional pending-orchestrator start from main.tsx; start it only inside the allowed subtree with full disposal. Audit hook/store startup and existing remote connections/voice/capture so switching to required ends active effects without logout or draft deletion. Update API/WS refusal plumbing to request a serving-origin recheck, suppress forbidden retries and stop background writes. The gate must not be merely a modal over still-running app activity.
- [ ] **Step 5: Validate UI and installed-host recovery.** Run M3 tests plus existing update, app-route, pending-message, audio and capture suites; run i18n/typecheck/lint. Drive a browser smoke with old/current/manual/external snapshots and capture screenshots; then test actual 1.14.2/1.15.0 installed hosts, real updater check/download and compatible relaunch in disposable profiles. Keep production disabled; update docs/evidence and commit.
