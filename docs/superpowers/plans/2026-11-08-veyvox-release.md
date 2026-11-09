# Veyvox 1.17.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one complete Veyvox 1.17.0 release from the exact validated main-branch commit in the renamed existing repository.

**Architecture:** Reuse the current version script, read-only candidate matrix, strict asset inventory and single gated publisher. Preserve legacy image/update entry points while switching source ownership metadata to the same renamed repository. No direct/manual release writer or production deployment.

**Tech Stack:** Existing Node release scripts, electron-builder/Updater, pinned GitHub Actions, `gh`, Docker Buildx/GHCR; no new dependency or toolchain upgrade.

**Spec:** [veyvox-release](../specs/2026-11-08-veyvox-release.md); [integrated plan and constraints](2026-11-08-veyvox-1.17.0.md).

## Global Constraints

- Target repository: `bernardokcosta/veyvox`, same owner, visibility and history; do not recreate `bernardokcosta/backspace`.
- All workspace versions **1.17.0**; release title **Veyvox 1.17.0**; new immutable tag **v1.17.0**.
- Preserve publisher host/redirect/token protections, exact asset inventory/hashes, native SDR, fuses, macOS signatures and exact-commit main CI gates.
- Manual/PR candidates stay contents-read and never publish; only tag push can invoke the existing release writer.
- Registry paths are compatibility identities; no change to default image path before independent public access/upgrade verification.
- Inherit all integrated safety boundaries and P1 review-before-commit policy.

## Review Focus

Execution checkpoint:
- [x] R1 five versions 1.17.0, exact inventory/download/publisher/cache/asar contracts and release notes implemented.
- [x] R2 legacy registry destination pinned; baseline :1.16.8 anonymously readable for amd64/arm64.
- [x] Local release/publisher negative/security/idempotency tests; candidate and publisher gates remain intact.
- [ ] Actual candidate manifests/installed matrix, Compose/image CI and post-rename registry linkage.
- [ ] R3 external review before commit, then rename/About/topics/push/candidate/integration/exact-SHA CI.
- [ ] R4 immutable tag, sole publisher and complete anonymous asset/feed/image verification.

No remote operation or release is implied by completed local implementation boxes. Detailed remote steps stay unchecked until executed.

- Release inventory accepts old/wrong-prefix extra bytes after rebrand: R1 keeps negative/extra-asset tests.
- GitHub rename silently changes GHCR image destination: R2 pins the existing legacy package and tests both architectures anonymously.
- Canonical installer links become public before artifacts exist: R1/D1 use release-list links until validated publication.
- Candidate SHA differs from merged/tagged SHA: R3/R4 require exact final main CI and candidate evidence, rerunning after changed inputs.
- Old apps follow redirects to a feed they cannot consume: R4 verifies anonymous old-provider resolution, manifest paths and asset hashes; installer acceptance stays C5.

---

## Task R1: Version and desktop publication contracts move together

**Files:** Run `scripts/bump-version.mjs`; modify `packages/desktop/electron-builder.yml` public metadata/publisher/artifact pattern, `packages/web/src/platform/desktopDownload.ts` and test; `packages/desktop/src/{updateStatus,recovery}.ts` source/release URLs and affected tests; server update/source URL owners from C4. Modify `scripts/{desktop-release-assets,verify-desktop-build,publish-desktop-release}.mjs`, their existing tests and `scripts/fixtures/desktop-release.mjs`; create `scripts/verify-desktop-build.test.mjs` if coverage currently lives only in another script suite. Update `.github/workflows/{release,ci,native-sdr-capture}.yml`; create `.github/release-notes/v1.17.0.md`; preserve all old release notes.

**Interfaces:** `artifactName: Veyvox-${version}-${os}-${arch}.${ext}`. Keep existing eight installers, four exe/dmg blockmaps and four `latest*.yml` manifests: 16 assets total. Preserve all current suffix/architecture spellings. Public updater/source/publisher repo becomes `bernardokcosta/veyvox`; C1's executable/bundle/profile/internal identities stay retained, so unpacked validation/fuse paths remain `Backspace Fork[.exe/.app]` where pinned.

- [ ] **Step 1 — RED assertions:** Update fixtures to expect `Veyvox-1.17.0-*`, title/notes `# Veyvox 1.17.0`, and canonical repo. Assert exact 16 basenames, all eight web downloads agree with builder/inventory, new packaged publisher is public GitHub without credentials/alternate URL, old repository cannot be used for new writes, and wrong-prefix/extra/missing/empty/symlink/duplicate/nested assets fail. Retain unsafe-manifest/hash/version/redirect/authorization/rerun/idempotency cases. Assert workflow candidate has no writer/token and tag publication still requires native/validate plus exact-main-CI success.

  Test name: `requires the exact Veyvox 1.17.0 inventory and canonical publisher`.
  ```js
  assert.equal(expectedDesktopAssets('1.17.0').length, 16);
  assert.ok(expectedDesktopAssets('1.17.0').includes('Veyvox-1.17.0-win-arm64.exe'));
  assert.doesNotThrow(() => verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: veyvox\n'));
  assert.throws(() => verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: backspace\n'));
  ```

- [ ] **Step 2:** Run existing release/publisher tests plus the new verifier test and `pnpm --filter @veyvox/web test -- src/platform/desktopDownload.test.ts`. Expect old-prefix/repository/title failures, not relaxed inventories.
- [ ] **Step 3:** Run `node scripts/bump-version.mjs 1.17.0`; apply naming consistently across release inventory, build verifier, publisher hardcoded allowlist, fixture notes and web downloads. Ensure wrong-prefix output is still rejected by the build-group verifier rather than skipped after changing its prefix filter. Keep all security checks unchanged. Update current source/offers/update links; do not alter historical artifact URLs/records. Add the new brand/icon/docs/verifier Node tests to CI alongside existing script tests, and C5 read-only identity/runtime checks to candidate runners.
- [ ] **Step 4:** Run the targeted tests, `pnpm --filter @veyvox/server test -- test/version-consistency.test.ts`, workflow guard tests and full P1. Write 1.17.0 release notes with actual changes, migration/legacy identity explanation, credit, unsigned/ad-hoc/manual-update limits and the exact download table. Candidate packaging must validate real manifests rather than synthetic fixtures alone.
- [ ] **Step 5:** Record queued `release: prepare Veyvox 1.17.0 contracts and notes` checkpoint. No tag or public release is created here.

## Task R2: Keep the public container upgrade channel working

**Files:** `.github/workflows/docker-publish.yml`, `Dockerfile`, `docker-compose.yml`, `install.sh`, active deployment/readme metadata; add container-contract assertions to `scripts/veyvox-brand.test.mjs` rather than a new publishing framework.

**Interfaces:** Retain default/public compatibility image `ghcr.io/bernardokcosta/backspace`; explicitly publish that path instead of deriving the only image destination from renamed `github.repository`. Keep `BACKSPACE_IMAGE`, `BACKSPACE_IMAGE_TAG`, `BACKSPACE_COMMIT`, tags/attestations/SBOM and existing moving-tag policy. OCI title `Veyvox`, source `https://github.com/bernardokcosta/veyvox`, revision exact commit. New `ghcr.io/bernardokcosta/veyvox` is not required for 1.17.0; do not create another package just for symmetry.

- [ ] **Step 1 — RED assertions:** Assert repository rename cannot change the legacy image destination/default or operator overrides; OCI source/title point at Veyvox, and amd64/arm64, commit injection, scan/provenance/SBOM steps remain. C4's Compose fixture must keep service/project/mount/DB paths unchanged.

  Test name: `does not derive the only upgrade image from the renamed repository`.
  ```js
  const workflow = readFileSync('.github/workflows/docker-publish.yml', 'utf8');
  assert.match(workflow, /images: ghcr\.io\/bernardokcosta\/backspace/);
  assert.match(workflow, /org\.opencontainers\.image\.title=Veyvox/);
  assert.match(workflow, /org\.opencontainers\.image\.source=https:\/\/github\.com\/bernardokcosta\/veyvox/);
  ```

- [ ] **Step 2:** Run `node --test scripts/veyvox-brand.test.mjs`; expect workflow destination/source/title assertions to fail before edits.
- [ ] **Step 3:** Pin legacy GHCR publication explicitly, update visible metadata/scan-image labels consistently and leave no invented registry redirects. Verify GitHub package linkage/write permissions survive repository rename. Do not change package visibility, pull policy or operator `.env` silently; if legacy package access/linkage is unavailable, stop and report before tagging.
- [ ] **Step 4:** Validate workflow/config and CI's non-publishing amd64 image build. Before the tag, anonymously inspect the existing legacy manifest on both architectures and record package accessibility. After tag publication R4 must anonymously inspect/pull 1.17.0 and check revision; a green image writer alone is not evidence of public access.
- [ ] **Step 5:** Update deployment/upgrade documentation and ledger; queue `fix: retain the existing public container upgrade channel`. No production stack restart or manual candidate image publication is included.

## Task R3: Reviewed commit, repository rename, read-only candidate and integration

**Files:** Complete intended task tree; local Git config `remote.origin.url`; remote GitHub name/About/topics and branch/PR. Repository configuration changes are part of the implementation review's declared operational scope, even though they do not appear in `git diff`.

**Interfaces:** About description:
`Self-hosted communication for communities: chat, voice, video, screen sharing, federation, and Juno. An independent AGPL-3.0 fork of Backspace.`

Topics (17): `veyvox`, `self-hosted`, `chat`, `voice-chat`, `video-chat`, `screen-sharing`, `federation`, `discord-alternative`, `typescript`, `react`, `electron`, `webrtc`, `livekit`, `docker`, `open-source`, `agpl-3-0`, `juno`. Website remains unset.

- [ ] **Step 1 — gate:** Finish P1 and its full-scope Sol review, including every queued change and the operational sequence here. Check `git status`, explicit staged/new files and generated artwork hashes. Create reviewed logical commits on `feat/veyvox-rebrand` (or one cohesive reviewed commit), using explicit paths only; do not commit unreviewed fixes or unrelated work. Check target slug availability, current ADMIN permission, repo numeric/node identity, default branch, visibility, release/tag absence and `gh repo rename --help`/`gh repo edit --help`. A conflicting target or existing v1.17.0 blocks the operation.
- [ ] **Step 2:** Execute `gh repo rename veyvox --repo bernardokcosta/backspace --yes`, then `gh repo edit bernardokcosta/veyvox --description "Self-hosted communication for communities: chat, voice, video, screen sharing, federation, and Juno. An independent AGPL-3.0 fork of Backspace."` with one `--add-topic` per topic above. Verify owner/public status, unchanged repository ID/history/prior releases, blank homepage, exact description/topics and old URL redirects. Do not create a replacement repository or clear unrelated settings. Set local origin to `https://github.com/bernardokcosta/veyvox.git` and verify; record shared-worktree remote-config effects without editing unrelated checkout files.
- [ ] **Step 3:** Push the candidate branch with normal `git push -u origin feat/veyvox-rebrand`. Dispatch `gh workflow run release.yml --repo bernardokcosta/veyvox --ref feat/veyvox-rebrand`; select that exact run/SHA, await completion and inspect all four groups, assembled 16 assets, inventory, native resources/fuses/signatures and C5 evidence. Verify `publish` is skipped and no release/draft/tag was created. If GitHub cannot dispatch because the branch workflow is not discoverable on default, open a PR to trigger the existing read-only candidate; do not merge just to bypass candidate validation.
- [ ] **Step 4:** Fetch current `origin/master`. Prefer a PR integration respecting branch protection/maintainer policy; if direct integration is permitted, use only a normal non-forced fast-forward/push preserving all new upstream work. If master advanced, merge it into the feature branch, resolve intended conflicts, rerun affected local checks and the candidate; never discard others' changes. After integration, require successful `ci.yml` push run for the exact final master SHA and aggregate `Build & test` gate. Rerun candidate on that final SHA if merge/integration changed the candidate inputs. Stop rather than bypass branch protection.
- [ ] **Step 5:** Record commit/PR/candidate/final-CI IDs and hashes outside a new unvalidated release commit if the final ledger is updated later. Do not change final main content after selecting its validated SHA. Do not create a tag yet if any required installed compatibility, CI, image access or candidate gate remains blocked.

## Task R4: Immutable tag and post-publication verification

**Files:** No new application changes. Authorized remote tag/release/assets/container outputs only; final evidence may be reported in the session or an uncommitted evidence file without pretending its commit was the tested release SHA.

**Interfaces:** Input is the exact validated main SHA from R3. Outputs are one `v1.17.0` tag, one published `Veyvox 1.17.0` release with 16 verified assets, and the public legacy-path container version. The current publisher is the sole writer.

- [ ] **Step 1 — gate:** Recheck remote main SHA/CI/candidate and local package version, absent local/remote v1.17.0, plus old/new updater/source access after rename. Anonymously fetch legacy provider/API `repos/bernardokcosta/backspace/releases/latest`, historical manifests and canonical URLs without sending credentials to redirects; verify old install paths still resolve. Do not claim those feeds already offer 1.17.0 before publication.
- [ ] **Step 2:** Create `git tag -a v1.17.0 <validated-final-sha> -m "Veyvox 1.17.0"`, inspect its peeled SHA, then `git push origin refs/tags/v1.17.0`. Observe the tag-triggered desktop/native/validate/publisher and container workflows to completion. No `gh release create/upload`, tag move, asset replacement, or permissions/gate bypass.
- [ ] **Step 3:** Retrieve the published release by tag: title/tag/target peeled commit, not draft/prerelease, unique release ID and exact 16 basenames/nonempty sizes. Download all assets anonymously into a fresh temporary directory, run `desktop-release-assets.mjs --directory <dir> --version 1.17.0 --output <new-inventory>`, and compare local SHA-256/SHA-512/sizes to the workflow inventory and GitHub digests. Check all updater manifests reference existing Veyvox assets of the correct version/architectures.
- [ ] **Step 4:** Repeat legacy and canonical release/feed/API URL checks without authentication, including an old-provider manifest/asset resolution using its actual installed updater version on disposable supported hosts. Verify old-client feeds reach Veyvox assets; do not infer updater installation success from HTTP 200. Anonymously inspect/pull `ghcr.io/bernardokcosta/backspace:1.17.0` for amd64/arm64, verify OCI source/revision and expected moving tags, and boot only a temporary isolated server with synthetic data. Check README/download/source links, prior-release preservation and redirects.
- [ ] **Step 5:** Report actual release URL, SHA, CI/candidate/publication results, preserved legacy identities and explicit platform/hardware limits. On failure stop and preserve immutable outputs/evidence: do not repair public bytes in place or deploy. The task is not fully published/verified until every required check has real evidence.
