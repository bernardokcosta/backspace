# OSV Dependency Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the new minimatch and glob OSV findings without waivers or breaking desktop packaging.

**Architecture:** Reuse pnpm overrides and version-specific patches, already used by this repository. Upgrade minimatch to ^11.0.3 and glob >=9 to ^14.0.3. Preserve glob 7's callback API, adapting its walkers to Matcher objects and keeping brace alternatives separate through a local Minimatch subclass; adapt the legacy default imports in asar and dir-compare to named exports. The subclass skips only row merging, not inherited parsing or amplification limits.

**Tech Stack:** pnpm 10.34.3, Node 24, TypeScript, Vitest, OSV-Scanner 2.7.0.

**Spec:** `docs/systems/security-scanning.md` (enforcing dependency scan and expiring exception policy).

## Global Constraints

- Do not disable scanners, add ignores, move `v1.15.9`, or change application versions.
- Preserve glob 7 callbacks used by asar and rimraf; glob >=9 consumers already use modern APIs.
- Keep the existing deepmerge exception unchanged.
- No application, protocol, persistence, or desktop bridge changes.
- Use permissively licensed upstream fixes and the existing pnpm patch mechanism.

## Review Focus

- Legacy CommonJS default imports must not become calls to a module object.
- glob 7 must use Matcher.test(), not String.match() or removed RegExp metadata.
- Native payload unpacking and negative packaging filters must still work.
- Dotfiles, braces, recursive patterns, ignores, and callback completion must survive the upgrade.
- Frozen installs, Workbox generation, static serving, and the actual OSV scan must succeed.

### Task 1: Dependency fixes and compatibility regressions

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `.github/workflows/security.yml`, `docs/systems/security-scanning.md`
- Create: version-specific patches under `patches/` for `@electron/asar@3.4.1`, `dir-compare@4.2.0`, and `glob@7.2.3`
- Test: `packages/desktop/src/packagingDependencies.test.ts`

**Interfaces:**
- Consumes: existing pnpm overrides/patchedDependencies; real installed electron-builder dependency graph.
- Produces: patched legacy callers using minimatch's named exports and Matcher.test(), without public API changes.

- [x] Add tests resolving the actual packager dependencies, checking safe minimatch versions, glob callback/sync traversal, asar unpacking, dir-compare filters, and electron-builder inclusion/exclusion.
- [x] Run targeted tests before the fix; verify the vulnerable version guard fails.
- [x] Upgrade overrides, add the three compatibility patches, and regenerate the lockfile with pnpm.
- [x] Replace deprecated OSV `--output` with `--output-file`; document advisories, compatibility decisions, and patch removal conditions.
- [x] Verify targeted tests, frozen installation, build (shared → server → web), desktop/e2e typechecks, lint, and affected suites.
- [x] Run OSV-Scanner 2.7.0 against the real lockfile and unchanged exception configuration; require exit 0. Check pnpm audit for the two fixed advisories.
- [x] Review the full diff externally with `review_final_gpt56`; fix concrete findings and rerun affected checks.

No commit, release, push, deployment, or service restart is part of this plan.

## Validation ledger

- Baseline OSV 2.7.0: exit 1, two advisories affecting six locked package versions. After remediation: exit 0, zero SARIF findings, existing deepmerge exception unchanged.
- Regression tests: vulnerable-version guard failed before the upgrade; a bare override then broke four compatibility tests. The three patches restore those paths; the final targeted suite has seven passing tests including filelist/ejs.
- Frozen install passes, including a fresh production-only workspace containing the same manifest/patch subset as Docker. This is not a Linux container build.
- Production shared → server → web build, Workbox generation, precache-size check, lint, desktop compilation and server e2e typecheck pass.
- Static-file smoke passes in wildcard and pre-enumerated modes. Real electron-builder Windows directory packaging of an isolated fixture passes archive/native-unpack/exclusion checks. This does not validate the full application installer or native SDR payload.
- Server startup with isolated runtime state passes health and built-frontend requests. Vite startup from the web package directory passes HTML, main-module and CSS requests.
- Ruling: rerun broad suites sequentially with four Vitest workers after the concurrent build/lint/test pass exhausted test deadlines. Do not change application logic or raise test timeouts to hide those failures; use isolated runtime directories for the rerun.
- Full sequential rerun passes: server 3,180 tests (290 files), web 3,303 tests (352 files), desktop 560 tests passed / 18 skipped (32 files). No test timeouts were raised.
- Final review found one P2: minimatch's row merging breaks glob 7's explicit-dotfile and `nonull` brace alternatives. Four added sync/callback regressions reproduce it. The local subclass preserves the original rows; an additional test checks the inherited preprocessing amplification cap. This compatibility seam warrants a second review by the same reviewer after affected validations.
- After the review fix: all 12 packaging regressions pass; the full desktop suite passes 565 tests / 18 skipped. Desktop compilation, lint, frozen install, OSV (exit 0) and the real isolated electron-builder packaging smoke pass again. Server/web dependencies and application code are unchanged by this glob-7-only adjustment.
- Second review by the same reviewer approved the complete scope, confirmed the P2 fixed, and independently checked partial alternatives and upstream limits at optimization levels 2/3. No remaining blockers; the previously declared multiplatform/full-installer/container validation limits remain.
