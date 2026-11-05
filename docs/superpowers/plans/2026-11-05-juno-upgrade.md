# Juno artwork and space progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans inline to implement the module plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not dispatch implementer subagents; one external final review covers the complete delivered change.

**Goal:** Deliver the approved cosmic Juno interface with real platform profiles,
authoritative round XP and persistent per-space ranking inside the current calls.

**Architecture:** Keep the existing native Juno engine, room lifecycle, REST/WS
and Games picker. Add one Juno progression module for durable idempotent awards
and ranking, use the provided local artwork, and compose the existing game
surface into focused views without a second voice, identity or game system.

**Tech Stack:** Existing strict TypeScript, Fastify 5, Drizzle/better-sqlite3,
React 19, Zustand 5, Tailwind 3, Vitest and Testing Library; no new dependency.

**Spec:** [Approved capability map and common rules](../specs/2026-11-05-juno-upgrade/README.md),
and its `SPEC-juno-{progression,artwork,interface}.md` module specifications.

Status: plan and detailed tasks approved for inline execution by the user on
2026-11-05. Progress and validation evidence are in the execution ledger.

## Global constraints

- XP is Juno-only, per **space**, shared by that space's voice channels; never
  global to the instance/home account or mixed with another space/origin.
- First/second/third/fourth: **120/80/40/20 XP**. Winner empties their hand; other
  places use remaining counts after penalties. Competition ties: **1,2,2,4**.
- No XP/counters for spectators, pre-finish abandonments or no-winner rounds.
  Reconnect grace is not abandonment. No new rule/cap/season/level/currency.
- Active matches remain ephemeral. Confirmed awards persist; old games are not
  backfilled. Do not change core rules, permission model, DM support or LiveKit.
- Real Backspace names/avatars; local assets from the two supplied ZIPs only.
  Never ship demo identities, composed previews or duplicate full-size PNG art.
- Use the hosting origin's existing authenticated row and API. No global-id
  assumptions, new identity resolver, relay protocol or persisted private hand.
- Additive schema only; generate migration/meta from `schema.ts`, never hand-edit
  SQL. Never read/migrate development runtime `data/` or production data to test.
- All new UI copy/errors/plurals go through all five catalogs. Preserve keyboard,
  touch, reduced motion/transparency, interface scaling and contained scrolling.
- Root build order stays **shared → server → web**. No commit, push, bump,
  release or deploy is authorized by this plan.
- Preserve the dirty `feat/games-picker` branch changes. Existing selector,
  RNNoise placement, tests and docs were already reviewed; do not reset/stash or
  copy runtime state to create a fresh branch. An isolated worktree may be used
  only if its treatment of those uncommitted changes is explicitly agreed.
- Each module plan inherits this section, the five review focus items below and
  the approved spec. Plans/tasks live in the established `docs/superpowers/`
  convention; do not add a duplicate root `tasks/` specification system.

## Mandatory test-isolation preflight

Every test command in the linked plans requires a fresh explicit fallback DB,
uploads and backup directory under the approved temporary root, even if the
test normally creates its own fixtures. Do not run tests with the checkout's
default `data/` paths. Example setup for one Bash subprocess on this machine:

```bash
export JUNO_TEST_ROOT="$(node -e "process.stdout.write(require('node:fs').mkdtempSync('C:/Users/berna/AppData/Local/Temp/opencode/juno-validation-'))")"
export NODE_ENV=test DB_PATH="$JUNO_TEST_ROOT/fallback.db" UPLOAD_DIR="$JUNO_TEST_ROOT/uploads" BACKUP_DIR="$JUNO_TEST_ROOT/backups" BACKUP_DISABLED=true
node -e "const fs=require('node:fs');for(const k of ['UPLOAD_DIR','BACKUP_DIR'])fs.mkdirSync(process.env[k],{recursive:true})"
```

Tool calls use fresh shells: repeat/pass this explicit environment in each test
subprocess; never assume an earlier call's exports persist. The existing
Corepack shim PATH, if needed, is added to the same subprocess only.

Use **`pnpm --filter <workspace> exec vitest run <explicit files>`**, not
`pnpm ... test -- <filter>`. The latter forwarded a literal `--` to this
installation's Vitest and selected the entire suite during the planning review.
Before each focused RED/GREEN run, inspect the same file selection with
`exec vitest list <explicit files> --filesOnly`; this inventories paths without
executing test files. For example:

```bash
pnpm --filter @backspace/server exec vitest list src/games/juno.test.ts src/routes/juno.test.ts --filesOnly
pnpm --filter @backspace/server exec vitest run src/games/juno.test.ts src/routes/juno.test.ts
```

The inventory must contain exactly those two files. Replace paths explicitly
for each task (after writing its failing test file); do not use an extra `--`.
For deliberately comprehensive runs, first audit tests that clear environment
variables or hardcode DB/upload paths. If one can bypass the temporary paths,
stop and obtain approval for an isolated validation workspace containing the
current code/task changes but no `.env`/runtime data; do not run it here.
Only after that check, in the isolated environment/workspace, run:

```bash
pnpm --filter @backspace/server exec vitest run --maxWorkers=2 --pool=threads
pnpm --filter @backspace/web exec vitest run --maxWorkers=2 --pool=threads
```

Budget 600s+ and label these as full-suite runs, never a task's focused RED.
Apply the same isolation to dev startup and review instructions. A DB opened
unexpectedly is an incident to report, not an excuse to reset/delete/restore it.

## Review focus

1. **DB fails at final play, then all players leave:** freeze the result before
   presence cleanup; keep the pending settlement for retry; no lost/duplicate XP
   or rematch replacement. An unconfirmed crash may lose the round, never a
   confirmed credit. Tests: progression P2/P3/P7.
2. **Departure, deletion or identity merge around settlement:** an already-final
   outcome cannot be recomputed; account erasure must not be undone by a pending
   award; same-round identity merges cannot double count. Tests: P3/P6.
3. **Federated user/same ids on different spaces or hosts:** authorize against
   the space host; profile/asset lookup and client state carry origin plus account
   and space; the viewer's own rank works off-page. Tests: P4/P5/P7, interface I2/I3.
4. **Large hands and short/scaled tiles:** cap decorative opponent fan density,
   not the count; viewer can scroll/reach every card and action in desktop/mobile
   without revealing an opponent face. Tests: artwork A2, interface I6/I7.
5. **Older hosts, long translated names and auxiliary screens:** no fake XP or
   duplicate game mutation on opening ranking/menu, no focus/Escape fall-through
   or changed call state. Tests: P5, interface I1/I2/I4/I6/I7.

## Module plans and dependency order

| Module | Plan | Independently verifiable deliverable |
|---|---|---|
| `juno-progression` | [Progression tasks P1–P7](2026-11-05-juno-progression.md) | Authoritative final result, durable XP, read-only space ranking, deletion/identity safety |
| `juno-artwork` | [Artwork tasks A1–A2](2026-11-05-juno-artwork.md) | Complete local card/back/UI assets and tested original-art renderer |
| `juno-interface` | [Interface tasks I1–I7](2026-11-05-juno-interface.md) | Localized responsive initial/lobby/table/result/ranking with real profiles |

Execute inline: **P1 → P2 → P3 → P4 → P5 → P6 → P7 → A1 → I1 → A2 → I2 → I3 → I4 → I5 → I6 → I7**.
P1/P2/P4 and A1 have no product dependency on each other, but no parallel agents
or shared-file concurrent writers are needed. I1's catalog updates precede A2's
color-label change. All provider interfaces must be green before the consuming
UI tasks. Each task includes RED → implementation → GREEN, with exact paths
and public signatures in its module plan.

## Delivery gates and execution ledger

- [x] Capability map, XP rules and all module specs approved by the user.
- [x] User approves this plan **and its linked detailed task lists** for inline execution.
- [x] P1–P7 complete, with ledgered RED/GREEN results and no pending data-integrity finding.
- [x] A1–A2 complete; asset manifest, coverage and build-path checks pass.
- [x] I1–I7 complete; real desktop/mobile/short-tile screenshots retained.
- [x] All affected suites, migration/identity checks and real HTTP/WS acceptance pass.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm check:i18n`, `pnpm build`, server e2e
  TypeScript and desktop TypeScript pass; isolated API/web dev startup passes.
- [x] Update subsystem docs and receive the single complete implementation final
  GPT review; fix concrete findings and rerun affected checks before delivery.

At execution start create the ledger
`docs/superpowers/plans/2026-11-05-juno-upgrade-progress.md` with plan identity,
task status, test outputs, rulings, evidence paths and validation limitations.
Use the plan ids rather than guessing which pending module is active. No
intermediate commits without the user's authorization; task completion is
recorded in the ledger rather than relying on conversation memory.

## Planning checkpoint evidence

- Read existing Juno rules/room lifecycle, routes, DB/transaction types,
  tombstone and reattach merge, profile sanitization, client transport/stores,
  existing user/asset resolution and relevant specs/tests.
- Installed Drizzle stays at the repository's version; Context7 lookup was
  attempted but quota-exhausted. Checked the official [transactions](https://orm.drizzle.team/docs/transactions)
  and [upsert](https://orm.drizzle.team/docs/guides/upsert) documentation directly;
  do not migrate to the newer beta examples/framework during implementation.
- Plan self-review and the first external review found two issues: P3 must
  capture starters at `start` (only final counts are frozen at finish), and
  focused Vitest invocation must avoid the extra separator. Both instructions
  and the integrated abandonment test have been corrected in the plans.
- No intentional edits to runtime code, assets, DB schema, generated migrations,
  `.env` or dependencies were made during planning. **Validation incident:**
  the reviewer reported that an unintended broad server suite opened
  `data/backspace.db` before timing out. The main agent did not read its contents,
  checkpoint it, restore it, delete it or remove its sidecars. Post-review
  metadata: main DB 884,736 bytes, mtime `2026-11-05T04:01:57.505Z`; WAL 0 bytes
  and SHM 32,768 bytes, created about `2026-11-05T17:28:53Z`. This is not a
  before/after content comparison or proof of no data effects. No pre-incident
  hash/baseline exists for this checkpoint; preserve the files and disclose that
  limitation. Process inspection found no remaining Backspace Vitest workers.
- The reviewer identified the incident command as
  `corepack pnpm --filter @backspace/server test -- src/games/juno.test.ts src/routes/juno.test.ts`
  (180s timeout). Tool stdout showed `vitest run "--" ...` and `Database
  initialized at .../backspace/data/backspace.db`, associated with
  `src/utils/federationOutbox.systemType.test.ts`, case `omits type for user
  messages (backward-compat with old peers)`. No separate persisted log was
  supplied; the evidence is the review tool history. Audit that test before any
  broad execution; this plan does not authorize changing/reverting its runtime DB.
- A direct file-only inventory after correction selected exactly
  `src/games/juno.test.ts` and `src/routes/juno.test.ts`, without running them.
  Context7 for Vitest was also quota-exhausted; its official CLI documentation
  was consulted. Re-review is restricted to documentation/inventory checks,
  not another broad suite or any runtime database operation.
- The same GPT reviewer approved the corrected plan on its second/final
  documentation-only pass. This is planning approval for presentation, not a
  feature implementation or verification of runtime DB contents.
