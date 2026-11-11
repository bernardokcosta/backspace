# Standalone Veyvox Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill for native execution,
> or an explicitly user-selected subagent-driven workflow. Steps use checkboxes.

**Goal:** Remove federation and its exclusive state, preserve local behavior, and
audit/harden the resulting application without production operations.

**Architecture:** Replace federation-aware branches with existing local paths,
not a standalone feature flag. One transactional database upgrade owns retirement;
one client session owns the chosen server. The four linked plans are dependency-
ordered and are not independently deployable intermediate application versions.

**Tech Stack:** Existing strict TypeScript, Fastify 5, SQLite/better-sqlite3,
Drizzle 0.45.4/Kit 0.31.11, React 19, Zustand 5, Vite 8, Tailwind 3, Electron.

**Spec:** [Approved capability map](../specs/2026-11-10-standalone-security-map.md).

## Global Constraints

- Node `^22.22.2 || ^24.15.0 || >=26.0.0`; pnpm `10.34.3`; no new dependency.
- Build shared → server → web sequentially; desktop/e2e typechecks are separate.
- Preserve native accounts/content, chosen status, bots, games, stickers,
  soundboard, permissions, diagnostics, backups and operational-resilience fixes.
- Delete federation-only data; never reset a DB, rewrite applied SQL/journals,
  cascade through mixed local data or delete an entire uploads/profile directory.
- Preserve Aether Drift/i18n, AGPL/source offers and installed crypto/profile IDs.
- No production access or deployment. The user subsequently authorized reviewed
  commit/publication and release 1.17.2 only when the complete implementation is
  correct; follow the conditional publication gate below, never publish a partial
  module. Do not run `git add .` over unfamiliar changes.

## Review Focus

1. Mixed local/remote ownership must abort without committed changes: Core C1–C2.
2. Pre-squash history with missing early journal rows must upgrade: Core C1.
3. Equal IDs across an explicit server switch must not leak state: Client W1–W3.
4. Replica stickers used by native history must not disappear: Core C2, Client W4.
5. A public DNS answer changing before connect or a stalled compressed body must
   not reach private addresses/exhaust workers: Security S2–S3.

---

## Plan sequence and gates

| Order | Plan | Deliverable and required gate |
|---|---|---|
| 1 | [Standalone core](2026-11-10-standalone-core.md) | Generated upgrade/rollback, native REST/WS and no S2S runtime; shared/server tests and e2e typecheck |
| 2 | [Standalone client](2026-11-10-standalone-client.md) | Single current session, zero peer requests, preserved local settings/UI; web/i18n/desktop/tooling tests |
| 3 | [Dead-code cleanup](2026-11-10-dead-code-cleanup.md) | Proven cleanup, inert-column migration, narrow automated absence check and clean artifacts |
| 4 | [Security hardening](2026-11-10-security-hardening.md) | Evidence ledger, reproduced fixes, authorization regressions, full validation/external review |
| Existing | [Voice polish spec](../specs/2026-11-10-voice-controls-polish.md) | Already implemented: 8px gap/radii, 28px buttons, nine tests and compact-width inspection; do not redo |

Read the owning subsystem documents before its task. Read all four plans before
editing cross-module contracts. Each task has a RED → minimal implementation →
GREEN cycle; add tests in an existing suite where its surface already fits.
Record actual commands/results, not predicted counts. Intermediate shared wire
changes may temporarily break the not-yet-updated web consumer; do not publish
those intermediate states or add compatibility stubs just to compile them.

### Task P1: Freeze the retirement inventory before destructive implementation

**Files:** Create `docs/superpowers/reports/2026-11-10-standalone-inventory.json`;
read the Core reference matrix and Client file map below their headers.

**Interfaces:** A checked-in array of `{ path, kind, action, symbols, reason }`,
with kinds `source|test|route|event|schema|catalog|config|history`, actions
`delete|simplify|retain|transition-only`. Paths are literal repository-relative
files, never wildcard exclusions. Route/event/schema symbols name exact contracts.
This is evidence/checker input, not an application runtime registry.

- [ ] Expand the file families in each plan using `git ls-files` and import/
  symbol searches; capture the exact existing paths, route methods/paths, WS
  variants, 18 tables, removed columns/indexes, resource keys and worker hooks.
- [ ] For mixed files/tests, record which local assertions survive and the
  responsible C/W/D/S task; especially auth, calls, stickers and upgrade tests.
- [ ] Register transition-only production paths exactly:
  `packages/server/src/db/retireFederation.ts`,
  `packages/server/src/db/retirementFiles.ts`,
  `packages/web/src/platform/retireFederationStorage.ts`.
  The local runner/ordinary stores are not broad exceptions.
- [ ] Review all residual matches before deletion. An unclassified consumer or
  ambiguous native-owned record blocks that task; new active-feature removal,
  dependencies or trust contracts require human approval.

## Final validation checklist (owned by Security S5)

- [ ] Run migration fixtures through the real `initDatabase`, then a real server
  on disposable DB/uploads with synthetic credentials, dotenv isolation and
  bounded owned-process cleanup. Inspect REST, WS and removed API JSON404s.
- [ ] Frozen install, full sequential build, root typecheck, server e2e typecheck,
  desktop `build:ts`, tooling/workspace tests, i18n, lint and precache check pass.
- [ ] Inspect real admin/mobile settings and compact voice controls in a
  disposable browser; seed old peer keys and record zero peer HTTP/WS requests.
- [ ] Rebuild only known task-owned `packages/{shared,server,web}/dist` outputs
  from clean directories, then run absence checks on emitted JS/web chunks and
  actual SQLite schema. Never clean runtime `data/` or unknown build artifacts.
- [ ] Dependency and available container/security scans have recorded output;
  unavailable native/installed/image checks remain explicit pending CI gates.
- [ ] No unresolved critical/high finding without explicit human disposition;
  all audit limits are recorded without an absolute-security claim.
- [ ] Mandatory external `review_final_gpt56` reviews the complete final scope,
  including earlier voice changes, new/untracked/docs/config/out-of-repo evidence.
  Correct concrete findings and rerun affected gates; never call the other final
  reviewer. This planning review does not approve future implementation.

## Handoff and status

Detailed specifications were approved with "sim". The user subsequently
authorized continuous native execution ("pode seguir direto sem interrupsoes").
The tightly coupled core/client plans are being executed inline, retaining the
mandatory independent final Sol review. No intermediate approval prompt is needed;
the safety/production/publication boundaries remain unchanged.

Planning verification is not migration testing or a completed security audit.
No federation implementation has been removed by writing these documents.

## Conditional publication: Veyvox 1.17.2

The user authorized commit and release 1.17.2 **after everything is correct**.
This adds no production deployment and does not waive any implementation,
data-preservation, review, scanner, installed/native or packaging gate above.

- [ ] Complete C1–S5 first. Before the final full-scope review, use the existing
  `node scripts/bump-version.mjs 1.17.2`, add accurate
  `.github/release-notes/v1.17.2.md` and run version-consistency/release tooling
  tests. Keep the approved installed-upgrade baseline pinned to Veyvox 1.17.0.
- [x] Resolve the requested destination: the user clarified "Shinogit" means
  GitHub, commit/push to master/main. Use the existing `origin` at
  `git@github.com:bernardokcosta/veyvox.git` (current default `master`), preserving
  branch protection through PR/checks/merge where required; never force-push.
- [ ] Commit only the complete reviewed intended scope using explicit paths.
  Reuse the existing protected PR/integration flow, preserve newer main changes,
  run the read-only desktop candidate and all six installed acceptance legs,
  and require successful main CI/security/image gates for the exact release SHA.
- [ ] Recheck absence of local/remote immutable `v1.17.2`; never move/overwrite an
  existing tag or public asset. Tag only the validated final main SHA and let the
  existing sole gated workflow publisher release **Veyvox 1.17.2**. No manual
  alternate release writer, protection bypass or unrelated repository rename.
- [ ] Verify the published tag/commit/title, all 16 desktop assets, manifest
  references/checksums and existing public container channel/architectures with
  anonymous reads. Preserve evidence and report any failed gate instead of
  treating a dispatched workflow as a successful release.
