# Standalone Core Implementation Plan

> **For agentic workers:** Use `executing-plans` for native execution, or the
> explicitly selected subagent-driven workflow. Track checkbox steps task by task.

**Goal:** Replace S2S federation with local identities/contracts and a safe upgrade.

**Architecture:** Reuse native routes, permission checks and DM find-or-create.
One owned migration runner reuses Drizzle's public migration reader and generated
SQL/journal, with retirement immediately before destructive schema SQL. It is
not a second migration mode or a disabled federation implementation.

**Tech Stack:** Existing TypeScript strict, Fastify 5, better-sqlite3,
Drizzle ORM 0.45.4/Kit 0.31.11; no dependency changes.

**Spec:** [Standalone core](../specs/2026-11-10-standalone-core.md);
[orchestration/global constraints](2026-11-10-standalone-security.md).

## Global Constraints

- Node `^22.22.2 || ^24.15.0 || >=26.0.0`, pnpm `10.34.3`; no `any`/stubs.
- Delete only proven federation-only data; preserve all native rows/content and
  sovereign detached accounts, credentials, tombstones and local feature behavior.
- Generate SQL from `schema.ts`; never hand-edit applied/generated SQL/history.
- Snapshot before changes; one transaction rolls back data/schema/new journal
  together; restore FK ON before normal work; file deletion only after commit.
- No production/publish/commit operation is included. Read database/auth/API/WS/
  permissions/DM/social/bots/voice/uploads/soundboard/Juno subsystem docs first.

## Review Focus

1. Incomplete supported journal prefix is not a reset or pending-count heuristic (C1).
2. Snapshot failure/SQL error/FK violation cannot leave data, schema or ledger ahead (C1–C2).
3. Native audit/ownership/non-FK/JSON references to remote identities must refuse (C2).
4. Duplicate native pairs retain every message/read pointer; ownerless UUID groups refuse (C2–C3).
5. Replica sticker/shared upload references and crash/retry cannot delete native assets (C2).

---

## File map and reuse boundaries

| Paths | Responsibility |
|---|---|
| `packages/server/src/db/migrationRunner.ts` (new), `pendingMigrations.ts` | Shared migration-state reader, history validation, single transaction owner |
| `packages/server/src/db/retireFederation.ts` (new) | Isolated old-schema classification, dependency deletion, retained-data checks |
| `packages/server/src/db/retirementFiles.ts` (new) | Crash-safe, commit-witnessed, reference-checked targeted file cleanup |
| `packages/server/src/db/{index,migrate,schema}.ts`, generated `drizzle/0049_standalone_core.sql`, `drizzle/meta/{0049_snapshot,_journal}.json` | Boot, repair/defaults, generated local schema |
| `packages/server/src/utils/{dmConversation,dmConversationEvents,dmMemberClosed,fileCleanup,storageJanitor,userDeletion,presenceStatus,sanitize}.ts` | Preserve actual local helpers/serializers; remove relay dependencies |
| `packages/shared/src/{types,errors,constants,stickers,dmSystemEvents,mentions}.ts` | Remove remote wire variants, preserve local payload validation/formatting |
| `packages/server/src/routes/{auth,users,admin,instance,social,dm,bots,livekit,stickerStore,stickerStoreAdmin}.ts`, `utils/auth.ts` | Local accounts/admission/bots/DMs/store; serializers and retained auth guards |
| `packages/server/src/ws/{handler,events,presence}.ts`, `packages/server/src/{index,config}.ts` | Native ready/events/calls, startup/teardown and configuration |
| `packages/server/test/helpers/{instanceHarness,localApi}.ts` (new) | Extract only retained process boot and native REST/WS helpers from `twoInstanceHarness.ts` |
| `packages/server/tsconfig.e2e.json`, `package.json` | Include all retained live tests/new helpers; remove federation-only scripts |

The exact path manifest in P1 expands mixed import consumers, test files and
registrars before editing. Baseline journal ends at 0048; if it changes, regenerate
the next migration and update the literal boundary/hash mapping, never guess it.

### Old-data reference matrix (C2 preflight/deletion coverage)

Query FK lists and compare against this matrix so unlisted schema edges fail the
fixture test. FK OFF means **no cascades execute**: explicitly delete dependents
in reverse dependency order before roots, then `foreign_key_check` before commit.
Any retained owner/member/author/actor makes the affected root protected; do not
erase remote references inside that protected root to make deletion succeed.

| References, including non-FK columns | Required treatment |
|---|---|
| `users.bot_owner_id`, `roles.managed_bot_id` | Native owner/bot/role touching remote identity is mixed; remote-only children delete first |
| `spaces.owner_id`, `space_members`, `channels`, `channel_categories` | Native root/member/author protects whole space; remote-only space closure may delete |
| `spaces.afk_channel_id`, `channels.category_id` | Verify preserved local target/meaning; prune only with removed owning root |
| `messages.user_id/reply_to_id`, `dm_messages.user_id/reply_to_id` | Native author or cross-root reply protects content; preserve stable message IDs |
| `dm_channels.owner_id/owner_home_*`, `dm_members` | Keep native pair/group owner/type; mixed identities or unclassifiable group refuse |
| `attachments.message_id/dm_message_id/uploader_id`, filename/thumbnail | Include unattached uploads; native uploader/reference protects file; inventory removed basenames only |
| `embeds.message_id/dm_message_id` | Delete only with fully removed message; never treat external image URL as local filename |
| `pinned_messages.channel_id/message_id/pinned_by_id` | Native pin actor is protected audit reference; preserve all native pins |
| `friends.user_id/friend_id`, `friend_requests.from_id/to_id` | Cross native/remote pair refuses; remove only remote/remote edges |
| `reactions`, `dm_reactions` user/message edges | Native reactor or retained message makes mixed reference; retain native history |
| `roles`, `member_roles`, `channel_overrides`, `category_overrides` | Resolve polymorphic `target_type/target_id`; native root or subject protects; never rewrite unknown types |
| `read_states.user_id/channel_id/last_read_message_id` | Resolve channel versus DM; native pointers to removed history refuse; duplicate local-pair merge keeps newer pointer |
| `notification_settings` user/space/channel | Retain native values; remote-only closure removes associated settings explicitly |
| `space_folders`, `space_folder_members.space_id` | Retain folder IDs/order; remove only independently proven foreign references, not merely IDs absent locally |
| `user_space_layout.layout` JSON | Parse existing validated layout shape; retain native item IDs/order/metadata, remove proven peer entries; malformed/ambiguous layout refuses |
| `bans.banned_by`, `join_requests.decided_by`, `voice_restrictions.moderator_id` | Native actor/audit on a removed identity/root refuses; no silent SET NULL |
| `soundboard_settings`, `soundboard_sounds.uploader_id/filename` | Retain native sounds/settings; remote-only files must pass shared-basename protection |
| `juno_round_results/participants/player_stats` | Native round/participant/space/stats protect score history; remote-only closure deletes explicitly |
| `bot_tokens`, `bot_commands`, `bot_seat_restrictions.moderator_id`, `interactions.user_id/bot_id/channel_id/dm_channel_id` | Preserve native credential/command/seat behavior; resolve non-FK interaction targets; mixed actors refuse |
| `invite_links.created_by`, `invite_redemptions.user_id/registrant_username` | Native invitation/redemption audit protects; username text is not sufficient deletion provenance |
| `personal_stickers`, `user_installed_packs`, `sticker_packs.creator_id/reviewed_by`, version reviewers | Native install/collection/review/creator protects; remote replica with such a reference refuses |
| `sticker_pack_versions/items`, `sticker_assets`, `game_icons/assets` | Shared content-addressed bytes survive any retained pack/collection/message/reaction/activity reference |
| Structured system-event JSON, mention/reaction/sticker/game-icon tokens in retained content | Use existing parsers to detect cross-references; uncertain parse blocks removal, never edit native text to hide it |
| Avatar/banner/space icon/DM icon/soundboard/attachment/thumbnail paths | Candidate must be owned by removed records, local, exact safe path and unreferenced across every retained asset consumer |

The 18 retired tables are `federation_peers`, `federation_sync_cursors`,
`federation_sync_retry`, `federation_applied_events`, `federation_subject_clocks`,
`federation_reset_events`, `federation_attach_proofs`, `peer_approval_requests`,
`peer_approval_subscribers`, `peer_approval_notifications`, `federation_outbox`,
`federation_file_queue`, `federation_mutation_log`, `user_federation_registry`,
`user_federation_credentials`, `bot_revocations`, `blocked_bots`,
`sticker_peer_policies`. They are not native roots and are dropped by generated SQL.

### Task C1: One journal-aware, snapshot-protected migration runner

**Files:** New `migrationRunner.ts`, `migrationRunner.test.ts`; modify
`db/{index,migrate,pendingMigrations,pendingMigrations.test,stickerMigrationRecovery.test,preSquashUpgrade.test}.ts`.

**Interfaces:** `readMigrationState(db: Database.Database, folder: string):
MigrationState` and `runMigrations(db: Database.Database, options: {
migrationsFolder: string; beforeChanges: () => void }): void` in `migrationRunner.ts`.
`MigrationState` contains readonly Drizzle `MigrationMeta[]` `pending` and `all`;
retirement hooks are internal exact-tag calls, not arbitrary plugin callbacks.
`hasPendingMigrations(db, folder): boolean` delegates to that same state reader.

- [ ] Add named cases `missingPrefixIsSupported`, `unknownHashOrFutureHistoryRefuses`,
  `duplicateOrInteriorContradictionRefuses`, `snapshotFailureWritesNothing`,
  `sqlAndFkFailureRollBackSchemaDataAndLedger`, `activeTransactionRefuses`,
  `foreignKeysRestoredAfterEveryExit`, `repeatBootDoesNotSnapshot`, and skipped-
  sticker repair with missing objects. Compare schema SQL, native rows and ledger
  values, not DB file bytes/WAL timestamps; use actual generated hashes/timestamps.
- [ ] Run `corepack pnpm --filter @veyvox/server exec vitest run src/db/migrationRunner.test.ts src/db/pendingMigrations.test.ts --maxWorkers=2`;
  expect RED on missing runner/current count-only predicate.
- [ ] Implement public `readMigrationFiles({ migrationsFolder })` reuse. Validate
  timestamps/order/hashes, allow the documented absent earliest journal prefix,
  never manufacture old entries. Snapshot outside the transaction before the
  first rewrite; require `db.inTransaction === false`; set FK OFF, begin immediate,
  apply pending SQL/journal in order, check FK/invariants before commit, finally
  restore and verify FK ON. Skip only exact generated FK-toggle pragmas, whose
  semantics are owned by the outer runner; reject unsupported transaction control.
- [ ] Move the existing skipped-0045 reconciliation into its ordered boundary
  within this transaction, retaining its generated SQL/hash and divergent-object
  refusals. Earlier upgrade migrations/repair must not commit if retirement fails.
- [ ] Rerun named suites plus `stickerMigrationRecovery.test.ts`; expect GREEN.
  Update `docs/systems/database.md` with the one-runner semantics. Checkpoint C1.

### Task C2: Classify old data, generate retirement, clean only committed files

**Files:** New `db/{retireFederation,retirementFiles,standaloneUpgrade.test,retirementFiles.test}.ts`,
`test/fixtures/standaloneUpgrade.ts`; modify schema/runner/boot/defaults/fileCleanup;
generate 0049 SQL/snapshot/journal, never modify 0000–0048.

**Interfaces:** `prepareFederationRetirement(db: Database.Database): RetirementPlan`
is read-only and throws categorized, count-only errors. Internal plan contains
retained/removed IDs, canonical native DM mapping, retained-row fingerprints and
target file identities. `retireFederationData(db, plan): void` operates on old
schema in the open transaction. `finishFederationRetirement(db, plan): void`
populates local pair keys/checks invariants after generated SQL, before commit.
`retryRetirementFiles(db: Database.Database, options: { dbPath: string;
uploadDir: string }): { deleted: number; pending: number }` owns post-commit retry.

- [ ] Build fully FK-valid fixtures: fresh, current native-rich, supported pre-
  squash with missing early ledger rows, detached local, disjoint remote/stub,
  mixed edges for **each matrix row**, ambiguous group, malformed layout and
  source/replica stickers sharing an asset. Assert unchanged native credentials,
  bytes/content/IDs/settings; every refusal rolls back all pending migrations.
  Adapt mixed historical upgrade suites to valid parents and final local schema;
  retain deduplicated reactions/sticker repair assertions, not relay imports.
- [ ] Add file cases: crash before/after commit, EACCES/ENOENT, shared basename,
  thumbnail referenced separately, symlink/path traversal/remote URL, replaced
  file identity, manifest retry, no unrelated orphan sweep, repeat startup no-op.
- [ ] Run `corepack pnpm --filter @veyvox/server exec vitest run src/db/standaloneUpgrade.test.ts src/db/retirementFiles.test.ts --maxWorkers=2`;
  expect RED because legacy schema/cleanup persist.
- [ ] Implement spec classification in `retireFederation.ts` and reverse-FK
  deletion using the matrix; detached accounts keep their IDs/passwords. Unknown
  provenance/edge/JSON shape refuses. Capture native canonical DM/key mapping
  before dropping old fields; populate private `pair_key` only after new schema,
  with native group pair keys null. Implement the local `dmConversation.ts`
  helper interfaces stated in C3 in this task: sorted local-ID key, native pair
  merge/read-pointer preservation and pair-key reconciliation. Adapt/run its
  existing find-or-create/backfill/read-pointer suites here so the migration
  does not depend on an unimplemented later helper. C3 consumes these functions.
- [ ] Remove the 18 tables and proven remote columns/indexes from `schema.ts`;
  add nullable private `dm_channels.pair_key` and unique partial
  `idx_dm_pair_key` (`pair_key IS NOT NULL`). Remove sticker replica provenance/
  policy, retaining native packs/status/review/version data. Generate via
  `corepack pnpm --filter @veyvox/server db:generate --name=standalone_core`;
  choose add/drop (not guessed rename/data wipe) for old federation key → pair_key.
  Verify generated rebuilds preserve all retained columns/defaults/indexes/FKs.
  Preserve the supported legacy `instance_settings CHECK(id = 1)` as an explicit
  schema check when rebuilding that singleton table. The historical embed-type/
  exactly-one-message CHECKs remain on the untouched legacy `embeds` table;
  do not drop or guess away native constraints. Refuse unknown columns/indexes/
  triggers/views/FK changes before rebuilding. Known pre-squash extras are only
  the six already-inert settings columns inventoried in the execution ledger.
- [ ] Wire pre/post hooks around exactly `0049_standalone_core` using the actual
  journal timestamp/hash. Remove detached/outbox boot backfills and epoch minting
  once no native consumer remains; defaults/installed_at queries use local schema.
  Revalidate preflight at the destructive boundary inside the write transaction.
- [ ] Persist an atomic JSON sidecar `${dbPath}.standalone-cleanup.json` before
  commit, containing version 1, actual migration hash and candidate relative paths/
  lstat identity (dev/ino/size/mtime). The committed matching journal row is its
  deletion witness; pre-commit crashes can never authorize unlinking. Never
  overwrite a pending manifest; remove an uncommitted manifest only after proving
  its witness absent. Post-commit, recheck surviving DB/content references, exact
  path containment/no symlinks and file identity before each unlink; persist
  progress atomically and remove sidecar when drained. A mismatch/IO error stays
  pending and aborts boot visibly; next boot retries only these candidates.
- [ ] Reuse `deleteUploadFile` with optional `{ strict?: boolean;
  includeThumbnail?: boolean }`, retaining default callers' behavior; transition
  uses strict=true/includeThumbnail=false and separately checked thumbnail entries.
  Extend safe path handling for explicitly inventoried sticker/game-icon assets
  within their known subdirectories; never map an arbitrary URL/path to basename.
- [ ] Run C1/C2 plus pre-squash/sticker recovery/rebrand/permission/backup tests;
  expect GREEN and FK ON. Update database/uploads/sticker API documentation and
  inventory. Checkpoint C2 includes the tested local DM helpers, not route changes.

### Task C3: Native DM identity, accounts, friends, bots and sticker routes

**Files:** Mixed route/middleware/shared/helper paths in file map; retain/adapt
`utils/dmConversation{,.findOrCreate,.backfill,.readPointer}.test.ts`,
`routes/{dm,auth,social,bots,stickerStore}.test.ts`; new
`routes/standaloneContracts.test.ts`. Expand exact serializers via P1 inventory.

**Interfaces consumed from C2:** `findOrCreateOneOnOne(db: DbWithClient, a: { id: string },
b: { id: string }, options: OneOnOneOptions): OneOnOneResult`; `oneOnOneKey(a,b):
string` uses sorted local IDs joined with `:` and SHA-256 first 32 hex chars.
Keep local reconcile result/`keepNewerReadPointer`/backfill names with local pair
semantics; rename `reconcileDmChannelFederatedId` → `reconcileDmChannelPairKey`.
REST target: `{ userId: string }`; group `users: Array<{ id: string }>`.

- [ ] Add tests for concurrent/reversed pair open, tombstones/duplicate native
  history, read/closed-state merge, group type/owner checks, foreign fields unable
  to create an account or bypass invite admission, native profile/password/status,
  bot issue/rotate/revoke/managed roles and local pack submission/review/install.
  Include denial asserting stored data unchanged, not just response status.
- [ ] Run `corepack pnpm --filter @veyvox/server exec vitest run src/utils/dmConversation src/routes/standaloneContracts.test.ts --maxWorkers=2`;
  expect RED for private key schema/retired wire variants.
- [ ] Simplify the existing routes/serializers using C2 helpers, removing home resolution,
  relay queueing and remote provision/attach/registry endpoints. Merge duplicate
  native pairs into a valid existing keyed holder, else earliest created/id;
  preserve messages/attachments/reactions/read state. Keep real auth/admin/owner/
  membership/friendship and bot restrictions when removing `requireLocalUser`.
  No constant-return federation predicates/wrappers remain.
- [ ] Run C1–C3 tests plus retained route suites; shared build then server
  typecheck pass. Update auth/API/DM/social/bot/permissions docs. Checkpoint C3.

### Task C4: Local call/WS contracts and complete S2S runtime retirement

**Files:** WS/server startup/config/LiveKit/storage paths in map; remove
`routes/federation.ts`, `routes/federation/`, `utils/federation*.ts`,
`utils/{botFederation,botRevocationQueue,detachedIdentity,callFanout,stickerSync}.ts`
and remote-only tests/helpers after mixed local coverage moves; new
`test/{standalone-e2e,standalone-absence-e2e}.test.ts` and `instanceHarness.ts`.

**Interfaces:** Shared `ActiveCallInfo.dmChannelId: string` is non-null;
`dm_call_accepted.answeredByUserId: string` comes from authenticated caller.
Remove remote call keys/hosts/followups, preserving native room/call/request
correlation and per-user LiveKit tokens. Extract `spawnInstance`,
`readInstanceLog`, `stopInstance` with native port/db/storage/jwt/log/LiveKit
options; no federation switches or handshake utilities.

- [ ] Preserve/adapt `events.{groupDmCall,callFollowups,callStartTokenScoping}.test.ts`
  and local refusal/participant/timeout/disconnect assertions. Add real REST/WS
  flows covering register/login, private space approval, friend/group/DM message/
  reply/reaction/read, local bot and calls with synthetic LiveKit credentials.
- [ ] In absence e2e enumerate P1 retired routes, including sticker admin sync and
  auth credential/attach paths: unauthenticated and authenticated JSON404, also
  production SPA fallback. Seed hostile legacy registration/events; assert no
  state mutation, no peer DNS/HTTP/WS attempts after ready/timer advancement.
- [ ] Run the new live suites; expect RED on currently registered federation.
- [ ] Remove runtime registrars/workers/side effects/remote call registries and
  replication sweeps, extract actual local cleanup first, change shared events
  and all server consumers atomically. Keep configured remote LiveKit URL support,
  permissions, ring windows, socket ownership, reconnect and native admission.
  Update every retained `test/` harness importer and e2e tsconfig; remove old
  federation-only scripts/tests only after recording replacement local coverage.
- [ ] Run server suites, shared→server build, `typecheck:e2e`; expect GREEN.
  Update WS/voice/deployment docs and retirement inventory. Web adaptations are
  next: do not hide intermediate type errors with compatibility exports.
