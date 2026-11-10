# Capability map: PR and dependency-security hygiene

## Approved scope and status

The user requested zero open PRs, integration of all logically sound changes and
zero open Dependabot alerts. On 2026-11-10 the user approved raising the Node
minimum for jsdom31 and consolidating the five remaining PR histories into one
reviewed integration. Module boundaries and linked designs were approved by the
user on 2026-11-10.

| Module id | Responsibility | Depends on | Design |
|---|---|---|---|
| `dependency-security` | Integrate Node/image/npm updates, retain meaningful compatibility tests, eliminate the vulnerable deepmerge dependency | Existing package/patch/scanner policy | [Dependencies](2026-11-10-dependency-security.md) |
| `version-neutral-docs` | Repair and integrate bilingual version-neutral onboarding without changing the app's release version | Existing README/local-link/branding contract | [Onboarding](2026-11-10-version-neutral-docs.md) |
| `github-integration` | Preserve PR commit ancestry, run combined checks/review, merge through protected master and reconcile PR/alert state | Both modules above | [GitHub integration](2026-11-10-github-integration.md) |

Build order: dependency-security + version-neutral-docs → github-integration.
Implementation stays in an isolated worktree; no implementer subagents.

## Starting inventory

- PR23 (rate-limit/operational resilience) is already merged through the protected
  PR flow after all checks passed. Master merge commit:
  `50c48f90edda2984cd6f483ac155af43d3acce37`.
- PR16 updates the three Node24-slim base-image pins to digest
  `01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9`.
- PR18 updates ten direct dependencies; PR19 upgrades jsdom30→31.
- PR21/22 change README installer examples, not package release versions.
- Dependabot alert1: `deepmerge@4.3.1`, CVE-2026-93753 /
  GHSA-gcqx-w48m-w2h4, no published fixed release. Existing CodeQL open-alert
  inventory was empty; published image findings are a separate question.

## Shared boundaries

- Preserve protections, required checks, pinning, licenses and anti-abuse changes.
- No force-push, admin bypass, broad suppression, alert dismissal for appearances,
  secret publication, production restart/deploy, release/tag or immutable artifact
  replacement. Auto-merge remains disabled; do not change repository governance.
- Commit/push/PR/normal merge are authorized. Preserve user work and original PR
  ancestry; reread current remote heads before publishing/merging.
- Empty open-PR/Dependabot inventories must be verified on GitHub, not inferred
  from a green local test or an ignored scanner finding.
