# Spec: github-governance

Parent: [repository hygiene](2026-11-09-repository-hygiene-design.md).
Depends on: [`repository-ci-hygiene`](2026-11-09-repository-ci-hygiene.md) for stable
check contracts. Approved on 2026-11-09; inherits parent commands/style/boundaries.

## Objective and scope

Remove the identified GitHub Pages residue and configure public-repository
security and `master` protection for `bernardokcosta/veyvox`. Reuse supported
GitHub settings/APIs; do not introduce custom security automation for features
GitHub already provides. No release, tag, production or VM changes.

## Acceptance

- Save local before/after snapshots and a mutation ledger, excluding credentials,
  under ignored `.superpowers/sdd/2026-11-09-repository-hygiene/`.
- Remove only deployments `7291467320` and `7288768799` and environment
  `github-pages` (`25173012070`), after verifying their identity/state. Mark the
  deployments inactive if required by the API. If unexpected deployments or
  protection rules appear, stop deletion and reassess. Keep Pages disabled and
  preserve legitimate Actions run history.
- Enable native secret scanning, push protection and Dependabot security updates
  supported for this public repository. Verify settings by API readback; record
  unsupported options or permission failures rather than claiming success.
- Apply one non-bypassable protection policy to `master`: PR required; zero
  required human approvals; all conversations resolved; required checks passed;
  branch up to date; no direct push, force-push or deletion, including by admins.
  No automation/admin bypass list and no weakening policy to merge this change.
- Required contexts must exist on the candidate PR and be bound to their real
  integrations: `Build & test`, `Secret scan (gitleaks)`, `Dependency scan (OSV-Scanner)`,
  `IaC/config scan (Trivy)` and `License compliance scan (Trivy)` from GitHub Actions
  (app `15368`), plus `CodeQL` from GitHub Advanced Security (app `57789`). Preserve
  these stable names or reconcile them explicitly before enforcement; never
  require tag-only, scheduled-only or nonexistent checks.
- Verify CodeQL analysis and new-alert merge blocking separately: a successful
  analysis job alone does not prove alert-based enforcement. Require blocking
  new high/critical CodeQL security alerts through supported code-scanning merge
  protection; report an unavailable capability as an unresolved limitation.
- Preserve the already-safe Actions token/review settings. Do not impose unrelated
  approval, signature or contributor requirements beyond the agreed PR + CI policy.

## Validation and delivery

Re-read effective branch rules, native security settings and PR requirements;
compare with the saved baseline and verify actual candidate check results.
Do not test destructive pushes/deletions against `master`. Confirm Pages remains
off and the targeted deployments/environment are absent. Retained releases/tags
must be unchanged. Log operations without tokens or secret values.

Protection must be active before integration and cannot be bypassed for the
cleanup PR. Commit/push follows local validation and external final review; PR
checks and protection readback then determine whether integration is permitted.
Any unavailable GitHub capability remains explicit, not silently relaxed.
No open product-policy question; the smallest supported protection mechanism is
the implementer's choice within these constraints.
