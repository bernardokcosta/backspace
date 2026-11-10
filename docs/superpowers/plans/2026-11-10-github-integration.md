# Protected GitHub Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish with all sensible PR changes on master, no open PRs and no open Dependabot alerts, without bypass or misleading dismissal.

**Architecture:** Provider plans build one candidate with real merge ancestry. Review the complete baseline-to-candidate range plus dirty/new files once, then publish one integration PR and obey all required checks before normal merge.

**Tech Stack:** Existing Git/GH CLI, GitHub Actions/CodeQL/Dependabot, Node24/pnpm10.

**Spec:** `docs/superpowers/specs/2026-11-10-github-integration.md`

## Global Constraints

- Baseline `50c48f90edda2984cd6f483ac155af43d3acce37` after already-merged PR23.
- Preserve author commits and user work; no force-push, admin bypass, repository-setting change or scanner suppression.
- User authorizes commit/push/normal PR merge, not production deploy/restart or releases/tags/images.
- Exactly one chosen final reviewer type, Sol, for this new dependency/security scope; at most one justified follow-up. Prior PR23 reviews belong to the completed rate-limit task.
- Do not poll background watchers; use automatic completion notifications. Do not mistake currently present checks for not-yet-created required aggregate contexts.

## Review Focus

- Upstream bot head changed while integration was built: reread and compare exact SHAs before push/merge.
- Strict protection requires up-to-date master: fetch and reconcile changes without overwrite.
- Green partial check inventory can hide missing Build & test aggregate: verify all six contexts and full merge eligibility.
- Original PR auto-closure may differ from ancestry: prove each valid head is reachable, inspect actual GitHub states and report accurately.
- Dependabot refresh can lag actual lockfile removal: verify default-branch graph/alert state after CI, never dismiss or claim premature success.

## File map

Provider plans own source/docs/config. Add one final validation record under `docs/superpowers/plans/2026-11-10-pr-security-hygiene-validation.md`; progress and exact head inventory live in this plan's ignored workspace. No workflow/config change is assumed.

### Task1: Candidate validation and review

**Interfaces:** consumes provider changes and recorded upstream head SHAs; produces reviewed final tree/commit and evidence, not a new runtime API.

- [x] Record original and reread current PR heads; assert relevant heads are ancestors of candidate with `git merge-base --is-ancestor`.
- [x] Complete provider validation, sequential build, tooling/all workspace tests, lint/typechecks and disposable local startup. Keep platform limitations explicit; user approved Node-range elevation, not a new release.
- [x] Write full validation/ruling record. Invoke only `review_final_gpt56` on the entire committed baseline range plus staged/unstaged/new files; include all paths, upstream merges, Node range, patch and scanner changes. Await and fix concrete findings; rerun affected validation.
- [ ] Commit task-owned final fixes/docs/tests after approval; verify clean worktree and no unrelated paths. Push only the integration branch, without force.

### Task2: Protected merge and reconciliation

**Interfaces:** reviewed candidate SHA is the only allowed GH merge head; remote PR/alert APIs are the final authority.

- [ ] Create one PR with provider/original PR links, evidence and platform limitations. Required checks: Build & test; Secret scan; Dependency scan; IaC/config; License compliance; CodeQL, with repository-required integrations. Keep native/container checks green too.
- [ ] Use a bounded GH checks watcher in background if needed; continue independent work and await notification, not repeated status polling. If failures occur, inspect actual failure logs and repair only demonstrated compatibility defects, without weakening protections.
- [ ] Reread branch heads/master and merge eligibility; use `gh pr merge --merge --match-head-commit <reviewed-sha>` without `--admin` or auto-merge setting changes.
- [ ] Fetch master; prove all valid original heads reachable. Read original PR states; close only obsolete/superseded leftovers with an accurate integration link/reason, preserving their branches/history.
- [ ] Verify `gh pr list --state open` empty and Dependabot open-alert API empty, alert1 fixed through removal. Wait for ordinary default-branch checks/graph refresh through supported watchers before final readback; unresolved refresh is reported, not dismissed.
- [ ] Deliver commit/merge/PR links and actual counts, no production claims. Cleanup only task-owned scratch after review; preserve source worktrees/user data.

## Self-review

All five Review Focus conditions have explicit readbacks/gates. The GitHub state is not inferred from local pass counts, and every original sensible change is preserved through actual ancestry.
