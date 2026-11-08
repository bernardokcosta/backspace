# Locale Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` for inline
> implementation, task by task. This plan does not authorize implementer agents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved 25-language registry and correct Automatic versus
explicit selection across web, native surfaces and the independent Juno scope.

**Architecture:** Existing web `i18n/index.ts` remains the only renderer preference/
effective-language owner. A small subscription hook adapts it to React; native
`l10n.ts` owns its persisted mirror and OS resolution, with no web/shared imports.

**Tech Stack:** Existing strict TypeScript, React/useSyncExternalStore, i18next 26,
Electron 45, Vitest/Testing Library; no dependency or storage-location change.

**Spec:** [Runtime](../specs/2026-11-07-i18n-locale-runtime.md).
**Parent:** [Initiative plan](2026-11-07-i18n-25-languages.md).

Execution evidence for R1–R5 is recorded in the parent ledger's task-status
section (RED/GREEN run IDs). The 2026-11-08 follow-up reran the complete web and
desktop suites; checkboxes are reconciled here, not new execution claims.

## Global Constraints

- Inherit every global constraint and the canonical 25 labels from the parent/spec.
- Explicit app preferences win; `auto` follows system/browser. Juno `auto` follows app.
- Preserve `backspace-language`, native `{ language: ... }` JSON and old concrete values.
- No generic IPC, new preference store, renderer Node access or native runtime import
  of web/shared TypeScript. Isolation/sandbox/navigation posture remains unchanged.
- New locales stay unreleased until L4; existing five remain usable throughout.

## Review Focus

1. Same-effective-language mode changes still notify React subscribers (R3).
2. Disk denial must not freeze native menus on the previous mode (R2).
3. Foreign window/subframe IPC cannot read languages or persist a preference (R2).
4. Slow OS/catalog replies cannot supersede explicit selection/dev preview (R3/R4).
5. Native HTML refocus relabels without clearing input or initiating an action (R5).

## Task R1: canonical registry and typed preference

**Files:** modify `packages/web/src/i18n/languages.ts`, `languages.test.ts`.
**Interfaces:** export `LanguagePreference = 'auto' | SupportedLanguage` and
`isLanguagePreference(value: unknown): value is LanguagePreference`.
Keep `resolveSupportedLanguage(tag: string): SupportedLanguage | null`,
`pickLanguage(stored: string | null, browserLanguages: readonly string[], released?: ReadonlySet<string>): SupportedLanguage`
and existing registry/direction exports. `pickLanguage('auto', ...)` behaves like
no explicit choice; do not change its return type to a preference.

- [x] Add failing registry tests with the exact 25 codes/native labels, exactly
  one RTL entry (`ar`), exactly five initially released entries, unique names,
  `pt-BR`/`pt-PT` → `pt`, `zh-TW` → `zh`, `no`/`no-NO`/`nb-NO` → `nb`, and
  `['zz-ZZ', 'fr-CA', 'en']` → `fr` with a test release set. Invalid/empty tags
  skip; an unreleased stored/detected locale never wins normal detection.
- [x] Run `pnpm --filter @backspace/web test -- src/i18n/languages.test.ts`;
  expect FAIL on registry count/alias/preference until implemented.
- [x] Add the spec's entries/labels, preserve existing code compatibility and
  dev-preview gating. Implement preference guard without an unsafe cast at callers.
- [x] Rerun the command; expect PASS. Record the canonical registry in the ledger.

## Task R2: native preference, secure OS-language IPC and packaging

**Files:** modify `packages/desktop/src/{l10n,main,preload,recovery}.ts`,
`packages/desktop/src/{l10n,recovery}.test.ts`,
`packages/web/src/platform/electron.d.ts`; create
`packages/desktop/src/languageIpc.ts` and `languageIpc.test.ts`.
**Interfaces:** native `DesktopLanguage` mirrors all concrete registry codes;
`DesktopLanguagePreference = 'auto' | DesktopLanguage`.

- `resolveDesktopLanguage(stored: string | null, systemLanguages: readonly string[]): DesktopLanguage`.
- `loadStoredLanguage(): DesktopLanguagePreference | null`;
  `saveStoredLanguage(preference: DesktopLanguagePreference): void` updates live
  cached mode **before** attempting disk write; caller logs failure, still refreshes UI.
- `getDesktopLanguagePreference(): DesktopLanguagePreference` (lazy initialize once,
  missing/invalid → `auto`), `getDesktopLanguage(): DesktopLanguage`, and
  `getDesktopLanguageQuery(): { lang: DesktopLanguage; preference: DesktopLanguagePreference; released: string }`.
  `released` is the native released-code list joined with commas, so inline pages
  can resolve OS preferences without their own independent eligibility registry.
- `registerLanguageIpc(ipc: Pick<typeof ipcMain, 'handle' | 'on'>, isSenderAllowed: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean, onChange: () => void): void`
  registers only `get-system-languages` and the existing `set-language`. Types are
  imported from Electron; implementation uses existing l10n functions.
- Optional renderer bridge `getSystemLanguages?: () => Promise<readonly string[]>`;
  existing `setLanguage?: (language: string) => void` accepts validated `auto` in
  the new shell. Validate runtime response despite its declared return type.

- [x] Write failing tests for preferred UI languages `['fr-CA','de']` (not the
  formatting region), Norwegian aliases, explicit `pt` preservation, old native
  JSON, invalid JSON, cached live preference after fs write throws, and OS changes
  affecting only Automatic. Keep new unreleased codes ineligible outside test overrides.
- [x] Add registrar tests: main-window/main-frame allowed; foreign webContents,
  missing/subframe sender, destroyed window, non-string/unsupported preference
  rejected before persistence/OS access. Valid changes call menu refresh even on
  save failure. Getter exposes a plain string array only, no paths/events/Node.
- [x] Run `pnpm --filter @backspace/desktop test -- src/l10n.test.ts src/languageIpc.test.ts src/recovery.test.ts`;
  expect FAIL on new contracts before implementation.
- [x] Implement the native registry/preference mirror in `l10n.ts`, using
  `app.getPreferredSystemLanguages()` after ready, English fallback, native target
  catalogs typed `Partial<Record<DesktopStringKey,string>>` and per-key English
  fallback. Keep English exhaustive. Add temporary empty tables for unreleased
  locales only; C3–C8 must fill them before any activation.
- [x] Replace mandatory target key-parity assertions in native unit tests with
  provided-entry validity/placeholder checks and tested English fallback for an
  omitted entry. C1's explicit strict tests retain full key-parity coverage, so
  future English-only native features do not fail TypeScript or ordinary tests.
- [x] Replace the existing inline `set-language` handler with the registrar. Its
  guard compares sender and senderFrame with the current live mainWindow/mainFrame,
  following screen-share IPC's existing pattern. Expose only the named getter in
  preload/declarations. Register once at startup, not on every focus/render.
- [x] Refresh native menus on existing focus handling and `powerMonitor` resume;
  reuse `applyMenusForState`/`applyEditOnlyMenu`, do not modify recovery/update state.
  All five `loadFile` sites in `main.ts`/`recovery.ts` use the same query helper.
  Update recovery tests for query mode without performing actual actions.
- [x] Rerun native suites and `pnpm --filter @backspace/desktop build:ts`; expect
  PASS without a shared workspace runtime dependency. Native actual launch is L4.

## Task R3: renderer preference lifecycle and Automatic selector

**Files:** modify `packages/web/src/i18n/{index,index.test}.ts`,
`packages/web/src/components/modals/settingsPanels/LanguageSection.tsx`,
`packages/web/src/locales/{en,pt,de,ru,zh}/common.json`; create
`packages/web/src/i18n/useLanguagePreference.ts` and
`packages/web/src/components/modals/settingsPanels/LanguageSection.test.tsx`.
**Interfaces:** existing `initI18n(options?: InitI18nOptions)`/`getLanguage()` keep
their contracts. Add `getLanguagePreference(): LanguagePreference`,
`subscribeLanguagePreference(listener: () => void): () => void`,
`setLanguagePreference(preference: LanguagePreference): Promise<void>` in index.
Retain `setLanguage(language: SupportedLanguage): Promise<void>` as a compatibility
entry into that same owner, not a second implementation. The new hook exports
`useLanguagePreference(): LanguagePreference` using the owner subscription.

- [x] Add failing tests named `auto mode changes notify when locale is unchanged`,
  `explicit survives languagechange`, `late native response loses to explicit`,
  `reinitialization owns one listener set`, and `preview never persists or notifies native`.
  Assert auto storage is exactly `auto`, old `pt` remains explicit, storage read/
  write denial leaves usable live state, and rejected/malformed native responses
  use navigator fallback. Dispatch focus/visibility/languagechange with mocked lists.
- [x] Add selector tests: exact canonical labels plus localized Automatic option;
  auto→en when OS is en still changes selected value; en→auto follows later de;
  preview option remains visible but not a saved explicit preference.

  The same-effective-language regression must include these public assertions
  after initialization with English browser preferences:

  ```ts
  await setLanguagePreference('en');
  await setLanguagePreference('auto');
  expect(getLanguage()).toBe('en');
  expect(getLanguagePreference()).toBe('auto');
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('auto');
  ```
- [x] Run `pnpm --filter @backspace/web test -- src/i18n/index.test.ts src/components/modals/settingsPanels/LanguageSection.test.tsx`;
  expect FAIL until the owner and selector are updated.
- [x] Implement mode snapshot/subscription in the existing owner, with guarded
  localStorage, ordered native/browser resolution, source fallback and generation
  invalidation for late OS replies. Reinitialize by disposing previous browser
  listeners; respond to `languagechange`, window focus and visible foreground,
  without polling or multiplying listeners. Unload invalidates pending work.
- [x] Separate selected mode from effective app language. For the new bridge send
  mode to native; for old shells send effective concrete language and acknowledge
  old native limitations. Do not notify or persist dev-only previews. Read native
  preference languages only as data; validate string-array shape before use.
- [x] Add `common:language.automatic` (en `Automatic (system)`, pt `Automático (sistema)`)
  and accurate system/browser description copy in all existing catalogs. Bind
  selector to preference via the hook and guard the event value; do not cast
  arbitrary DOM text to SupportedLanguage. Keep current settings placement.
- [x] Rerun the suites plus `src/i18n/languages.test.ts`; expect PASS with no
  same-language stale selection or storage writes during mere startup detection.

## Task R4: lazy fallback and Juno isolation/media label reuse

**Files:** modify `packages/web/src/i18n/{index,loader}.ts` and adjacent tests,
`packages/web/src/components/games/{JunoLocale,JunoSettings}.tsx`,
`packages/web/src/components/games/junoAssets.ts`, adjacent existing tests,
`packages/web/src/stores/junoPreferences.test.ts`.
**Interfaces:** keep `LazyCatalogBackend.read(language: string, namespace: string): Promise<Record<string, unknown>>`
and Juno store shape. Replace dubbing entry's competing translation label with
its canonical registry `languageCode: 'pt'`; keep edition key `pt-BR`, URLs and
`resolveJunoDubbing` unchanged. Juno settings renders the registry's nativeName.

- [x] Add failing tests with deliberately inverted lazy completions: newest app
  choice wins, auto uses the newest OS reply, detached game scope never commits
  late work. Assert app mode/storage/document/native notifications remain unchanged
  by a Juno explicit selection. Test all 25 Juno options in a test release set.
- [x] Add real-i18next fallback tests for a new English-only namespace and wholly
  missing target plural family with counts `0,1,2,3,11,100,1000000` across `ar,ru,ja`.
  Target exists but key/namespace/chunk is missing or rejected; English remains
  available, no raw key/empty label, target lazy imports not eagerly bundled.
  Check blocked/rejected chunks do not cause an unbounded retry loop.
- [x] Run focused index/loader/JunoLocale/JunoSettings/junoAssets suites; expect
  FAIL on uncovered fallback/registry-label and request-order cases.
- [x] Preload before applying a change and gate/serialize commits by latest
  request generation so even an in-flight older change cannot finish last. Keep
  `fallbackLng: 'en'`, all source namespaces bundled, returnNull false and set
  `returnEmptyString: false` defensively. Absent target files return an empty
  bundle; genuinely failed imports retain bounded error handling and English fallback.
- [x] Reuse the owner policy in the existing Juno scope without changing app
  preference or introducing another translation path. Canonicalize the media
  label via registry lookup; no new edition, asset request or audio modification.
  C1 retains validation of malformed supplied translations rather than hiding them.
- [x] Run `pnpm --filter @backspace/web test -- src/i18n/index.test.ts src/i18n/loader.test.ts src/components/games/JunoLocale.test.tsx src/components/games/JunoSettings.test.tsx src/components/games/junoAssets.test.ts src/stores/junoPreferences.test.ts`;
  expect PASS, plus existing music/scroll regressions in L4. New locale fixtures
  may use test resources before full catalogs land; they are not claimed as translated.

## Task R5: native HTML runtime and changed-contract docs

**Files:** modify `packages/desktop/resources/{recovery,instance-picker}.html`,
`docs/systems/{localization,desktop,desktop-security}.md`; tests in
`packages/desktop/src/languageIpc.test.ts`/`recovery.test.ts` and the controlled
HTML fixture in the parent evidence directory.
**Interfaces:** loadFile query `{lang,preference,released}` from R2; only auto-mode pages
use optional `window.backspace.getSystemLanguages()` to re-resolve on focus.
Keep existing `STRINGS`, English fallback and action/diagnostic contracts.

- [x] Add a controlled browser check `check-native-pages.mjs` against the actual
  HTML scripts with stubbed bridge/actions. On Automatic focus, change mocked
  system languages and assert title, text, placeholders, lang/dir relabel while
  typed instance URL, diagnostics/state, button readiness and action counts stay
  unchanged. Explicit mode ignores the change. Missing bridge degrades safely.
- [x] Run the fixture before editing; expect FAIL on live Automatic relabeling.
- [x] Replace one-time constant locale selection with local idempotent
  `applyLanguage(language)` per page, reusing its existing lookup/render logic.
  Resolve auto from the query's released list intersected with known STRINGS codes
  (same aliases as R1), protect late replies,
  reapply dynamic labels without resetting inputs or reloading documents. Update
  `document.title` and all app-owned initially hardcoded placeholder/loading copy.
  Direction/font details are completed by L1/L3; full tables by C3–C8.
- [x] Update the three subsystem docs for mode/effective language, real OS API,
  secure named getter, legacy compatibility and native HTML query contract.
  Do not claim all catalogs complete or rewrite previous Juno work as delivered here.
- [x] Rerun controlled native fixture and affected native suites; expect PASS.
  Record which checks used a stub bridge; only L4's actual isolated Electron
  launch may be described as native execution.
