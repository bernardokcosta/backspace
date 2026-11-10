# Security Scanning & Supply-Chain Assurance

This is the current fork's scanning and repository-governance contract, not the
upstream repository's historical alert/settings inventory. Workflow success,
uploaded results and merge protection are distinct signals. An empty GitHub alert
list does **not** prove that a published image is vulnerability-free.

## Workflows

| File | Purpose | Trigger | Enforcement |
|------|---------|---------|-------------|
| `.github/workflows/ci.yml` | Build, tooling/workspace tests, lint, desktop/e2e typechecks, image build and reusable Windows native validation | Every PR; main/master pushes | Stable `Build & test` aggregate rejects unsuccessful dependencies |
| `.github/workflows/security.yml` | Full-history Gitleaks, OSV dependencies, Trivy config and licenses | Every PR; main/master pushes; weekly | Four separate enforcing checks |
| `.github/workflows/codeql.yml` | JavaScript/TypeScript SAST, build mode `none` | PR; main/master pushes; weekly | Analysis status plus separate alert-based merge protection |
| `.github/workflows/scorecard.yml` | Repository/supply-chain posture | main/master push; weekly; classic branch-protection changes | Advisory SARIF and public results |
| `.github/workflows/dast.yml` | Ephemeral-container OWASP ZAP baseline | main/master push; weekly; manual; PRs touching its configuration | Findings advisory; container startup failures fail the job |
| `.github/workflows/docker-publish.yml` | Published image scan, SBOM and provenance | Tag push; manual | Image findings advisory; not a PR merge check |
| `.github/dependabot.yml` | npm, GitHub Actions and Dockerfile update PRs | Weekly | Updates must pass ordinary PR checks |

`native-sdr-capture.yml` is reusable from CI and tag releases, with a manual
diagnostic trigger. It has no independent push trigger duplicating its callers.
Its checksum-verified actionlint validates **all** retained workflows. CI runs
Node 24 (the pinned `.nvmrc`/Docker line); `engines.node >=22.12` is a declared
floor, not evidence of a second Node 22 CI leg.

## Tiered policy

- **Secrets:** any non-excepted Gitleaks finding fails `Secret scan (gitleaks)`.
  Checkout uses full Git history. The action emits a redacted report/log; the job
  does not separately upload secret SARIF to the code-scanning dashboard.
- **Dependencies:** `Dependency scan (OSV-Scanner)` fails for any vulnerability not
  covered by the explicit expiring exception in `osv-scanner.toml`. It is not
  limited to fixable or HIGH/CRITICAL findings.
- **IaC and licenses:** `IaC/config scan (Trivy)` and
  `License compliance scan (Trivy)` set `exit-code: '1'` and severity
  `HIGH,CRITICAL`. Merely uploading SARIF is not enforcement.
- **CodeQL:** require completed analysis and block new high/critical security
  alerts with the repository's code-scanning rule. A successful analysis job
  alone is not alert-based merge protection.
- **Image/ZAP/Scorecard:** retain advisory findings and reports. Never dismiss or
  filter a real finding merely to obtain a green release or a better score.

### Historical secret-scan exceptions

The 2026-11-09 scheduled Gitleaks 8.24.3 run
[42632232304](https://github.com/bernardokcosta/veyvox/actions/runs/42632232304)
reported 16 historical `generic-api-key` matches. Each was checked against its
original commit and context, without publishing matched values:

| Classification | Count | Evidence |
|----------------|-------|----------|
| Natural-language prose | 3 | Auth comments and a design instruction containing authenticated/S2S-proof-gated wording, not credentials |
| Disposable-container example | 1 | Synthetic JWT environment value in a named local hardening-test command |
| Mocked test configuration | 12 | Explicitly test-prefixed JWT literals inside `vi.mock` configurations |

`.gitleaksignore` records **one full commit/path/rule/line fingerprint per match**,
each with a safe rationale. There are no whole-file, rule-wide, global-fingerprint
or history exclusions. A match added in a different commit is not ignored, even
at the same path and line. Do not rewrite history to remove these fixtures.

`scripts/gitleaks-policy.test.mjs` checks syntax, uniqueness, rationale and
historical blob existence. `scripts/verify-gitleaks-policy.mjs` exercises the real
scanner in an isolated temporary Git repo: detect a generated synthetic fixture
(exit 2), ignore only its first commit (exit 0), then remove/reintroduce it at the
same path/line in a new commit (exit 2). It runs in the security job after the
pinned action installs Gitleaks. It never uses provider credentials or prints the
synthetic value. Any genuine or uncertain secret requires investigation and
rotation/revocation decisions, not another broad exception.

### What is left open, and why

One dependency exception remains in `osv-scanner.toml`:

| Package / advisory | Bucket | Reason | Expiry |
|--------------------|--------|--------|--------|
| deepmerge 4.3.1, CVE-2026-93753 / GHSA-gcqx-w48m-w2h4 | Build tooling through `@rollup/plugin-node-resolve` (`vite-plugin-pwa`/Workbox and `prism-react-renderer`) | No fixed release recorded; repo-controlled build configuration inputs, not shipped runtime code | 2026-12-01 |

The exception is a dated deferral, not a clean scan. Review a fixed release when
available; do not silently extend expiry or weaken the scanner. The old thirteen-
finding/Fastify-4 backlog is not the current dependency state: this fork uses
Fastify 5 and Vitest 5, and has no active Cloudflare Workers workspace.

### The image scan is the exception

The image scan remains report-only. The old explanation that it awaits a Fastify
4→5 migration is obsolete. The published 1.17.0 image has measured OS-package debt
that must not be hidden by an empty alert list or a host-system upgrade.

**Measurement:** GitHub SARIF analysis
[2126525016](https://api.github.com/repos/bernardokcosta/veyvox/code-scanning/analyses/2126525016),
category `trivy-image`, `refs/tags/v1.17.0`, commit
`25d7a8f41766045ba6e5d211e5a8121f6c9e20df`, recorded 2026-11-09.
All **25 results / 24 advisory rules** were classified. They total 3 CRITICAL,
8 HIGH, 10 MEDIUM, 1 LOW and 3 UNKNOWN; the report names fixes for all 25.
One advisory affects two packages, so rule count and result count differ.

| Package | Installed | Fixed version(s) named in report | Results |
|---------|-----------|----------------------------------|---------|
| apt | 2.6.1 | 2.6.2 | 1 HIGH |
| libapt-pkg6.0 | 2.6.1 | 2.6.2 | 1 HIGH |
| libpcre2-8-0 | 10.42-1+deb12u1 | 10.42-1+deb12u2 | 1 HIGH |
| libssl3 | 3.0.22-1~deb12u1 | 3.0.22-1~deb12u2 | 1 HIGH, 4 MEDIUM, 1 LOW |
| perl-base | 5.36.0-7+deb12u3 | 5.36.0-7+deb12u4 | 3 CRITICAL, 4 HIGH, 6 MEDIUM |
| tzdata | 2026b-0+deb12u1 | 2026c/2026e/2026f-0+deb12u1 | 3 UNKNOWN (Debian update advisories) |

This is the report's package/severity/fix classification, not proof that every
advisory is reachable through a request or that the present source tree has the
same inventory. The scan covers the amd64 artifact; it does not establish the
arm64 image's state. OSV's lockfile scan answers a different question.

**Follow-up:** inventory the current multi-architecture base-image digest and
Debian repositories; evaluate a maintained base/package refresh that includes the
reported fixes; build both architectures, rescan and run health/migration/data
compatibility checks. Propose a measured severity/fix-availability gate after that
baseline is understood. Obtain separate release/deployment authorization. Do not
replace immutable 1.17.0 assets/tags, republish its image or deploy production as
part of repository hygiene. Upgrading the host does not update image packages.

## Dynamic scanning (DAST)

`dast.yml` builds the checked-out tree into an ephemeral app container and runs
OWASP ZAP baseline: spider plus passive checks, not active attack traffic. It uses
the production Compose graph with an isolated project name, a synthetic `.env`
and only service `backspace`; it must not start Caddy/ACME or LiveKit. ZAP joins
the isolated Compose network and scans `http://backspace:3000`.

The unauthenticated spider primarily reaches the SPA shell/assets, not
authenticated API, federation, voice or user flows. A historical 2026-09-03 sample
visited 11 URLs and no `/api/` routes; do not present that sample as a fresh
measurement. A healthy container plus an advisory baseline is not an application
security assessment, and HTTP cannot verify deployment-owned HTTPS/HSTS behavior.

`.zap/rules.tsv` keeps rule 10109 (Modern Web Application) ignored because it
describes this coverage limitation, not a vulnerability. Other findings remain
visible. Preserve its three tab-separated columns. ZAP's `-I` keeps findings
advisory; an image/container that cannot become healthy still fails the job.
Full reports remain available regardless of console rule classification.

## Triage and supply-chain safeguards

- Classify findings by actual placement: server image, browser bundle, installed
  desktop app or build-only tooling. Inspect `pnpm -r why <package>` and manifests;
  a tool's name alone does not establish whether it ships.
- Record fixed, deferred or dismissed outcomes with evidence. GitHub alert IDs
  and settings from the upstream repository do not transfer to this fork.
- Keep `paths-ignore` in `.github/codeql/codeql-config.yml` limited to test-only
  TS/TSX paths and server/web test helpers. Tests model attacker behavior; never
  exclude shipped code to silence a finding. Runtime/security assumptions belong
  in [web-security.md](web-security.md) and
  [desktop-security.md](desktop-security.md), not a stale alert-number register.
- `.trivyignore` contains only DS-0002: the entrypoint needs root to initialize
  mounted-data ownership, then execs the app as `node`. A Dockerfile `USER` before
  that initialization would break a fresh mount. Re-verify actual runtime UID when
  changing the image/entrypoint; the static exemption is not proof by itself.
- Keep compatibility patches for `@electron/asar`, `dir-compare` and glob 7 until
  their callers support the safe minimatch/glob APIs. Their packaging regression
  tests, Workbox build and `COPY patches/ patches/` are load-bearing. Do not remove
  patches/overrides merely because the original advisory is old.
- Keep full-SHA Action pins, checksum verification for downloaded actionlint,
  least-privilege job tokens, supported-runner hardening, image SBOM and provenance.
  Build-only jobs must not inherit release-writing tokens. A network-free aggregate
  job need not install runner hardening just to compare dependency results.
- Scorecard is advisory posture analysis. Some justified release-writing scopes
  remain reportable; do not remove them merely to improve a score. A single
  maintainer's zero-human-approval PR policy is not independent human review.

## Dependency update policy

Dependabot covers npm, GitHub Actions and the pinned Dockerfile base. Minor/patch
npm updates and Action updates are grouped; major upgrades are reviewed separately.
The remaining deliberate ignores are Tailwind 3, TypeScript 5, per-package
`@types/node`, the exact-patched `uiohook-napi` and Node-image majors. Their
conditions live in `.github/dependabot.yml`; the Workers-based Vitest deferral no
longer applies. React 19, Fastify 5, tus 2 and Electron 45 are already in use.

Node 24 remains pinned pending a separate, measured next-LTS migration, not because
Node 26's October 2026 transition is still in the future. Do not silently upgrade
runtime/toolchain majors in a cleanup. Check dependency runtime APIs as well as
types; manifests' type versions are not runtime guarantees.

Closing one major-update PR is not a lasting ignore: a changed `from` version can
produce a new PR. Use a justified major-only ignore when deferring a migration;
do not suppress security patches wholesale. Keep the npm PR limit at 10 rather
than raising it to discover the backlog; use `pnpm outdated -r` to inventory.
Compose's Caddy/LiveKit image pins require separate manual review; Dependabot's
Dockerfile ecosystem does not maintain Compose `image:` entries here.

## Maintainer checklist (one-time GitHub settings — NOT code)

The initial fork audit on 2026-11-09 found Pages disabled but two failed legacy
deployments/environment, no effective `master` protection, and native secret
scanning/push protection/security updates disabled. The following is the required
maintained configuration; validate actual API readback rather than inferring it
from this document or from a successful workflow.

| Setting | Required state / verification |
|---------|-------------------------------|
| Public repo / default branch | `bernardokcosta/veyvox`, repository ID 1431316690, public, `master` |
| GitHub Pages | Disabled; no residual `github-pages` deployments/environment |
| Native secrets | Secret scanning and push protection enabled |
| Dependabot | Alerts and automated security updates enabled; updates still use PR checks |
| Actions defaults | `default_workflow_permissions: read`; `can_approve_pull_request_reviews: false` |
| `master` policy | Active branch ruleset; PR required, zero human approvals, conversations resolved, branch up to date |
| Destructive/direct writes | No force-push/deletion/direct push; no bypass actors, including admins |
| Required checks | All six contexts below, bound to the correct GitHub integrations |
| Alert protection | CodeQL tool results required; new high/critical security alerts block merge |

Required contexts are `Build & test`, `Secret scan (gitleaks)`,
`Dependency scan (OSV-Scanner)`, `IaC/config scan (Trivy)` and
`License compliance scan (Trivy)` from GitHub Actions (app 15368), plus `CodeQL`
from GitHub Advanced Security (app 57789). Verify those identities on the actual
PR commit/merge analysis before enforcing them. Do not require a tag-only
publisher or advisory scheduled scan as a PR check.

Read back `/rules/branches/master` plus the full ruleset, repository
`security_and_analysis`, `/actions/permissions/workflow`,
`/vulnerability-alerts` and `/automated-security-fixes`. Check the actual candidate
SHA, check conclusions and CodeQL analysis separately. If a feature/API is
unavailable or a check fails, report the limitation; never use an admin bypass or
weaken protection for the cleanup PR. No independent human approval is required
while there is only one maintainer; that does not mean direct master pushes.

There is no active metrics/CLA store, upstream release-bot writer or Cloudflare
Workers deployment in this fork. Do not provision their old secrets/environments
from historical upstream instructions. Optional provider validity checks and
future image enforcement are separate decisions, not silently enabled here.
