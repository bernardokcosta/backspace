# Dependency Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate PR16/24/19 compatibly (PR24 superseded PR18), remove deepmerge and its waiver, retain effective security checks.

**Architecture:** Preserve upstream commit ancestry in an isolated integration branch. Reuse versioned pnpm patches and selective dependency removal: the resolver only needs a native clone of its private data-only defaults. Correct historical snapshot tests rather than freezing valid dependency updates.

**Tech Stack:** Node24, pnpm10.34.3, existing TypeScript/Vitest5/node:test, jsdom31, Workbox7/Rollup4.

**Spec:** `docs/superpowers/specs/2026-11-10-dependency-security.md`

## Global Constraints

- User approved inline execution, commits, push and protected merge; no production deploy/restart, image/tag/release publication or governance change.
- Root Node engines: `^22.22.2 || ^24.15.0 || >=26.0.0`; `.nvmrc`, CI and Docker stay on24. No new dependency or generic merge helper.
- Preserve author commits, existing packaging patches, scanner gates, service/storage identity and app version1.17.1. Build shared→server→web sequentially.
- Use patch tool for source changes and pnpm for lockfile generation. Never edit dependency-store files directly or manually splice resolutions.

## Review Focus

- Resolver CJS and ESM must both load after removing the dependency; actual installed-module tests in Task2.
- Exported DEFAULTS arrays must remain deeply frozen and isolated from mutable instance options; test Task2.
- Updated lockfile must preserve workspace links without freezing third-party versions; structural assertions Task3.
- Amplification rejection must be specifically the intended bound, while ordinary packaging still succeeds; Task3 tests.
- Node22/24 lower supported boundaries must match jsdom31, without accidentally advertising unsupported Node24.0 or Node23; Task3 manifest/range assertions.

## File map

- Upstream: `Dockerfile`, `packages/{server,web,desktop}/package.json`, `pnpm-lock.yaml`.
- Root `package.json`: engines, exact-parent dependency removal, patchedDependencies.
- New `patches/@rollup__plugin-node-resolve@16.0.3.patch`: only remove deepmerge imports and clone private defaults with structuredClone in installed CJS/ESM; metadata as needed.
- New `scripts/build-dependency-security.test.mjs`: real installed resolver paths through existing Workbox dependency, exports/freeze/isolation/graph and Node engine contract.
- Modify `scripts/veyvox-brand.test.mjs`: workspace lock/importer structural assertions instead of full third-party fingerprint.
- Modify `packages/desktop/src/packagingDependencies.test.ts`: assert minimatch11.0.5 RangeError for the bounded adversarial case and retain benign glob/asar cases.
- Modify `osv-scanner.toml`, `docs/systems/{security-scanning,deployment,desktop}.md`, `AGENTS.md` and setup docs where Node minimum is stated.

### Task1: Preserve upgrade ancestry and reproduce failures

**Interfaces:** merge commits carry original PR heads into final master; lockfile is always regenerated from merged manifests.

- [x] Fetch and record current PR16/24/19 head SHAs; merge each normally with no force/rebase. If lockfile conflicts, regenerate through `pnpm install --lockfile-only`, then stage the generated resolution. Commit only merge resolutions, not unrelated dirty fixes.
- [x] Install frozen dependencies in this worktree; run `node --test scripts/veyvox-brand.test.mjs` and focused desktop packaging tests. Expect the historical lock fingerprint and minimatch amplification assumptions to fail as observed in CI.
- [x] Confirm actual installed resolver still depends on deepmerge before applying the removal.

### Task2: Remove the unnecessary vulnerable dependency

**Interfaces:** installed `nodeResolve(options)` behavior/exported DEFAULTS stay unchanged; no new application API. Test resolution uses createRequire rooted at web→vite-plugin-pwa→workbox-build, not a new direct dependency.

- [x] Add tests for no deepmerge in lockfile/parent dependency graph; actual CJS and ESM node-resolve exports; expected seven defaults, frozen nested arrays, usable independent resolver instances and unchanged mutable custom option arrays. Run focused node:test and observe RED.
- [x] Add a versioned pnpm patch replacing only `deepMerge({}, defaults)` with `structuredClone(defaults)` and deleting imports; remove exact parent edge via existing `-` override. Generate/apply the patch using pnpm tooling; retain integrity hashes and upstream license.
- [x] Regenerate/install lockfile and rerun tests; require GREEN for both module formats and `pnpm -r why deepmerge` empty. Remove the CVE waiver and update its exact removal rationale in security docs only after absence is verified.

### Task3: Make upgrade checks semantic and Node support honest

**Interfaces:** root engines match jsdom's exact supported ranges; actual current24.x setup remains selected by `.nvmrc`. Existing readBuildYaml parses importer metadata.

- [x] Replace the obsolete lock graph hash with assertions for all `@veyvox/*` workspace names, server/web `@veyvox/shared` workspace specifier/link, no legacy workspace aliases and retained fixed build order. Desktop has no shared dependency. Keep unrelated Compose snapshot checks.
- [x] Change the adversarial minimatch test to require the known RangeError/too-many-patterns safeguard; retain ordinary sync/callback/asar/dir-compare assertions. No broad catch or lowered limit.
- [x] Set the Node engine range above, update setup/AGENTS references and correct stale image Node-version comments using the actually pinned image metadata. Add range boundary assertions with existing tooling support, not a new semver dependency.
- [x] Run focused security/brand/packaging tests, all tooling tests, sequential build, root typecheck/i18n, server e2e and desktop TS checks, lint and all workspace tests. Record unavailable local container/hardware checks; combined GitHub CI remains mandatory.
- [x] Leave final fix/spec/test commit to the whole-change external-review gate in the GitHub integration plan; local ancestry merge commits are allowed setup records.

## Self-review

Each Review Focus edge has a test task. No generic merging semantics are replaced: only an inaccessible constant clone uses structuredClone. Runtime APIs, app version and release/deployment boundaries are unchanged.
