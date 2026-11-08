# Juno settings and focused music implementation plan

> **For agentic workers:** Use `executing-plans` inline; no implementer agents.

**Goal:** Implement the approved personal Juno settings and focused-only music.
**Architecture:** Device-local validated preferences, scoped existing i18n,
edition-to-media lookup, existing Modal and AudioManager output. An ephemeral
view lease in the existing Juno store proves actual table presence; navigation,
document focus and session guards decide eligibility. No server/protocol change.
**Tech stack:** Current strict TypeScript/React/Zustand/i18next/Web Audio/Vitest.
**Spec:** `../specs/2026-11-07-juno-settings-and-music.md` (user approved).

## Global constraints and review focus

- Base 1.16.8 `d86101dc08e5ab1409a3be889beeebbed0093f6f`, feature branch
  `feat/juno-settings`; no commit, push, version bump, release or deploy.
- Preserve game/privacy/origin/recovery rules and single session ownership.
- Only four nonpersonal preferences persist; auto UI/dubbing (pt-BR fallback), 100/100
  volumes. No app language, document language or global volume writes.
- Music uses original supplied MP3 streamed to AudioManager's existing bus;
  gain `0.20 * music/100 * output/100`, local only, no new AudioContext/dependency.
- Hidden views/late asynchronous starts must never produce music; only one loop.
- Five catalogs, accessible glass modal, compact/scaled geometry, explicit
  autoplay retry, old audio deduplication and live gain are acceptance gates.

## Task 1 — preferences, edition and scoped language

**Files:** new `packages/web/src/stores/junoPreferences.ts` + tests;
new `components/games/JunoLocale.tsx` + tests; existing `junoAssets.ts`,
`JunoCard.tsx`, `JunoTile.tsx`, `JunoTable.tsx`, `JunoRanking.tsx`,
`i18n/formatters.ts` + tests and five `locales/*/voice.json` catalogs.

**Interfaces:** `useJunoPreferences` persists `{language:'auto'|SupportedLanguage,
dubbingLanguage:'auto'|'pt-BR',effectsVolume:number,musicVolume:number}` only, with
normalized setters. `JunoLocale` wraps Juno-owned surfaces via a clone of the
existing instance/catalog loader, without app-global listeners/side effects.
Edition mapping exports actual pt-BR memory artwork and sound name. Default
`junoCardUrl` compatibility stays unchanged; translated errors use existing
optional scoped-instance argument. `useFormatters` honors its context instance.

- [x] RED: defaults/storage recovery/normalization, app keys unchanged; explicit
  game language versus app/HTML; Automatic updates; scoped formatting/errors.
- [x] Implement these existing-pattern seams and localized settings keys; GREEN
  new suites plus existing asset/i18n/game regressions.

## Task 2 — real view presence and managed local audio

**Files:** `stores/junoStore.ts` + tests; new `audio/junoMusic.ts` + tests,
new `components/games/JunoMusic.tsx` + tests; existing `JunoSession.tsx`,
`JunoMemorySound.tsx` + tests; actual original MP3 in
`public/games/juno/music/charting-the-dark.mp3`, manifest/provenance.

**Interfaces:** existing ephemeral Juno store gains token-owned `presentView`
registration/cleanup, scoped to its current target; reset/target change clears
leases. `JunoTable` registers only its real eligible rendering (including top
mobile `voice-full` and absence of global modals). Never derive presence from
`open` alone. `JunoMusic` is owned once by `JunoSession`; it combines leases,
snapshot/access/connection, document visibility/window focus and deafen/output.

`createJunoMusicPlayer` owns one lazily created HTMLAudioElement, media-source
and gain connected to `getMasterOutput`; update eligibility/gain without reset,
pause/retain position, bounded generation-safe play retry and complete disposal.
Its small runtime status/retry surface is not persisted or a navigation store.
Effects keep their existing confirmed-id semantics, reuse `loadSound` buffers
with a Juno-owned gain so current sources can change volume live.

- [x] RED: lease target/overlap cleanup; music not created/downloaded inactive;
  one loop/resume/live gain, pending play hide/dispose, rejection/retry; all real
  desktop/mobile navigation gates, hidden/blurred/covered/deafened cases.
- [x] Effects local gain, zero/deafen pending cancellation, no replay or
  global voice changes; retain existing memory-sound behavior.
- [x] Import exact MP3 bytes with hash guard; implement and GREEN the suites.

## Task 3 — settings modal and complete presentation

**Files:** new `components/games/JunoSettings.tsx` + tests; existing
`JunoTable.tsx`, `juno.css`, five voice catalogs and game tests.

- [x] RED: gear in every phase; dialog focus trap/return/Escape without commands;
  four controlled preferences, available languages/edition only, live values,
  localized percentage/status/retry and independence of app settings.
- [x] Implement shared glass Modal with two restrained groups, DM Sans,
  existing brand `#7c6cf6`, cosmic deep `#060a27`/pearl `#eee9ff`; logo+gear on
  the left, existing game actions on the right. Left-aligned fields, two-language
  selects above two sliders; no decorative cards/extra motion. GREEN UI tests.

## Task 4 — actual preview, documentation and delivery

**Files:** docs systems `juno`, `sounds`, `localization`, `mobile-ui`; this plan/spec;
isolated runner/preview helpers/evidence under approved temp
`C:/Users/berna/AppData/Local/Temp/opencode/juno-settings-20261107/`.

- [x] Preview actual application components/MP3/session lifecycle in desktop,
  mobile/short/200% layouts; inspect screenshots; exercise settings and real
  playing/paused resume/gain, keyboard, reduced motion, navigation/hidden views.
  No production accounts/API/media publication; no reuse of old screenshots.
- [x] Update subsystem docs/spec status and ledger; production sequential build,
  root types/i18n, server e2e/desktop TS, lint, affected tests and practical
  broader suites. Startup checks use isolated storage only.
- [x] One full implementation follow-up with the same Sol reviewer (spec review
  `ses_e48ef5d35ffevgYC5tBfHSS2iY` approved only the design). Cover all source,
  docs/media, new and outside-repo helper files, and validate concrete fixes.
- [x] Deliver playable preview and truthful results, without publication/deploy.

## Ledger

- User approved this spec and source/preview implementation in the latest turn.
  Branch clean except approved untracked spec; prior 1.16.8 stays immutable.
- Design review session above approved the spec with no actionable findings.
- Ruling: record execution/evidence in this plan and its new approved temp
  directory rather than another plan's workspace. Reuse existing pnpm runner,
  testing patterns and fixture engine only; never overwrite prior evidence.
- Ruling: a token lease belongs in the existing transient Juno store, not a
  second route/focus store. Audio runtime status contains no route/identity data
  and is never persisted. This preserves single ownership across view remounts.
- Tasks 1–3 implemented inline. Preference/locale tests went RED (missing modules)
  → GREEN (34 tests including assets/table/formatters). Music core/eligibility
  tests went RED → GREEN; effects tests were adapted to cached buffer/live gain
  while retaining every prior deduplication/cancel/freshness scenario. Settings
  tests went RED (missing gear) → GREEN, followed by both user refinements.
- Current focused seven-file pass: 56 tests. Existing engine/bot/report/route
  regressions: 79 server tests pass. Full web suite at the earlier implementation
  checkpoint: 376 files/3,509 tests passed; the complete final-tree rerun passed
  all 377 files/3,513 tests (eight isolated batches, all exit 0).
  The settled mobile-stack, shell and music regression run passed 25 tests.
- Fixed the existing `useFormatters` context/global mismatch. ESLint correctly
  reported its old exhaustive-deps suppression stale; `pnpm lint:prune` removed
  that one entry automatically, and lint now exits 0. No manual suppression.
- Music source imported byte-for-byte with source hash guard; no re-encoding,
  original modification or new dependency. Browser tests already verify real
  nonzero streamed PCM, one loop, 20%/live gain, pause/resume/navigation and the
  final clean modal in all 40 five-language/eight-size cases, including bounded
  vertical scrolling at short/200% sizes and reachable controls. No console,
  external application or production API errors/requests were observed.
- Additional RED→GREEN regression covers partial output-graph construction
  failure and retry; another covers pre-gesture suspended-context retry instead
  of silently waiting forever. Native preview also caught missing host focus
  notifications; document focus-in now safely re-evaluates eligibility.
- User refinement during actual preview: remove the three explanatory settings
  paragraphs (device-local persistence, dubbing and music hints), including dead
  translation keys/ARIA references. Keep the agreed behavior and exceptional
  autoplay/error retry. This is presentation refinement, not a task replacement.
- User refinement: dubbing also defaults to Automatic, with explicit pt-BR.
  Resolve Automatic against real editions for the effective game UI language,
  falling back to pt-BR (currently the result for every interface language).
- Ruling: mobile navigation intent and IntersectionObserver cannot prove that a
  retained screen is uncovered during the existing 200ms pop animation. Expose
  a local settled-screen visibility context from MobileScreenStack (no new
  navigation state, DOM/CSS changes or voice behavior); the Juno view lease
  consumes it. Add transition regression tests and update mobile-ui docs.
- Final validation: sequential root build passed (existing bundle-size/dynamic-
  import warnings only); root typecheck/i18n, separate server e2e types, desktop
  build:ts, lint and normal Git diff whitespace check all passed. An autocrlf-
  disabled diff produced CRLF-only false positives; the repository's normal
  normalization was retained, not a mass line-ending conversion.
- Both source dev servers started successfully against unique temp storage:
  API health/instance version 1.16.8 and web entry passed on ports 3005/5194;
  only those spawned process trees were stopped. Production storage untouched.
- Inspected actual desktop/mobile/short/200% screenshots and current native
  Review-pane modal: clean copy, Automatic UI/dubbing, independent 100% values,
  one foreground lease and playing status after a real gear click. Native
  screenshot: `C:/Users/berna/AppData/Local/Temp/opencode-browser-A8Rgvq/0/screenshot.png`.
  Headless evidence measures real streamed nonzero PCM and gains; window-focus
  events there are simulated and hidden-document policy is unit-tested. This
  is not subjective listening, installed-app minimization or live-call acceptance.
- Ruling: retain this plan's temp preview/evidence workspace for delivery, rather
  than deleting it after review — the approved deliverable is a running local
  preview, and the evidence supports truthful validation. No release/deploy.
- Harness restart interrupted the first implementation-review tool invocation
  and stopped the preview server after validation. Resume that same Sol session
  and restore only the current preview; completed checks are not rerun needlessly.
- Full external implementation review resumed in the same Sol session. It checked
  the complete source/docs/media/helper scope and ran 109 tests, lint, web types,
  i18n and whitespace checks. Two concrete P2 findings: independently owned
  soundboard overlay did not pause music; media retry did not reload a failed
  HTTP resource. Both were reproduced and corrected in one focused fix pass.
- Review fix RED→GREEN: five regressions initially failed; same real soundboard
  dialog plus independent soundboard/screen-share/incoming-call state now pause
  immediately and resume on close. Existing stores are subscribed directly;
  no overlay registry, modal changes or duplicated navigation state. Retry calls
  `load()` only for media errors on its existing element with pending-start
  invalidation; autoplay retry and ordinary pause/resume remain unchanged.
- Added a pending-error/retry/hide regression. The final focused 11-file pass is
  95 tests, all green; web typecheck, lint and whitespace checks passed again.
  Do not repeat the earlier full web suite solely because of the harness restart.
- New external `check-review-fixes.mjs` and `review-fixes-evidence.json` prove
  real HTTP 503 → 200 retry in desktop/mobile: exactly two requests, nonzero PCM,
  one media element, soundboard real dialog pauses to gain 0, close resumes at
  the retained position/gain .20, no game commands or external/API requests.
  `fixture.tsx` now mounts the real soundboard controller with an isolated empty
  in-memory catalog, never the production API. No live audio is published.
- Ruling: the two review corrections are local to already-approved eligibility
  and error recovery, with no new contract/security/architecture risk; principal
  agent verifies them with regression/browser checks rather than requesting a
  redundant second external review. Final sequential production build rerun
  passed after both fixes (existing warnings only). No known unresolved findings.
- Preview restored on port 5195 and reloaded successfully in its existing Review
  tab after the restart. The first restart attempt collided with the reviewer's
  temporary preview; no unknown process was terminated. Final changes remain
  uncommitted on feat/juno-settings at version 1.16.8; no push/release/deploy.

## Preview refinement — right-aligned icons and contrast

The user's screenshot/request fully specifies this local visual refinement;
continue inline without a new product/architecture approval gate. Preserve the
completed feature and no-publication boundary. Before-state copies/hashes for
this refinement are in the same temp workspace's `header-before/` (11 files).

Design: keep only the logo/practice badge on the left. A single right-aligned
row contains rules, ranking where already available, settings, leave and mosaic.
Equal 36px circles with 20px block SVGs, zero inherited padding/line-height and
grid centering prevent the old narrow/short breakpoint rules from misaligning
icons. Use pearl `#f5f8ff` on a near-opaque cosmic navy `#101a35`, brighter
`#2a4168` hover and a visible `#7f97bf` edge; retain existing Juno typography,
game artwork, primary action styling and keyboard focus. Similar secondary text
and close controls, including Juno's show/hide-members toggle, share the stronger
contrast; do not convert content actions
or unrelated application buttons to icons. Both Automatic labels include
localized “(Backspace)”; PT-BR fallback remains unchanged.

- [x] Add failing table/settings regressions for right-group ownership, icon-only
  accessible controls and matching Automatic option copy; run and observe RED.
- [x] Update existing JunoTable markup/CSS and five voice catalogs, retaining
  all handlers/guards. Run table/settings and affected game/audio regressions.
- [x] Actual preview: verify right-edge layout, square/circular geometry, SVG
  center within 1px, contrast ratios, keyboard/rules/settings/leave/mosaic and
  no overflow at desktop/mobile/short/200%; inspect fresh screenshots.
- [x] Build/types/i18n/lint/diff checks; one external final review of this
  refinement's before/after delta and new helper artifacts. Deliver same local
  preview, no commit/push/release/deploy.

Refinement validation: observed both new regressions RED → GREEN (15 tests).
Eight affected game/preferences/audio suites passed 70 tests. Root sequential
build, root typecheck/i18n, lint and whitespace checks passed. Final SVG polish
makes the gear's painted bounds symmetric as well as its SVG box; the subsequent
table/settings rerun passed again. Web build and the 40-case browser matrix
passed against that last SVG change; SVG-box and painted-bounds centers are
checked within 0.1 physical pixels, including scale 50%/200%. Fresh screenshots wait for finite
animations to finish, avoiding misleading halfway-faded modal captures.
The browser checker `check-header.mjs`/`header-evidence.json` verifies five
languages, eight sizes/scales, right alignment, circular/square controls,
SVG-box and painted-bounds centering, tooltips/accessible names, keyboard focus,
rules/settings/leave/ranking/mosaic behavior, practice-lobby layout, matching
Automatic labels, no overflow or game commands, and secondary-control contrast.
Measured worst-white-background contrast is at least 14.60:1 for icons/text and
5.23:1 for edges, exceeding the check's 4.5:1/3:1 thresholds. Baseline copies,
new helper, JSON and `header-screenshots/` are the only external artifacts added
for this refinement; prior helpers/evidence are preserved.
External Sol final review `ses_e489fc762ffeheFh6UvnCDzdE3`: APPROVED for this
11-file refinement delta, no concrete findings. Reviewer verified baseline hashes,
ran the 15 table/settings tests plus i18n/whitespace checks and inspected the
40-case Edge evidence/helper/screenshots. Other full validations were reviewed
as reported, not redundantly rerun. No Safari/real-hardware acceptance claimed.
Same local preview remains available; no commit, publication or deploy.
