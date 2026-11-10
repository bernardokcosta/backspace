# Spec: github-integration

## Objective and status

Approved by the user on 2026-11-10; consumer of both providers in the
[approved map](2026-11-10-pr-security-hygiene-map.md).
Finish with zero open PRs in bernardokcosta/veyvox, all logically sound candidate
changes reachable from master, and zero open Dependabot alerts by actual
remediation. The user authorized commit, push and normal protected merges.

## Approved integration approach

- Baseline is master after PR23:50c48f90. Use an isolated worktree and integration
  branch; do not edit the original checkout or the completed rate-limit worktree.
- Incorporate PR16/24/19/21/22 (PR24 superseded PR18) with real Git merge ancestry, not just cherry-picks
  or copied diffs. Preserve authors' commits; resolve lockfiles through pnpm.
- Add the approved compatibility/security/documentation fixes on that branch.
  This is one integration candidate, not five unrelated attempts to bypass CI.
- Re-read remote head SHAs before integration publication and before final merge.
  If a bot/user advances a head, compare and incorporate the relevant new changes
  safely; never overwrite the branch or claim an unseen head was integrated.
- Perform one complete external Sol review after changes and primary validation,
  covering committed merge range plus staged/unstaged/new task files. Respect the
  two-call maximum and exclusivity; fix concrete findings and revalidate.
- Push the candidate, open one PR against master and require all checks/rules.
  GitHub settings currently require PR, up-to-date branch, resolved discussions,
  six integration-bound status contexts and CodeQL alert-based protection.
  Auto-merge is disabled; do not enable it or use `--admin`/force-push.
- Merge only the reviewed head with the normal GH merge API once eligible.
  Do not create a release/tag, publish installers/images or restart/deploy the VM.
- Reconcile original PRs after the merged commit ancestry is proven. GitHub may
  mark ancestor-head PRs merged automatically. If a PR is obsolete/superseded,
  close it with a specific integration link and accurate status, never pretend
  a closed/unmerged PR was independently merged.

## Observable success criteria

### Approved CI baseline amendment

On 2026-11-10 PR25 passed all protected checks, native capture, container build
and cross-OS packaging, but all six installed-replacement jobs failed before
running the candidate: the historical `v1.16.8` release is unavailable. The user
chose a fixed `bernardokcosta/veyvox` `v1.17.0` baseline instead of merging with
that limitation or awaiting unavailable old installers.

Reuse the existing installed acceptance flow, opt-in/disposable-runner guards,
six-platform matrix and eight per-installer SHA-256 pins. Fix the repository,
tag, version and filename prefix together; no latest lookup, dynamic fallback,
skipped assertion, relaxed cookie protection or publication. Verify public
release bytes against the recorded digests before committing. Keep identity,
profile/session/cookie, OS-disabled startup, AppImage, version/cache and repeat-
launch checks. Document explicitly that this now measures Veyvox upgrade from
1.17.0, not the unavailable historical 1.16.8 rebrand path. Require green installed
CI and one material-scope follow-up to the same Sol reviewer before publication.

### Original integration criteria

1. Original valid PR heads, or explicitly reviewed successors, are ancestors of
   the final master; dependency and onboarding requirements pass together.
2. `gh pr list --state open` returns an empty list, including the new integration
   PR and any obsolete duplicate surfaced during reconciliation.
3. The default-branch dependency graph no longer includes deepmerge; Dependabot
   alert1 transitions to fixed and the open Dependabot inventory is empty without
   manual dismissal. Allow GitHub's normal graph/scan refresh; if it has not
   refreshed, report that limitation instead of asserting zero alerts.
4. Required CI, native and container build checks and CodeQL succeed on the final
   candidate. Do not confuse a subset of already-created checks with pending
   aggregate checks: verify `Build & test` and the full PR state before merge.
5. Record merge SHA, links, validations and any unavailable hardware/image/release
   checks. Empty Dependabot/CodeQL inventories are not a claim that existing
   published container images have been rebuilt or all OS CVEs disappeared.

## Tools, commands and style

Use existing GH CLI and Git credentials; do not print tokens or alter auth config.
Keep factual public PR bodies/comments, no raw private logs. A later plan will
list pinned head SHAs and exact merge/validation steps before execution.

```bash
gh pr list --repo bernardokcosta/veyvox --state open --limit 100 --json number,title,headRefOid,url
gh pr checks <candidate> --repo bernardokcosta/veyvox --watch --fail-fast
gh pr merge <candidate> --repo bernardokcosta/veyvox --merge --match-head-commit <reviewed-sha>
gh api 'repos/bernardokcosta/veyvox/dependabot/alerts?state=open'
git merge-base --is-ancestor <original-head> origin/master
```

Prefer independent read calls in parallel. Background watchers return only after
automatic completion notification; never poll/sleep to wait for those jobs.
Local build order remains shared→server→web.

## Boundaries

- Always preserve user work, truthful alert attribution and repository protections.
- Ask before new scope such as production remediation, image publication, changing
  governance or discarding unrelated modifications.
- Never remove/disable a scanner, hand-edit suppression counts, mass-dismiss an
  alert, rewrite user history, deploy production or claim an unfinished job passed.
