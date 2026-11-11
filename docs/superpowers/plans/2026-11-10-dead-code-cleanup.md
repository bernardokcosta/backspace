# Dead-Code Cleanup Implementation Plan

> **For agentic workers:** Use `executing-plans` for native execution, or the
> explicitly selected subagent-driven workflow. Track checkbox steps task by task.

**Goal:** Delete proven unreachable remnants and enforce complete retirement in
source, schema and clean production artifacts without losing local functionality.

**Architecture:** Consume the exact P1 inventory after Core and Client. Reuse the
existing node:test tooling gate, Drizzle generator and package manager; no new
dependency-analysis framework, application feature flag or compatibility stub.

**Tech Stack:** Existing TypeScript, node:test, pnpm 10.34.3, Drizzle Kit 0.31.11.

**Spec:** [Cleanup](../specs/2026-11-10-dead-code-cleanup.md);
[orchestration/global constraints](2026-11-10-standalone-security.md).

## Global Constraints

- Preserve Node `^22.22.2 || ^24.15.0 || >=26.0.0`, build order and no new dependency.
- Remove only proven unused consumers/fields/dependencies; native settings,
  `installed_at`, worker IDs, diagnostics, media, licenses/source offer stay.
- Never hand-edit lock snapshots/generated SQL/suppressions to hide new failures.
- Keep six installed-upgrade legs, image/native capture/security gates and pinned
  v1.17.0 baseline; no release or historical artifact mutation.
- No production, commit/push/merge or broad deletion of build/runtime/user paths.

## Review Focus

1. A deleted TS file's stale emitted JS must not ship (D2).
2. A wildcard exception must not hide a reintroduced worker/endpoint (D2).
3. Mixed regression suites keep native assertions instead of disappearing (D1–D2).
4. A still-used override/patch must survive lockfile pruning and Docker COPY (D3).
5. An inert-column table rebuild must preserve native settings and old upgrades (D1).

---

## File map

- Modify `packages/server/src/db/schema.ts`, generate
  `drizzle/0050_standalone_cleanup.sql`, `meta/0050_snapshot.json`, `_journal.json`.
- Modify `packages/server/src/db/standaloneUpgrade.test.ts` and retained
  `packages/server/src/routes/spaces.retirement.test.ts`,
  `packages/server/src/ws/readyPayload.retirement.test.ts`,
  `packages/server/test/discovery-retirement-e2e.test.ts`
  where existing tests pinned obsolete-column preservation.
- Create `scripts/check-standalone.mjs`, `scripts/check-standalone.test.mjs`;
  consume `docs/superpowers/reports/2026-11-10-standalone-inventory.json`.
- Modify manifests/`pnpm-lock.yaml` only for proven unreferenced entries; preserve
  required patches and Docker copies. Root package description loses federation.
- Update `AGENTS.md`, `README.md`, `.env.example`, `Dockerfile`, current
  `docs/systems/` and `.github/workflows/ci.yml` comments/commands where needed;
  delete active federation guides or replace them with concise retirement notices.

### Task D1: Generate removal of confirmed inert persistence mappings

**Interfaces:** Reuse Core `readMigrationState`/`runMigrations`; no extra runner or
backfill. The cleanup migration is ordinary generated SQL after the Core boundary.

- [ ] Search every exact mapping and SQL column below; record remaining consumers
  as production/test/history in P1. Do not remove `installedAt` or `workerId`:
  `users.{lastActiveDay,lastClient}`, `spaces.directoryListed`,
  `instance_settings.{telemetryEnabled,telemetryId,telemetryLastDay,
  telemetryLastError,telemetryDeclinedVersion,discoveryEnabled,directoryEnabled,
  directoryDirty,directoryLastPingAt,directoryLastError,directoryBrowseEnabled,
  supportCardEnabled}`. Classify `dm_members.closed_changed_at`,
  `dm_channels.metadata_updated_at`, `dm_messages.encryption_version` from actual
  remaining consumers; remove only if no native meaning remains.
- [ ] Add migration cases `inertColumnsGoneNativeSettingsUnchanged`,
  `preSquashAndCurrentUpgradeThroughBothMigrations`, `cleanupSqlFailureRollsBack`
  and `secondBootDoesNotRewriteNativeValues`; preserve diagnostics/discovery
  retirement API404 tests. Run focused upgrade suites; expect RED on old schema.
- [ ] Delete proven inert mappings, generate via `corepack pnpm --filter
  @veyvox/server db:generate --name=standalone_cleanup`; review generated rebuilds,
  FK checks, indexes/defaults and no loss of native content or tuning settings.
  If Core's last tag shifted, use actual next tag consistently, not hand-written SQL.
- [ ] Run migration/retained retirement suites and server typecheck; expect GREEN.
  Update `docs/systems/{database,directory,telemetry,project-hub}.md` to reflect
  intentional permanent column retirement, not the older rollback-retention rule.
  Checkpoint D1.

### Task D2: Narrow absence enforcement plus clean artifacts

**Interfaces:** `findRetiredImplementation({ root, inventory }): Finding[]` in
`scripts/check-standalone.mjs`, with each finding `{ path, symbol, reason }`.
Default CLI scans inventoried active source/schema/config/resources; `--artifacts`
also requires/scans freshly built dist outputs. Missing required outputs fail,
not skip. Run source checking through existing `pnpm test:tooling` tests.

- [ ] Add temp-root tooling fixtures `rejectsRetiredImport`, `rejectsRouteAndEvent`,
  `rejectsWorkerRegistrationAndSchemaField`, `rejectsFedCatalogNamespace`,
  `rejectsWildcardOrUnknownException`, `rejectsStaleEmittedModule`,
  `acceptsLocalLiveKitRemoteAndCurrentOrigin`, and `allowsOnlyInventoriedHistory`.
  Each injection must produce path/symbol evidence and a nonzero CLI result.
- [ ] Run `node --test scripts/check-standalone.test.mjs`; expect RED with no
  checker, then implement exact inventoried symbol/route/import checks. Check
  active server/shared/web/desktop/config and generated-current artifacts, not
  a blanket ban on the English word "remote". Remove/replace dead imports,
  exports, settings, types, catalog resources and preview entrypoints found.
- [ ] Encode **literal files** and reasons for 0000–0048 SQL/snapshots, supported
  old fixture records, approved design/audit history, negative tests and the
  three P1 transition files. Generated emitted transition paths derive from
  those exact source paths. Reject directory/wildcard exceptions, unexpected
  transition network imports, disabled flags/no-op adapters/ambient shims.
- [ ] Preserve native assertions from mixed tests; record deleted protocol-only
  suites and their retained local replacement tests in P1. Adjust e2e/helper
  scripts/CI comments/AGENTS to local-only behavior without reducing any gate.
- [ ] Remove only confirmed task-owned shared/server/web dist directories;
  rebuild shared→server→web via `corepack pnpm build`. Run
  `node scripts/check-standalone.mjs --artifacts` and tooling tests; expect GREEN.
  The real DB schema and API/no-traffic clauses remain enforced by Core's
  `standaloneUpgrade.test.ts` and `standalone-absence-e2e.test.ts`, also rerun
  here; text search alone cannot satisfy this task. Checkpoint D2.

### Task D3: Dependency/configuration/documentation closure

**Interfaces:** Existing package graph/build/security contracts, no new public API.

- [ ] For each P1 deleted module's external imports, search all production/build/
  test callers and run `corepack pnpm -r why <exact-package>`; document keep/remove
  evidence. No dependency is presumed federation-only from its name.
- [ ] Add/adjust existing `scripts/{build-dependency-security,repository-ci,
  veyvox-docs}.test.mjs` assertions for removed scripts/docs and preserved
  required gates/COPY/patch paths. Run tooling suite, observe specific REDs.
- [ ] Remove only proven unused direct dependencies/overrides/patch entries;
  regenerate `pnpm-lock.yaml` via pnpm. Preserve completed deepmerge remediation,
  Workbox/media/native replacements and permissive-license constraints.
- [ ] Remove federation env parsing/examples/compose/deploy knobs and old test
  scripts. Evaluate generic DOMAIN/PUBLIC_ORIGIN/source/update variables from
  their native consumers instead of deleting every URL knob. Update current
  docs to native IDs, one chosen server and generated upgrade/refusal/recovery
  instructions; preserve license/attribution/AGPL and release-paired Flatpak files.
- [ ] Run full frozen install and a filtered server production frozen install
  in a disposable checkout with the **same** committed candidate lockfile;
  no install against the live application/profile. Run tooling/e2e typecheck/
  i18n/lint/audit and sequential build. If lint reports fixed stale suppressions,
  run `corepack pnpm lint:prune`, never suppress a new issue.
- [ ] Build the disposable container if Docker is available (no push); verify
  Dockerfile COPY/patch/tooling input paths. Record unavailable Docker gate for
  protected CI; full dependency/security disposition belongs to S4. Checkpoint D3.
