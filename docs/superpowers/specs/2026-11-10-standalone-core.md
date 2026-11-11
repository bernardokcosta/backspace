# Spec: standalone-core

## Objective and status

Approved provider specification under the [approved map](2026-11-10-standalone-security-map.md).
Keep the existing local application and remove all server-to-server federation,
including its data and contracts. The user authorizes deletion of federation-only
data, not native content or a database reset. No production operation is included.

## Tech stack and structure

Existing strict TypeScript, Fastify 5, SQLite/better-sqlite3, Drizzle 0.45.4 and
Drizzle Kit 0.31.11; Node/pnpm requirements remain unchanged. No new dependency.

- `packages/shared/src/{types,errors,constants}.ts`: local wire contracts.
- `packages/server/src/db/{schema,index,migrate,pendingMigrations}.ts` and generated
  `drizzle/`: schema, ordered upgrade and invariant checks.
- `packages/server/src/routes/{auth,users,admin,instance,social,dm,bots,livekit}.ts`,
  `ws/{handler,events,presence}.ts` and their local helpers: retained behavior.
- `routes/federation.ts`, `routes/federation/`, federation-only utils, WS replica
  projections and worker registration: delete after extracting actual local work.
- Update subsystem docs for database, auth, API, WS, permissions, DM, social, bots,
  voice and deployment. Historical migration/decision records are not rewritten.

## Interface consumed by the client

One authenticated instance owns one local `User.id`; there is no home identity,
remote row id, replicated instance registry, peer epoch or credential provisioning.
Remove federation-only properties from shared types and actual serializers,
including User home/detached/registry metadata, DM owner-home/copy fields,
attachment replication state and federation events/errors/settings.

- Keep `POST /api/dm { userId }`, with an existing local target. Keep group request
  `users: Array<{ id: string }>` and existing group constraints; remove remote
  identity alternatives, not friendship/membership/owner checks.
- DM/channel message ids and channel ids remain stable. `DmChannel.id` identifies
  the local conversation. No client-visible federation/conversation-copy key.
- A local active call always has a non-null `dmChannelId`. Remove remote call
  registries, relay follow-ups and host overrides. An accepted event identifies
  its actor as `answeredByUserId: string`, set from the authenticated account,
  not a client-supplied identity. Local call correlation, socket ownership,
  participant permissions, ring windows and accept/reject/end behavior remain.
- Local LiveKit may still be independently hosted: retain configured LiveKit URL
  handling and per-user token confidentiality. It is not server federation.
- Bot token issue/rotate/revoke, managed roles and local bot accounts remain.
  Remove cross-instance bot proofs/revocation queues and remote block lists.
- Retain local password/login/invite admission, revocation, admin checks and
  temporary-failure behavior. Removing `requireLocalUser` cannot remove actual
  authentication or permission checks.
- Retired federation/credential/attach endpoints are unregistered JSON 404 APIs,
  including under production SPA fallback. A historical federated username or
  registration body cannot create a remote identity or bypass local signup.

## Local DM identity

Reuse `utils/dmConversation.ts` as the single transactional find-or-create module.
Its local pair key becomes private `dm_channels.pair_key`, with a unique partial
index for non-null values. Compute the existing 32-hex SHA-256 key over sorted
**local** ids; this preserves valid native pair keys. Group rows use their stable
channel id and have null pair keys, not federation UUIDs.

Remove home identity resolution, cross-instance copy reconciliation and relay
log rewrites. Preserve native channel ids, messages, attachments, reactions, read
pointers, closed/open state and group owner/type. Duplicate native pairs must
be reconciled using the existing local merge semantics, never by deleting their
history. Ambiguous ownerless UUID-shaped legacy groups fail preflight instead
of becoming a new local 1-on-1 or getting a guessed owner.

## Data classification and deletion

The one-time transition inspects the **old schema** before dropping provenance.

| Class | Treatment |
|---|---|
| Native human/bot, native tombstone | Keep identity, credentials and local data |
| Sovereign detached account | Keep local account; remove obsolete provenance, never infer removal just from an old handle |
| `password_hash = '!federation-replicated'` stub | Remove as non-loginable federation placeholder |
| Non-detached row with a non-empty home instance | Remote account eligible for removal, subject to reference preflight |
| Inconsistent/unclassifiable identity or mixed native/remote content | Abort the upgrade before deletion; report counts/categories, not secrets or message bodies |

Protected local data includes spaces, DMs or other owned roots with a retained
owner/member/author. A remote account referenced by such a mixed conversation,
ownership chain or native audit record is not an excuse to cascade-delete that
local root. This uncommon state contradicts the reported unused feature: stop
without mutation rather than widen deletion silently. Detached accounts are
retained, not re-created under another id or granted a new password.

For fully remote-only roots, delete dependent content in FK-safe order, including
non-FK read pointers, overrides, layout references and ownership metadata.
Remove the 18 dedicated tables: federation peers, outbox/file/mutation queues,
sync cursors/retries, applied events/subject clocks/reset events/attach proofs,
the three peer-approval tables, user registry/credentials, bot revocations and
blocked remote bots, and sticker peer policies. The eighteenth table and sticker
replication consumers were confirmed during planning; this completes the approved
total-removal scope, not removal of the local sticker store. Remove sticker sync
routes/helpers and replica provenance. Delete exclusively remote replica packs
only when their assets/installs/history have no retained local reference; otherwise
refuse preflight rather than deleting local sticker history or inventing a local
creator. Keep native packs, versions, review history, collections and assets.
Generate removal of their schema/indexes plus federation
columns on users, DMs/messages, attachments and instance settings. Retained fields
with an actual local purpose are not deleted merely because a relay used them.

Native folder/layout entries keep order and ids; remove only proven remote
references. Do not convert malformed layout JSON into an empty native layout.

## Upgrade seam and transactional integrity

All schema SQL remains generated from `schema.ts` through `db:generate`. Do not
hand-edit historical/generated SQL or fabricate applied journal entries. Existing
pre-migration snapshots and skipped-sticker migration repair remain supported.

The installed synchronous Drizzle migrator opens `BEGIN`/`COMMIT` itself and
offers no pre-migration data hook; wrapping it in a native transaction is not
valid. Generated SQLite table rebuilds also require FK mode to be changed before
the transaction, not by a pragma inside it. This is a concrete reuse limitation.

Use one owned migration seam in `db/` that consumes Drizzle's existing migration
reader, generated statements/hashes/timestamps and existing journal. It replaces
the direct sync-migrator call, not a second optional migration engine. Required
semantics:

1. Validate migration ordering/history and inspect old data without mutation;
   take the existing snapshot before any upgrade rewrite. Supported pre-squash
   ledgers can lack early rows: accept that documented history, validate recorded
   hashes/timestamps and do not fabricate the missing rows or demand a contiguous
   row count. Reject contradictory/future/unrecognized history explicitly.
2. Require no active transaction. Scope FK suspension only to the migration
   connection, before beginning the immediate write transaction.
3. Apply unapplied historical migrations in order, run the retirement data
   transition immediately before the generated destructive schema migration,
   then apply generated statements and record their actual Drizzle hashes.
4. Before commit, assert foreign-key integrity, retained native rows/content,
   pair-key consistency and absence of retired schema. Any failure rolls back
   data, schema and new journal rows together.
5. Restore `foreign_keys=ON` on success or failure before normal application
   work. Never start routes/workers on an incomplete upgrade or a disabled FK
   connection. Normal repeated boot is a no-op, not another cleanup sweep.

File deletion is post-commit only: reuse safe local upload cleanup, and delete
only basenames explicitly attributed to removed records that have no surviving
references. Never recursively delete an upload directory or use a remote URL as
a path. Retain an atomic, migration-owned pending-basename manifest until all
targeted cleanup succeeds; recheck references/path identity on retry, then remove
the manifest. This is transient removal bookkeeping, not retained federation
content or a new network worker. An IO failure must remain visible and cannot
be reported as 100% completed cleanup. No unrelated orphan-file sweep.

## Style and tests

Use existing strict error contracts and small local interfaces, for example:

```ts
interface LocalDmTarget { userId: string }
// Authority is always the verified caller, not any id from the request body.
const callerId = request.userId;
```

Tests must exercise fresh DB, current local DB, pre-squash supported DB, disjoint
remote-only fixture, detached local fixture, mixed-reference refusal, malformed
metadata, generated-table rebuild, snapshot failure, injected SQL/FK failure,
post-commit file retry, repeat boot and concurrent local DM creation. Compare
native rows/content before/after and prove rollback, not merely final row counts.
Use real one-instance REST/WS tests for removed routes, local flows, authorization
and zero peering/relay traffic. Extract the retained process boot helper from the
old e2e harness; do not retain handshake utilities just to boot a local server.

## Commands and acceptance

```bash
corepack pnpm --filter @veyvox/server db:generate
corepack pnpm --filter @veyvox/server exec vitest run src/db/standaloneUpgrade.test.ts --maxWorkers=2
corepack pnpm --filter @veyvox/server typecheck
corepack pnpm --filter @veyvox/server typecheck:e2e
corepack pnpm --filter @veyvox/server test --maxWorkers=2
```

Add the focused migration suite at the specified path during implementation.
Server runtime, shared wire contracts, schema and startup must contain no active
federation implementation. Preserve local behavior and all integrity assertions;
generated migration plus regression tests are mandatory, not a reset workaround.

## Boundaries and open questions

Always preserve native data, existing scanner fixes and bounded diagnostics.
Ask before dependencies, unrelated protocol changes or deletion of ambiguous
native-owned data. Never access production, disable backup/security gates, rewrite
applied migrations or silently turn remote accounts into authenticatable locals.
No product question remains; implementation planning must map each non-FK
reference and verify the migration seam against the pinned installed sources.
