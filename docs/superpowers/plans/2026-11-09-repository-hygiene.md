# Repository Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` for native
> execution, or an explicitly approved subagent-driven workflow, to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved minigames presentation, evidence-based repository/CI
cleanup and non-bypassable PR + CI protection for the public Veyvox repository.

**Architecture:** Reuse existing Node tests, YAML reader, pnpm scripts, reusable
native workflow and GitHub rulesets. Three capability specs feed one coordinated
sequence because repository protection consumes the actual CI check contracts;
there is no new application runtime mechanism.

**Tech Stack:** Node 24, pnpm 10.34.3, `node:test`, existing Vitest workspaces,
GitHub Actions, actionlint 1.7.12, Gitleaks 8.24.3 and GitHub REST APIs.

**Spec:** [Approved design and capability map](../specs/2026-11-09-repository-hygiene-design.md),
including its `readme-presentation`, `repository-ci-hygiene` and `github-governance`
child specs. Design and plan approved 2026-11-09; native execution selected.

## Global Constraints

- Repository: `bernardokcosta/veyvox`; default/protected branch: `master`.
- Work on `chore/repository-hygiene`, based on `25d7a8f41766045ba6e5d211e5a8121f6c9e20df`;
  recheck `origin/master` and preserve user changes before execution.
- Use `minigames` in English and `minijogos` in Portuguese; Juno only as an example.
- Preserve the 25 languages, Juno content/assets/audio, attribution to Jannis Braun
  (TheZwiss) and contributors, AGPL notices and persistent/installed identities.
- Preserve retained 1.16.8/1.17.0 releases/tags/assets. No new release, published-image
  replacement, history rewrite, Pages publication or production/VM operation.
- Build order stays shared → server → web; do not parallelize those builds.
- Reuse existing tools, strict TypeScript with no `any`, SHA-pinned Actions and
  least-privilege permissions. No new package dependency is planned.
- No commits per task: the maintainer requires validation and external review
  before commit/push. Stage explicit paths only at the publication gate.
- Use local ignored `.superpowers/sdd/2026-11-09-repository-hygiene/` for evidence;
  never publish raw scanner material, tokens, operator `.env` or infrastructure data.
- Stop on uncertain/real secrets, unexpected deletion targets or unsupported security
  capability; never relax a check, invent a pass or broaden an exception to continue.

## Review Focus

1. A new match at an ignored historical path/line must still fail Gitleaks in a new
   commit: exercise remove/reintroduce history in Task 4.
2. Flatpak must remain usable after removing its upstream writer: run the SDK CLI,
   pairing negative tests and generated-manifest tests in Tasks 2–3.
3. A skipped, failed or cancelled native/lint/image/build dependency must not make
   the aggregate gate green: exercise the aggregate shell in Task 3.
4. A green check with the wrong integration, stale SHA or missing CodeQL analysis
   must not permit merge: verify exact contexts/apps/SHA/rules in Task 8.
5. Remote state may drift between inspection and mutation: compare target IDs and
   preconditions immediately before each mutation in Tasks 1 and 8.

## File map

| Files | Responsibility / planned action |
|-------|---------------------------------|
| `README.md`, `README.pt-BR.md`, `scripts/veyvox-docs.test.mjs` | Category hierarchy and bilingual regression |
| `.github/workflows/flatpak-release-metadata.yml` | Delete upstream-only writer after consumer verification |
| `flatpak/node-sdk-version.mjs`, `flatpak/node-sdk-version.test.mjs` | Retained references/required generator flag; synthetic fixtures stay useful |
| `flatpak/sources-pairing.mjs`, `flatpak/manifest-pin.mjs`, `flatpak/README.md` | Accurate diagnostics/comments/local-build documentation; preserve pairing logic |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.github/dependabot.yml` | Shared tooling test command and proven obsolete Workers residue only |
| `.github/workflows/ci.yml`, `.github/workflows/native-sdr-capture.yml` | All tooling tests, pairing/SDK checks, complete actionlint and no duplicate push trigger |
| `scripts/repository-ci.test.mjs` (new) | Structural CI/workspace/retained-tooling contracts using existing YAML reader |
| `.gitleaksignore` (new), `.github/workflows/security.yml` | Exact verified historical fingerprints and version-aligned regression gate |
| `scripts/gitleaks-policy.test.mjs`, `scripts/verify-gitleaks-policy.mjs` (new) | Ignore-policy syntax/provenance contracts and real-scanner isolated history test |
| `docs/systems/security-scanning.md`, `docs/systems/desktop.md` | Current enforcement, debts and actual release/packaging process |
| `.github/workflows/docker-publish.yml`, `.github/workflows/scorecard.yml` | Correct stale explanatory comments only; preserve operational policy |
| `.superpowers/sdd/2026-11-09-repository-hygiene/` (ignored, new) | Baselines, safe triage, request/readback JSON, validation and mutation ledger |

Any additional deletion needs a recorded obsolete purpose and consumer check.
Do not modify application, catalogs, generated brand assets, Compose identities,
Docker base pins or the historical Flatpak manifest/offline-source pair.

---

### Task 1: Establish a safe inventory and mutation baseline

**Files:** Create ignored `before/`, `operations.jsonl`, `tracked-inventory.json`
and `preserved-files.sha256.json` beneath the evidence directory.
**Interfaces:** Produces sanitized before-state and allowlisted deletion targets
for Tasks 2/8, plus protected-file hashes for Task 7. No remote mutation.

- [x] Run `git status --short --branch`, `git fetch origin master` and
  `git diff --name-status origin/master`; confirm the expected spec/plan files are
  the only pending work and the baseline has not drifted without assessment.
- [x] Save read-only API snapshots: repository metadata/security settings, effective
  `master` rules/classic protection/rulesets, Actions token permissions, environments,
  deployments/statuses, releases/asset IDs/sizes/digests, and retained tag refs.
  Use `gh api` against `repos/bernardokcosta/veyvox/...`; record 404 versus permission
  failure explicitly, paginate lists, and never enable a setting in this step.
- [x] Inventory every tracked path with `git ls-files -z`. Classify suspected
  obsolete artifacts and trace consumers with `git grep -n`; record retain/remove
  decisions. Hash existing catalogs, Juno asset/audio paths, brand assets, legal
  files, package runtime identities and the committed Flatpak manifest/source pair.
- [x] Verify baseline fixtures/assertions reject an unexpected deployment ID,
  environment ID or retained release/tag set. Require repository ID `1431316690`,
  only targeted Pages deployments `7291467320`/`7288768799`, environment ID
  `25173012070`, and release/tag set `v1.16.8`, `v1.17.0` before later deletions.

### Task 2: Correct the READMEs and retire only the upstream Flatpak writer

**Files:** Both READMEs, `scripts/veyvox-docs.test.mjs`, the Flatpak files from the
file map; delete only `.github/workflows/flatpak-release-metadata.yml`.
**Interfaces:** Consumes Task 1 consumer inventory; produces retained local Flatpak
CLI contracts and bilingual presentation for the CI test command in Task 3.

- [x] Add a documentation test asserting each hero ends in its localized minigames
  category, contains no `Juno`, and the feature list contains Juno under
  `**Minigames and soundboard:**` / `**Minijogos e soundboard:**`. Reject Juno in
  headings or bold feature labels; retain all existing attribution/link/icon tests.

  ```js
  test('presents Juno only as a minigame example', () => {
    for (const [file, category, label] of [
      ['README.md', 'minigames', 'Minigames and soundboard'],
      ['README.pt-BR.md', 'minijogos', 'Minijogos e soundboard'],
    ]) {
      const text = read(file);
      const hero = text.slice(0, text.indexOf('</div>'));
      assert.match(hero, new RegExp(` · ${category}\\r?$`, 'm'));
      assert.doesNotMatch(hero, /\bJuno\b/);
      assert.match(text, new RegExp(`^- \\*\\*${label}:\\*\\*[^\\n]*\\bJuno\\b`, 'm'));
      assert.doesNotMatch(text, /^#{1,6}[^\n]*\bJuno\b|^- \*\*[^*\n]*\bJuno\b/im);
    }
  });
  ```

- [x] Run `node --test scripts/veyvox-docs.test.mjs`; expect the new hierarchy test
  to fail on both current READMEs before changing copy.
- [x] Change only the tagline/feature copy: use Juno as one example, preserve
  soundboard capability, and inspect equivalent English/Portuguese rendering.
- [x] Extend `flatpak/node-sdk-version.test.mjs`: every `REFERENCING_FILES` path
  exists; retained generator references still fail on a missing flag or wrong
  runtime/extension. Run `node --test flatpak/*.test.mjs` as a baseline, then make
  the smallest change that removes the upstream workflow from real references
  and requires the README's generator command instead. Keep parser negative tests
  with clearly synthetic workflow paths; do not delete them as obsolete files.
- [x] Delete the upstream writer only after its consumers are reconciled. Correct
  `flatpak/sources-pairing.mjs` / `flatpak/manifest-pin.mjs` comments and diagnostics
  that imply an active automatic release writer; keep `checkSourcesPairing` and
  `readManifestPin` signatures/behavior. Rewrite the Flatpak guide for local builds,
  historical source pairing, and actual checks, without claiming two-arch CI builds.
- [x] Run `node --test scripts/veyvox-docs.test.mjs flatpak/*.test.mjs` and
  `node flatpak/node-sdk-version.mjs`; expect all pass, including changed-sources /
  unchanged-pin rejection. Confirm the protected Flatpak pair is byte-identical.

### Task 3: Close CI coverage gaps without losing native or release validation

**Files:** `scripts/repository-ci.test.mjs` (new), `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `.github/dependabot.yml`, `ci.yml`, `native-sdr-capture.yml`.
**Interfaces:** Consumes Task 2 CLIs. Produces `pnpm test:tooling`, retained stable
gate/scanner names and reusable native callers required by Task 8.

- [x] Add Node contracts using `readBuildYaml(text)` from
  `scripts/desktop-release-assets.mjs` (no YAML dependency). Assert `test:tooling`
  covers `scripts/*.test.mjs`, `flatpak/*.test.mjs` and
  `packages/desktop/scripts/*.test.mjs`; CI invokes it and the SDK/pairing checks;
  the native workflow has `workflow_call` + `workflow_dispatch`, no direct `push`,
  and still has both Windows architectures and build/load/package checks.
  Test names: `all tooling suites feed the required gate` and
  `native validation keeps callers without duplicate push runs`. Core assertions
  after parsing the named files into `pkg`, `ci` and `native`:

  ```js
  assert.equal(pkg.scripts['test:tooling'],
    'node --test "scripts/*.test.mjs" "flatpak/*.test.mjs" "packages/desktop/scripts/*.test.mjs"');
  assert.equal(ci.jobs['build-and-test-required'].if, 'always()');
  assert.deepEqual(ci.jobs['build-and-test-required'].needs,
    ['build-and-test', 'build-image', 'lint', 'native-sdr']);
  assert.deepEqual(Object.keys(native.on).sort(), ['workflow_call', 'workflow_dispatch']);
  ```

- [x] Assert the aggregate retains `if: always()` and needs build/test, image,
  lint and native jobs. In a Linux/Bash validation fixture, substitute controlled
  `needs.<job>.result` values into its existing shell: all `success` exits 0;
  each job independently set to `failure`, `cancelled` or `skipped` exits nonzero.
  Also assert both CI and tag-release callers still reference the reusable workflow.
- [x] Run `node --test scripts/repository-ci.test.mjs`; expect failures for current
  missing tooling coverage, limited actionlint and duplicate native push trigger.
- [x] Add root `test:tooling` using `node --test` with the three quoted glob patterns;
  replace the explicit CI Node-test list with `pnpm test:tooling`, retaining
  `pnpm -r test`. Add `node flatpak/node-sdk-version.mjs`. For PRs, run
  `node flatpak/sources-pairing.mjs "$BASE_SHA" "$HEAD_SHA"` using PR base/head SHAs
  passed through env and checkout `fetch-depth: 0`; never interpolate user text
  into shell commands. Keep existing build/e2e/desktop/lint/image steps and gate.
- [x] Remove only `on.push` from the native reusable workflow and change its pinned,
  checksum-verified actionlint invocation to `actionlint -oneline` over all retained
  workflows. Update obsolete CI comments; do not alter native tests, artifacts,
  architecture matrix, concurrency safety or the release caller.
- [x] Prove Workers have no active importer/consumer with
  `pnpm -r why @cloudflare/vitest-pool-workers` and tracked references. Remove only
  `@cloudflare/vitest-pool-workers>zod`, its lockfile override, the obsolete Vitest
  major-ignore block and the misleading workspace tooling comment. Correct retained
  Node-types/LTS comments against actual manifests without changing their ranges
  or doing a Node major upgrade in this cleanup. Run
  `pnpm install --lockfile-only` then `pnpm install --frozen-lockfile`; investigate
  any dependency graph churn instead of refreshing compatibility-test hashes.
- [x] Run `pnpm test:tooling`, the Bash gate truth table and `actionlint -oneline`;
  expect complete suite discovery, all gate cases correct and zero syntax errors.
  Existing brand tests must retain their dependency-graph/identity hashes.

### Task 4: Resolve historical Gitleaks noise with commit-specific evidence

**Files:** New `.gitleaksignore`, `scripts/gitleaks-policy.test.mjs`,
`scripts/verify-gitleaks-policy.mjs`; modify `.github/workflows/security.yml`.
Create ignored `gitleaks-triage.json` and redacted scanner results.
**Interfaces:** Produces exact historical exceptions and CLI
`node scripts/verify-gitleaks-policy.mjs --binary gitleaks` (0 only on all expected
scanner outcomes). Does not change `Secret scan (gitleaks)` context identity.

- [x] Reconstruct all 16 run fingerprints from the redacted log and historical
  blobs. Classify each as comment/example/test fixture with safe rationale and
  commit/path/rule/line; do not print token contents. Stop on any uncertain entry.
- [x] Add policy tests: entries are unique four-part fingerprints with a 40-hex
  commit, historical path, `generic-api-key`, positive line and preceding rationale.
  Check historical existence with `git cat-file -e <commit>:<path>`, not current
  file existence or printed source. Reject global/path wildcards or broad
  `.gitleaks.toml` exclusion. Expect failure before adding the 16 verified entries.
  Test name: `historical exceptions use unique commit-specific fingerprints`. Parse nonempty,
  non-comment lines as `entries`; the syntax/count assertions are:

  ```js
  assert.equal(entries.length, 16);
  assert.equal(new Set(entries).size, 16);
  for (const entry of entries) {
    assert.match(entry, /^[0-9a-f]{40}:[^:*]+:generic-api-key:[1-9]\d*$/);
  }
  ```

- [x] Implement the real-scanner regression CLI with only built-in Node modules.
  Create a temporary Git repo under the approved temp root; generate a synthetic
  high-entropy generic API key, commit it, and require redacted detection exit 2.
  Extract that report's exact fingerprint, allow only it, and require exit 0.
  Remove/reintroduce the same fixture at the same path/line in later commits and
  require exit 2 with the new commit fingerprint. Distinguish scanner errors from
  detections, never log values, and clean only the temporary repo it created.
- [x] Pin existing Gitleaks to `GITLEAKS_VERSION: 8.24.3`, matching the audited
  action/default behavior; preserve full-history checkout and the action SHA.
  Use the existing pinned Node setup for Node 24 in this job and run the regression
  CLI after the action installs `gitleaks` on PATH. Policy-format tests also run
  in `test:tooling` without requiring a scanner binary.
- [x] Run `node --test scripts/gitleaks-policy.test.mjs`, the regression CLI and a
  redacted full-history scan with Gitleaks 8.24.3. Since actual changes must remain
  uncommitted before review, materialize the explicit candidate file manifest in
  a temporary local clone and commit there only, including approved new files and
  deletions; never copy operator/ignored state or alter source-repository refs.
  Scan that complete candidate history, not just the source repo's old HEAD.
  Expect validated policy, the 2→0→2 synthetic sequence and no untriaged findings.
  Store safe metadata only; real findings block rather than justify more ignores.

### Task 5: Reconcile image-scan debt and current operational documentation

**Files:** `docs/systems/security-scanning.md`, `docs/systems/desktop.md`, relevant
Flatpak guide updates, comment-only changes in `docker-publish.yml`/`scorecard.yml`.
Create ignored `image-triage.json` and a safe current debt table in security docs.
**Interfaces:** Consumes source/workflow state from Tasks 2–4 and SARIF analysis
`2126525016`; produces truthful operator docs and dated follow-up, not a new gate.

- [x] Parse every SARIF result from the audited published image, recording advisory,
  package, installed/fixed version, severity, report provenance and follow-up.
  Verify exactly 25 results are classified, including duplicates across packages;
  distinguish report facts from unverified reachability/exploitability claims.
- [x] Replace current Fastify-4/13-OSV/Workers/two-Node-leg claims with measured
  present state. Keep historical measurements only when clearly dated. Describe
  the single expiring deepmerge exception and actual enforcing scanner exit rules.
- [x] Correct the desktop release section against `release.yml` and current scripts:
  no active upstream Flatpak writer, actual build-only matrices/installed acceptance/
  single publication gate, Veyvox asset names and retained update identities.
  Do not change release code or signing/fuse/profile policy.
- [x] Update obsolete scanner/Scorecard comments only. Preserve report-only image
  scanning, SARIF upload, SBOM/provenance, publisher triggers and GHCR identity.
  Document a separate base-image remediation proposal: measure current pins,
  evaluate fixed packages, rebuild/test, then seek release/deploy authorization.
- [x] Reconcile each current workflow/exception/settings statement against source
  or dated API evidence. Mark governance settings pending until Task 8 readback;
  do not claim they were applied during this documentation task.

### Task 6: Prepare Pages/security settings and offline ruleset validation

**Files:** Ignored `ruleset-request.json`, `verify-governance.mjs`,
`verify-governance.test.mjs` and `operations.jsonl`. Update security docs with
actual pre-publication operations only. No new tracked governance framework.
**Interfaces:** Consumes Task 1 snapshots and Task 3 check names. Produces offline
validated desired policy and live Pages/security readback; activation waits for
the candidate PR in Task 8.

- [x] Write offline tests for `verifyGovernance(before, after, expectedChecks)` in
  the ignored verifier: reject wrong repository/ref/environment/deployment IDs,
  extra bypass actors, wrong app IDs, missing checks, approvals >0, absent CodeQL
  rule, changed retained tags/assets or unsafe Actions token settings.
- [x] Prepare one `active` branch ruleset named `Protect master — PR and CI`,
  scoped only to `refs/heads/master`, `bypass_actors: []`. Include `deletion`,
  `non_fast_forward`, `pull_request` (approval count 0, no code-owner/last-push
  approval, thread resolution true), and `required_status_checks` (strict true).
  Include `code_scanning` for tool `CodeQL`, `alerts_threshold: none` and
  `security_alerts_threshold: high_or_higher`. Preserve enabled merge methods.
  Match status `context` and `integration_id` to the six identities in the spec;
  run offline tests and validate request fields against the official schema.
- [x] Immediately re-read targets. Mark only the two approved Pages deployments
  inactive if necessary, then delete each with
  `DELETE /repos/bernardokcosta/veyvox/deployments/{id}`; delete only environment
  `github-pages` after confirming its ID. Log each response and post-readback;
  stop if state differs unexpectedly. Do not delete Actions runs or create a site.
- [x] Enable `security_and_analysis.secret_scanning.status` and
  `secret_scanning_push_protection.status` via the repository PATCH API. Ensure
  Dependabot alerts through `PUT .../vulnerability-alerts` if needed, and enable
  security updates with `PUT .../automated-security-fixes`. Read back all settings;
  preserve Actions default `read` and review-approval `false`. Record unsupported
  capabilities as blockers; do not enable unrelated provider validity checks.
- [x] Run verifier tests and verify Pages remains disabled/404, targeted objects are
  absent, retained artifacts unchanged and all three native security features on.
  Save the payload without applying the master ruleset yet.

### Task 7: Complete local validation, external review and publish the branch

**Files:** Entire implementation diff including specs/plan, new tests, ignored
operational scripts, remote snapshot/readback and validation evidence.
**Interfaces:** Produces reviewed candidate commit and PR for final policy binding.

- [ ] Run the complete approved command set: `pnpm install --frozen-lockfile`,
  `pnpm test:tooling`, `pnpm build`,
  `pnpm --filter @veyvox/server typecheck:e2e`,
  `pnpm --filter @veyvox/desktop build:ts`, `pnpm -r test`, `pnpm lint`,
  `actionlint -oneline`, scanner regressions/full-history scan and `git diff --check`.
  For new/untracked files also check content/whitespace directly. Do not change
  suppressions except via `pnpm lint:prune` for an actually removed violation.
- [ ] Start both dev servers with isolated synthetic configuration/temp database
  and explicit non-production URLs; do not read operator `.env` or touch existing
  `data/`. Verify local responses and clean startup, then stop only owned processes.
  Render both READMEs and capture the minigames hierarchy; preserve screenshot paths.
- [ ] Compare protected-file hashes and the retained release/tag/asset inventory.
  Mark local Docker/native validation unavailable where necessary; require their
  actual candidate CI checks before integration, not a substituted local pass.
- [ ] Request `review_final_gpt56` once for the complete local/remote scope, including
  all new/ignored files and evidence paths. Fix concrete findings and rerun affected
  validation. No commit/push while a relevant blocker or review failure remains.
- [ ] Stage only explicitly reviewed tracked files; inspect `git diff --cached`.
  Commit, then push explicitly to `origin chore/repository-hygiene` (never default
  push to its initial `origin/master` upstream). Open a PR with base `master`,
  validation summary, scan debt, deletions and no release/deploy claims.

### Task 8: Bind live checks, activate protection and hand back the PR

**Files:** Ignored candidate check evidence, desired/readback ruleset JSON and
final verification report; tracked security docs only if a factual correction is
needed. Any further tracked change must be validated and externally reviewed
before its follow-up commit/push; never declare an earlier PR SHA final afterward.
**Interfaces:** Consumes the reviewed PR SHA and offline policy from Task 6;
produces effective non-bypassable master protection and a verifiable merge decision.

- [ ] Query candidate PR/head SHA, check runs and actual merge-ref analyses, not
  unrelated master/scheduled runs. Require `Build & test` and four enforcing
  scanner contexts from app `15368`, plus `CodeQL` from app `57789`. Verify each
  expected context actually appears on this candidate and completes successfully.
- [ ] Re-read current protections; if unexpected rules appeared, stop and reconcile
  rather than overwrite. Activate the offline-validated ruleset through
  `POST /repos/bernardokcosta/veyvox/rulesets`; save returned ID and full readback.
  Verify effective branch rules, zero bypasses, PR/thread/strict-check requirements,
  exact contexts/integrations and CodeQL thresholds. Never enable an `update`
  restriction that would block all legitimate merges when there are no bypasses.
- [ ] Verify CodeQL analysis completion and alert-based protection separately.
  Use candidate analyses/results and the active rule; do not plant a vulnerability
  in `master` or dismiss an alert to test it. If blocked, report the exact unresolved
  analysis/alert/policy problem. Do not use `--admin`, force push or disable rules.
- [ ] Re-run read-only release/tag/assets/Pages/security/Actions checks and save
  before/after comparison. Validate the final candidate remains current with master
  and its build/lint/image/native/security checks passed; rerun after any update.
- [ ] The newly activated ruleset is material security scope added after the first
  review: request one justified second review from the SAME `review_final_gpt56`
  reviewer over full diff, PR SHA, remote mutations/readback, evidence and any
  factual documentation updates still pending. After approval, commit/push those
  updates if needed and repeat all affected local checks and candidate CI/readback
  on the final SHA. No other final reviewer and no endless review loop; report
  any remaining limitation instead of exceeding the review budget or bypassing it.
- [ ] Hand back the PR URL, check results, effective protection and outstanding image
  debt. Do not auto-merge: ask the maintainer for final integration approval; any
  later merge must use the passing protected PR, never direct master push. Do not
  create a release, publish/rebuild an image or deploy production.

## Documentation sources and self-review

- GitHub REST API [official schema](https://github.com/github/rest-api-description/blob/main/descriptions/api.github.com/api.github.com.json)
  and [ruleset rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets):
  checked read-only while planning; verify API capability again before mutations.
- Gitleaks [8.24.3 fingerprint implementation](https://github.com/gitleaks/gitleaks/blob/v8.24.3/detect/detect.go)
  and pinned [action installer](https://github.com/gitleaks/gitleaks-action/blob/e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e/src/gitleaks.js):
  commit-specific ignores and binary added to PATH confirmed. Context7 quota was
  unavailable; no claim of remote settings validation is made by writing this plan.
- Coverage: README criteria → Task 2; deletion/Flatpak → Tasks 1–3; test/native
  contracts → Task 3; Gitleaks → Task 4; all 25 image results/current docs → Task 5;
  Pages/native security → Task 6; validation/publication → Task 7; protection and
  actual merge checks → Task 8. Review Focus conditions are assigned above.
- Execution authorized in-session; task evidence is recorded in the ignored
  `.superpowers/sdd/2026-11-09-repository-hygiene/progress.md`. Final integration
  still requires the maintainer's approval of the protected, passing PR.
