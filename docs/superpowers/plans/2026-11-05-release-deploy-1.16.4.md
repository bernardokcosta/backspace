# Juno 1.16.4 Release and VM Deployment Plan

> **For agentic workers:** Execute inline with executing-plans; choose only Sol
> for external review. No implementation delegation or alternate final reviewer.

**Goal:** Commit/push the approved Juno playability/computer changes, publish
1.16.4 and deploy that exact verified image to the existing Backspace VM.
**Architecture:** Reuse lockstep version tooling, immutable tags, existing CI/
security gates, the single desktop publisher and separate multiarch GHCR workflow.
Reuse the VM's existing backup/update/Compose path, with private rollback evidence.
**Tech Stack:** Existing Node 24/pnpm 10, Git/GitHub Actions, SSH, Docker and SQLite.
**Spec:** `docs/systems/deployment.md`, approved Juno playability specs/plan and
the user's explicit commit/push/1.16.4/deploy authorization in this session.

## Constraints and review focus

- The user confirmed that “AV” means the same VM `10.84.22.89`, serving
  `https://backspace.costakoch.cloud`. This supersedes the prior local-only scope.
- Base is master/v1.16.3 `4669187634294acf5ac14a9c8ec5dd2b246a10da`; remote master
  and the clean VM checkout matched it at preflight. VM is healthy on 1.16.3,
  has approximately 18 GB free, and LiveKit is an unrelated running service.
- Product changes match the previously approved 40-file hash inventory; only
  the feature ledger gained its review result. Include the independently reviewed
  prior 1.16.3 deployment record, new release metadata and this plan deliberately.
  Inventory all files before staging; never stage runtime/secrets or other work.
- No product behavior, schema, dependency, lockfile or workflow changes are planned
  during release preparation. Keep five manifests consistent at 1.16.4.
- Never force-push, move a published tag, replace public assets, disable a gate,
  prune Docker/data, use compose down/remove-orphans, or reset a checkout.
- Require exact-commit CI/Security/CodeQL success before pushing annotated v1.16.4.
  Verify the complete public 16-asset/updater inventory and anonymous hashes,
  plus both OCI architectures' version/revision, before touching the running VM.
- Snapshot DB/uploads/config and retain the old image before restart. Recheck
  active calls immediately before applying; ask before interrupting an active
  call unless the user has explicitly accepted that for this release.
- Only the Backspace service may be recreated. Preserve all other .env bytes,
  configs, identity, uploads and unrelated services. No automatic DB restoration.
- Testing uses the audited explicit-file isolated launchers, never checkout .env/
  data. GitHub credentials stay in memory, sent only to fixed trusted API hosts.
- One selected Sol reviewer checks the complete release scope/procedure before
  publication. A second/final call to that same reviewer is justified after the
  material production .env/container/checkout change, covering actual deployment
  evidence and all files outside Git; at most these two calls for this task.

## Task 1: Prepare the reviewed release

**Files:** root/four workspace package.json; `.github/release-notes/v1.16.4.md`;
this plan and the existing feature ledger/spec index; all approved product files.
**External tools:** existing read-only GitHub verification helper and isolated
test launchers. Its 1.16.4 evidence must not overwrite 1.16.3 evidence.

- [x] Set all five versions via `node scripts/bump-version.mjs 1.16.4`.
- [x] Record truthful fixes, practice/no-XP rules, compatibility, no new migration
  relative to 1.16.3, eight installer links and acceptance limitations.
- [x] Run build, typecheck/i18n, lint, e2e/desktop TS, affected/version tests,
  desktop/tooling tests, precache and isolated source API/assets checks.
- [x] Obtain final external Sol review of the complete enumerated release scope,
  metadata, helper changes and deployment procedure. Correct concrete findings.

## Task 2: Commit, push and publish

**Refs:** fork `feat/games-picker` and master; immutable annotated `v1.16.4`.

- [ ] Check reviewed hashes and exact staging scope; commit without unrelated work.
- [ ] Recheck remote base and absent version; push without force (normal PR route
  if protected), preserving concurrent work. Do not advance an unvalidated base.
- [ ] Await CI/Security/CodeQL for that exact main-branch commit, then tag once.
- [ ] Await desktop/native/container workflows and independently verify release
  identity/notes/latest, all 16 downloads/hashes/updaters and multiarch OCI labels.

## Task 3: Deploy the verified image

**Remote paths:** `/opt/backspace`, its .env/data/Compose configuration;
root-only `/root/backspace-rollback-1.16.4-*`. Local sanitized evidence stays in
the approved temp directory `juno-release-1.16.4-20261105`.

- [ ] Recheck clean checkout/running 1.16.3, available disk, active-call status,
  exact old image/container state and .env/Compose/script hashes.
- [ ] Use existing backup.sh, validate SQLite quick_check/FKs, preserve snapshot
  outside retention; archive/validate uploads and private configuration.
- [ ] Pull the expected image and bind its Docker 29 index to the exact published
  amd64 manifest, comparing immutable config/layers and registry digest membership.
- [ ] Fetch immutable release and fast-forward only to its commit. Atomically
  change only BACKSPACE_IMAGE_TAG=1.16.3 → 1.16.4@<verified-amd64-digest>, preserving
  file mode/ownership. Both the updater's pull and restart use this immutable ref.
- [ ] Temporarily detach at the exact release while existing update.sh --yes
  performs its enabled backup/pull/app-only restart/health/version gates; return
  to master afterward. On failure restore previous environment/image, not data.
- [ ] Verify exact image/API version+commit, healthy/non-root/bounded logs, unchanged
  other containers/config, SQLite/identity/migration count and original uploads.
  No new migration is expected from 1.16.3; existing 0048 remains applied.
- [ ] Verify public HTTPS health/frontend/entry assets and all 67 Juno hashes.
  Do not create test players/games/messages or claim real media acceptance.
- [ ] Obtain the second and last review from the same Sol session, covering actual
  production changes/evidence. Report outcome/release/rollback, not assumptions.

## Prior validation

The feature has approved full isolated suites (3,259 server/300 files and 3,421
web/370 files), later affected tests, 144 controlled visual cases across five
languages plus 48 independent reviewer cases, build/typecheck/i18n/lint, e2e/
desktop TS, precache and 67 served asset hashes. This is not proof of live media,
native fullscreen Escape or Safari/Firefox. Release preparation reruns version/
packaging gates; remote CI validates the final exact publication commit.

## Release validation ledger

- Sequential shared/server/web build, root typecheck/i18n, ESLint, e2e TypeScript,
  desktop TypeScript and precache budget passed at 1.16.4. Build warnings concern
  existing chunk size/dynamic imports; no gate was disabled.
- Isolated affected/version tests: 86 server tests/9 files, 69 web tests/13 files
  and 28 release/native tooling tests passed. Desktop initially failed an unchanged
  real-clock assertion by 1 ms (`60001` versus `60000`); inspection confirmed its
  `Date.now()` timing sensitivity. The full unchanged rerun passed 565 tests/32
  files with 18 platform skips. This is recorded, not treated as a clean first run.
- Isolated source API startup and HTTP/SHA-256 checks for all 67 production Juno
  assets passed. All eight download links match the existing 16-asset contract.
- New VM helpers passed Bash syntax; seven embedded Python blocks were AST-parsed
  remotely without executing them (local Python is unavailable). Both extended
  read-only verification helpers passed Node syntax, and `git diff --check` passed.
- GitHub preflight confirms absent v1.16.4 tag/release and unchanged master;
  external operational helpers are inventoried alongside repository changes for
  release review. No 1.16.4 publication or production restart has occurred yet.
- Initial Sol review found one P2 in the deployment procedure: a second mutable-tag
  pull could run unverified bytes before the post-restart image gate. Corrected
  by keeping the existing single environment pin but binding its tag to the
  verified amd64 digest. Preparation records the pinned platform image ID separately
  from Docker 29's tag/index ID; no updater or product code is changed. The outer
  rollback restores the old environment/reference if the updater cannot retag a
  digest-bound reference. The final operational review remains planned.
- Correction validation: Bash syntax and all seven embedded Python ASTs passed;
  the actual pin-substitution code preserved unrelated fake environment bytes for
  LF and CRLF, and rejected a mismatched approved digest before writing. Read-only
  Compose resolution accepts the tag+digest pin; no pull/restart was performed by
  this syntax check. This closes the concrete finding without expanding scope;
  independent confirmation is included in the planned final operational review.
- Read-only LiveKit check at 22:11:53Z found one room/two participants. The user
  explicitly authorized restart for 1.16.4 after release/image/backup validation,
  accepting brief interruption/reconnection and ephemeral game loss. This is new
  authorization, not reuse of the prior release's consent. Recheck before apply.
