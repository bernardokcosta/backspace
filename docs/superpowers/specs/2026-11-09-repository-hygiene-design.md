# Design: evidence-based repository hygiene

Status: design and execution plan approved by the maintainer on 2026-11-09;
native execution in progress.
Baseline: `origin/master` at `25d7a8f41766045ba6e5d211e5a8121f6c9e20df`.
Repository: `bernardokcosta/veyvox` (public; default branch `master`).

## Objective and agreed assumptions

Present minigames as a category, remove demonstrably obsolete repository and
GitHub Pages residue, make CI coverage and security documentation accurate, and
protect the public repository without requiring a second human maintainer.

The maintainer chose conservative, evidence-based cleanup and **PR + CI**:
administrators must also use PRs, pass checks and resolve conversations, but no
independent human approval is required while there is only one maintainer.
This is maintenance, not a redesign of the application or release process.

## Capability map and boundaries

The three fronts were presented together and accepted with the PR + CI choice.
Each has independent acceptance criteria; GitHub enforcement depends on stable
CI check contracts. They share this maintenance design, not new runtime modules.

| Id | Responsibility | Depends on |
|----|----------------|------------|
| [`readme-presentation`](2026-11-09-readme-presentation.md) | Equivalent English/Portuguese minigames presentation | — |
| [`repository-ci-hygiene`](2026-11-09-repository-ci-hygiene.md) | Proven dead residue, test coverage, scan triage and current documentation | — |
| [`github-governance`](2026-11-09-github-governance.md) | Pages residue and public-repository security/protection settings | CI check contracts from `repository-ci-hygiene` |

Order: presentation and CI hygiene, then verify/enforce GitHub settings against
the actual PR checks. Snapshot remote settings before any remote mutation.

## Approaches and tradeoffs

- **Selected: cleanup by evidence.** Trace consumers before deletion, reuse
  existing jobs/tools, preserve useful optional tooling and record security debt.
  More investigation than bulk deletion, but preserves compatibility and coverage.
- A README/Pages-only pass would leave the CI and governance problems untouched;
  it does not satisfy the requested general cleanup.
- A broad rewrite or deletion of everything old would risk installations,
  optional packaging and useful tests; it is outside the selected approach.

## Current evidence (2026-11-09; recheck before changes)

- Both READMEs put Juno in the top feature line and give it its own feature entry.
- Pages is already disabled: `has_pages: false`, and its site endpoint returns
  404. Two failed `github-pages` deployments remain: `7291467320` and `7288768799`,
  plus environment `github-pages` (`25173012070`). No active Pages workflow exists.
- `master` has no protection or applicable ruleset. Native secret scanning,
  push protection and Dependabot security updates are disabled. Actions already
  defaults to read-only tokens and cannot approve PRs; preserve those settings.
- The Flatpak release-metadata workflow is guarded for `TheZwiss/backspace` only.
  Local Flatpak generation/build tooling is still useful and must be preserved.
- Native SDR validation runs both directly on selected pushes and through CI or
  release callers. CI lists script tests explicitly but omits the Flatpak suite;
  actionlint currently validates only three workflows.
- A Workers-specific override and Dependabot justification remain after removal
  of the upstream Workers workspace. Their actual consumers need verification.
- Scheduled Gitleaks run `42632232304` reports 16 historical `generic-api-key`
  matches in comments, documentation examples and federation fixtures. Inspection
  suggests false positives; classification of every match is still required.
- The published 1.17.0 image SARIF (analysis `2126525016`) contains 25 results,
  including fixable Debian packages. No open GitHub alert is not proof of a clean
  image. The existing Fastify 4-based justification is outdated.

## Requirements and acceptance

Each linked capability spec defines its independently testable requirements and
inherits the shared commands, style and boundaries below. This initiative is
complete only when all three are satisfied; the capability map is the index.

## Structure, commands and style

Keep the TypeScript/pnpm monorepo and existing pinned Actions. Primary files are
the two READMEs, `.github/workflows/`, `.github/dependabot.yml`, root pnpm
configuration, `scripts/`, `flatpak/` and affected `docs/systems/` guides. Extend
existing `node:test` contracts rather than creating a parallel test framework.
For example, match the existing documentation-test style:

```js
test('presents minigames as a category', () => {
  assert.match(read('README.md'), /minigames/i);
});
```

The implementation must also test placement/prominence, not only word presence.
Use strict TypeScript with no `any`, existing formatting, SHA-pinned Actions and
least-privilege job permissions. No new dependency is expected.

Principal validation commands (Node 24, pnpm 10.34.3):

```sh
pnpm install --frozen-lockfile
node --test scripts/*.test.mjs flatpak/*.test.mjs packages/desktop/scripts/*.test.mjs
pnpm build
pnpm --filter @veyvox/server typecheck:e2e
pnpm --filter @veyvox/desktop build:ts
pnpm -r test
pnpm lint
actionlint -oneline
git diff --check
pnpm dev:server
pnpm dev:web
```

Build order stays shared → server → web; do not parallelize those builds. Check
that both dev servers start cleanly, then stop only processes started for this
validation. Run scanner-specific regression checks and readback checks as well.
Remote CI must cover platform-dependent native builds and the actual Docker
build when they cannot be executed locally; distinguish pending from passed.

## Delivery boundaries and remaining decisions

- Always: preserve installation/profile/update identifiers, persistent data,
  retained 1.16.8/1.17.0 releases/tags/assets, credits, useful tests and security
  enforcement. Record deletions and their consumer checks; review the full diff.
- Ask first: runtime/architecture/schema changes, new dependencies, genuine secret
  remediation beyond this scope, expanded deletions, new releases or deployments.
- Never: mask real leaks, disable useful checks to get green, publish Pages,
  rewrite history, replace immutable 1.17.0 assets, touch the production VM or
  claim the image is vulnerability-free based on an empty alert list.
- The implementer chooses the smallest existing CI/test mechanisms and supported
  GitHub protection API that satisfy this contract; these are proposals, not
  additional maintainer requirements.
- No unresolved product-policy question. Unknown consumers, scanner classifications
  and API capability limits are technical checks, not permission to expand scope.
- After design approval, write the implementation plan before code/remote changes.
  Finish validation and the required external final review before commit/push;
  open a PR and integrate only under the approved protections and passing checks.
  A limitation must be reported rather than bypassed or silently deferred.
