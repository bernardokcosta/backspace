# Illustrated Juno rules implementation plan

> **For agentic workers:** Use `executing-plans` inline, task by task. No
> implementer subagents and no per-task reviewers; one final implementation
> follow-up with the existing Sol design reviewer.

**Goal:** Deliver the approved complete illustrated scrollable guide in Juno.
**Architecture:** Extract existing details/help ownership into `JunoRules`, with
only public capability/phase input, original static example cards and scoped
catalogs. Keep all game/session/audio state and controls untouched.
**Tech stack:** Existing strict TypeScript/React, i18next, CSS, Vitest/Testing Library.
**Spec:** `../specs/2026-11-07-juno-illustrated-rules.md` (user approved).

## Global constraints and review focus

- Preserve all earlier uncommitted settings/music/header work on feat/juno-settings.
  Version stays 1.16.8; no commit/push/release/deploy.
- No engine, protocol, permissions, dependency, audio or persistence change.
- All five catalogs; no private hand/history in teaching examples or guide props.
- Respect report legacy/modern/unknown capabilities and memory inactive/mixed decks.
- One contained scroll; mobile/short/200% content and close remain reachable;
  contents moves focus/scroll inside help only, never routes or game commands.
- Opening the guide never pauses the turn or eligible music. Escape closes only
  help and returns to its existing accessible icon.

## Task 1 — semantic guide and capability coverage

**Files:** new `packages/web/src/components/games/JunoRules.tsx` and adjacent
`JunoRules.test.tsx`; existing `JunoTable.tsx`, `JunoTable.test.tsx`.
**Interface:** `JunoRules({game,supportsMemory})` accepts only
`Pick<JunoView,'phase'|'supportsReports'|'memoryEnabled'|'supportsBots'> | null`
and optional root `supportsMemory`. It renders the existing details/summary icon
and bounded guide, using static `JunoCard` examples. No command/store/private data.

- [x] Write/run RED tests for seven sections and original card examples; reporting
  true/legacy/unknown, capable lobby/active/classic/unsupported memory, Escape/
  close focus return, contents focus/scroll without URL or game mutation.
- [x] Implement the guide using scoped translation keys and existing formatters/
  constants. Keep direct section refs and useId-scoped headings; no new global
  guide/nav abstraction. Reuse original JUNO logo and still hammer.
- [x] Replace only the old help block in JunoTable, pass public presentation
  input, preserve header names/geometry and handlers. GREEN table/guide tests.

## Task 2 — complete localized content and visual layout

**Files:** `packages/web/src/locales/{en,pt,de,ru,zh}/voice.json`, existing
`packages/web/src/components/games/juno.css`.

- [x] Add complete rule copy from the spec inventory with short paragraphs and
  card-by-card captions. Reuse existing face names/report/legacy/practice keys
  when accurate. No word-splitting the old rulesText or alternate rule engine.
- [x] Style named glass guide with a bounded title/close row, desktop contents
  column and a single reading scroll; mobile contents stacks in that scroll.
  Use actual card rows, matching examples and XP table; readable 14–16px body,
  70–75ch max, no decorative dashboard boxes or automatic animation.
- [x] Run new/affected suites plus i18n, types and lint. Preserve masked-hand,
  per-origin session, music and existing keyboard regressions.

## Task 3 — preview, final validation and review

**Files:** this plan/spec and new isolated evidence helpers under
`C:/Users/berna/AppData/Local/Temp/opencode/juno-rules-20261107/`.

- [x] Use existing live preview 5195 and real components/media/engine fixture;
  keep its helpers unchanged. New browser checker covers five languages and
  desktop/mobile/short/200%, all contents targets, card loads, keyboard/close,
  no routing/commands, retained music eligibility and reduced motion.
- [x] Inspect fresh settled screenshots, compare source/copy to engine and spec;
  run sequential build, root types/i18n, lint, affected web and existing server
  rule suites. Startup checks use temp storage only if needed.
- [x] Same Sol reviewer `ses_e489191dfffeCU03p71WetR6bO` reviews the full
  implementation delta, all docs/helpers/evidence, not just the last edit.
  Fix concrete findings in one pass and validate affected scenarios.
- [x] Present the updated local preview; do not publish or deploy.

## Ledger

- User selected the proposed scrollable guide and explicitly approved the written
  spec plus implementation in separate turns. Execute without another approval
  interruption; planning only records the already-approved approach.
- Ruling: preserve the existing feature branch/live preview and use an isolated
  before-state snapshot rather than move existing uncommitted work to a worktree.
  Baseline copies/hashes (9 existing files) are `juno-rules-20261107/before/`.
- Ruling: keep this task's helpers/evidence in its own temp directory and reuse
  the unchanged preview/pnpm runner. Copied the established safe test runner into
  this workspace; its temp DB/uploads remain task-local. Retain evidence/preview
  for delivery rather than deleting the workspace after review.
- Guide suite observed RED (missing module), then guide/table GREEN: 18 tests.
  Guide lazily renders illustrations only when opened; public Pick props prevent
  reading a live hand. Added a separate closed-guide lazy-loading regression.
- Complete copy and layout implemented in all five catalogs. Initial i18n check
  correctly rejected a duplicated invariant XP key; reused existing xpEarned
  instead of adding a suppression or duplicate label. Web types and lint passed.
- Task 1 complete; Task 2 implementation complete, final validations pending.
- Final validations passed: sequential shared→server→web build (existing chunk/
  dynamic-import warnings only), root typecheck/i18n, lint and whitespace checks.
  Nine focused web suites passed 81 tests; all 20 game/audio/store suites then
  passed 168 tests. A final added open-guide locale-isolation regression also
  passed with the guide/table suite (20 tests). Existing server rules/memory/
  reports suites passed 66 tests; engine/shared source remains unchanged.
- Actual browser checker `check-guide.mjs`: all 40 five-language/eight-size cases
  passed, including 320px phone, very short view, 50%/200% scale, contents focus/
  inner-scroll, no route/game commands, all local card loads, legacy/unknown/
  inactive/unsupported capability changes, Escape/close focus return and reduced
  motion. Actual music remained playing with one stream while help was open.
  No page/console/API or external application errors/requests observed.
- Inspected fresh desktop/mobile/specials/memory/short/200% captures. Initial
  off-screen async-decoded card captures missed some image pixels; the checker
  now awaits every illustration's decode before capturing, with no sleeps.
  Application artwork and existing JunoCard behavior were not changed.
- Native Review tab was verified and help opened for delivery; native clicking
  was unavailable (UnknownVizError), so its DOM was inspected and opened with a
  synthetic local click. Do not claim this as native-window click acceptance.
  The generated settled desktop-special screenshot was shown with browser.preview.
- Tasks 1 and 2 complete; Task 3 validation complete. Only the full implementation
  follow-up with the same Sol reviewer and final ledger/delivery remain.
- Final implementation follow-up in the same Sol session: APPROVED with no
  actionable findings. Reviewer compared all 12 files with verified before-state
  hashes, checked rules/capabilities/copy/layout/privacy, reran 20 guide/table
  tests plus i18n, targeted ESLint and delta whitespace checks, and inspected
  40-case evidence/captures/helpers. Build/root types/broader suites were not
  redundantly repeated. Native browser was disconnected in the reviewer's
  session; no Safari/live-call/hardware acceptance is claimed.
- All tasks complete. Current local preview stays at 5195 with the illustrated
  help ready; original artwork, previous work and production data preserved.
  No commit, push, version bump, publication or deploy performed.

## Refinement — scroll-aware contents and special-card category

The user explicitly requested automatic current-section marking during manual
scroll and a generic Special cards category instead of Memory. Rename the old
ordinary group Action cards to avoid duplicate labels in all five catalogs.

Implementation stays local in JunoRules: derive one active section from the
existing scroller/headings (24px reading threshold, final section at bottom),
render aria-current and a persistent high-contrast selected style. Reuse the
same update for scroll, contents jumps and local resize/layout changes; clean
up resize observation. No focus/scroll mutation from scroll tracking, no routes,
new global store or future-card framework. Reopening starts at the first section.

- [x] RED tests: initial/single marker, forward/back manual scrolling without
  focus change, bottom edge, reopen and visible-capability change; rename labels.
- [x] Implement local tracking, selected CSS and five catalog labels; GREEN.
- [x] Browser matrix: wheel/manual scroll and contents clicks, bottom/reopen/
  capability/layout changes at desktop/mobile/short/50%/200%; fresh screenshots.
- [x] Affected tests, sequential build, types/i18n/lint/diff and one external
  final review of this new delta; update same preview without publication.

Before-state hashes/copies (10 files) and new validation helpers/evidence belong
to `C:/Users/berna/AppData/Local/Temp/opencode/juno-guide-scroll-20261107/`.
Earlier source/helpers/evidence remain untouched. No additional approval gate
is needed for these two explicit refinements.

Refinement ledger: six assertions initially RED (new labels/marker), then GREEN;
the final four-suite guide/table/locale/music run passed 46 tests, including local
ResizeObserver observation/disposal. Tracking observes the scroller and its full
layout, so contents/locale reflow is included; selected styling does not change
font weight or geometry. Scroll handling only measures/sets a local marker and
never moves focus or scroll position. The existing contents jump remains explicit.
Sequential root build, root types/i18n, lint and diff whitespace all passed.
The new checker passed all 40 five-language/eight-size cases with actual wheel
scroll in both directions, non-click native scroll events, one current marker,
bottom/reopen, capability changes, desktop viewport reflow and unchanged music.
The 50% case confirmed that a clamped jump can show the final two sections;
the checker was corrected to honor the documented last-section-at-bottom policy
rather than wrongly requiring the clicked penultimate heading to stay current.
No source workaround was added. Fresh screenshots show distinct Action cards /
Special cards labels and persistent lavender/blue selection, without new cards.
External Sol review `ses_e485f35a4ffeO9KCMCesScg1kO` checked this refinement's
10-file delta, verified baseline hashes and reran the 46 tests/i18n/targeted lint.
It found one P2: a jump already clamped at the bottom emits no scroll event, so
an optimistic clicked-section marker could remain incorrect. Added a regression,
observed RED, and invoke the same geometric updater immediately after jumping.
This one-line local correction does not expand scope or introduce new risk;
principal-agent diff/tests/browser validation suffices without a second review.
Final four-suite rerun: 47 tests pass. Web production build, lint and whitespace
checks pass again. Final 40-case browser matrix now additionally clicks the
penultimate heading while already at the bottom; all cases pass, including the
reviewer's actual 50% reproduction. No known unresolved finding remains.
Both requested refinements are complete in the same local preview. No commit,
push, version change, publication or deploy.
