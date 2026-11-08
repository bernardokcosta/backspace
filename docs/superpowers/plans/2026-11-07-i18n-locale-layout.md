# Locale Layout and Integrated Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` for inline
> implementation, task by task. This plan does not authorize implementer agents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all approved scripts, RTL and long translations readable and
operable, then verify the complete integrated 25-language delivery locally.

**Architecture:** Apply app lang/dir at the existing owner, and explicit Juno
lang/dir at real DOM roots including portals. Keep physical game geometry LTR
where it encodes meaning; isolate user content without modifying text.

**Tech Stack:** Existing global/Juno CSS, React, Intl formatters, Vitest/Testing
Library and controlled browser/Electron fixtures; no font service/dependency.

**Spec:** [Layout](../specs/2026-11-07-i18n-locale-layout.md).
**Parent:** [Initiative plan](2026-11-07-i18n-25-languages.md).

Current execution: [2026-11-08 acceptance](../validation/2026-11-08-i18n-acceptance.md).
Browser/Electron tooling is available in this follow-up. Earlier statements
about unavailable tooling are superseded by the actual evidence noted here;
OS changes, updater installation and live calls remain intentionally untested.

## Global Constraints

- Inherit parent constraints; use actual completed catalogs for final visual acceptance.
- Preserve Aether Drift, `.glass*`, `.input-standard` and interface-scale tokens.
- App Automatic follows system; game Automatic follows app; game explicit locale
  must not change global/native preferences or document language/direction.
- Do not mirror card art, swap authoritative seats, change clockwise semantics,
  rewrite user content or make music eligible on a previously hidden screen.
- No new fonts/downloads/dependencies without a concrete gap and approval.

## Review Focus

1. Portalled Juno settings must use the game script/direction, not inherit the app (L1).
2. RTL must not swap CSS grid columns for named physical seats or reverse art (L2).
3. Technical URLs/usernames mixed into Arabic must retain readable order and safe DOM (L2).
4. Long translations at 320px/200% must keep close/actions/focus reachable (L2/L3).
5. Mocked native/browser acceptance must not be reported as OS/install/live-call
   acceptance; native launch and platform limits are recorded separately (L4).

## Task L1: scoped language/direction and script font readiness

**Files:** modify `packages/web/src/components/games/{JunoTable,JunoTile,JunoSettings,JunoMatch,JunoPlayerBadge}.tsx`,
`packages/web/src/components/games/juno.css`, `packages/web/src/styles/globals.css`,
existing `JunoLocale.test.tsx`/`JunoSettings.test.tsx`/`JunoTable.test.tsx`;
create `packages/web/src/i18n/layout.test.tsx`.
**Interfaces:** consume `getLanguageDirection(language)` from R1 and the existing
contextual i18n instance. Add native `lang`/`dir` attrs to real game table/tile/
settings roots; no new global store, provider DOM wrapper or Modal interface.

- [x] Add failing component tests for English app/Arabic explicit game and Arabic
  app/English explicit game. Assert actual settings dialog root (portal under
  shared container), table/tile and rules text have correct lang/dir; document
  attributes/native notification/storage remain app-owned. Include Auto changing
  with app and a game-specific number/percentage formatter assertion.
  (RED established by HEAD comparison: pre-change markup carried no lang/dir
  attributes; GREEN 7/7 in `src/i18n/layout.test.tsx`.)
- [x] Run `pnpm --filter @backspace/web test -- src/i18n/layout.test.tsx src/components/games/JunoLocale.test.tsx src/components/games/JunoSettings.test.tsx`;
  expect FAIL on missing DOM attributes/font scope.
- [x] Add attrs on real DOM roots using scoped language. Keep `JunoLocale` sharing
  catalogs without adding a game-sized wrapper that changes container queries.
  Juno settings attrs belong on its own inner dialog because React context crosses
  the portal but DOM inheritance does not.
- [x] Extend existing font rules with platform stacks for `uk` (bundled Inter
  Cyrillic where covered), `ar`, `hi`, `th`, `ja`, `ko`, retaining `ru`/`zh` behavior
  and DM Sans only for Latin/Vietnamese glyphs the actual bundled faces cover
  (otherwise use the platform stack). Apply both app body/root and scoped
  game/settings roots, plus emoji-picker font variables. Verify actual bundled
  glyph coverage, not font-name assumptions; platform absence is a documented
  acceptance gap, not a reason to fetch an unapproved font.
- [x] Rerun suites; expect PASS. Use L3 real browser screenshots for glyph/line-break
  validation; jsdom assertions cannot establish rendered font correctness.

## Task L2: meaningful RTL, bidi and responsive control behavior

**Files:** modify the actual affected owners only:
`packages/web/src/components/layout/{AppLayout,MobileScreenHeader}.tsx`,
`packages/web/src/components/modals/settingsPanels/LanguageSection.tsx`,
`packages/web/src/components/chat/{Message,MessageInput}.tsx`,
`packages/web/src/components/ui/Modal.tsx`, global/Juno CSS and game files from L1;
extend their existing adjacent tests and `src/i18n/layout.test.tsx`.
Before editing an owner, demonstrate its concrete defect in the fixture; owners
without defects stay untouched. Additional owners found by C2/L3 are recorded
with exact path/test in the ledger before a focused fix, not a broad RTL rewrite.
**Interfaces:** preserve props, navigation, geometry helpers, handlers and wire
identities. Use native `dir="auto"`/`bdi` for isolated user text and explicitly
LTR technical/code inputs when appropriate; never HTML-escape by string injection.

- [x] Add failing rendered checks for Arabic navigation/settings/chat labels,
  mixed Arabic plus `alice@example.test`, URL, mentions and numbers; all textContent
  stays unchanged, links/click targets and keyboard actions retain their meaning.
  Assert no DOM HTML injection with a hostile-looking user display name.
- [x] Add game checks using identical public snapshot: physical left/top/right
  seat coordinates and next-player/direction semantics remain identical in en/ar;
  art has no direction-dependent transform and header controls remain physically
  right-aligned as approved. Assert one current guide marker at clamped bottom
  jumps and no route/command/audio change on language switches.
  (`layout.test.tsx` checks logical/public snapshot identity; actual 25×6 browser
  checks record seat rectangles, pinned arena direction and header action order.)
- [x] Run layout/affected owner tests and controlled `check-layout.mjs` RED.
  Use real geometry in browser; CSS-source/jsdom checks alone cannot prove seat order.
- [x] Fix directional UI spacing/alignment with logical CSS only where it follows
  reading direction. Pin `.juno-arena` and physical artwork/seat/card arrangement
  to LTR geometry; reapply scoped text direction inside player-copy/prose roots.
  Preserve positive/negative game direction values and original arrows.
- [x] Preserve usernames/URLs/mentions with semantic isolation. Use wrapping,
  `min-width: 0`, bounded scroll and established accessible overflow instead of
  smaller unreadable text or hiding essential controls. Fix native focus styles
  only where required by the changed controls, not a global design overhaul.
  (`dir="auto"` on PersonName, message content, composer mirror + textarea and
  edit textarea; no string-injection escaping.)
- [x] Rerun exact affected suites/browser scenarios GREEN; record coordinates,
  readable bidi and no unexpected body-level overflow or inaccessible close control.
  (Rendered RED→GREEN: Arabic header, Ukrainian 320px caption, settings handle
  and role identifier bidi. Final affected/full checks are in the follow-up.)

## Task L3: native HTML/script layouts and all-locale rendered matrix

**Files:** modify focused defects in
`packages/desktop/resources/{recovery,instance-picker}.html` and L1/L2 owners;
create temp `check-layout.mjs`, extend R5 `check-native-pages.mjs`, update shared
validation ledger and `docs/systems/{localization,design-system,mobile-ui}.md`
only for changed shared contracts (desktop docs already R5).
**Interfaces:** fixtures use actual components/HTML with isolated synthetic
accounts/permissions/snapshots and stubbed network/IPC. Never production login,
real update/recovery actions, live calls or real OS language changes.

- [x] Define the reproducible matrix from all 25 registry codes and these states:
  auth/register/invite; app language/settings; chat/DM with mixed content;
  spaces/social/search; admin/federation/uploads and visible error states;
  voice/share/soundboard controls; Juno lobby/playing/result/ranking/guide/settings;
  both native pages including unavailable bridge/update/recovery variants.
  Every C2 inventory row must map to a rendered scenario or explicit justified
  non-renderable OS/external exclusion, not disappear from coverage.
  (Actual-component 32-surface matrix, Juno states/layout, native HTML and
  adjacent state/error suites; coverage and platform exclusions in the follow-up.)
- [x] Run every language over desktop `1440x900`, phone `390x844`, narrow phone
  `320x640`, short `1280x480`, and `1280x800` at interface scales 50% and 200%.
  Exercise navigation/close/focus, guide contents/manual scroll/bottom/reopen,
  wrapping, native input retention and representative plural/number values.
  Save machine assertions and representative settled captures; inspect scripts
  and long-label captures explicitly. No test uses arbitrary fixed sleeps.
  (4800/4800 app cases and 450/450 lobby/result/ranking cases PASS; 150 Juno
  main/settings/guide and 300 native HTML cases are also recorded with captures.)
- [x] Before each verified layout fix, save failing scenario/assertion, patch
  only its owning module and rerun. Native HTML uses lang/dir/platform fonts and
  local scrolling for short windows, with inputs/actions retained. Do not reload
  native pages just to relabel or fetch new fonts for screenshots.
  (L1/L2 fixes above followed this: JunoLocale roots, Message/MentionTextarea
  isolation, arena pin; affected suites GREEN.)
- [x] Record missing locale/key/fallback use separately from geometric success:
  final matrix must show actual completed translations, except deliberate fallback
  test fixtures. A clipped label must not be “fixed” by reverting it to English.
  (Strict all-25 reports zero missing; fallback fixtures isolated in tests.)
- [x] Update subsystem docs with verified script/RTL/game geometry behavior.
  Run affected suites and normal/strict checks; expect PASS and matrix coverage
  of all languages/surface rows. Record browser/platform and mocked IPC limits.
  (Docs updated: `localization.md` 25-language scope + Juno lang/dir + fonts +
  L3/L4 matrix note; `design-system.md` font stacks; `desktop.md` released
  entries. Actual browser/native execution and controlled-fixture limits are
  recorded separately from unavailable OS/install/live-call acceptance.)

## Task L4: all-25 activation, local integration gate and external review

**Files:** modify release eligibility in `packages/web/src/i18n/languages.ts` and
native released-code mirror in `packages/desktop/src/l10n.ts`, corresponding tests,
initiative plans/validation ledger and changed-contract docs. No package version,
release workflow, media manifest or deployment file changes.
**Interfaces:** all 25 available languages only after C1–C8/L1–L3 pass; runtime
fallback stays available and default checks still permit future English-only keys.

- [x] Run `node scripts/check-i18n.mjs --strict --include-desktop`; require zero
  missing semantic families/forms for all 25 and three native surfaces, no empty/
  copied prose or concealed fallback. Reconcile reviewed leaf counts/provenance
  with final source/native fingerprints; reopen any affected batch if source moved.
  (Strict all-25 desktop PASS; C6–C8 batches PASS; review pages + fingerprints
  generated for all 12 C6–C8 locales; ko/ja reattach + 12-locale SDR corrections
  applied and re-verified.)
- [x] Activate the 20 new locales in both eligibility mirrors, update registry
  tests from five to 25 released, and run i18n/native suites. Assert 25 unique app/
  Juno/native choices and one canonical Portuguese name; dubbing remains auto/pt-BR.
  (Web registry + desktop mirror + `languages.test` + `l10n.test` updated;
  consequential test updates: picker counts, detection fallbacks, loader paths,
  Juno options count, Juno game-language hydration, preview-picker behavior.)
- [x] Verify new English-only key/namespace/plural fixtures again: normal checks
  PASS, target renders English, strict reports the deliberate missing translation;
  missing English or malformed supplied target FAILS. Fixtures stay isolated,
  not intentionally incomplete production catalogs.
  (Normal + strict PASS; fallback behavior covered by updated loader/preview/
  hydration tests that no longer depend on unreleased French.)
- [x] Run sequential `pnpm build`, `pnpm typecheck`,
  `pnpm --filter @backspace/desktop build:ts`,
  `pnpm --filter @backspace/server typecheck:e2e`, `pnpm lint`,
  `node scripts/check-i18n.mjs --strict --include-desktop`, and `git diff --check`.
  Run web i18n + affected UI tests and all existing Juno game/audio/preferences/
  visibility suites through the isolated runner; no product audio/engine edits.
  (Build chain GREEN incl. vite exit 0; typechecks GREEN incl. server e2e;
  full `eslint .` PASS; strict PASS; `git diff --check` clean apart from
  pre-existing CRLF warnings; web suite 406 files / 3830 tests GREEN;
  desktop suite 33 files GREEN.)
- [x] Start both source development servers with `NODE_ENV=test` for the server
  (its config then skips checkout `.env`), explicit temp DB/uploads/backup paths,
  fixed test JWT configuration and unused loopback ports; verify healthy startup
  and actual UI, then stop only processes started by this task. Use the existing
  Juno preview without overwriting its earlier fixtures; add a separate locale
  fixture/evidence directory. Launch the API via
  `pnpm --filter @backspace/server exec tsx watch src/index.ts` with child-only
  environment, not `dev:server` (which forces port 3005). A temp Vite config reuses
  the existing config with `envDir` pointing to an empty task directory, loopback
  host/unused port and proxy to that isolated API. No production environment/
  database access and no repository config edit merely for test-port isolation.
  (Follow-up `startup-smoke.mjs`: actual source API `/api/health` 200 and Vite
  login rendered Automatic Arabic/RTL without page errors. Clean child env,
  temporary DB/uploads/backups, no checkout `.env`, no account created and no
  updater. Both owned servers stopped; evidence retained, no runtime state used.)
- [x] Run an isolated Electron smoke harness using built l10n/IPC and production
  preload with temp userData and stubbed updater/network: verify real OS-language
  getter, explicit/auto persistence across restart, native menus and actual HTML
  loading, guarded IPC and refocus behavior. OS changes are simulated at the
  dependency seam, not by changing system preferences. Do not let electron-updater
  download/install an update. Report actual Windows execution separately from
  simulated languages and unavailable macOS/Linux/Safari/hardware acceptance.
  (Executed on Windows: 53 checks plus a separate restart PASS, using rebuilt
  production preload/IPC, temp userData and blocked network. Simulated language
  getter changes are distinguished from the initial real OS getter.)
- [x] Re-run all-25 rendered matrix after activation and inspect settled captures;
  check previous Juno 40-case scroll/music behavior alongside the new cases.
  Record final files/hashes, tests/checks, source baseline, linguistic review
  provenance and any honest remaining limitations in the validation ledger.
  (Follow-up final results: app 4800 + supplemental 450, Juno states 450 and
  main/settings/guide 150, native HTML 300, actual Electron 53 + restart 1,
  preserved scroll/capability 40 and actual MP3/music 200, all PASS. Representative
  captures directly inspected; hashes/source freeze and limitations reconciled
  in the 2026-11-08 acceptance. The current task's external verdict remains its
  separate final gate.)
- [x] Original local delivery: invoke one read-only `review_final_gpt56` covering **all** initiative files,
  not the entire dirty branch as if it were newly authored. Supply before-state
  snapshots so prior Juno work stays distinguished but preservation is checked.
  Include external helpers/evidence and default-versus-strict/Docker compatibility.
  (Original task: initial + second/final to the same reviewer, both non-approval.
  Those verdicts remain historical. The newly authorized readiness/commit task
  has its own full-scope final gate in the 2026-11-08 acceptance.)
- [x] Fix concrete findings together, rerun affected checks and record verdict.
  Complete checkboxes only for work actually executed. No publishing/commit;
  deliver local outcome and limits, never absolute fluency from automated checks.
  (Second-review code findings fixed: mirror `unicode-bidi: plaintext`,
  arena `:lang(ar)` prose RTL. Layout 20/20, i18n 371/371, desktop 60/60 GREEN;
  strict + normal PASS; lint + diff clean. Activation-gate objection standing and
  documented as limitation, not resolved by deactivation per delivery requirement.)
