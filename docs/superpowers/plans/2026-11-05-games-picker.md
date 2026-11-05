# Voice controls and games picker implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Games discoverable from the voice sidebar and open a shared game
list, while moving noise suppression next to Disconnect without resembling Mute.

**Architecture:** Reuse the existing UIStore modal registry, shared Modal portal,
Juno artwork/tile and current voice navigation. Selecting Juno alone focuses its
existing table; opening/canceling the picker never joins, creates or leaves a game.

**Tech Stack:** Existing React 19, React Router 7, Zustand 5, Tailwind, Vitest.

**Spec:** User request in this conversation; `docs/systems/juno.md`,
`docs/systems/voice.md` and `docs/systems/design-system.md`.

## Global constraints and design

- No dependencies, server/game rules, wire contracts, permission or audio-engine changes.
- Existing RNNoise preference remains independent of microphone mute and other processing.
- Put the compact mic-with-sparkle control immediately before Disconnect in the
  sidebar's status row; no crossed-out microphone for noise-suppression-off.
- Replace its former bottom-row slot with Games. Keep camera/share/soundboard.
- All Games buttons (sidebar, mosaic bar and mobile) open the same list with Juno only.
- Preserve Aether Drift: DM Sans, matte backgrounds #0b0b10/#13131a, primary
  #7c6cf6, mint active state #86efac; existing Juno coral/mint card art is the
  only decorative emphasis. Modal is glass, compact status actions remain quiet.
- Reuse Modal in the fullscreen portal, with localized title/help, keyboard focus
  containment/return and Escape closing the picker without exiting fullscreen.
- UI selection is scoped to account/origin/channel and revalidated on click.
- No version bump, commit, push, release or production deployment in this request.

## Review focus

- Opening/canceling Games must not focus Juno or emit any game command.
- Selecting Juno from a text/DM view must navigate to the actual connected voice
  channel; on mobile preserve the existing voice-full screen stack.
- Room/account/origin changes must dismiss the old picker, not select a new session.
- Noise processing must never alter mute, deafen, disconnect or capture ownership.
- Escape in the picker must not reach the fullscreen voice Escape handler.

### Task 1: Shared game list and navigation

**Files:** `stores/uiStore.ts`, `components/games/{GamesButton,GamesPicker,JunoTile}.tsx`,
`components/layout/AppLayout.tsx`, `components/games/GamesPicker.test.tsx`, five voice catalogs.

**Interfaces:** `openModal('games', {...JunoTarget})`; `GamesPicker()` consumes
that context, `JunoTile({onOpen?})` optionally delegates selection, existing
`JunoStore.setOpen(true)` remains table-focus state only.

- [x] Write and observe failing tests: list first/no mutation, cancel, text-view
  navigation, active game retained, mobile stack, stale context and keyboard/fullscreen.
- [x] Register/mount the picker using the existing modal pattern; reuse JunoTile
  artwork and its default direct-focus behavior for an existing mosaic tile.
- [x] Change GamesButton into a dialog trigger; preserve support/connection gates.
- [x] Implement current-session validation, focus management and navigation.
- [x] Run affected web tests and TypeScript/i18n checks.

### Task 2: Sidebar control placement

**Files:** `components/voice/VoiceControls.tsx`, `VoiceControls.test.tsx`.

- [x] Write and observe failing tests for header placement and RNNoise-only toggling.
- [x] Move the toggle next to Disconnect; use a persistent sparkle/mic identity,
  aria-pressed, action tooltip and explicit help that it does not mute.
- [x] Add shared GamesButton in the old slot and test it opens the same picker.
- [x] Run sidebar/mosaic/mobile regression tests.

### Task 3: Acceptance and final review

**Files:** update `docs/systems/{juno,voice,mobile-ui,localization}.md` and this ledger.

- [x] Check the actual components in a browser at sidebar and narrow widths.
- [x] Run shared → server → web production build sequentially, lint, typechecks,
  i18n, affected web tests and broader UI regressions.
- [x] Request one GPT final review after changes/primary checks; fix concrete issues.

## Progress / rulings

- Initial checkout was clean at release 1.16.2; work is isolated on the new
  `feat/games-picker` branch without copying runtime data.
- The user already delegated implementation decisions; this localized UI change
  follows their explicit control placement and shared-list requirements directly.
- Task 1: complete. Tests first failed on the missing picker/import and old
  immediate-open behavior, then all 9 picker cases passed after implementation.
- Task 2: placement and RNNoise-only behavior complete; all 3 sidebar tests pass.
- Primary checks passed: root production build (shared → server → web), root
  typecheck including i18n, direct web tsc, ESLint with zero warnings, and i18n.
- The first root build invocation failed because pnpm was absent from PATH;
  adding the existing Corepack shims to that process's PATH fixed it. No global
  configuration or dependency changes. The first full web run hit its 120s
  limit; the subsequent 600s run passed all 3,378 tests across 360 files in 357s.
- Browser acceptance: actual React controls and picker with isolated fixture
  state, 1280×800 and 390×844; sidebar and mosaic buttons, cancel, Escape without
  exiting fullscreen, no POST game commands, selection and no horizontal
  overflow passed. This is a UI check, not a live-media/multiplayer test.
- In-app browser screenshots require a visible desktop window, unavailable in
  this session; used existing cached Playwright with the installed Edge instead.
  Evidence and the temporary harness are under
  `C:/Users/berna/AppData/Local/Temp/opencode/games-picker-checks-20261105/`
  (`sidebar.png`, `picker-desktop.png`, `picker-mobile.png`, `acceptance.mjs`).
- Isolated API startup used a new temporary DB/uploads directory, no `.env` or
  runtime `data/` access; `/api/health` and `/api/instance/info` both returned 200.
- Context7 was attempted but its monthly quota was exhausted; the official
  React Router `useNavigate` documentation was read directly instead.
- Task 2: complete. Targeted sidebar/mosaic/mobile/Juno UI/store regression:
  39 tests across six files passed; full web suite also passed. Lint rerun clean.
- Additional checks: desktop TypeScript (`tsc --noEmit`), server e2e TypeScript,
  and all 2,930 server `src` tests (259 files) passed.
- Final GPT review: approved with no actionable findings. Reviewer independently
  repeated the 39 focused tests, web tsc, i18n, ESLint and diff whitespace check.
  Native-browser fullscreen Escape and actual LiveKit/multiplayer were not
  exercised; unchanged game/server/media rules remain outside this UI acceptance.
- Task 3: complete. No commit, push, version bump, release or deployment performed.
