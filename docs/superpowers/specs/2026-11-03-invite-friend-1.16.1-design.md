# Invite a friend to a space — upstream #485 and release 1.16.1

## Objective and authority

The operator requested review of TheZwiss/backspace#485, correction of any
problems before incorporating it into the fork, testing against the latest
fork master (including the already merged dependency PR), and publication of
1.16.1. Preserve the upstream author and integrate only the feature commit.
No upstream merge/review publication, server deployment, or VM restart is part
of this authorization. Continue directly using the existing project patterns.

Baseline: fork master `35431e2c`, including operational PR #10 and dependency
PR #9 (Electron 45.1.0, venmic 7.2.5, react-router-dom 7.18.5). Upstream feature:
`0ab1535cee27de058af2f2dd2c5ba4e326fa2a44` (14 files; no server/schema/dependency changes).

## Requirements and approach

Add the existing context-menu flow on a friend and a one-on-one DM counterpart:
choose a joined space, lazily obtain its invite code, and send the existing
space-invite DM card. Groups retain Leave Group. Render the same modal in both
mobile and desktop shells and add all five locale entries. Reuse the existing
modal/context-menu stores, API authorization and extracted shared invitation
sender; do not create another protocol, permission bypass or message format.

Selected approach: import the upstream commit with author attribution, then
apply focused, tested compatibility/correctness fixes. A literal merge is not
sufficient: source inspection identified origin ambiguity and stale async work.
A feature rewrite or importing unrelated upstream history is unnecessary.

### Review acceptance

- A selected space is identified by **origin + spaceId**. Its invite code must
  be generated on that explicit origin, even when another instance has the
  same space id. Extend the existing store action with an optional origin;
  preserve current callers, permissions and server validation.
- Closing/replacing the modal, changing the recipient, or changing the account
  must prevent a pending code lookup from initiating an unintended send.
  Already submitted requests cannot be undone; their late results must not
  mark a different recipient/session as sent or close an unrelated modal.
- Synchronous in-flight guards prevent duplicate sends from rapid input.
- The extracted sender preserves true-home friend resolution, legacy-stub
  refusal, source-origin translation and localized error mapping.
- New tests use strict typed fixtures, not the PR's new `any` annotations.
  Existing invitation tests remain green; no new lint suppressions/dependencies.
- Test both context-menu entry points and group behavior, federation cases,
  row failures, retries, duplicate input and async lifecycle boundaries.

## Release and verification

Use Node 24 / pnpm 10.34.3 and frozen installation with the merged lockfile.
Run affected suites, full server/web/desktop suites, sequential shared → server
→ web build, desktop compilation, server e2e typecheck, lint, i18n, version and
release-tooling checks. Exercise the real feature on an isolated local instance;
do not claim production/installed-desktop acceptance without doing it.

Bump all five manifests with `scripts/bump-version.mjs`, add accurate fork-owned
release notes and subsystem documentation. Obtain the mandatory single Sol
external final review before merging/publishing. Push the reviewed result to
fork master without force, require exact-commit CI/security success, then create
and push immutable annotated `v1.16.1`. Reuse existing GitHub Actions publishers;
verify public release inventory/manifests and multiarch OCI version/revision.
Never replace old assets/tags, weaken gates or publish a partial release as done.

## Boundaries

No new API/WS/federation/DB contracts or platform/dependency changes beyond the
operator's already merged dependency PR. Secrets remain in the credential
manager and ephemeral child-process environment, never files or tool output.
No changes to the official upstream repository, unrelated work, runtime state,
host configuration, or production services.
