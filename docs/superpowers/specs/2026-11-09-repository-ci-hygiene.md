# Spec: repository-ci-hygiene

Parent: [repository hygiene](2026-11-09-repository-hygiene-design.md).
Depends on: none. Approved on 2026-11-09; inherits parent commands/style/boundaries.

## Objective and files

Remove proven obsolete automation/configuration without losing functionality or
test coverage. Audit `.github/workflows/`, `.github/dependabot.yml`, `package.json`,
`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `scripts/`, `flatpak/` and their consumers;
update affected `docs/systems/` and Flatpak guides in the same change.

## Acceptance

- Delete only artifacts with verified obsolete purpose and no required consumers.
  Age, legacy branding or an unused automatic trigger alone is not evidence that
  a useful tool is trash. Record deletions and consumer checks in the local ledger.
- Remove the upstream-only Flatpak release automation; keep local packaging,
  manifest/source pairing safeguards and useful tests. Correct references to
  nonexistent workflows. Do not imply this fork publishes a Flathub package.
- Eliminate duplicate native push runs while preserving CI and release callers,
  manual diagnostics, Windows x64/arm64 native build, Electron load and packaged
  payload checks, and their connection to the aggregate required gate.
- Include the applicable root-script, desktop-script and Flatpak Node tests in
  CI. Validate every retained workflow with actionlint. Preserve workspace tests,
  federation e2e, e2e typechecking, desktop typechecking, lint and image builds.
- Remove only proven consumerless overrides/configuration; regenerate the lockfile
  through pnpm. No unrelated dependency upgrades or weakened license policy.
- Triage all 16 Gitleaks findings without exposing secret values. Any exception
  must identify one verified historical commit/path/rule/line fingerprint and
  have a safe, reviewable rationale. No whole-file/rule/history exclusions.
  Prove that a new synthetic credential in a new commit still fails scanning.
  A genuine or uncertain credential blocks this path and requires reporting and
  rotation/revocation decisions, not an allowlist or history rewrite.
- Classify all 25 image-scan results by affected package, severity and fix
  availability, separating published-image debt from current-tree checks. Record
  the report's date/provenance and a concrete follow-up; do not dismiss findings
  or make the advisory image scan blocking blindly. Fixing/rebuilding published
  images is not authorized by this cleanup.
- Update current security/desktop/Flatpak documentation and stale CI comments to
  match actual versions, jobs, coverage, exceptions and enforcement. Do not erase
  historical design records merely because their decisions have been superseded.

## Interface to GitHub governance

Keep the stable aggregate `Build & test` check dependent on every gating CI job,
failing on failed, cancelled or skipped dependencies. Expose the four existing
enforcing scanner checks and CodeQL on PRs without path-based omissions. GitHub
governance consumes their exact observed context/integration identities, not
assumed workflow/job labels. Do not substitute an advisory image/ZAP report for
an enforcing security check.

## Validation

Run the full parent command set and scanner-specific regression tests. Record
the actual Gitleaks full-history result, synthetic new-secret detection, complete
actionlint coverage and image-SARIF classification. Platform-dependent checks
must pass in CI before integration; unavailable local tooling is not a pass.
No open product question; consumer checks and triage remain implementation work.
