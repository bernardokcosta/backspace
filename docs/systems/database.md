# Database Schema Reference

Source of truth: `packages/server/src/db/schema.ts` (Drizzle ORM)
Migrations: drizzle-kit generates SQL from `schema.ts` (`pnpm db:generate` from
`packages/server/`). On startup, `initDatabase()` runs the single `runMigrations`
transaction described below against `packages/server/drizzle/`, then
`ensureDefaults()` (settings row, Snowflake worker ID, `installedAt`
backfill, first-admin promotion), `backfillOneOnOneDmMembership()` and
`backfillOneOnOneKeys()` (see dm-system.md "Local pair identity").

Migration history was squashed to a baseline on 2026-04-24 (backlog #31 Phase 2).
Pre-squash databases retain tables created by the old hand-written statements:
inline UNIQUE constraints instead of named indexes, text primary keys without
NOT NULL and extra columns. A migration must not assume a baseline-only index or
column. `test/fixtures/pre-squash-schema.sql` holds that shape;
`src/db/preSquashUpgrade.test.ts` boots it, a squashed install and an empty database
through `initDatabase`, comparing retained native data, reaction deduplication and
retired-schema absence.
Engine: SQLite via `better-sqlite3`
IDs: Snowflake text, permissions: bigint decimal strings

## Transactional migration runner

`initDatabase()` uses `db/migrationRunner.ts:runMigrations`, rather than wrapping
Drizzle's synchronous migrator in an invalid nested BEGIN/COMMIT. It reads
Drizzle's generated statements, SHA-256 hashes and timestamps
through public `readMigrationFiles`; there is only one production migration path.
`hasPendingMigrations` uses that same validated history, not journal row counts.
A documented missing earliest pre-squash prefix is accepted without recreating
its rows; unknown/future hashes, duplicate timestamps, interior gaps and malformed
generated ordering abort startup without a database rewrite.

The sole historical hash alias recognizes the original `0042_past_millenium_guard`
at timestamp `1792815772672`: applied SHA-256 `e8525948…` from Git `1e640289`
remains valid only with canonical SHA-256 `e94a6a77…`. Historical commit
`3083e433` removed its FK PRAGMA wrappers/comments after some instances had already
applied it, without changing the resulting schema or timestamp. The runner
recognizes this exact pair read-only; it never rewrites the original ledger,
accepts an arbitrary historical hash, or replays 0042. Wrong timestamps, changed
canonical files, duplicates and interior gaps remain startup failures. Snapshot,
transaction rollback, native preservation and repeat-boot tests cover this path.

The existing pre-migration snapshot is taken before changes. FK suspension is
connection-local and occurs before `BEGIN IMMEDIATE`. All pending generated SQL,
the known partial-0045 sticker repair and their real journal entries run in that
one transaction. `foreign_key_check` must pass before commit; failures roll back
data, schema and new history together. FK enforcement is restored to ON on both
success and failure; a caller-owned transaction is refused, never committed.
An unchanged repeat boot neither rewrites history nor takes another snapshot.
Targeted retirement file cleanup must finish before native defaults/backfills.

Focused evidence: `src/db/migrationRunner.test.ts` covers snapshot failure,
history validation, fresh/prior-ledger SQL/FK rollback and partial sticker repair
rollback; `preSquashUpgrade.test.ts` retains real native parent graphs, reaction
deduplication and all supported upgrade shapes.

### One-time standalone retirement

`0049_standalone_core` is generated from the local schema. The runner invokes
`db/retireFederation.ts` immediately before its destructive SQL and verifies all
retained row projections after SQL and native pair reconciliation, before commit.
The old-data boundary is the immutable 0048 snapshot and supported pre-squash shape.
The wider server/client conversion is still in progress; this worktree is not
release-ready merely because the database transition passes its synthetic tests.

`0050_standalone_cleanup` permanently drops 16 remaining inert columns through
generated `ALTER TABLE ... DROP COLUMN` statements, without rebuilding tables:
user telemetry activity (2), space directory listing (1), the DM member replicated
closed clock (1), and telemetry/discovery/directory/Support settings (12). Applied
SQL and snapshots through 0049 remain immutable. Both migrations share the runner's
snapshot, transaction and FK checks when pending together; a cleanup failure rolls
back core retirement and its journal entries too. Reopening an already upgraded
database changes neither native values nor history.

Native `dm_members.closed` and `dm_channels.metadata_updated_at` remain: the former
is local visibility, the latter versions native name/icon edits. The unused relayed
closed-clock implementation is gone; `dm_messages.encryption_version` was already
removed by 0049. Native credentials/content, `installed_at`, `worker_id`, titles,
registration/space-creation settings and media/upload tuning survive unchanged.

Classification keeps native/bot/tombstone and sovereign detached accounts, uses
canonical FK edges plus explicit non-FK/structured references, and refuses mixed
or unclassifiable local content before mutation. The pre-squash DM reaction's
missing message FK is still treated as a logical edge. Unknown columns, indexes,
FK changes, triggers/views and unrecognized CHECKs stop preflight instead of being
silently discarded by a generated table rebuild. Known old inline-unique indexes,
six inert settings extras and native legacy CHECK forms are narrowly recognized.

The candidate plan has a stale-data digest, dependent-first deletion order and
only file paths attributed to removed records. Shared assets remain registered
while surviving collections, packs or native content (including encoded URLs)
refer to them. No general orphan scan is part of this one-time transition.

Veyvox 1.17.0 explicitly inserts `instance_name = 'Veyvox'` only when
`ensureDefaults` creates a missing settings row. Existing instance titles,
worker IDs, epochs, accounts and installation dates are not rebranded or reset.
The standalone transition removes the obsolete federation epoch rather than
minting another; retained worker IDs, account credentials and dates stay unchanged.
The historical SQL/schema default remains unchanged; no rebrand migration is needed.

---

## Core Tables

Soundboard tables added by `0032_soundboard`, tightened by `0042`: `soundboard_settings` (spaceId PK/FK
with cascade; enabled boolean default true, allowMemberUploads boolean default
true, maxDurationSeconds real NOT NULL default 30, maxSounds integer default 100)
and `soundboard_sounds` (id PK, spaceId FK cascade/index, uploaderId FK cascade,
name, emoji, filename, durationSeconds real, createdAt). See [soundboard.md](soundboard.md).

### users
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake |
| username | text UNIQUE NOT NULL | | Login name |
| displayName | text | | |
| passwordHash | text NOT NULL | | bcrypt for native humans; bots use their existing non-login sentinel |
| avatar | text | | Upload filename |
| status | text | `'offline'` | Native live presence: chosen status while connected, offline after disconnect grace/boot reset. See activity-presence.md |
| chosenStatus | text NOT NULL | `'online'` | Persistent native choice: online/idle/dnd. Written by REST/WS via `applyChosenStatus`, read by `statusOnConnect`; idle and dnd survive disconnects/restarts |
| customStatus | text | | |
| isAdmin | integer | 0 | First registered user = 1 |
| banner | text | | Upload filename |
| accentColor | text | | Hex color |
| avatarColor | text | | Hex color |
| bio | text | | |
| isDeleted | integer | 0 | Soft-delete flag |
| discoverable | integer | 1 | Visible in user directory |
| profileUpdatedAt | integer | | Epoch ms |
| passwordChangedAt | integer | | Token revocation: tokens before this rejected |
| showActivity | integer NOT NULL | 1 | Rich presence visibility |
| developerMode | integer NOT NULL | 0 | Developer Mode (shows the Bots tab in settings); self-view only, never relayed to peers. Migration `0033_developer_mode.sql` |
| botRequestedPermissions | text | | Bots only: requested native space permissions, canonical decimal mask. See [bots.md](bots.md) |
| botActivity | text | | Bots only: stored JSON `{ type, name }`. See [bots.md](bots.md) |
| createdAt | integer NOT NULL | | Epoch ms |

### spaces
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| name | text NOT NULL | | |
| icon | text | | Upload filename |
| banner | text | | Upload filename |
| avatarColor | text | | Hex color |
| ownerId | text NOT NULL | | FK → users.id |
| ownerTitle | text | | The owner title: the heading over the owner's group in the member list, set by the owner alone (migration `0030_space_owner_title`). Null shows the translated default ("Owner"). Stored as `normalizeOwnerTitle` returns it. Cleared when ownership is transferred. See [spaces.md](spaces.md), "Owner title". |
| inviteCode | text UNIQUE | | |
| visibility | text | `'private'` | public/request/private |
| description | text | | |
| afkChannelId | text | | A voice channel of this space that idle members are moved to, null when the feature is off (migration `0043_space_afk`). Validated on write, never by FK: a deleted or converted channel simply disables the move. |
| afkTimeoutSeconds | integer NOT NULL | 300 | Seconds of voice inactivity before the move; one of `AFK_TIMEOUT_OPTIONS` (60/300/900/1800/3600). Stored even while no channel is set. |
| createdAt | integer NOT NULL | | |

### space_members
PK: (spaceId, userId)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| nickname | text | Per-space display name |
| joinedAt | integer NOT NULL | |

### channel_categories
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| position | integer | 0 | |
| createdAt | integer NOT NULL | | |

### channels
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| type | text NOT NULL | | text/voice |
| topic | text | | |
| position | integer | 0 | |
| categoryId | text | | Soft FK → channel_categories |
| createdAt | integer NOT NULL | | |

### Juno progression (0048)

`juno_round_results`: `roundId` text PK, `spaceId` FK/cascade/index, nullable
`channelId` FK/set-null, `finishedAt` integer, `scoringVersion` integer.
`juno_round_participants`: PK (`roundId`, `userId`), round/user FKs with cascade,
nullable place/count, nonnegative XP and completed/abandoned/unranked outcome;
user lookup index. `juno_player_stats`: PK (`spaceId`, `userId`), space/user FKs
with cascade, total XP/wins/completed rounds (nonnegative; rounds ≥ wins), space
ranking index and user lookup index. No profile or private-card snapshots.

The unique round marker, participant rows and arithmetic aggregate increments
commit together in an immediate transaction. Member leave/rejoin keeps totals;
channel deletion keeps XP; space deletion cascades it. Soft tombstones explicitly
delete personal Juno rows. Native progression survives the standalone upgrade;
there is no account-reattachment merge path. See [juno.md](juno.md).

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| channelId | text NOT NULL | FK → channels.id CASCADE |
| userId | text NOT NULL | FK → users.id |
| replyToId | text | FK → messages.id SET NULL |
| content | text | For a system row, JSON (`channelSystemEvents.ts`) |
| type | text NOT NULL, default `'user'` | `user` (a member wrote it) or `system` (the instance wrote it; a poke is the only one so far, websocket.md "Channel pokes"). Migration `0029_persistent_channel_pokes` |
| editedAt | integer | |
| createdAt | integer NOT NULL | |

A system row's `userId` is the member who acted (the poker). `userWrittenMessages()` in `db/userWrittenMessages.ts` is the one condition for "a message a member wrote": the unread counts, the last message id in `ready`, channel search and the reply target check all take it, so a system row is never unread, never found by a search and never replied to.

Indexes: `idx_messages_channel_id` (channelId); `idx_messages_user_id` (userId); `idx_messages_channel_unread` (channelId, `CAST(id AS INTEGER)`, userId, type), created by migration `0027_unread_count_indexes` and given `type` by `0029_persistent_channel_pokes`. The last one serves the unread counts (websocket.md, "Unread counts"): the messages members wrote in a channel after a read cursor, compared as numbers, without reading the table. SQLite uses an expression index only when the query spells the expression the same way, type name case included, so the count writes `CAST(... AS INTEGER)`; the index names the column unqualified because SQLite refuses a qualified one there.

### pinned_messages
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake |
| channelId | text NOT NULL | FK → channels.id CASCADE |
| messageId | text NOT NULL | FK → messages.id CASCADE; unique (`idx_pinned_messages_message`): a message pins once |
| pinnedById | text | Who pinned; null for rows predating the column's writers. Not an FK, so a deleted user leaves the pin standing |
| createdAt | integer NOT NULL | Pin order: the list sorts by `createdAt`, the id breaking ties |

Migration `0044_channel_pins`. At most `MAX_PINS_PER_CHANNEL` (50) rows per channel, enforced on POST. Deleting the message or the channel cascades the pin away.

### attachments
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| messageId | text | | FK → messages.id CASCADE |
| dmMessageId | text | | FK → dm_messages.id CASCADE |
| uploaderId | text | | User who uploaded |
| filename | text NOT NULL | | Stored filename |
| originalName | text NOT NULL | | User-facing name |
| mimetype | text NOT NULL | | |
| size | integer NOT NULL | | Bytes |
| thumbnailFilename | text | | Generated thumbnail |
| width | integer | | Image/video pixel width |
| height | integer | | Image/video pixel height |
| duration | real | | Audio/video seconds |
| playable | integer (boolean) | NULL | Video web-playability tri-state: 1 = browser-decodable, 0 = known-undecodable (e.g. HEVC .mov), NULL = unknown/non-video. See uploads.md §3. |
| createdAt | integer NOT NULL | | |
CHECK: exactly one of messageId/dmMessageId is set

### sticker_assets and personal_stickers

Migration `0031_personal_stickers` adds only these two tables; message and reaction columns are unchanged (a sticker is a token in `content` or `emoji`, see [uploads.md](uploads.md#14-personal-stickers)).

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| sticker_assets | id | text PK NOT NULL | SHA-256 of the encoded WebP bytes |
| sticker_assets | created_at | integer NOT NULL | Epoch ms of the latest upload of these bytes; set before the file is written, and the start of the cleanup's 24-hour grace period |
| personal_stickers | user_id | text NOT NULL | FK → users.id, ON DELETE CASCADE |
| personal_stickers | sticker_id | text NOT NULL | FK → sticker_assets.id |
| personal_stickers | name | text NOT NULL | User’s collection label |
| personal_stickers | created_at | integer NOT NULL | Epoch ms |

The composite primary key (user_id, sticker_id) makes collection idempotent; one user holds at most 200 rows (`MAX_PERSONAL_STICKERS`, checked by the routes). Removing an entry or deleting its user removes only the association. An asset stays while any collection entry, message or reaction on this instance names it; after that, and once past its grace period, the storage cleanup deletes the row and its file (`cleanupUnusedStickerAssets`). Files live under `UPLOAD_DIR/stickers`, outside the attachment phases and the storage stats.

### sticker_packs, sticker_pack_versions, sticker_pack_items, user_installed_packs

Migration `0045_flawless_mister_sinister` introduced curated reviewable packs (`routes/stickerStore.ts`). Current packs are native only; exclusive replica data/provenance was removed by 0049. See [api.md](api.md), "Sticker packs / store".

Published metadata/status is kept on the pack; the candidate's metadata and
review status belong to its version. Submitting or rejecting v2 does not change
v1's published state. Approval switches metadata and currentVersion atomically.
Recovery of a preexisting `max_sticker_size_bytes` column executes all missing
generated 0045 objects and records the journal's actual timestamp/hash in one
transaction, refusing divergent objects or unapplied older migrations. The
column's presence alone never marks the whole migration applied.

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| sticker_packs | id | text PK | Native UUID |
| sticker_packs | name / description | text | Capped at 100 / 500 chars on write |
| sticker_packs | creator_id | text | FK → users.id SET NULL |
| sticker_packs | current_version | integer NOT NULL, default 1 | The served version number |
| sticker_packs | status | text NOT NULL, default `'draft'` | `draft`/`pending_review`/`approved`/`rejected`/`deleted`; indexed |
| sticker_packs | reviewed_by / reviewed_at / review_notes | | Admin moderation trail; user FKs SET NULL |
| sticker_pack_versions | id / pack_id / version | | `pack_id` FK → sticker_packs.id CASCADE; (pack_id, version) unique |
| sticker_pack_items | asset_id | text NOT NULL | FK → sticker_assets.id RESTRICT: an item holds its asset |
| sticker_pack_items | sort_order | integer NOT NULL, default 0 | Display order inside the version |
| user_installed_packs | (user_id, pack_id) | composite PK | Both FKs CASCADE |

Deleting a pack cascades its versions and items; deleting a user cascades their installs and nulls their created packs' creator. Item assets are RESTRICTed, so an asset in a pack is never swept by the unused-asset cleanup.
### game_icon_assets and game_icons

Migration `0047_game_icons` (renumbered from `0036` to follow the migrations other pending work already claims; drizzle applies by journal `when`, so a database that already ran `0032_game_icons` skips it) adds only these two tables; no activity or user column changes (an icon is an `assets.largeImage` URL on a transient activity, see [uploads.md](uploads.md#15-game-icons) and [activity-presence.md](activity-presence.md#game-icons)).

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| game_icon_assets | id | text PK NOT NULL | SHA-256 of the encoded WebP bytes |
| game_icon_assets | created_at | integer NOT NULL | Epoch ms of the latest upload of these bytes; set before the file is written |
| game_icons | user_id | text NOT NULL | FK → users.id, ON DELETE CASCADE |
| game_icons | icon_id | text NOT NULL | FK → game_icon_assets.id |
| game_icons | created_at | integer NOT NULL | Epoch ms |

The composite primary key (user_id, icon_id) makes the upload idempotent; one user holds at most 25,600 rows (`MAX_GAME_ICONS_PER_USER`, checked by the route). Deleting a user removes only their rows: unclaimed assets and stale temp files are removed by the storage janitor (`cleanupGameIconAssets`, phase 5; see uploads.md §15).

### embeds
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| messageId | text | FK → messages.id CASCADE |
| dmMessageId | text | FK → dm_messages.id CASCADE |
| url | text NOT NULL | |
| embedType | text NOT NULL | generic/video/image/audio/rich |
| provider | text | youtube/vimeo/spotify/null |
| title | text | |
| description | text | |
| image | text | Thumbnail/og:image URL |
| embedUrl | text | iframe-safe URL |
| width | integer | |
| height | integer | |
| color | text | |
| createdAt | integer NOT NULL | |
CHECK: exactly one of messageId/dmMessageId is set

### reactions
PK: id
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| messageId | text NOT NULL | FK → messages.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| emoji | text NOT NULL | |
| createdAt | integer NOT NULL | |

Indexes: `idx_reactions_message_id` (messageId); `idx_reactions_message_user_emoji` UNIQUE (messageId, userId, emoji), one reaction per user and emoji on a message. Writers insert with `ON CONFLICT DO NOTHING` and treat no row written as "already reacted" (`reaction_add` in `ws/events.ts`). See "Reaction uniqueness (0024)" below.

---

## DM Tables

### dm_channels
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| ownerId | text | | NULL for 1-on-1, set for group |
| pairKey | text | | Private native one-on-one pair key; unique partial index `idx_dm_pair_key`, null for groups; never serialized to clients |
| deletedAt | integer | | Soft-delete; native GC after 24h |
| createdAt | integer NOT NULL | | |
| name | text | | Group DM custom name. NULL = use comma-joined member fallback. Owner-only writes. |
| icon | text | | Native group DM icon filename. NULL = use AvatarStack fallback |
| metadataUpdatedAt | integer NOT NULL | 0 | Native name/icon edit timestamp, published in local DM metadata updates. |

### dm_members
PK: (dmChannelId, userId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| dmChannelId | text NOT NULL | | FK → dm_channels.id CASCADE |
| userId | text NOT NULL | | FK → users.id CASCADE |
| closed | integer | 0 | Soft-close flag |

### dm_messages
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| dmChannelId | text NOT NULL | | FK → dm_channels.id CASCADE |
| userId | text NOT NULL | | FK → users.id |
| replyToId | text | | FK → dm_messages.id SET NULL |
| content | text | | |
| type | text NOT NULL | `'user'` | user/system |
| editedAt | integer | | |
| createdAt | integer NOT NULL | | |

Indexes: `idx_dm_messages_dm_channel_id` (dmChannelId); `idx_dm_messages_user_id` (userId); `idx_dm_messages_channel_unread` (dmChannelId, `CAST(id AS INTEGER)`, userId), as `idx_messages_channel_unread` above.

### dm_reactions
PK: id
| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| dmMessageId | text NOT NULL | FK → dm_messages.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| emoji | text NOT NULL | |
| createdAt | integer NOT NULL | |

Indexes: `idx_dm_reactions_dm_message_id` (dmMessageId); `idx_dm_reactions_message_user_emoji` UNIQUE (dmMessageId, userId, emoji). Native reaction writers use `ON CONFLICT DO NOTHING` for authorized idempotent adds.

#### Reaction uniqueness (0024)
The squashed baseline (0000) created both reaction tables without a unique key; only pre-squash installs had one, as an inline `UNIQUE(message_id, user_id, emoji)` / `UNIQUE(dm_message_id, user_id, emoji)` from the old hand-written statements. On installs created after the squash the same user's reaction could be stored several times (#393). Migration `0024_reaction_unique` first deletes the repeats, keeping per key the row with the lowest `created_at` and, of equally early rows, the lowest `rowid` (any one of equal rows would do; the rowid only makes the choice definite), then creates the two named unique indexes. On a pre-squash install there are no repeats, and the named index is created beside the inline constraint (`sqlite_autoindex_*`), which stays.

---

## Social Tables

### friends
PK: (userId, friendId)
| Column | Type | Notes |
|--------|------|-------|
| userId | text NOT NULL | FK → users.id CASCADE |
| friendId | text NOT NULL | FK → users.id CASCADE |
| createdAt | integer NOT NULL | |

### friend_requests
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| fromId | text NOT NULL | | FK → users.id CASCADE |
| toId | text NOT NULL | | FK → users.id CASCADE |
| status | text | `'pending'` | pending/accepted/declined |
| createdAt | integer NOT NULL | | |

---

## RBAC Tables

### roles
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| name | text NOT NULL | | |
| color | text | `'#b9bbbe'` | Hex |
| position | integer | 0 | Hierarchy rank: @everyone 0, other roles distinct from 1 up, higher is more senior (permissions.md, "Role hierarchy") |
| permissions | text | | Bigint decimal string |
| createdAt | integer NOT NULL | | |
| managedBotId | text | | Set on a bot's managed role: the bot it belongs to (no FK). Unique with spaceId (`idx_roles_managed_bot`). Migration `0039_bot_permissions.sql`, see [bots.md](bots.md), "Permissions on invite" |

### member_roles
PK: (spaceId, userId, roleId)
All columns FK CASCADE to their respective tables.

### channel_overrides
PK: (channelId, targetType, targetId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| channelId | text NOT NULL | | FK → channels.id CASCADE |
| targetType | text NOT NULL | | role/member |
| targetId | text NOT NULL | | Role ID or user ID |
| allow | text NOT NULL | `'0'` | Bigint decimal string |
| deny | text NOT NULL | `'0'` | Bigint decimal string |

### category_overrides
PK: (categoryId, targetType, targetId)
Same structure as channel_overrides, with categoryId FK → channel_categories.id CASCADE.

Neither override table nor `roles` stores an edit version. The version a
concurrent-edit check compares (`overrideVersion`, `rolePermissionsVersion`)
is derived from `allow`/`deny` and `permissions` themselves, so it needs no
column and no migration (permissions.md, "Concurrent edits").

---

## State Tables

### read_states
PK: (userId, channelId)
| Column | Type | Notes |
|--------|------|-------|
| userId | text NOT NULL | FK → users.id CASCADE |
| channelId | text NOT NULL | Channel or DM channel ID |
| lastReadMessageId | text NOT NULL | |
| updatedAt | integer NOT NULL | |

### notification_settings
A native user's notification setting for a space (`channelId` NULL) or one channel. Read/written through `routes/notificationSettings.ts`, keyed by native account ID. See api.md and sounds.md, "Notification settings".

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| userId | text NOT NULL | | FK → users.id CASCADE |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE. Set on channel rows too, so a space's rows go with it |
| channelId | text | | FK → channels.id CASCADE. NULL = the space-wide row |
| level | text | | `all` / `mentions` / `nothing`; NULL = not chosen (a channel inherits its space, a space uses `mentions`) |
| muted | integer NOT NULL | 0 | 1 = muted |
| mutedUntil | integer | | Epoch ms (server clock) a timed mute ends; NULL with `muted = 1` = until lifted. An ended mute is read as none and dropped at the next write |
| suppressEveryone | integer NOT NULL | 0 | 1 = `@everyone` and `@here` do not alert on `mentions` (space rows only; migration `0028_mass_mention_preferences`) |
| suppressRoles | integer NOT NULL | 0 | 1 = role mentions do not alert on `mentions` (space rows only; migration `0028_mass_mention_preferences`) |
| updatedAt | integer NOT NULL | | Server write time, strictly increasing per row; clients merge last-write-wins on it |

**Indexes:** `idx_notification_settings_space_row` UNIQUE `(user_id, space_id) WHERE channel_id IS NULL` and `idx_notification_settings_channel_row` UNIQUE `(user_id, channel_id) WHERE channel_id IS NOT NULL`: one space row and one row per channel, per user. Two partial indexes because a plain unique index never treats two NULL `channel_id`s as equal. No primary key: the rowid is the row's identity.

A row with nothing chosen (level NULL, not muted and neither suppress flag set) is deleted rather than stored. The suppress flags are written only on the space row: the channel route refuses them, so a channel row always holds 0. Rows are kept when the user leaves the space or loses sight of the channel (the list route filters them out), so they apply again on rejoin.

### space_folders
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| userId | text NOT NULL | | FK → users.id CASCADE |
| name | text | | |
| color | text | | |
| position | integer | 0 | |
| createdAt | integer NOT NULL | | |

### space_folder_members
PK: (folderId, spaceId)
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| folderId | text NOT NULL | | FK → space_folders.id CASCADE |
| spaceId | text NOT NULL | | Native space ID; membership validated before layout writes |
| position | integer | 0 | |

### user_space_layout
PK: userId
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| userId | text PK | | FK → users.id CASCADE |
| layout | text NOT NULL | `'[]'` | JSON array of {t:'s',id} | {t:'f',id} |
| updatedAt | integer NOT NULL | | |

---

## Moderation Tables

### bans
PK: (spaceId, userId)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| reason | text | |
| bannedBy | text | FK → users.id |
| createdAt | integer NOT NULL | |

### join_requests
| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | |
| spaceId | text NOT NULL | | FK → spaces.id CASCADE |
| userId | text NOT NULL | | FK → users.id CASCADE |
| message | text | | |
| status | text NOT NULL | `'pending'` | pending/accepted/declined |
| decidedBy | text | | FK → users.id |
| createdAt | integer NOT NULL | | |
| decidedAt | integer | | |

### voice_restrictions
PK: (spaceId, userId, restrictionType)
| Column | Type | Notes |
|--------|------|-------|
| spaceId | text NOT NULL | FK → spaces.id CASCADE |
| userId | text NOT NULL | FK → users.id CASCADE |
| restrictionType | text NOT NULL | mute/deafen |
| moderatorId | text | FK → users.id |
| createdAt | integer NOT NULL | |

---

## Registration Invites

### invite_links
Admin-managed registration invite tokens. Status (`active` / `expired` / `exhausted` / `revoked`) is **derived** at read time from `revokedAt` + `expiresAt` + `usedCount`/`maxUses`; there is no stored status column. See `packages/server/src/utils/inviteService.ts` (`inviteStatus()`).

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | text PK | | Snowflake |
| token | text UNIQUE NOT NULL | | 22-char base64url (`crypto.randomBytes(16).toString('base64url')`). Rotated on revoked → reinstate. UNIQUE constraint provides the lookup index. |
| name | text NOT NULL | | Admin-facing label, 1-64 chars trimmed. |
| createdBy | text NOT NULL | | FK → users.id (no CASCADE — admin tombstone keeps the row resolvable). |
| createdAt | integer NOT NULL | | Epoch ms |
| maxUses | integer | | NULL = unlimited; positive integer otherwise. |
| usedCount | integer NOT NULL | 0 | Incremented atomically inside the redemption transaction. |
| expiresAt | integer | | Epoch ms; NULL = never expires. |
| revokedAt | integer | | Epoch ms; NULL = not revoked. Set by revoke endpoint, cleared by reinstate. |

**Index:** `idx_invite_links_created_at` on `(createdAt)`.

### invite_redemptions
One row per successful invite-token consumption. Surrogate ID supports future per-redemption metadata without schema churn.

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | Snowflake |
| inviteId | text NOT NULL | FK → invite_links.id ON DELETE CASCADE — hard-deleting an invite drops its redemption history with it. |
| userId | text | FK → users.id ON DELETE SET NULL — defensive against future hard-delete paths; tombstone (soft-delete) keeps the row populated. |
| registrantUsername | text NOT NULL | Snapshot of username at the registration moment. Preserves forensic value when the user is later renamed or tombstoned (`!deleted:{uid}`). |
| redeemedAt | integer NOT NULL | Epoch ms |

**Indexes:** `idx_invite_redemptions_invite_id` on `(inviteId)`, `idx_invite_redemptions_user_id` on `(userId)`.

The user INSERT, `usedCount` increment, and redemption row INSERT all run in a single SQLite transaction (`inviteService.redeemInvite()`), which re-derives status under the transaction to close the TOCTOU window between `/check-invite` and `/register`.

---

## Instance Settings (singleton, id=1)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| id | integer PK | 1 | |
| instanceName | text | `'Backspace'` | |
| workerId | integer | | Snowflake worker ID |
| maxBitrateKbps | integer NOT NULL | 20000 | |
| minBitrateKbps | integer NOT NULL | 500 | |
| bitrateStepKbps | integer NOT NULL | 500 | |
| allowedResolutions | text NOT NULL | `'540,720,1080'` | CSV |
| allowedFramerates | text NOT NULL | `'30,45,60'` | CSV |
| maxResolution | integer NOT NULL | 1080 | |
| maxFramerate | integer NOT NULL | 60 | |
| registrationOpen | integer | | Local-anonymous-signup gate. null = use env (`config.registrationOpen`); 0/1 = explicit admin override. |
| spaceCreationOpen | integer NOT NULL | 1 | Whether non-admin users can create new spaces on this instance (`POST /api/spaces`). Instance admins (`users.is_admin = 1`) are exempt. Migration `0046_windy_sphinx`. |
| gifApiKey | text | | Klipy API key |
| bitrateMatrixOverrides | text | | JSON sparse overrides |
| allowCustomBitrate | integer NOT NULL | 1 | |
| maxUploadSizeBytes | integer | | null = use env |
| maxStickerSizeBytes | integer | | Sticker upload/item byte cap. null = use env (`MAX_STICKER_SIZE`, default 5 MiB). Set by admins in Storage settings; served as `maxStickerSizeMb` on instance info. Migration `0045_flawless_mister_sinister`. |
| installedAt | integer | | First-boot timestamp (epoch ms). Backfilled by `ensureDefaults` from the oldest local non-deleted account, or `Date.now()` on a fresh DB, so it is non-null after boot and never overwritten. |
| updatedAt | integer NOT NULL | | |

---

## Retired exclusive persistence

Generated 0049 removes dedicated peer/proof/relay/replication/credential and
remote-bot-policy persistence. Exact old objects remain in generated migration
history and the approved retirement inventory, not current ORM mappings or APIs.

## Bot accounts (`users`)

Migration `0032_bots.sql` adds `users.is_bot` (INTEGER NOT NULL DEFAULT 0) and `users.bot_owner_id` (TEXT, native owner's ID, NULL for humans). A bot's `password_hash` is `'!bot'`. See [bots.md](bots.md).

## Bot tokens (`bot_tokens`)

Migration `0035_bot_tokens.sql`. One row per access token of a bot: `id` (16 hex, the public half of `bsb_<id>.<secret>`), `bot_id` (FK to `users`, cascade), `token_hash` (SHA-256 of the secret), `name` (owner's label, nullable), `created_at`, `last_used_at` (written at most once a minute); index `idx_bot_tokens_bot_id`. Up to 5 per bot. See [bots.md](bots.md), section 1.

## Bot seat restrictions (`bot_seat_restrictions`)

Migration `0036_bot_seat_restrictions.sql`. A moderator's mute or deafen of one bot seat. Primary key `(channel_id, bot_id, restriction_type)`; `channel_id` → `channels` (cascade), `bot_id` → `users` (cascade), `moderator_id` → `users`, `created_at`; index on `bot_id`. A person's restrictions stay per space in `voice_restrictions`. Rows are deleted on unmute/undeafen, when the bot leaves the space (`removeUserFromSpace`) and with the channel. See [voice.md](voice.md), section 2.

## Slash command tables

The same migration adds the two tables of the slash commands. `bot_commands`: `id` (PK), `bot_id` (FK to `users`, cascade), `name`, `description`, `options` (JSON array, default `'[]'`), `updated_at`; unique index on `(bot_id, name)`. `interactions`: `id` (random 32-hex string, PK), `bot_id` and `user_id` (FKs to `users`, cascade), `channel_id` / `dm_channel_id` (exactly one is set), `command`, `options` (JSON object of the parsed values), `created_at`, `expires_at`, `responses` (default 0); index on `expires_at`. A spent interaction is dropped by the first invocation that comes a day after it expired. A bot's `bot_commands` rows are deleted when the bot is tombstoned.

Migration `0040_command_permissions.sql` adds `bot_commands.required_permissions` (text, nullable): the permissions a person needs in the invoking channel to see and use the command, canonical decimal mask; null for none. Subcommands and groups keep their own `requiredPermissions` inside `options`. See [bots.md](bots.md), "Required permissions".
