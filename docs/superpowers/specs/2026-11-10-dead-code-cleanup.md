# Spec: dead-code-cleanup

## Objective and status

Approved consumer of core/client in the [approved map](2026-11-10-standalone-security-map.md).
Remove all code and assets made unreachable by federation removal, and confirmed
inert remnants of already-retired features. This is not permission to remove
working functionality or rewrite the project around new abstractions.

## Structure and confirmed candidates

Use existing package manifests/lockfile, `scripts/`, subsystem docs, schema and
generated migrations. The following candidates are documented inert today:

- `users.last_active_day`, `last_client`;
- `spaces.directory_listed`;
- instance telemetry flags/id/day/error/declined-version;
- instance discovery/directory flags/dirty/ping/error/browse and support-card flag.

Remove their current ORM mappings and generate column/index removal after
verifying consumers and tests. Preserve `installed_at` (still backfilled),
worker ids, instance name, current diagnostics, invitations/approvals and all
other active local settings. This intentionally updates the older directory/
telemetry documents' schema-retention policy, without reviving either feature.

Review relay-only timestamps/encryption placeholders and attachment provenance
after removing their callers. Delete only proven unused fields; a field used
by retained local behavior needs its local semantics, not arbitrary deletion.

## Removal inventory and proof

Maintain an explicit file/symbol/route/table/catalog inventory. Delete federation-
only modules, tests/fixtures that exclusively require the retired protocol,
environment handling, CLI scripts, e2e peering harness sections, manifest scripts,
exports, icons/resources and docs claiming it is still available.

For mixed tests/files, retain local assertions and remove only remote branches;
replace federation identity fixtures with real local fixtures. A large deleted
test count is not success. Preserve and expand local authorization, migration,
session, message/call and upload tests rather than deleting their containing
suite to make typecheck pass.

Recalculate dependencies from actual production/build/test consumers. Remove
direct dependencies and pnpm overrides/patches only when **all** callers have
disappeared. Regenerate the lockfile with pnpm; do not manually splice snapshots
or remove Workbox, media libraries or the completed deepmerge remediation simply
because an old test also used them. No new dependency or version bump by default.

Update `AGENTS.md` and current subsystem docs to local-only operation. Remove
obsolete federation test commands/guidance from CI/docs without reducing retained
security gates. Keep the six installed upgrade legs, native capture, image build,
scanner contexts and build ordering. Delete only feature-specific e2e jobs or
script entries whose behavior is now covered by local and absence tests.

## Absence contract

An automated tooling check must inspect shipped server/shared/web/desktop source,
current schema and generated artifacts for the retired implementation's imports,
exports, routes/events/resources, field names and worker registrations. It must
also check the generated DB's actual schema and the real server's removed-route
responses/zero relay traffic. Source text search alone is not sufficient.

Rebuild from clean, task-owned output directories so removed TS modules cannot
survive as stale emitted JS or old web chunks. Do not commit generated output
or mistake runtime data/uploads for disposable build output. "Remote" media
participants, current-instance origins and generic external URLs are not retired
federation symbols: the checker targets the actual inventoried contracts.

Allowed references have **exact paths and reasons**: historical SQL/snapshots and
approved decision/spec history; the isolated removal transition; negative tests
and their fixed fixture records; the absence checker itself. No wildcard that
excludes an active production directory, all tests or all documentation.
No no-op API, disabled federation setting, undeclared ambient import or hidden
legacy restore path may survive behind an exception.

Use the existing tooling gate (`pnpm test:tooling`); no new framework or generic
dependency-analysis layer. Example inventory style:

```js
const transitionOnly = new Map([
  ['packages/server/src/db/retireFederation.ts', 'one-time old-schema removal'],
]);
```

The plan must choose and register the final transition file path once; this
example does not authorize broad exceptions or retaining a runtime subsystem.

## Testing and commands

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test:tooling
corepack pnpm --filter @veyvox/server typecheck:e2e
corepack pnpm check:i18n
corepack pnpm lint
corepack pnpm audit --audit-level=low
```

Add a negative fixture proving the absence check fails if a retired route/import/
worker is reintroduced outside the exact inventory. Validate full and filtered
frozen installs, the sequential production build and Docker COPY/patch paths.
Check native upgrade preserves local values while removed-only values/columns
are absent. No stale suppression may be hand-edited away.

## Boundaries and success

Always reuse established helpers and keep licenses/attribution/source offer,
local diagnostics, installer/profile/crypto identities and release-paired
historical Flatpak sources. Ask before deleting active functionality or changing
release/deployment contracts. Never rewrite Git history, broad-delete data or
exclude new findings just to achieve a clean search/test output.

Success is no retired active consumers, generated schema and bundle clean under
the narrow inventory, preserved local regression tests and frozen/audit checks.
No product question remains; prove each additional cleanup candidate first.
