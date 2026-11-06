# Juno Hammer 1.16.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task in the current session.

**Goal:** Ship the approved hammer, decorative buttons and stationary table as 1.16.6, then safely update the existing VM.

**Architecture:** Extend the existing match and confirmed-effects components; use stable seat anchors and fan lanes rather than animation-dependent layout. Reuse server rules, transport, localization and the established release/backup/update workflows.

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest, pnpm 10, Node 24, existing GitHub Actions/Docker deployment.

**Spec:** `docs/superpowers/specs/2026-11-06-juno-hammer.md` (approved visual preview and explicit implementation/release/deployment authorization).

## Global Constraints

- No new dependencies, database, permissions or wire-contract changes; preserve report deadlines and actual drawn amounts.
- No production fixture/fake users, optimistic penalties, mount/poll replays or temporary hiding/reflow of cards.
- Preserve origin-aware identities/actions, accessible localized controls and reduced motion.
- Tests must use isolated storage and explicit file inventories; never touch runtime `data/`.
- External Sol final review covers application, release metadata and external deployment helpers before publication.

## Review Focus

- Concurrent opportunities and their removal must not resize/recenter seat geometry.
- Short/scaled tables and both lateral avatar layouts must keep base alignment and avoid pile/card occlusion.
- Failed/stale/expired requests never animate or change counts; confirmed ids animate once at the accused seat.
- Reduced motion, unmount and changing game/context must clean up effects without stale DOM anchors.
- Exact image/tag/commit identity, consistent backups and preservation of LiveKit/data gate deployment.

---

### Task 1: Accessible hammer and stable seats

**Files:** modify `JunoMatch.tsx`, `juno.css`, `junoAssets.ts`, `JunoMatch.test.tsx`, `junoAssets.test.ts` under `packages/web/src/components/games/`; add `ui/hammer.gif`, `ui/hammer-still.webp` and provenance entries under `packages/web/public/games/juno/`.

**Interfaces:** keep existing `JunoMatch()` and report commands; expose a persistent `.juno-report-anchor` per supported occupied seat for the existing effects layer. `JUNO_ASSETS.hammer` and `.hammerStill` name local art.

- [ ] Add failing tests for image-only target-labelled reports, hidden rather than visible timing, retained opponent backs, stable anchor identity across confirmation and existing action/expiry/capability guards.
- [ ] Run the focused tests with the existing isolated explicit-file runner; verify new assertions fail.
- [ ] Import exact approved assets/hashes and implement persistent seat anchors/fan space, correct base offsets at each responsive layout, and approved primary/secondary CSS.
- [ ] Run focused match/assets tests and browser geometry checks for top/side/multiple targets, compact layouts and interface scales.

### Task 2: Confirmed local strike feedback

**Files:** modify `JunoEffects.tsx`, `JunoEffects.test.tsx`, `JunoMatch.test.tsx`, `juno.css` and `docs/systems/juno.md`.

**Interfaces:** retain `JunoEffects({move,position,name})`; measure `.juno-report-anchor` relative to its current layer with `layoutPixels`. A report-only render branch replays the supplied GIF, flash/ring and 12 particles for approximately 1.05 seconds; ordinary play/draw/JUNO feedback is unchanged.

- [ ] Replace report-flight expectations with failing assertions for accused-seat strike, 12 particles, no central draw/+2, positive-amount-only effects and cleanup/no replay.
- [ ] Implement the report branch using existing confirmed-id/lifecycle machinery, aria-hidden/pointer-transparent effects and reduced-motion hiding.
- [ ] Pass unit tests, controlled browser before/during/after stability, keyboard, multi-target, expired/pending, reduced-motion and all five-language/scale regressions.
- [ ] Update subsystem/artwork docs and preserve reporting authority/rules.

### Task 3: Validate, publish and update only Backspace

**Files:** update versioned manifests with `scripts/bump-version.mjs 1.16.6`; add `.github/release-notes/v1.16.6.md`; prepare scoped external evidence/helpers under the approved OpenCode temporary directory.

- [ ] Run production build in fixed order, typechecks including desktop/e2e, lint, isolated affected/server-report regressions and full suites where practical; start both dev servers against temporary storage and inspect browser captures.
- [ ] Run final external Sol review over the complete diff/new assets/version metadata and deployment helpers; resolve concrete findings and rerun affected checks.
- [ ] Commit/push reviewed source to main branch, create immutable v1.16.6 and verify exact-commit CI, desktop inventory and multi-arch OCI release. Never move an existing tag.
- [ ] Prepare consistent private backups and old-image/config state; verify new image labels/digest; update the VM via the existing update workflow, restarting Backspace only.
- [ ] Verify public version/commit/health/frontend assets, DB integrity/identity/migrations, original uploads and unchanged LiveKit. Retain rollback and report outcome/limitations.
