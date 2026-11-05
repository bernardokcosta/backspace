# Juno 1.16.3 Release Implementation Plan

> **For agentic workers:** Use executing-plans inline; one mandatory final external
> review before commit/push/publication. No implementation subagents.

**Goal:** Commit and push the reviewed Juno/picker changes and publish 1.16.3.
**Architecture:** Reuse lockstep versions, immutable Git tags, exact-commit CI,
the existing single desktop publisher and separate GHCR workflow. No new product
or publishing mechanism, no production deployment.
**Tech Stack:** Existing Node 24/pnpm 10, Git, GitHub Actions and release validators.
**Spec:** `docs/systems/deployment.md`, approved Juno specs and implementation
ledger, plus the user's explicit commit/push/release authorization in this session.

## Constraints and review focus

- The user authorized commit, push and public release 1.16.3, including the supplied
  artwork, on 2026-11-05. This supersedes the earlier local-only delivery boundary;
  it does not establish a new authorship/license claim for the supplied archives.
- Preserve all reviewed changes on dirty `feat/games-picker`, source ZIPs,
  runtime data and published tags/releases. Never force-push or move a tag.
- Base is fork master/v1.16.2 `4c444f631fb4b7024bb72b069a9753b75de0984c`;
  recheck remote master immediately before pushing, preserve concurrent work.
- Only the existing tag workflow publishes desktop assets. Require exact-commit
  main-branch CI and security checks, native/package validation and all 16 assets.
- Do not bypass failed gates, replace public assets or infer success from a tag.
- Tests use the already audited explicit-file isolated launcher, never checkout
  `.env`/`data/` or `pnpm test -- filter`. GitHub credentials stay in process memory.
- No production SSH, restart, database migration or installed-desktop update is
  authorized here. The additive Juno migration runs only when operators upgrade.

## Tasks

### 1. Prepare the release

**Files:** root and four workspace `package.json` files;
`.github/release-notes/v1.16.3.md`; supplied-art provenance README; this plan.
All previously reviewed Juno/picker files remain in the complete release scope.

- [x] Run `node scripts/bump-version.mjs 1.16.3`; verify all five versions agree.
- [x] Write truthful feature, XP, migration, compatibility and acceptance notes;
  record the newly granted publication authorization without asserting authorship.
- [x] Run isolated version/Juno integration tests, release/probe tooling tests,
  sequential build, lint/i18n, e2e and desktop compilation, precache checks.
- [x] Obtain one external `review_final_gpt56` release review of the full pending
  scope, versions/notes and procedure; correct concrete findings before committing.

### 2. Commit, push and publish

**Refs:** fork feature branch/master and annotated immutable `v1.16.3`.
**Interface:** existing GitHub Actions CI/security/release/container workflows.

- [ ] Stage only the enumerated reviewed files; commit the complete release.
- [ ] Recheck remote base and absence of v1.16.3. Push without force, using the
  normal protected-branch/PR path if required; validate the final exact commit.
- [ ] Require successful CI/security before creating/pushing the tag once.
- [ ] Await desktop/native/container jobs; report failures without weakening gates.
- [ ] Independently verify public release identity, 16 assets/updater versions and
  hashes, anonymous download access and multiarch OCI version/revision.

## Evidence and boundaries

The feature and lateral-card refinement already passed external reviews, full
isolated web/server suites, SQLite/HTTP/WS federation/restart acceptance, desktop/
e2e compilation, build/lint and desktop/mobile/scaled visual checks. Release
preparation reruns the affected and version/packaging gates; CI validates the exact
published commit. Real multi-device LiveKit and native fullscreen Escape remain
untested. The earlier planning DB incident remains documented without a baseline;
do not claim that its lack of effects was proved or touch its files to investigate.

## Pre-publication validation

- All five manifests are 1.16.3 using the existing bump script; lockfile/dependencies
  and workflow gates are unchanged. The remote master still matches the stated
  base; neither tag nor release 1.16.3 exists at the read-only preflight.
- At 1.16.3: 102 isolated server/version/SQLite/migration/HTTP/WS/federation tests,
  84 affected web tests, 565 desktop tests (18 platform skips) and 28 release/native/
  probe tooling tests passed. Earlier full feature suites and both visual matrices
  remain recorded in the Juno ledger and lateral-card review evidence.
- Sequential build, root typecheck/i18n, lint, e2e TypeScript and desktop TypeScript
  passed. Precache check passed (115 files, largest 1,578.9 KiB) and whitespace
  check passed. No checkout runtime DB or environment file was used.
- Publication monitoring/anonymous verification uses an external read-only helper
  under the approved temporary tooling directory, with the existing credential
  manager supplying the GitHub token only in memory. The tag workflows remain
  the only release/image writers; no local publication bypass is introduced.

## Review finding and bounded correction design

The first release review found that a pending result can still name a stub after
the proof-authorized reattachment transaction deletes it. The retry then skips
that missing id and permanently commits a round without its award. Publication
is blocked until this combination is covered and corrected.

**Approach:** retain original standings/counts/places as frozen authority, with a
separate, private per-round recipient-id override owned by the existing Juno room.
Only a successfully committed proof-authorized merge redirects pending recipients,
using one application-local event on the existing Fastify HTTP server emitter.
The existing Juno route subscribes/unsubscribes with its room lifecycle; there is
no new global identity service, durable alias table, wire event or schema change.
Settlement validates original outcomes first, then deduplicates redirected awards
by recipient (higher award, one round/win increment) before its atomic writes.
Tombstoned/missing targets are still excluded. A rolled-back reattachment emits
nothing; merged ids never transfer a live seat or private hand.

**Alternatives:** a persistent alias table requires unnecessary schema/privacy
changes for ephemeral rounds; rewriting the frozen starter roster recalculates
places and can duplicate a target already in the round; clearing the pending
round loses the award. The chosen seam changes only game settlement and the
existing authorized merge notification.

**Regression gates:** real SQLite failure → real reattachment → retry, merged
participants in the same round, failed-merge rollback, target erasure before
retry, event listener cleanup and ordinary immutable-result/idempotency tests.
This identity/persistence correction requires a second and final call to the
same selected Sol reviewer after affected validations, not another reviewer.

- RED confirmed the original loss with an actual SQLite rollback and successful
  reattachment while the destination was not a starter (award absent on retry).
  A separate deterministic case exposed missing recipient deduplication for a
  winner; lifecycle and application-listener tests initially failed as expected.
- Implemented the bounded design using a per-round `ReadonlyMap`, copied across
  the existing settlement seam. Committed merge notification is synchronous
  before subsequent async profile work; no DB/wire/schema change was introduced.
- First focused GREEN: 72 tests in seven server files, including real reattach/
  SQLite retry with/without the target as starter, rollback, target tombstoning,
  chained redirects, no transferred private hand and listener cleanup.
- Second/final review by the same Sol reviewer approved the complete 154-file
  scope and the 13-file correction delta, with no additional findings. It
  independently passed 75 server tests in nine files plus lint/i18n/precache/diff
  checks. The corrected build, e2e TypeScript and isolated source API/67 served
  asset hashes also passed. No third external review or alternate reviewer was used.
- Full post-correction server validation finished: 299 inventoried files/3,250
  cases. Two cases in the unchanged sticker suite failed only during temporary
  directory cleanup on Windows (`ENOTEMPTY`); its isolated rerun passed 18/18,
  and the entire affected 50-file batch then passed 789/789. No sticker code or
  test was changed and no failure was suppressed. Exact-commit remote CI remains
  mandatory before tagging.
