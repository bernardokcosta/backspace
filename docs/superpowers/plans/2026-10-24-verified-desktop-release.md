# Verified Desktop Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one complete Backspace Fork 1.15.1 release and activate the desktop minimum only after verified public availability and a healthy deployment.

**Architecture:** Build without remote publication, upload immutable matrix artifacts, then use one id-aware writer to validate and upload the exact release assets. Validate updater content and SHA hashes before publication and repeat public checks afterward. Production rollout is explicitly two-stage: compatible server/frontend with policy off, then enable the minimum after recovery tests pass.

**Tech Stack:** GitHub Actions, electron-builder 26.15.3, Node 24 tooling/tests, GitHub REST, Docker/GHCR, existing SQLite backup tooling.

**Spec:** [Verified desktop release](../specs/2026-10-24-verified-desktop-release.md); [initiative constraints and order](2026-10-24-desktop-1.15.1.md).

## Global Constraints

- Preserve `v1.15.0`; tag **v1.15.1** once at the reviewed commit with all five manifests matching.
- Exactly 16 unique uploaded assets, excluding GitHub source archives, with eight installers and four latest manifests.
- No matrix writer creates/publishes releases; no silent overwrite, tag move, unpublish or deletion of unrelated drafts.
- Public verified installers precede production enforcement of **1.15.1**.
- Real HDR, both Windows architectures, security fuses, correct metadata and old-client recovery are hard gates.
- Preserve fork publisher/source offer, credentials, application data and LiveKit. Never print/store publishing tokens in evidence.

## Review Focus

1. --publish never must still generate app-update.yml and all latest manifests; prove it on real outputs rather than assuming it.
2. Aggregation must reject duplicate/conflicting/unexpected names and unsafe referenced paths, including artifacts hidden in subdirectories/symlinks.
3. Reruns or a pre-existing public release must not create another release or replace different bytes/edited notes.
4. A correct primary Windows path with a wrong/missing ARM entry must fail updater validation before publication.
5. An unhealthy/inaccessible release after policy activation needs a policy-disable recovery, not a database restore or collateral LiveKit restart.

---

### Task R1: Single-writer build aggregation and release validation

**Files:**
- Modify: `.github/workflows/release.yml`, `.github/workflows/ci.yml`.
- Create: `scripts/desktop-release-assets.mjs`, `scripts/desktop-release-assets.test.mjs`, `scripts/publish-desktop-release.mjs`, `scripts/publish-desktop-release.test.mjs`.
- Create: `.github/release-notes/v1.15.1.md` with approved summary, limitations and platform links.
- Modify: `.github/workflows/flatpak-release-metadata.yml` only to prevent this fork's release from invoking upstream-only main/manifest automation; do not repair or publish a new Flatpak distribution in this task.
- Update: `docs/systems/{deployment,desktop}.md`.

**Interfaces:**
- `expectedDesktopAssets(version: string): readonly string[]` returns the exact names in the release spec, substituting the supplied validated version.
- `validateDesktopRelease(directory: string, version: string): Promise<{ assets: Array<{ name: string; size: number; sha256: string; sha512: string }> }>` rejects missing/unexpected/conflicting files and updater mismatches; produces an auditable inventory.
- CLI: `node scripts/desktop-release-assets.mjs --directory <dir> --version 1.15.1 --output <inventory.json>`.
- Publisher: `publishDesktopRelease({ repository, tag, commit, releaseId, directory, inventory, notesPath, publish }, api)` validates identity and idempotently resumes identical uploads; different bytes fail. The injected API interface is tested through a fake local server, never real writes in unit tests.
- CLI: `node scripts/publish-desktop-release.mjs --repository bernardokcosta/backspace --tag v1.15.1 --commit <sha> --release-id <id> --directory <dir> --inventory <inventory.json> --notes .github/release-notes/v1.15.1.md --publish`.
- Writer validates an exact release id supplied by the bootstrap response; `publish=false` validates/stages only, `publish=true` requires every release/hardware/CI gate already satisfied.

- [ ] **Step 1: Add failing asset/publisher fixture tests.** Require 16 unique assets, four latest versions, both Windows architectures and size/SHA-512 matches for every file reference. Reject absent/empty/truncated output, wrong version, absolute/encoded/traversal paths, symlink escape, missing blockmaps, nested duplicate basenames and mismatched digest/size. Fake GitHub tests cover multiple/untagged drafts, wrong repo/tag/commit, partial retry, existing identical assets, differing assets, upload failure and edited public notes. No fixture test mutates GitHub.
- [ ] **Step 2: Run** `node --test scripts/desktop-release-assets.test.mjs scripts/publish-desktop-release.test.mjs`; expect failures before implementation.
- [ ] **Step 3: Implement deterministic inventory and id-based publisher.** Do not add an unneeded runtime dependency for YAML: use the already installed build-tool YAML parser through a documented build-time import, or add an explicitly justified permissive dev dependency if no stable accessible import exists. Restrict manifest references to expected basenames, validate numeric fields and compare complete hashes. Preserve existing title/body on rerun unless unchanged bootstrap values; a different user-edited body is never silently replaced. Never log tokens or token-bearing redirects; send credentials only to validated GitHub API/upload hosts. Verify remote uploaded bytes/digests before marking complete.
- [ ] **Step 4: Reshape workflow into build → aggregate → single writer.** Matrix jobs use `--publish never`, no GH_TOKEN and contents:read, keep fuse/signature checks, build/verify Windows native binaries, and upload only their explicit artifact allowlists. Retain GitHub publish configuration so packaged app-update.yml points at the fork. The inspected installed PublishManager generates update-info tasks independently of isPublish, but require real output checks for all four jobs. Download each artifact into its own directory, validate collisions before flattening, and gate a single contents:write finalizer on every successful job plus required CI for the exact commit. Bootstrap emits the release id; finalizer uses it directly, verifies tag resolution/commit and refuses ambiguous state. Concurrency is per tag, never cancels an active publisher mid-upload. Pin new actions to verified SHAs, not guessed values.
- [ ] **Step 5: Validate workflow and rerun semantics.** Run fixture tests, lint, workflow syntax/static checks and a dry-run packaging/aggregation on actual outputs. Verify packaged app-update.yml repository and generated latest metadata even with publication disabled. Confirm a simulated failed matrix has no publish path, failed final upload preserves the draft, and a rerun resumes the same id without replacing different bytes. Gate upstream-only Flatpak automation explicitly for this fork; record the previous split cause as unconfirmed unless evidence establishes it. Update docs and commit the workflow repair.

### Task R2: Whole-branch validation and release acceptance evidence

**Files:**
- Update: `docs/superpowers/validation/2026-10-24-desktop-1.15.1.md`.
- Modify version manifests only after all feature gates pass: `package.json`, `packages/{desktop,server,shared,web}/package.json` via `scripts/bump-version.mjs`.
- Update: release notes and affected subsystem docs to match actual measured support/limitations.

**Interfaces:** Consumes N1–N3/M1–M3/R1 artifacts and evidence; produces a reviewed exact release commit and a complete acceptance ledger, with pending checks visibly blocking publication/activation.

- [ ] **Step 1: Run the full repository gate.** `pnpm build` (ordered), `pnpm typecheck`, `pnpm --filter @backspace/server typecheck:e2e`, `pnpm --filter @backspace/desktop build:ts`, `pnpm check:i18n`, `pnpm lint`, `pnpm -r test`, and the Node release-script tests. If an old suppression was genuinely fixed, run `pnpm lint:prune`; never add suppressions to hide a regression. Start both dev servers with isolated test configuration and exercise the actual UI. Record any platform-specific failure with evidence/baseline comparison, not an unexplained ignore.
- [ ] **Step 2: Complete native/installed-client acceptance.** Require matching-host native tests and real packaged boot/load on x64/arm64; real HDR→SDR preview/receiver and SDR regression; bounded native resource tests; current/legacy/manual/external update behavior; no background replay under the gate; and active-old-client/browser coexistence transition. Missing hardware, legacy identification or media teardown evidence stops here. Tests cannot be substituted by the existence of an installer.
- [ ] **Step 3: Prepare the versioned source and external review.** After gates pass, use the confirmed syntax `node scripts/bump-version.mjs 1.15.1`, rerun version-consistency/build/affected checks and `git diff --check`. Obtain the mandatory external final review for all staged/unstaged/new files, native code, workflow/configuration, source offer and planned operation. Correct concrete findings, rerun affected validation, then commit the reviewed source/version/notes. Do not move the existing 1.15.0 tag or publish while review remains pending.

### Task R3: Public release, healthy deploy and explicit minimum activation

**Files/external state:** GitHub release/tag/image metadata; `/opt/backspace/.env` on the operator's locally configured deployment target; a fresh `/opt/backspace/data/backups/deploy-v1.15.1-<UTC>/` record. Keep the actual SSH host/user in local ops configuration, not public source. No LiveKit/configuration/data reset.

**Interfaces:** Consumes the reviewed release commit and complete R2 evidence; produces public release URL, asset inventory, healthy public instance info and a verified enabled policy. Secrets remain on the VM or in memory, never in logs/commits.

- [ ] **Step 1: Publish only the reviewed commit.** Confirm clean/understood working state and exact SHA; push master, tag v1.15.1 once and push that tag. Await successful CI, native gates, container publication and the new release workflow. Reconcile only that new release id using R1 tooling. Verify anonymous release/latest endpoints and all eight installer downloads, all four manifest versions/references/hashes and both Windows updater selections. Verify GHCR OCI revision equals the reviewed SHA. Do not rely on the green workflow alone.
- [ ] **Step 2: Record rollback and deploy with policy off.** SSH in batch mode; confirm current instance/version/image. Use existing `backup.sh` for a consistent SQLite snapshot, save environment before, current image id/ref and public info under a mode-700 deploy record, without printing secrets. Pin `BACKSPACE_IMAGE_TAG=1.15.1`, explicitly leave/unset the minimum, and run `docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --no-deps --pull never backspace` after pulling and checking the target image. Wait for healthy and verify public `/api/health` and `/api/instance/info`, homepage/source offer, unchanged instanceId and SQLite quick/FK checks. Only Backspace restarts.
- [ ] **Step 3: Verify recovery before activation.** Test browser login and current desktop; run a legacy desktop update check/download/relaunch against the now-public release in a disposable account/profile. Confirm every installer remains available, installed version becomes >=1.15.1 and user credentials/drafts persist. Record after-environment/image/info and compare only intended settings changed. If health/recovery fails, keep the minimum disabled and preserve the database.
- [ ] **Step 4: Activate the approved policy explicitly.** After all public/native/legacy checks pass, set `BACKSPACE_MIN_DESKTOP_VERSION=1.15.1` in the VM environment, preserve the before/after copies and restart only Backspace. Verify the public field announces 1.15.1, old desktop gets update-required, current desktop/browser/bot/federation remain usable and queued sends do not run behind the block. Verify the observed already-open legacy-call transition, not only a fresh launch.
- [ ] **Step 5: Verify external state and deliver honestly.** Inspect all repository and external changes against review. Because the actual release/deployment introduces material external state after R2's review, make the justified second call to the same selected reviewer before final delivery, covering the complete configuration/backup record and release reconciliation; do not call a different reviewer or start an unbounded loop. If artifact/update access breaks, first disable the minimum and verify recovery; image rollback, if needed, preserves the current database. Report release/deploy/policy outcomes separately, with links and any remaining blocker. Do not claim completion with a pending native/HDR/legacy gate.
