# Juno Neon Sounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate all 16 supplied effects into Juno's existing audio controls and release 1.17.1.

**Architecture:** Generalize the session-owned memory controller, retaining its scope/freshness rules and output route. Put pure cue selection/catalog in one nearby module and bound playback by lane. Expose only a transient local-feedback callback through the existing store.

**Tech Stack:** Existing strict TypeScript, React, Zustand, Web Audio, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-09-juno-neon-sounds.md`

## Global Constraints

- No new dependency, audio context, voice publication, game rule, REST/WS contract or persisted preference.
- Keep the original memory dubbing and music unchanged.
- Build in shared → server → web order; preserve Downloads originals and runtime data.
- Mandatory final external Sol review precedes commit/push/tag; never bypass release gates.

## Review Focus

- Terminal snapshots have zero remaining time; finishing a live round must still sound once.
- A separately confirmed announcement must not repeat on the following play.
- Late loads and rapid inputs must not start after silence, scope exit or a newer same-lane cue.
- Federated scope uses account, origin, channel and host-issued self id.
- Initial finished/playing reads and reconnect must remain silent.

### Task 1: Catalog and asset provenance

**Files:** `packages/web/public/sounds/juno/*`, `packages/web/src/components/games/junoSoundCues.ts`, `junoSoundCues.test.ts`.

**Interfaces:** `JunoSoundCue`, `JUNO_SOUNDS`, `junoMoveSounds(previous: JunoView, game: JunoView, selfId: string): JunoSoundCue[]`.

- [x] Test exact special/move/announcement/turn/result selection and silent historical/old/foreign-round transitions.
- [x] Run targeted tests; initial invocation was blocked by missing pnpm/dependencies; subsequent regression tests were observed failing and passing.
- [x] Copy 16 OGG files unchanged and record supplied provenance/hashes. Implement typed catalog and pure transition selection.
- [x] Verify tests and all asset hashes/durations.

### Task 2: Session owner and local interactions

**Files:** rename `JunoMemorySound.tsx`/tests to `JunoSounds.tsx`/tests; modify `JunoSession.tsx`, `JunoTable.tsx`/tests, `stores/junoStore.ts`.

**Interfaces:** `JunoSounds({ target: JunoTarget | null, connected: boolean })`; transient `playFeedback: ((cue: 'button' | 'select') => void) | null` in Juno store.

- [x] Extend existing audio tests for all selection paths, multiple live gains, same-lane replacement, cancellation, scope isolation and contained failures.
- [x] Generalize existing owner with bounded source lanes, post-load validity checks and live volume updates; preserve memory suppression rules.
- [x] Route enabled button/summary/card clicks from the table capture handler to the owner callback, including portal controls. Test mouse/keyboard and disabled controls.
- [x] Run all Juno/audio/store tests and web typecheck.

### Task 3: Validation and release

**Files:** `docs/systems/{sounds,juno}.md`, `.github/release-notes/v1.17.1.md`, versioned package manifests via supported script, this plan.

- [x] Document actual triggers, gain and lifecycle. Bump all versions with `node scripts/bump-version.mjs 1.17.1`.
- [x] Run `pnpm build`, `pnpm lint`, `pnpm -r test`, tooling tests and desktop TS build. Start both dev servers without touching runtime data.
- [x] Exercise real browser decode/playback, live effects volume and settings interaction; save screenshot evidence outside tracked paths.
- [x] Request one external `review_final_gpt56` over the complete changes and validations; fix concrete findings.
- [ ] Commit only task files, push the feature branch, merge through the required PR checks, tag/push `v1.17.1`, and observe the existing release workflow. Report publication truthfully if CI remains pending or fails.

## Execution ledger

- Base: `6f95b9bf`; initially clean repository; implementation isolated on
  `feat/juno-neon-sounds` rather than master. Ruling: reuse this checkout's
  dependencies instead of a second worktree; no other user changes were present.
- Tooling: `pnpm` is not on PATH; use `corepack pnpm` with the pinned 10.34.3.
  Frozen install succeeded, including desktop native rebuild; lockfile unchanged.
- Ruling: catalog is `junoSoundCues`, not `junoSounds`, to avoid Windows
  case-insensitive resolution colliding with `JunoSounds.tsx`.
- Ruling: deadline freshness applies to turn-resetting moves only. Playable
  draws/announcement/report work late in the same turn. The final review caught
  that unplayable draws and every memory miss advance/reset the deadline; the
  actor/current-player comparison covers even missed intervening snapshots.
- Catalog/trigger tests pass. Original memory regression tests retained; new
  controller tests exposed and fixed child-effect-before-parent-bind feedback
  registration. UI test covers keyboard selection, disabled cards and portals.
- Main validation: ordered production build/i18n and lint passed; desktop TS and
  server e2e TS passed; tooling 151 passed; desktop 614 passed/18 skipped.
  The unconstrained recursive test run overloaded this machine and timed out in
  unrelated suites. Reruns with two workers passed all web 412 files/4,002 tests
  and server 303 files/3,307 tests, including federation e2e.
- Dev startup: web used free port 5193 because 5173 belongs to another app;
  API on 3005 returned 200. All server runtime state was isolated under
  `C:/Users/berna/AppData/Local/Temp/opencode/juno-neon-1171/`, not checkout data.
- Real browser: all 16 pack files plus memory decoded to stereo 48kHz/nonzero
  PCM. A real confirmed +4 played through the existing output bus with measured
  PCM peak 0.1440; moving the actual effects slider 100→25 changed its active gain
  0.56→0.14 without replay. Zero rejected new sources; music stayed 100.
  This used isolated snapshots, not a claim of live multi-device voice testing.
- Evidence: `.playwright-mcp/juno-neon-1171-settings.png`; the temporary ignored
  browser harness was removed after validation. Native in-app screenshot required
  a visible desktop window, so Playwright captured the same real components.
- Final external Sol review completed with one P2: memory misses and advanced
  draws incorrectly escaped freshness filtering. Three regressions reproduced
  it (RED); the selector and its documentation were corrected. This is a local
  fix within reviewed behavior, without a new contract/scope/risk or second reviewer.
  Revalidation: 22 affected files / 211 tests passed, including fresh/stale
  advanced draws, fresh/stale memory misses and retained late playable draws.
- Ordered build and lint also passed again after the review correction.
- Remote master advanced to `01c1cea1` (GitHub Actions pin updates only) during
  the review. Its rules require a PR and successful checks; publish through that
  normal path rather than bypass protection or overwrite the remote commits.
