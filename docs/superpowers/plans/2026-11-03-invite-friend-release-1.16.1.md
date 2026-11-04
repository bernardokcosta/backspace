# Invite Friend and 1.16.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans inline. Do not delegate implementation. Use the mandatory final reviewer before merging or publishing.

**Goal:** Incorporate upstream #485 with proven defects fixed, preserve the latest master merges, validate and publish fork 1.16.1.

**Architecture:** Import the one upstream feature commit with attribution. Reuse existing invitation generation/sending and UI stores; add origin and lifecycle safety without new server contracts. Use existing version/release tooling and immutable tags.

**Tech Stack:** TypeScript strict, React 19, Zustand 5, Vitest, Node 24, pnpm 10.34.3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-03-invite-friend-1.16.1-design.md`

## Global Constraints

- Preserve fork master `35431e2c`, merged PRs #9/#10, and the upstream author.
- No new dependencies, `any`, suppressions, migration or server protocol.
- Use origin + id, existing authorization and all five catalogs.
- No production/upstream mutation. Only the fork merge/release is authorized.
- No force-push, tag movement, asset replacement or disabled publication gates.

## Review Focus

- Coinciding ids across two space origins must not mix invite codes and cards.
- A code lookup resolving after recipient/account/modal change must not send.
- Old send completion must not mark a newly opened modal successful.
- Friend and DM entry points preserve canonical identities and group actions.
- Master dependency updates, fork identity and exact-commit release gates remain intact.

### Task 1: Import and reproduce

**Files:** Upstream's 14 feature files; this spec/plan.
**Interfaces:** Existing `generateInvite(spaceId)`, modal store, DM context callback;
upstream shared `sendSpaceInvite(friend, source, t)`.

- [x] Import only `0ab1535` with provenance into the release branch based on latest master.
- [x] Install frozen dependencies; run the upstream and existing invitation suites.
- [x] Add typed RED tests for explicit origin, coinciding ids, closure/recipient/account changes, late results and duplicate input.

### Task 2: Correct and validate invitation behavior

**Files:** `InviteFriendModal.tsx` and tests, `InviteModal.tsx` and affected tests,
`spaceStore.ts` and invitation-action tests, `utils/spaceInvite.ts` and tests,
friend/DM context-menu tests, `docs/systems/spaces.md`.
**Interfaces:** `generateInvite(spaceId: string, origin?: string): Promise<string>`;
existing true-home sender and closed/localized status type.

- [x] Route generation through the existing action using the selected origin.
- [x] Guard pending work by current modal/recipient/auth session; isolate statuses and prevent synchronous duplicate sends.
- [x] Keep the shared sender behavior, add origin/identity/error coverage and entry-point/group regressions.
- [x] Replace new untyped PR fixtures; run all targeted suites to GREEN.
- [x] Exercise the real UI with artificial local data and document results/limitations.

### Task 3: Prepare and validate release

**Files:** All five `package.json` versions, `.github/release-notes/v1.16.1.md`, subsystem docs and this ledger.
**Interfaces:** Existing bump script, frozen lockfile, version consistency, release inventory/publisher/native verification tooling.

- [x] Bump lockstep 1.16.1; notes credit upstream and cover merged operational/dependency changes without overstating unresolved diagnostics.
- [x] Run full server/web/desktop tests, sequential build, desktop/e2e typechecks, lint/i18n/precache and release-tooling checks.
- [x] Obtain one `review_final_gpt56` external final review of imported commit, all corrections, versions/notes/docs and release procedure. Correct concrete findings and rerun affected gates.

### Task 4: Merge and publish

**Files/refs:** Fork master, annotated immutable `v1.16.1`, existing Actions/release assets.

- [ ] Confirm master has not moved; merge/push reviewed commits preserving latest master without force.
- [ ] Require successful CI/security for the exact master commit before tag publication.
- [ ] Push annotated tag once; wait for the existing desktop/native/container workflows without weakening gates.
- [ ] Verify release/version/inventory/manifests, public downloads and OCI version/revision. Report any blocked job rather than claiming completion.

## Execution ledger

- Initial checkout clean on `fix/operational-regressions`; fetched master contains the two operator-mentioned merges. Work continues on dedicated `release/1.16.1`, not on master.
- Review/source evidence: upstream composite space keys still call id-only `generateInvite`; new modal resets results but does not invalidate pending lookup/send work. Tests will establish exact failures before fixes.
- Existing portable GitHub CLI found in approved temporary tooling. Use the configured credential manager only through process memory; no interactive login, credential file, global configuration change or secret output.
- Imported as `33b83473` with the upstream author and cherry-pick provenance. The sole import conflict kept the fork's navigation/resize imports and added the DM counterpart type; no unrelated upstream history was brought in.
- RED/GREEN: upstream's 24 invitation tests passed unchanged; new origin/lifecycle/duplicate regressions exposed 10 failures. Fixes passed 37 tests, then expanded sender/context coverage reached 70/70. The existing modal's new token-change regression separately failed on a disabled row, then passed after session-aware reset.
- Ruling: harden the existing space-first dialog alongside the extracted sender — otherwise an old send could close an unrelated modal and a stale lookup could replace the new space's link. This is the same invitation lifecycle boundary, with focused regressions, not another sending path.
- Frozen installation, sequential shared/server/web build (including i18n), web typecheck, desktop compilation, server e2e typecheck, lint, precache budget and 18 release/probe tooling tests passed. Full workspace suites run with two workers to bound local resource usage: desktop 565 passed / 18 platform-skipped; server 3,190 passed including federation e2e; web 3,357 passed. Total: 7,112 passed / 18 skipped, plus the 18 release/probe tooling tests. `git diff --check` passed; existing build size/dynamic-import warnings do not exceed the precache budget.
- Real UI smoke used an isolated loopback server/database/uploads under `C:/Users/berna/AppData/Local/Temp/opencode/invite-1161-ADBOPC`, plus Vite. Cached local Playwright drove real API-created accounts/friendship/spaces: friend and DM menus delivered exactly two cards to the recipient; closing a delayed code lookup produced no third card; no page errors. Screenshot evidence: `friend-picker.png`, `friend-sent.png`, `dm-sent.png`; report: `ui-smoke-result.json`. Early smoke harness selectors were corrected (Active Now also contains the name; avatar initials enter accessible button names). No product defect was hidden by those harness corrections.
- The in-app browser's localhost points at another environment, so it was closed without interacting with that unrelated app; the local cached browser exercised this checkout instead. This is web UI acceptance, not installed-desktop/native-capture or cross-instance UI acceptance; federation is additionally covered by automated sender/store and server e2e tests.
- Version bumped with the supported script in all five manifests. Release notes credit upstream and include master PRs #9/#10 without claiming additional production acceptance. Master was fetched again and remains `35431e2c`; its existing CI/security/native runs all succeeded.
- Final external Sol review approved the complete diff from `35431e2c`, imported commit and untracked files, with no concrete findings or blockers. Reviewer independently passed 110 web, 22 server and 18 tooling tests (150), plus web typecheck, lint, i18n and whitespace checks. No second reviewer or fallback was invoked. Publication remains contingent on exact-commit CI/security, immutable tag and verified public artifacts.
