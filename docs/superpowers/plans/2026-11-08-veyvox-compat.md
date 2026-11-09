# Veyvox Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing fork without losing sessions, instances, preferences, server data or the upgrade path.

**Architecture:** Retain the working installed identity and existing persistence owners; adopt the new display name at presentation boundaries. Extend the current migration, bridge and deep-link handlers instead of creating parallel startup/auth flows. Use baseline-to-candidate fixtures and isolated platform evidence.

**Tech Stack:** Electron 45, electron-builder 26, contextBridge, existing TypeScript/Vitest/fs helpers, current Zustand/localStorage/IndexedDB and SQLite/Compose owners.

**Spec:** [veyvox-compat](../specs/2026-11-08-veyvox-compat.md); [integrated plan and constraints](2026-11-08-veyvox-1.17.0.md).

## Global Constraints

- No database schema, credential, federation identity or permission change; no new dependencies.
- Preserve Chromium credential/keychain/safeStorage context, PWA identity, single-instance locking and installer upgrade identity.
- Never import the official upstream app's profile, merge populated profiles, or delete/reset existing data to pass a test.
- Keep existing bridge operations and sender/frame/focus/security gates; aliases share one implementation.
- Keep legacy storage/wire/environment identifiers unless a tested change is necessary; 1.17.0 adds no general environment-alias mechanism.
- Inherit integrated boundaries and defer commits until P1's complete implementation review.

## Review Focus

Execution checkpoint:
- [x] C1 safe migration/startup/identity pins and directed/full desktop regression.
- [x] C2 canonical-first single bridge and legacy fallback with complete web/desktop suites.
- [x] C3 bounded dual-scheme parsing/main wiring/listener cleanup and directed tests.
- [x] C4 unchanged browser/storage/wire/operator identities, fresh-only default and regression tests.
- [x] C5 actual isolated Electron/preload seed→migrate→repeat fixture.
- [x] C5 runner-only installed driver and six-native-runner matrix implemented; local refusal guards pass.
- [ ] C3/C5 real installed/protocol/encrypted-cookie/startup/AppImage evidence from candidates.
- [ ] C4 actual Compose config/image CI; local parsed production/proxy graphs are baseline-identical.

Ruling: Electron 45's Linux login-item API is a no-op. The existing auto-launch owner now explicitly reads/writes its same owned desktop entry, with escaped Exec and no implicit recreation/re-enabling. Detailed installed acceptance below remains unchecked until runner evidence exists.

- Files exist but are unreadable: C1 distinguishes ENOENT from denied/not-a-directory instead of treating both as fresh.
- Copy/promotion crashes or a destination appears concurrently: C1 never promotes partial bytes or overwrites an account.
- A new hosted client runs inside an old shell: C2 falls back to `window.backspace`, including optional-method handling.
- A new link reaches an old hosted client: C3 emits the supported legacy wire scheme from the new shell after strict validation.
- Autostart is disabled by the OS or a package path moves: C5 preserves disabled status and refreshes only an existing owned enabled entry.

---

## Task C1: Pin installed identity and make historical-profile migration fail safely

**Files:** `packages/desktop/src/{main,userDataMigration}.ts`, `userDataMigration.test.ts`; create `packages/desktop/src/startupIdentity.test.ts`; `packages/desktop/electron-builder.yml`, desktop package metadata, `docs/systems/{desktop,desktop-security}.md`.

**Interfaces:** Keep `MigrationOptions` and `migrateUserData(opts: MigrationOptions): MigrationResult`. `failed` is fatal to normal startup, not a log-and-continue into a clean profile. Same-volume migration retains its atomic rename; EXDEV copies to an exclusively created sibling staging directory and promotes only completed bytes. On EXDEV success retain the old source as a safety copy; a populated committed destination wins on later launches. No new migration daemon/registry.

The candidate's public `productName` is `Veyvox`, but pin these compatibility values:

| Owner | Value/policy |
| --- | --- |
| `app.setName` before profile consumers | `Backspace Fork` (runtime crypto/profile identity, not window/menu text) |
| Current profile | `<appData>/Backspace Fork`; never `<appData>/Backspace` |
| Historical source | `<appData>/@backspace/desktop` only |
| builder `appId` and Windows AUMID | `io.github.bernardokcosta.backspacefork` |
| builder `executableName` (all platforms) | `Backspace Fork` to preserve executable/bundle references |
| builder `extraMetadata.name` | `@backspace/desktop` for packaged metadata/cache identity; workspace remains `@veyvox/desktop` |
| desktop package `desktopName` | `io.github.bernardokcosta.backspacefork.desktop` |
| macOS `extendInfo.CFBundleName` | `Backspace Fork` for early keychain identity; `CFBundleDisplayName = Veyvox` |
| autostart entry identities | Windows `Backspace Fork`, Linux `backspace-fork`; preserve OS-authoritative preference |
| Debian `packageName` | Pin the exact baseline `.deb` Package value measured in C5, not a newly inferred Veyvox name |

Grounding: Electron v45.2.1 initializes Linux OS crypt from its app name, and
macOS reads early application name from `CFBundleName`; electron-builder 26.18.0
derives `productFilename` from `executableName`, Linux package identity from
`packageName`/product name and updater cache from packaged `name`. Verify installed
types/source and actual baseline packages before relying on these pins. Official
sources: [Electron main parts](https://github.com/electron/electron/blob/v45.2.1/shell/browser/electron_browser_main_parts.cc),
[macOS name](https://github.com/electron/electron/blob/v45.2.1/shell/common/application_info_mac.mm),
[builder AppInfo](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.18.0/packages/app-builder-lib/src/appInfo.ts).

- [ ] **Step 1 — tests:** Extend migration fixtures with `Backspace Fork` destination, source cookie/Local State/IndexedDB/instance/language/autostart/window files, and an unrelated official Backspace profile. Assert bytes and siblings survive old→new/repeat/new-populated/identical/fresh cases. Inject ENOENT versus EACCES/ENOTDIR, EXDEV, mid-copy error, pre-promotion error, and a concurrently populated destination. Assert failed operations leave source bytes unchanged, leave no partial final destination, do not delete preexisting paths, and never initialize a window/session/updater. Add startup-order/pin assertions using a mocked Electron app, not a real userData path.

  Test name: `leaves the historical profile usable after a partial EXDEV copy`.
  Following the injected copy failure, using the existing `seedOld` fixture:
  ```ts
  expect(migrateUserData({ oldDir, newDir, oldParent }).kind).toBe('failed');
  expect(fs.readFileSync(path.join(oldDir, 'instance-url.json'), 'utf8')).toBe('{"url":"https://nova.ddns.net"}');
  expect(fs.existsSync(newDir)).toBe(false);
  ```

- [ ] **Step 2:** Run `pnpm --filter @backspace/desktop test -- src/userDataMigration.test.ts src/startupIdentity.test.ts` before B2 (use `@veyvox/desktop` afterward). Expect new failure-path/startup guards to fail; baseline successful migration preservation should pass.
- [ ] **Step 3:** Harden the existing helper: only missing means absent; refuse unreadable/invalid directories; use exclusive staging on EXDEV, clean only staging owned by this invocation on failure, recheck the final destination before promotion, and never remove the EXDEV source. Keep populated destinations untouched. Wire fatal startup refusal before any normal profile consumer/BrowserWindow/updater on failure, with a non-secret diagnostic and nonzero exit. Apply identity pins together with B2. Do not create a `Veyvox` profile or change encryption backends to make a fixture pass.
- [ ] **Step 4:** Rerun both desktop tests and the desktop suite; expected PASS. Confirm `new-populated` never merges either source and repeated startup selects the same profile. C5 must still prove actual encrypted profile and install replacement; these tests alone do not establish platform acceptance.
- [ ] **Step 5:** Document retained identity values and migration/refusal behavior in desktop/security docs and ledger; queue `fix: preserve installed identity during Veyvox adoption`.

## Task C2: One typed bridge, two names, existing security gates

**Files:** `packages/desktop/src/preload.ts`; `packages/web/src/platform/{electron.d.ts,platform.ts,activityBridge.ts,manualGameBinding.ts,notifications.ts}`; all production bridge consumers found by `git grep -l 'window.backspace' -- packages/web/src` (App/main startup, i18n, diagnostics, hooks, activity/instance/update stores, NotificationController, desktop/keybind/activity/connected-instance and share UI). Create `packages/web/src/platform/platform.test.ts`, `packages/desktop/src/preload.test.ts`; extend existing consumer/security tests and `docs/systems/{desktop,desktop-security,localization}.md`.

**Interfaces:** `getElectronAPI(): VeyvoxElectronAPI | null`; `isElectron(): boolean`; `isElectronMac(): boolean`. `Window` has optional `veyvox` and `backspace` of the same type; retain `type BackspaceElectronAPI = VeyvoxElectronAPI` for legacy source fixtures. Preload constructs one existing API object and exposes it under both names. IPC channel names and method signatures remain unchanged.

- [ ] **Step 1 — RED assertions:** Test no-window/browser, only legacy bridge, only canonical bridge, both bridges (canonical precedence), and optional old-shell methods. Assert both exposed objects have the same operation set and call the same IPC channels with the same payloads; do not assert cross-world proxy reference equality. Exercise rendererReady, native language, update events/unsubscribe, notifications, connected origins, activity and keybind readiness through canonical-only and legacy-only clients. Retain unauthorized sender/subframe, destroyed-window, navigation and focus-denial tests for privileged operations.

  Test name: `prefers the canonical bridge and falls back to the legacy shell`.
  With distinct typed bridge fixtures installed in `window`:
  ```ts
  expect(getElectronAPI()).toBe(window.veyvox);
  delete window.veyvox;
  expect(getElectronAPI()).toBe(window.backspace);
  delete window.backspace;
  expect(getElectronAPI()).toBeNull();
  ```

- [ ] **Step 2:** Run the new bridge tests plus affected consumer/security tests; expect canonical-only cases to fail on the baseline.
- [ ] **Step 3:** Reuse the existing preload implementation for both exposures, resolve canonical-first with a `typeof window` guard in `platform.ts`, and route production consumers through that helper. Keep optional feature detection and existing cleanup contracts; do not add a generic IPC or Node surface. Preserve legacy-only fixtures rather than converting every test to the new name. Update native HTML to resolve either bridge without losing old-shell support.
- [ ] **Step 4:** Run all desktop/web suites and typechecks. Inspect `git grep 'window.backspace'`: production direct access remains only in the resolver or explicitly documented compatibility fixtures, not feature consumers. Confirm existing SDR smoke tooling still transpiles/serves the platform helper and uses the production preload correctly.
- [ ] **Step 5:** Record the supported matrix and queued `feat: expose compatible Veyvox desktop bridge` checkpoint.

## Task C3: Strict dual-scheme deep links with old-client compatibility

**Files:** Create `packages/desktop/src/deepLinks.ts` and test; modify main protocol/cold/second-instance handlers, builder `protocols`; `packages/web/src/platform/deepLink.ts` and new `deepLink.test.tsx`; `docs/systems/desktop.md`.

**Interfaces:** Desktop `normalizeDeepLink(input: string): string | null` accepts only `veyvox:`/`backspace:` supported routes and emits normalized `backspace://...` for existing hosted clients. Web `getDeepLinkRoute(input: string): string | null` accepts both and returns only `/join/{code[@host]}` or `/channels/{spaceId}/{channelId}`. Reuse these helpers in their existing trust boundaries; desktop is CommonJS and web ESM, so do not introduce a cross-build runtime dependency just to share a parser.

- [ ] **Step 1 — RED assertions:** For both schemes assert `join/abc`, `join/abc@peer.example` and `channel/space/channel` map to the same routes. Reject unsupported schemes/actions, empty/extra segments, authority credentials/port, query/fragment, backslash, control characters and decoded traversal/slashes. Validate invite-host suffixes with the existing invite parsing owner, not a permissive arbitrary-URL parser. Test cold pending and second-instance delivery, plus unsubscription when the React hook unmounts.

  Test names: `normalizes supported schemes for old hosted clients` (desktop) and
  `maps supported links to bounded in-app routes` (web).
  ```ts
  expect(normalizeDeepLink('veyvox://join/abc@peer.example')).toBe('backspace://join/abc@peer.example');
  expect(normalizeDeepLink('veyvox://join/abc/extra')).toBeNull();
  // In the separate web test:
  expect(getDeepLinkRoute('veyvox://channel/space/channel')).toBe('/channels/space/channel');
  expect(getDeepLinkRoute('backspace://join/%2e%2e')).toBeNull();
  ```

- [ ] **Step 2:** Run desktop deep-link and web hook tests; new scheme/strictness cases must fail before implementation.
- [ ] **Step 3:** Register both schemes in runtime and builder, selecting command-line arguments only through validation. Normalize new-shell emissions to the old scheme before delivering the existing `deep-link` event. On web, reuse `buildInstanceJoinUrl(domain: string, qualifiedCode: string): string | null` from `packages/web/src/utils/inviteParser.ts` for the host grammar (bare DNS/IPv4/bracketed IPv6 plus optional valid port); do not treat `parseInviteInput` as a strict validator. Main applies the same bounded URL grammar without importing renderer i18n/window code. Keep origin-aware internal join interception unchanged, preserving federated invite handling and navigation guards. New web accepts either shell; old binaries do not magically gain OS registration for `veyvox://`.
- [ ] **Step 4:** Rerun tests and isolated C5 fixture: both schemes navigate only inside fixture routes; malformed inputs cause no navigation or external shell action. Do OS protocol registration checks only in disposable runners/VMs.
- [ ] **Step 5:** Record the exact compatibility limitation and queued `feat: support Veyvox and legacy deep links` checkpoint.

## Task C4: Keep browser/server/Compose state in place

**Files:** New `packages/web/src/platform/rebrandCompatibility.test.ts`; extend existing `stores/{authStore.sessionReset,instanceStore,pendingMessageRehydrate}*.test.*`, `stores/junoPreferences.test.ts`, i18n preference tests, `utils/idbHandles.test.ts`, localized-manifest tests. Server `src/config.ts`, `src/db/migrate.ts` (`ensureDefaults`), `src/utils/releaseCheck.ts` and test, `src/routes/{instance,adminUpdates}.test.ts`; create `packages/server/src/db/rebrandCompatibility.test.ts`. Inspect/preserve `docker-compose*.yml`, `Caddyfile`, `install.sh`, `update.sh`, `backup.sh`, `restore.sh`, `.env.example`, Docker commit/source fields and existing backup tests; current prose changes belong to D2.

**Interfaces:** Keep `backspace_token`, `backspace-language`, `backspace-interface-scale` and every existing instance/pending/Juno/IndexedDB key/database name. Preserve PWA manifest install URLs, `X-Backspace-Paging`, other wire/header fields, `BACKSPACE_*` environment options/build args, service/container `backspace`, current Compose project identity, `./data:/app/data`, `/app/data/backspace.db`, backups and secret ownership. New default source/update repository is `bernardokcosta/veyvox`; explicit operator source URL overrides remain authoritative.

- [ ] **Step 1 — tests:** Seed old serialized storage/IndexedDB through the actual existing owners; rehydrate twice and assert token, true-home identity, connected instances, pending messages, devices/Juno preferences and language `auto` survive, with no competing `veyvox_*` stores. Check empty/unset/denied cases without destructive fallback. Seed a temporary baseline SQLite database with stable users/worker/epoch/settings; run current boot/default owners twice and compare identities/rows/uploads/backups. New fresh DB expects `instance_name = 'Veyvox'`; existing names, including literal `Backspace`, must remain unchanged. Check unset/explicit source URL, legacy env support and `/api/instance/info` source offer.

  Test names: `rehydrates existing product storage without rekeying` (web) and
  `sets Veyvox only for a newly inserted instance settings row` (server).
  After seeding old storage and reloading its real owners:
  ```ts
  expect(localStorage.getItem('backspace_token')).toBe('synthetic-session');
  expect(localStorage.getItem('backspace-language')).toBe('auto');
  expect(localStorage.getItem('veyvox_token')).toBeNull();
  // In the separate server fixture, after ensureDefaults(db) on a fresh DB:
  expect(db.prepare('SELECT instance_name FROM instance_settings WHERE id = 1').get()).toEqual({ instance_name: 'Veyvox' });
  ```

- [ ] **Step 2:** Run targeted old-name fixtures before B2 (preservation should pass); after adding fresh/source expectations, confirm those expectations fail on baseline.
- [ ] **Step 3:** Leave storage names and operational IDs unchanged. In `ensureDefaults`, explicitly insert `instance_name = 'Veyvox'` only when inserting the missing settings row; retain the old schema default/migration history as compatibility history, with no schema edit. Change app-owned fallback/source/update URLs, not stored instance names or secrets. Fix only regressions introduced by rebranding; do not turn this task into a general auth/storage refactor.
- [ ] **Step 4:** Run the affected storage/DB/auth/instance/backup tests and full federation e2e/typecheck. Run `bash -n` on touched scripts. In an isolated copied Compose fixture with synthetic env, compare `docker compose config` project/services/mounts/network/volume/image defaults before and after; never invoke the production stack. R2 owns image publication continuity.
- [ ] **Step 5:** Record exact remaining storage/config/wire identifiers, preservation tests and queued `fix: retain existing storage and operator compatibility` checkpoint.

## Task C5: Isolated runtime and installed-replacement acceptance

**Files:** New `packages/desktop/scripts/run-rebrand-smoke.mjs`, `packages/desktop/test/rebrand/{main.cjs,fixture.html}`; extend existing compatibility fixture documentation rather than its unrelated probe protocol. Add read-only acceptance steps to `.github/workflows/release.yml` and the existing ledger; C1 owns any required identity pins, existing auto-launch helpers/tests own path-refresh logic.

**Interfaces:** `node packages/desktop/scripts/run-rebrand-smoke.mjs` runs a fixture main with compiled production preload and startup/migration helpers, a new temporary appData/userData root and loopback-only fixture pages. It produces bounded PASS/FAIL JSON and capture paths, with a timeout/nonzero failure. This is not a production `--skip-security`/`--skip-migration` flag.

- [ ] **Step 1 — RED assertions:** Add the runner/fixture that fails when compiled inputs are absent, when a canonical-only bridge is missing, or when a saved synthetic session/instance/language/IndexedDB/cookie disappears on relaunch. Explicitly verify the harness does not register protocols, initialize updates, write login items, call external services or acquire user media. Import production logic/preload; do not rewrite their behavior in the fixture.

  Acceptance name: `relaunch preserves the synthetic old-profile state with production preload`.
  In the fixture's bounded result assertions:
  ```js
  assert.equal(relaunch.instanceUrl, 'http://127.0.0.1:' + fixturePort);
  assert.equal(relaunch.languagePreference, 'auto');
  assert.equal(relaunch.cookie, 'synthetic-session');
  assert.equal(sideEffects.protocolRegistrations + sideEffects.updateInstalls + sideEffects.loginItemWrites, 0);
  ```

- [ ] **Step 2:** Run the runner after compilation and capture genuine baseline/new behavior. A DOM mock alone cannot pass this gate. Harness isolation does not establish installed-main wiring; keep those results separate.
- [ ] **Step 3:** Compare verified 1.16.8 baseline packages with candidate packages on matching disposable platform runners/VMs. Record NSIS GUID/install location/uninstall entry/shortcut and appId; macOS bundle ID/CFBundleName/display name/crypto and bundle path; Linux `dpkg-deb -f <baseline.deb> Package`, desktop filename, install path and AppImage behavior. Pin `deb.packageName` to the measured literal baseline value in C1; fail if candidate differs. Install baseline, seed synthetic data, upgrade candidate and relaunch twice: one owned installation/entry, intact cookies/session/instances/preferences, no official Backspace import. For macOS/manual update, replace the existing bundle at its retained path, not a side-by-side new app. Do not run installers on the maintainer's real OS account.
- [ ] **Step 4:** Exercise OS-enabled/disabled autostart and start-minimized without duplicating entries. If Linux's `/opt` path changes with productName, refresh only an existing owned enabled entry from its old path to `process.execPath`; reuse the current AppImage path-refresh helpers, never recreate a missing/disabled entry or overwrite an unrelated command. Rerun `autoLaunch.test.ts`, native security suites and packaged fuses/signature/native-resource checks. Verify packaged updater cache name remains baseline-equivalent and no cache cleanup broadens its deletion scope.
- [ ] **Step 5:** Run on local Windows and available matching CI platforms, record exact installed-versus-build-only evidence. Missing runners/VM/old-installer or encryption checks are explicit publication blockers, not simulated passes. Queue `test: prove Veyvox replacement and mixed-client compatibility` checkpoint.
