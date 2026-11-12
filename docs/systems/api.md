# REST API Reference

Base: `/api`. Auth via `Authorization: Bearer <jwt>`. All responses JSON.
Source files: `packages/server/src/routes/*.ts`

## Native voice game (Juno)

GET/POST `/channels/:channelId/juno` return a private `JunoSnapshot`. They require
an authenticated human member with VIEW_CHANNEL + CONNECT and a live voice-owning
socket in that space channel. Commands are `create`, `join`, `leave`, `start`,
`rematch`, `draw`, `pass`, `play`, `announce`, `addBot`, `removeBot` (`botId` required),
`report` (`targetUserId`, `opportunityId` required);
non-create commands name the table and expected
revision (409 `juno_stale` on conflict). No opponent hands or draw order leave
the server. Five creates and 60 commands/minute/account, plus the existing HTTP
limit. State GETs have a separate bounded 600/minute/address route budget for
live-update fanout and fallback polling; this does not relax POST, account, auth,
voice or permission gates. Full rules, payloads and lifetime limits: [juno.md](juno.md).

Optional `?memory=1` declares memory support; `intoxicated=1` additionally declares
Entorpecido support and requires `memory=1`. Root `supportsMemory` and
`supportsIntoxicated` advertise host support. Only exact `1` is valid;
unknown/duplicate query keys are refused and GET variants share one read budget.
The lobby freezes 108 classic cards, 109 with memory, or 110 with both rare cards,
according to all seated humans' declarations (`memoryEnabled`/`intoxicatedEnabled`).
Unsupported enhanced-round reads/commands return 409
`juno_update_required` without a snapshot (existing `leave` is still allowed).
During `memoryCurse: {id,targetUserId}`, only the victim receives `hand: []`,
`maskedHand: {id}[]` and null `topCard`, `color`, `drawnCardId`. A blind attempt
uses ordinary `play/cardId`; no new endpoint/event. `memory_miss` confirms only
actor/id/actual draw amount, never the attempted card. Ranking URLs are unchanged.

`intoxication: {id,targetUserId}` lasts for the next player's turn. Valid ordinary
plays have a server-rolled 50% miss: retain cards, draw up to two and pass;
`lastMove.type: intoxicated_miss` exposes actor/id/actual amount only. Optional
`misplayedCard` is included solely in the actor's private response, never other
players' or spectators' views. Wild/+4 plays instead have a 50% chance to select
one of the three other colors (`intoxicatedColor: true`), with no extra draw-two
penalty and unchanged +4 legality/effects. No new command, endpoint or WS event.
Clients may retry only the initial GET capability probe as memory-only on exact
400 `invalid_body`, remembering the result in their existing scoped snapshot;
mutations are never replayed for compatibility.

Game people include current sanitized user/nickname data. Optional `scoreboard`
adds immutable final places/counts/XP and `pending|credited|unranked` status; clients
never submit awards. GET `/spaces/:spaceId/juno/ranking?limit=25&offset=0` returns
`JunoRankingPage` (`spaceId`, `limit`, `offset`, `total`, `entries`, `me`). Current
non-banned, non-deleted human membership is required; voice is not. Limit 1–50,
offset 0–1,000,000, integers only; unknown fields are refused. Ranks are shared by
equal total XP before pagination; own summary is returned even off-page. All Juno
reads are no-store, contain no opponent faces or historical channel details.
`addBot`/`removeBot` are host-only lobby actions for ephemeral computer opponents,
not account/voice bots. Optional `supportsBots`/`supportsAnnounce` advertise these
actions; absent on older hosts. Computer participants carry `computer: 1|2|3`
without a user profile. `practice` freezes true for computer rounds: zero XP,
wins or completed-round increments for everyone. A private computer hand is never
returned even when its id is used as viewer. `announce` confirms a two-card JUNO
call on the actor's turn without extending time; existing play.announce still works.
Optional lastMove.id remains stable across polls for non-replaying visual effects.
`supportsReports` advertises explicit missed-JUNO reporting. Public
`reportOpportunities: {id,targetUserId,remainingMs}[]` expose at most one window
per seated player, never hands/deck. Other seated humans may report out of turn
before ten seconds elapse; the first valid report draws two (or available cards),
without moving/extending the turn. Self/spectator/computer reporters and stale/
duplicate/expired ids are refused. Silence expires without a penalty. Cards gained,
departure or immediate round completion cancel the window. Reporter identity is
the authenticated host row, not request data; normal voice/revision/budget gates
apply. Confirmed report moves add targetUserId and actual amount. Older hosts omit
the capability and keep their legacy automatic-penalty rule/UI copy.

## Diagnostics

`POST /diagnostics` accepts 1–10 privacy-normalized fault events without credentials
(16 KiB/request, 12 requests/minute/IP and 256 KiB/minute process-wide). It returns
204; invalid input/body/budget use 400/413/429. Reports are untrusted and never
include message content or credentials. `GET /admin/diagnostics` uses the existing
auth/admin hooks and returns storage/drop/failure statistics only. See
[diagnostics.md](diagnostics.md) for the wire fields, privacy and 5 GB retention.

## Desktop access

Desktop version checks have been removed from HTTP, raw tus and LiveKit token
routes. Instance info no longer advertises a minimum desktop version, and the
legacy minimum-version environment setting is ignored. Authentication, account
validation, permissions and upload ownership checks remain required.

Deferred channel/DM sends have separate receipt-only methods using
the same existing endpoints: a successful HTTP response acknowledges delivery,
even if the orchestrator stopped during the request. No response body is
applied to stores. Failed/unconfirmed requests are not treated as delivered;
no new wire endpoint or server-side idempotency contract is introduced.

---

## Rate limiting

The space soundboard REST endpoints, permission gates and account/room budgets
are documented in [soundboard.md](soundboard.md). The upload accepts only
validated PCM WAV in base64 JSON, not the chat attachment/tus pipeline.

Soundboard playback preserves its authorization gates but names missing live
voice ownership, moderation mute and deafen using `soundboard_voice_required`,
`soundboard_muted` and `soundboard_deafened`. Its user/room two-second budgets
are atomic; a refusal returns the actual remaining `Retry-After` in seconds
and the same numeric `retryAfter` in JSON for cross-origin clients.

`utils/httpRateLimit.ts` registers two independent gates. Early `onRequest`
admission uses normalized trusted client addresses (IPv6 /64): API 5,000/min,
static/public assets 12,000/min, upload transport 6,000/min, WS handshakes
300/min and health 120/min, each independent. This is emergency shared-address
protection, not the ordinary account budget.

The plugin's ordinary `preHandler` runs after existing authentication: reads
are 1,200/min/account and mutations 600/min/account; anonymous API fallback is
600/min/address. Asset/WS/health/upload transport families remain separate.
`config.rateLimit` replaces only this ordinary plugin budget, never the early
gate. Protected route overrides use the verified hosting-instance account row,
not a bearer token, claimed identity or address. Public authentication and
diagnostics limits remain address-based. All counters are per process, not
distributed. The plugin caches at most 10,000 keys per store; action/fixed-window
registries also bound key cardinality and do not evict exhausted actors for
fresh admission.

The address comes from Fastify's `trustProxy`, which is a **count of trusted
hops**: the `TRUSTED_PROXY_HOPS` environment variable, default 1, read in
`config.ts` and documented there and in `.env.example`. At 1 the key is the
address the nearest proxy appended, and entries a client writes into
`X-Forwarded-For` are ignored. A deployment with a CDN in front of its own
proxy, or with no proxy at all, sets a different number; see
[web-security.md](web-security.md) section 9 and
[deployment.md](deployment.md), "Server proxy-awareness".

Channel + DM message creates share one account token bucket across REST, WS,
tabs and credentials: burst 12, refill 2/second, charged immediately before
persistence after validation. Reactions share burst 20/refill 5/second across
add/remove/transports; authorized idempotent no-ops do not spend action capacity.
Separate coarse gates still bound attempts. Upload creates remain 30/min/account,
PATCH 1,000/min/account; stickers 30, game icons 10, soundboard uploads 10,
Juno creates 5/actions 60 and pokes 5 per minute. Soundboard playback retains
atomic account+room 1/2s limits. Other protected route overrides retain their
counts/windows, now per verified account. `DISABLE_RATE_LIMITS=1|true` is an
explicit test-only bypass, never set in production.

Over the limit: `429` with the shared error body (`{ error, code:
'rate_limited', statusCode: 429 }`, see [localization.md](localization.md))
plus numeric `retryAfter` in whole seconds and `Retry-After`, including manual
limits' actual remaining wait. Optional `rateLimitScope` is a closed vocabulary:
`http`, `action`, `resource`, `transport`. CORS exposes retry/limit headers.
Clients bound wait metadata to 1..3600s, supporting numeric JSON and header
seconds/HTTP dates. Scoped GETs may retry once (at most 60s + 0..250ms jitter),
deduplicated per target/client and cancelled on session/origin teardown.
Unscoped legacy 429s throw immediately. Mutations never use this read recovery.

---

## Auth (`routes/auth.ts`) — public, rate-limited
```
POST /auth/register         { username, password, displayName?, avatarColor?, inviteToken? } → { token, user }
GET  /auth/check-username    ?username= → { available, reason? }
GET  /auth/check-invite      ?token=    → CheckInviteResponse
POST /auth/login             { username, password } → { token, user }
```

**Login** verifies only the retained local account/password hash, including valid
sovereign legacy handles. Failed credentials never contact another host or rewrite
the hash. Signup gating does not block existing-account login.

**Registration** is create-only, with strict native usernames and a single local
gate. Submitted identity/bot/admin fields cannot choose another admission path,
claim an existing account or grant privileges. When `registrationOpen` is true,
ignore invitation tokens without consumption. When closed, require an active
token: account insertion, use-count increment and redemption audit are atomic and
revalidated under the transaction. Refuse with `invite_required` or `invite_invalid`
without consuming a slot. The attach-proof endpoint is unregistered (JSON 404).

**`GET /auth/check-invite`** — public, rate-limited 30/min/IP. Always returns 200; the body discriminates:

```typescript
type CheckInviteResponse =
  | { valid: true; name: string }            // active token; name surfaces for UX
  | { valid: false; reason: 'expired' | 'exhausted' | 'invalid' };
```

`revoked`, malformed (non-22-char-base64url), and not-in-DB tokens all collapse to `'invalid'` (enumeration shield). `name` is returned **only** in the valid case.

## Users (`routes/users.ts`) — auth required
```
GET    /users/@me                                        → user (self view)
PATCH  /users/@me             { displayName?, avatar?, banner?, accentColor?, avatarColor?,
                                bio?, customStatus?, status?, discoverable?, showActivity?, developerMode? } → updated user (self view)
POST   /users/@me/verify-password  { password }          → { valid }
POST   /users/@me/change-password  { currentPassword, newPassword } → { token }
DELETE /users/@me             { password, username }      → { success }
PUT    /users/@me/space-layout { items, folders, updatedAt? } → { items, folders, updatedAt }
GET    /users/:id                                        → user (public view)
GET    /users/:id/mutuals                                 → { mutualFriends[], mutualSpaces[] }
```

**Status:** `online`, `idle` or `dnd`; `offline` and unknown values are refused.
Save `users.chosen_status`; publish live status only while connected. A status-only
body is valid. Presence uses local account ids only.

**Local self-service:** every retained account manages its own local profile and
must verify the current local password for change/deletion. Bots still cannot
edit owner-only durable profile fields through their own token. Profile broadcasts
use public profiles for observers, self views only for the same account; private
`developerMode`/`showActivity` preferences never reach friends.

**Profile assets:** local avatar/banner changes require the caller's own loose
upload, not a message-held or already profile-referenced file. Bare filenames and
exact `/api/uploads/<filename>` forms normalize before comparison. Re-saving the
same current file does not delete or resize it; replacement retains any file still
referenced by native content. Normal HTTP(S) external image references remain
references only, without local file mutation. Invalid asset input uses the
existing `avatar_url_invalid` / `banner_url_invalid` codes.
Space create/update and bot avatars reuse this same loose-upload authority and
surviving-reference inventory. Group DM icons additionally retain their existing
owner/image/size checks and refuse message-held attachments. Native deletion paths
preserve historical shared files rather than erasing another holder's bytes.

**Sidebar layout:** only current native memberships may be named; existing folder
IDs must belong to the authenticated account. New folders use `new:*` keys mapped
to server-generated IDs. Unknown/foreign folders, invalid field types and dangling
folder references are `validation_failed` before any write. Stale timestamps keep
the existing last-write-wins response; no foreign-folder import path remains.

Registry, remote credential and remote identity-deletion endpoints are
unregistered, not compatibility handlers. No user response carries home identity,
replication registry or password hashes. Mutuals uses the exact local path id,
never a query-string identity fallback.

## Spaces (`routes/spaces.ts`) — auth required
```
GET    /spaces                                                                 → { spaces[] }
POST   /spaces                { name, icon?, description? }                    → { space }   [spaceCreationOpen or admin]
GET    /spaces/:id                                                             → { space, channels[], members[], roles[] }
PATCH  /spaces/:id            { name?, icon?, banner?, description?, visibility?, avatarColor?, ownerTitle?, afkChannelId?, afkTimeoutSeconds? } → { space }   [MANAGE_SPACE; ownerTitle: owner]
DELETE /spaces/:id                                                             → { success }  [owner]
POST   /spaces/:id/invite                                                      → { inviteCode }  [CREATE_INVITE]
POST   /spaces/:id/join       { inviteCode }                                   → { space }
POST   /spaces/join           { inviteCode }                                   → { space }
GET    /spaces/invite/:code/preview                                            → InvitePreview (no auth)
PATCH  /spaces/:id/transfer-ownership  { newOwnerId }                          → { space }  [owner]
```
`POST /spaces/:id/invite` answers every visibility, `request` included (up to 1.9.0 it refused a request space with `403 space_uses_join_requests`). The two join routes never admit anyone to a `request` space: after the code matches they answer `403 user_banned`, `409 already_member`, then, for a request space, `409 join_request_pending` when the caller's request is waiting and otherwise `403 join_request_required` with `details: { spaceId }`, the id for `POST /spaces/:id/request-join`. They read the space's visibility on each call, so a code follows the space when its visibility changes. `InvitePreview` carries `visibility` (absent from an instance up to 1.9.0). See [spaces.md](spaces.md), "Join by Invite Code".
The legacy `directoryListed` input is ignored; it is absent from all active
space/ready/accepted-request responses. Retained edits never clear or change
the stored historical flag. An unknown-only PATCH keeps the existing
`no_fields_to_update` response. See [directory.md](directory.md).
`ownerTitle` accepts a string or null (reset), only from the authenticated native owner (`request.userId === spaces.owner_id`). Any other caller gets `403 space_owner_only` with no body fields written. Shared `normalizeOwnerTitle` trims strings and rejects blank/invisible values, more than 32 UTF-16 code units (`MAX_OWNER_TITLE_LENGTH`), controls, line/paragraph separators and bidi controls with `400 space_owner_title_invalid` / `details.max`. Blank does not reset. Space responses/ready carry null when unset; ownership transfer clears the title. Servers through 1.10.0 omit/ignore the field.

`afkChannelId` (a same-space voice channel id, or `null` to switch the feature off) and `afkTimeoutSeconds` (one of `AFK_TIMEOUT_OPTIONS`: 60/300/900/1800/3600) need `MANAGE_SPACE`. Anything else is refused before anything is written: an unknown id, a text channel or a channel of another space is `400 space_afk_invalid_channel`; any other timeout is `400 space_afk_invalid_timeout`. The timeout stores even while no channel is set; the move only happens while a set channel still exists and is still voice. `Space.afkChannelId` (`null` when off) and `Space.afkTimeoutSeconds` ride every space response and the ready payload; both are optional on the wire, absent from instances up to 1.13.x. Enforcement is client-side (voice.md, "AFK moves").

### Members
```
GET    /spaces/:id/members                               → { members[] }
PATCH  /spaces/:id/members/:uid  { roleIds?, nickname? } → { member }  [roleIds: MANAGE_ROLES; nickname: self, or MANAGE_SPACE]
DELETE /spaces/:id/members/:uid                          → { success }  [KICK_MEMBERS|self]
```
`PATCH /members/:uid` takes `roleIds`, `nickname` or both; a body with neither, or one that is not an object, answers `400 validation_failed`. Every field is checked before anything is written, and both are written in one transaction, so a refused field leaves the other unchanged too. `nickname` is the member's name in this space (`space_members.nickname`); the account name is not touched. Anyone may set their own. Setting another member's needs `MANAGE_SPACE` (`403 missing_permission`), never reaches the owner (`403 space_owner_only`) and needs a higher rank (`403 role_hierarchy`). The value goes through `normalizeMemberNickname` (`packages/shared/src/constants.ts`): `null` or a string that trims to nothing clears it; otherwise it is trimmed and refused with `400 member_nickname_invalid` (`details: { max }`) when longer than `MAX_MEMBER_NICKNAME_LENGTH` (32 UTF-16 code units), when it holds a control character, a line or paragraph separator or a bidirectional control, or when it has no visible character. The answer is followed by `member_updated` to the space (websocket.md); a role change is also followed by `space_access_changed`. Instances up to 1.9.x read only `roleIds` and refuse a nickname-only body (`role_ids_invalid`, `cannot_change_own_roles` or `missing_permission`).

### Bans
```
GET    /spaces/:id/bans                                  → { bans[] }  [BAN_MEMBERS]
POST   /spaces/:id/bans       { userId, reason? }        → { success }  [BAN_MEMBERS]
DELETE /spaces/:id/bans/:uid                             → { success }  [BAN_MEMBERS]
```

### Roles
```
POST   /spaces/:id/roles              { name, color?, permissions? }              → { role }  [MANAGE_ROLES]
PATCH  /spaces/:id/roles/:rid         { name?, color?, position?, above?, below?, permissions?, permissionsVersion? }  → { role }  [MANAGE_ROLES]
DELETE /spaces/:id/roles/:rid                                                     → { success }  [MANAGE_ROLES]
POST   /spaces/:id/members/:uid/roles { roleId }                                 → { success }  [MANAGE_ROLES]
DELETE /spaces/:id/members/:uid/roles/:rid                                        → { success }  [MANAGE_ROLES]
```
Kick, ban, the member role routes and the role routes also enforce the role hierarchy, answering `403 role_hierarchy` (permissions.md, "Role hierarchy"). `POST` and `PATCH /roles` also apply the held-bits rule (permissions.md, "Held-bits rule"): switching on a bit the actor does not hold answers `403 cannot_grant_unowned_permissions`, switching one off `403 cannot_change_unowned_permissions`; `DELETE /roles/:rid` of a role carrying a bit the actor does not hold answers `403 cannot_change_unowned_permissions`, and giving a member such a role (`PATCH /members/:uid`, `POST /members/:uid/roles`) `403 cannot_grant_unowned_permissions`; a `permissions` value that is not a canonical non-negative decimal string answers `400 permissions_invalid` (permissions.md, "Stored form"). `PATCH /roles/:rid` with `permissions` also takes `permissionsVersion`, the `rolePermissionsVersion` of the permissions the editor loaded: when the role's stored permissions have another version by then, the whole request answers `409 role_permissions_conflict` and nothing changes; a `permissionsVersion` that is not a non-empty string answers `400 validation_failed`. Without it (clients from before the check, 1.9.x and older) the write is not compared, and without `permissions` it is ignored (permissions.md, "Concurrent edits"). Editing a role below the actor is allowed whoever holds it, members ranked above the actor included (permissions.md, "Lower roles held by senior members"). `PATCH /members/:uid` takes `roleIds`, the member's whole role set: a list of distinct role id strings, else `400 role_ids_invalid`. Every write in this section is followed by `space_access_changed` to the space's connected members (websocket.md). `PATCH /roles/:rid` answers `404 role_not_in_space` for a role of another space. `PATCH /roles/:rid { position }` moves the role to that position (1 = just above @everyone) and renumbers the others; `{ above: roleId }` or `{ below: roleId }` instead moves it directly next to that role of the space and the request's `position` is then ignored (permissions.md, "Setting the order"): naming both, the role itself, @everyone with `below`, or a non-string answers `400 validation_failed`, a role of another space `400 role_not_in_space`. A new role is created at 1. The single-role routes refuse a role of another space with `400 role_not_in_space`.

A role in any answer carries `permissions` only for a viewer who holds `MANAGE_ROLES` in the space: `GET /spaces/:id` lists every role with its display fields for every member and with its bits for managers, member rows (`GET /spaces/:id/members`, `PATCH /members/:uid`, `members[]` of the detail) list roles with display fields only, and the `POST`/`PATCH /roles` answers are shaped for what the actor holds after the change (permissions.md, "Who receives role and override data").

`DELETE /spaces/:id/roles/:rid` answers `404 role_not_in_space` for a role id that is not in the space, and otherwise deletes the role together with every channel and category override that names it (overrides carry no foreign key to the role).

## Channels (`routes/channels.ts`) — auth required
```
GET    /spaces/:id/channels                              → { channels[] }  [VIEW_CHANNEL]
POST   /spaces/:id/channels   { name, type?, topic?, categoryId? } → { channel }  [MANAGE_CHANNELS]
PATCH  /channels/:id          { name?, type?, topic?, categoryId? } → { channel }  [MANAGE_CHANNELS]
DELETE /channels/:id                                     → { success }  [MANAGE_CHANNELS]
PATCH  /spaces/:id/channels/reorder  { order }           → reordered  [MANAGE_CHANNELS]
```

`topic` is a string of at most `CHANNEL_TOPIC_MAX_LENGTH` (1024) characters after `normalizeChannelTopic`; on PATCH, `null` or a blank string clears it. A non-string answers `400 channel_topic_invalid`, a longer topic `400 channel_topic_length` with `{ max }` (spaces.md, "Create Channel").

### Channel Overrides
```
GET    /channels/:id/overrides                                   → { channelId, targetType, targetId, allow, deny, version }[]  [MANAGE_ROLES]
PUT    /channels/:id/overrides  { targetType, targetId, allow, deny, version? } → { success, version }  [MANAGE_ROLES]
DELETE /channels/:id/overrides/:targetType/:targetId  ?version=   → { success }  [MANAGE_ROLES]
```
All three check `MANAGE_ROLES` space-wide (permissions.md, "Client gating"). `PUT` and `DELETE` (here and on categories) also follow the role hierarchy (permissions.md, "Role hierarchy"): an override on a role at or above the actor's top role, or on another member ranked at or above the actor, answers `403 role_hierarchy`; a `PUT` naming a role that is not in the space answers `400 role_not_in_space`. `PUT` and `DELETE` (here and on categories) also apply the held-bits rule against the stored override (permissions.md, "Held-bits rule"): a newly allowed unheld bit answers `403 cannot_grant_unowned_permissions`, a newly denied one `403 cannot_deny_unowned_permissions`, and clearing one, or deleting an override that sets one, `403 cannot_change_unowned_permissions`. `DELETE` removes the override row, so the target falls back to its space-wide permissions in that channel; the category routes below do the same for a category. A `PUT` or `DELETE` is followed by `channel_updated` (with the recipient's new `myPermissions`) or `channel_deleted` for each connected member of the space, and a category write also sends `category_updated`. `allow` and `deny` are canonical non-negative decimal strings, else `400 override_bits_invalid`; one left out sets no bits (permissions.md, "Stored form"). The editor stages removals and sends them on Save.

Concurrent edits (here and on categories; permissions.md, "Concurrent edits"): each listed row carries `version` (`overrideVersion` in `packages/shared/src/permissions.ts`, derived from its allow and deny), and a `PUT` answers the `version` of the row it wrote. A `PUT` with `version` (the version of the row the editor loaded, `"none"` when it loaded no row for that target) answers `409 overrides_conflict` and writes nothing when the stored row has another version, including when a row was created meanwhile. A `DELETE` with `?version=` answers the same when the row still exists with another version; a row already gone answers `200`. A `version` that is not a non-empty string answers `400 validation_failed`. Without `version` (clients from before the check, 1.9.x and older) the write is not compared, as before. The check runs after the hierarchy check and before the held-bits rule.

### Categories
```
POST   /spaces/:id/categories        { name }              → { category }  [MANAGE_CHANNELS]
PATCH  /categories/:id               { name?, position? }  → { category }  [MANAGE_CHANNELS]
DELETE /categories/:id                                      → { success }  [MANAGE_CHANNELS]
GET    /categories/:id/overrides                            → { categoryId, targetType, targetId, allow, deny, version }[]  [MANAGE_ROLES]
PUT    /categories/:id/overrides     { targetType, targetId, allow, deny, version? } → { success, version }  [MANAGE_ROLES]
DELETE /categories/:id/overrides/:tt/:tid  ?version=        → { success }  [MANAGE_ROLES]
```

## Messages (`routes/messages.ts`) — auth required
```
GET    /channels/:id/messages  ?before=|after=&limit=50 (1-100) → MessageWithUser[]  [VIEW_CHANNEL+READ_MESSAGE_HISTORY]
POST   /channels/:id/messages  { content, attachments?, replyToId? } → { message }  [SEND_MESSAGES, +ATTACH_FILES, +MENTION_EVERYONE]
PATCH  /messages/:id           { content }                → { message }  [author, +MENTION_EVERYONE]
DELETE /messages/:id                                      → { success }  [author|MANAGE_MESSAGES]
```
`replyToId` on POST must name a message in the same channel, otherwise `400 Invalid reply target` and nothing is inserted. See permissions.md, "Reply-target confinement".

Content with `@everyone`, `@here` or a role token (`<@&roleId>`) outside code needs MENTION_EVERYONE on the channel: without it POST answers `403 missing_permission` (`details.permission` = `MENTION_EVERYONE`) and nothing is stored. PATCH refuses the same way only when the edit adds a mass mention the stored message did not have. Every channel message the server returns or broadcasts carries `mentionEveryone: boolean` and `mentionRoleIds: string[]`, read from its content; a system message carries `false` and `[]` whatever its content holds. See permissions.md, "Mass mentions".

Every channel message also carries `type`: `user`, or `system` for a row the instance wrote (a poke; websocket.md, "Channel pokes"). History and messages-around return system rows in place; a 1.10.0 or older server sends no `type` and has no channel system rows. A system row is never created over REST. PATCH on one answers `403 system_message_immutable`, its author included, before the author check. A POST whose `replyToId` names a system row is `400 reply_target_invalid`. Channel search (below) leaves system rows out of its results and its count.

## Pins (`routes/pins.ts`) — auth required, text channels only
```
GET    /channels/:id/pins              → { pins: PinWithMessage[] }  [VIEW_CHANNEL+READ_MESSAGE_HISTORY]
POST   /channels/:id/pins  { messageId } → { pin: PinnedMessage }    [MANAGE_MESSAGES]
DELETE /channels/:id/pins/:messageId   → { success }                 [pinner|MANAGE_MESSAGES]
```
A pin is one message on the board; the board holds at most `MAX_PINS_PER_CHANNEL` (50). POST names a message of the same channel (`404 message_not_found` otherwise) and is idempotent: pinning a pinned message answers `200` with the existing pin. A full board is `409 pin_limit_reached` (`details: { max }`). DELETE takes the pinner themself (matched by `pinned_by_id`) or anyone holding `MANAGE_MESSAGES` on the channel; anything else pinned is `404 pin_not_found`. Voice channels, unknown channels and DMs all answer `404 channel_not_found`: pins are space text channels in v1. Every write broadcasts (`message_pinned` with `pinnedById`, `message_unpinned`; websocket.md, "Messages"). GET hydrates each pin lightly — author plus attachments, no embeds, no reactions, no reply chain — oldest first (`createdAt`, id breaking ties); a pin whose message row is gone hydrates to `message: null` instead of failing the list. Deleted messages and channels cascade their pins away.

### Message history paging

`GET /channels/:id/messages` and `GET /dm/:id/messages` share one implementation (`utils/messagePaging.ts`) and one contract. Both answer a bare array, oldest first: ordered by `createdAt`, the id breaking ties. Permission checks and hydration (authors, attachments, reactions, embeds, reply targets) do not depend on the direction.

| Query | Page |
|-------|------|
| neither cursor | the `limit` newest messages |
| `before=<id>` | the `limit` messages with id less than `<id>` and the newest `createdAt` |
| `after=<id>` | the `limit` messages with the smallest ids greater than `<id>`: the next ids after it |
| both | `400 paging_cursor_conflict`, nothing selected |

- `limit` defaults to 50 and is clamped to 1-100. An empty cursor (`after=`) counts as absent. A repeated cursor (`after=a&after=b`) is `400 validation_failed`.
- Cursors compare snowflake ids; the cursor message need not exist (a deleted message is a valid cursor).
- **Next forward cursor:** the greatest id in the page, not the last element. A relayed DM message keeps its sender's `createdAt` but gets a local id on arrival, so it can sort earlier in the page than its id says. Cutting at the greatest id never skips or repeats a row.
- **End of history:** a forward page shorter than `limit` reached the newest message at the time of the request; an empty forward page means nothing is newer than the cursor.
- **Signal:** a response that honoured `after` carries `X-Backspace-Paging: after` (`MESSAGE_PAGING_HEADER` / `MESSAGE_PAGING_AFTER` in `@veyvox/shared`), the empty page included. Backward, newest and error responses never carry it. A server that predates forward paging ignores `after` and answers with the newest page and no header, so a client that sent `after` and finds no header must treat the body as the newest page, not as the page after its cursor. The header is in the CORS `exposedHeaders`, so a browser on another instance can read it (web-security.md, section 6).

## DMs (`routes/dm.ts`) — auth required
```
GET    /dm                                                          → DmChannel[] (open DMs, same shape as the ready payload, newest activity first)
POST   /dm                     { userId }                            → DmChannel (200 existing 1-on-1, 201 new)
POST   /dm/group               { users: [{ id }], fromDmChannelId? } → 201 DmChannel [2-9 users + caller; each a friend, own bot, or authorized source 1-on-1 member]
PATCH  /dm/:id                 { name?, icon? }                     → { id, name, icon, metadataUpdatedAt } [owner; group only]
DELETE /dm/:id                                                      → { success } [member] (soft-close)
POST   /dm/:id/members         { userId }                            → DmChannel [any member; group only; friend or own bot; max 10]
DELETE /dm/:id/members                                              → { success } (leave) [group only]
DELETE /dm/:id/members/:targetUserId                                → { success } [native owner kick; cannot self-kick; group only]
POST   /dm/:id/transfer        { newOwnerId }                        → { success } [owner; group only; existing live member; not self]
POST   /dm/space-invite        { target: { userId }, spaceId, spaceInstanceOrigin, inviteCode } → SpaceInviteResponse [local friend/current-instance invite; foreign host refused; request-to-join gate unchanged]
GET    /dm/:id/messages        ?before=|after=&limit=50 (1-100)     → DmMessageWithUser[] [member]
POST   /dm/:id/messages        { content?, attachments?, replyToId? } → 201 DmMessageWithUser [member; content or attachments required]
PATCH  /dm/messages/:id        { content }                          → DmMessageWithUser [member and author; 403 not_dm_member after leaving the group; 403 system_message_immutable for a system message]
DELETE /dm/messages/:id                                             → { success } [member and author; 403 not_dm_member after leaving the group]
```

**Native identity only.** All DM targets are existing local account ids. No
request variant resolves, provisions or renames an account through another server.
`pair_key` is private storage, never a `DmChannel` property. Channel/user/message
serializers omit all retired copy and home-identity metadata.

**`POST /dm`** — Transactional native pair lookup, exact-membership reuse or
insertion through `findOrCreateOneOnOne`. 201 new / 200 existing, with the same
serializer as ready/list. Reopens only the caller; a recipient stays closed until
the first new message/call delivers `dm_channel_created`. See [dm-system.md](dm-system.md).

**`PATCH /dm/:id`** — Owner/member-only group name/icon update. Fields may be
omitted, cleared or set; whitespace names clear. Local icon files require image
type, size and upload ownership checks; validated HTTP(S) URLs retain support.
No-ops emit nothing. Channel/system-message writes are atomic; broadcasts and
old-icon cleanup follow commit.

**Kick** — Native owner removes another current member, using the leave helper
with `reason:'kick'`. Evicts the target's DM voice seat first, cleans their read
state and sends `dm_channel_closed`; owner/type cannot be orphaned by a kick.

**Transfer** — Authenticated owner names another existing live member. Atomically
updates `ownerId` and inserts an `owner_changed` message authored by the previous
owner; emits `dm_owner_updated {dmChannelId,newOwnerId}` after commit. Self-leave
uses the same native ownership helper.

## Social (`routes/social.ts`) — auth required
```
GET    /social/friends                                    → Friend[]
GET    /social/requests                                   → FriendRequest[]
POST   /social/requests        { username }                → { success, requestId }
PATCH  /social/requests/:id    { status: 'accepted'|'declined' } → { success }
DELETE /social/requests/:id                               → { success } (cancel, sender-only)
DELETE /social/friends/:id                                → { success }
GET    /social/discover        ?q=&limit=&offset=         → { users[], total }
GET    /social/search          ?q=                        → { users[] }
```

### POST /api/social/requests — native target & error codes

`SendFriendRequest` requires a username. Lookup trims and lowercases the exact
native name and excludes deleted accounts. Retained `@` handles are never split
into a different local name or used to contact another host. Obsolete identity
metadata cannot choose the target or claim another sender.

| HTTP | error code | When |
|---|---|---|
| 201 | (success, created) | New friend request created |
| 400 | `username_required` | Missing/empty/non-string username |
| 400 | `cannot_friend_self` | Native target ID matches authenticated sender |
| 400 | `bots_no_friends` | Target is a bot |
| 400 | `already_friends` | Friendship row already exists |
| 400 | `friend_request_pending` | Either direction already has a pending request |
| 403 | `bots_native_only` | Caller is a bot |
| 404 | `user_not_found` | No live native account has that exact name |

Acceptance/decline requires the authenticated recipient and a pending request;
cancellation requires the authenticated sender and a pending request. Refusals
leave the native graph unchanged. Successful acceptance snapshots native presence.

## Search (`routes/search.ts`) — auth required
```
GET /channels/:id/search         ?q=&from=&has=&before=&after=&offset=&limit= → { results[], totalCount }  [VIEW_CHANNEL]
GET /channels/:id/messages/around ?messageId=&limit=                           → { messages[] }
GET /dm/:id/search               ?q=&from=&has=&before=&after=&offset=&limit= → { results[], totalCount }
GET /dm/:id/messages/around      ?messageId=&limit=                           → { messages[] }
```
has: `file`|`image`|`link`

Channel search matches only messages members wrote (`userWrittenMessages()`); a poke's JSON content is not text anyone wrote. DM search still returns DM system rows.

## Join requests (`routes/joinRequests.ts`) — auth required

Independent of discovery: invitations and space managers use these paths.
`BackspaceApiClient.joinRequests` groups them as `request`, `list`, `decide`
and `mine`; the REST paths, permissions and rate limit are unchanged.
```
POST   /spaces/:id/request-join          { message? }        → { request }  [5/min; also where an invite to a request space leads]
GET    /spaces/:id/join-requests         ?status=            → { requests[] }  [MANAGE_SPACE]
PATCH  /spaces/:id/join-requests/:rid    { action }          → { request }  [MANAGE_SPACE]
GET    /users/@me/join-requests          ?status=            → { requests[] }
```

## Retired discovery APIs (1.15.2)

`GET /directory`, `GET /directory/spaces`, `GET /spaces/explore` and
`POST /spaces/:id/public-join` no longer exist. With the `/api` prefix these
return JSON 404, not the SPA HTML fallback. There is no proxy, listing document
or pinger and old `DIRECTORY_ENDPOINT` is ignored. Invitation admission and
join-request routes remain; see [directory.md](directory.md).

## Uploads (`routes/files.ts`, `routes/uploads.ts`)

### Tus Upload Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/files/` | JWT | Create resumable upload. Returns `Location` (upload URL) and `Upload-Expires`. |
| HEAD | `/api/files/:uploadId` | JWT (ownership) | Probe `Upload-Offset` for resume. |
| PATCH | `/api/files/:uploadId` | JWT (ownership) | Append bytes at offset. |
| DELETE | `/api/files/:uploadId` | JWT (ownership) | Abort. |

The final PATCH that completes an upload returns the `Attachment` JSON in its response body. See `docs/systems/uploads.md` for the full pipeline (PRE_CREATE / PRE_PATCH / POST_FINISH hooks, storage layout, janitor).

### File Serving
```
GET  /uploads/:filename  (public, supports Range) → file stream
```
Served `Cache-Control: public, max-age=31536000, immutable`: a stored file's name is the snowflake it was given at upload and its bytes are never rewritten, so the name identifies one immutable file for good. The sandboxing headers on the same response (`default-src 'none'` CSP, `nosniff`, `X-Frame-Options: DENY`, `Content-Disposition: attachment` for SVG and non-media) are in [uploads.md](uploads.md) and [web-security.md](web-security.md).

## Personal stickers (`routes/stickers.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/stickers` | JWT | Current user's collection, newest first: `{id, name, token}[]` |
| POST | `/api/stickers` | JWT | `{name, image}`; canonical base64 image bytes. Creates or reuses an asset and collects it |
| POST | `/api/stickers/:id/collect` | JWT | `{token, name}`; collects an existing local asset under `name` |
| PATCH | `/api/stickers/:id` | JWT | `{name}`; renames only the current user's entry, returns `{id, name, token}` |
| DELETE | `/api/stickers/:id` | JWT | Removes only the current user's entry |
| GET | `/api/stickers/assets/:id.webp` | Public | Immutable WebP; anyone holding the link can read it |

Upload, collect and rename return `{id, name, token}`. The id is the SHA-256 of the re-encoded WebP bytes; the token is `sticker:<canonical absolute asset URL>`. Names follow `normalizeStickerName` (packages/shared/src/stickers.ts): trimmed, 1 to 100 characters, one line, at least one visible character, no control or bidirectional characters. Uploads accept PNG, JPEG, WebP and GIF up to the configured sticker size (`instance_settings.maxStickerSizeBytes`, admin Storage settings, `MAX_STICKER_SIZE` env, default 5 MiB) with a 67,108,864 decoded-pixel cap across frames, stored within 512 x 512; the JSON body limit allows for base64. Refusals: `400 sticker_name_invalid` (`details.max`, a name the rule above refuses), `400 validation_failed` (base64 that is not canonical), `400 sticker_invalid_image` (`details.max`, in MB), `400 sticker_pixel_limit_exceeded` (too many frames/resolution), `409 sticker_collection_full` (`details.max`, 200 entries), `429 rate_limited` (30 uploads per account per minute, counted in the route after auth, next to the per-address limit), `400 sticker_not_local` (a collect token that is not this instance's), `404 sticker_not_found` (unknown asset, a rename of an entry the caller does not have, or a lost file on the asset route). No WebSocket event follows a collection change; the picker reads the collection each time it opens. Collection is idempotent, and removal never deletes a shared asset; unused assets are removed by the storage cleanup. Full description: [uploads.md](uploads.md#14-personal-stickers).

## Sticker packs / store (`routes/stickerStore.ts`, `routes/stickerStoreAdmin.ts`) — auth required

Native sticker packs are versioned, curated sets: `draft` → `pending_review` → `approved` or `rejected`. Limits remain 100 items (`MAX_STICKERS_PER_PACK`), 100-character names and 500-character descriptions. Members create/upload under personal-sticker image/size rules; only instance admins approve/reject. Users install approved packs (`user_installed_packs`); the picker combines their collection and installed packs.
```
GET    /api/sticker-store/packs              → approved/active local packs (optional auth: installs flagged)
GET    /api/sticker-store/packs/:id          → pack detail with active items
POST   /api/sticker-packs                    { name, description? } → draft pack
PATCH  /api/sticker-packs/:id                { name, description? } → save candidate metadata (creator only)
POST   /api/sticker-packs/:id/items          { name, image } → append (409 sticker_pack_limit_exceeded past 100)
POST   /api/sticker-packs/:id/submit         → draft → pending_review
POST   /api/sticker-store/packs/:id/install  → install for the caller (idempotent)
DELETE /api/sticker-store/packs/:id/install  → uninstall
GET    /api/sticker-store/my-packs           → caller's installed packs, hydrated
GET    /api/sticker-packs/created            → caller's own packs (any status)
```
Admin (`requireAdmin`): reviews, approve/reject, list/status of local packs.
Pack summaries omit origin/copy provenance. Submission/versioning/publication,
install/uninstall and native moderation remain intact. No peer policy or remote
sync endpoint is registered, even for admins. Store reads emit no WS events.

Publication and candidate review are independent: `sticker_packs.currentVersion`
and its metadata continue serving the approved version while the next version
is draft, pending or rejected. Only approval switches the publication. Creator
summaries include optional `editingVersion`/`editingStatus`; creator detail
returns candidate metadata/items. Admin review lists/previews use that candidate,
not the public store. PATCH and item reorder accept only draft/rejected versions;
reorder must name every active candidate item exactly once. Uploads recheck
ownership, state and capacity in their final transaction after encoding.
Optional store authentication accepts both `Bearer` and `Bot` schemes.

Sticker upload authentication runs at `onRequest`, before JSON parsing. Both
personal and pack uploads enforce the configured base64 byte envelope on the
received stream (also for chunked bodies), capped at 500 MiB JSON, with HTTP 413
before validation on excess. Unauthenticated uploads receive 401 before parsing.

## Game icons (`routes/gameIcons.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/game-icons` | JWT | `{image}`; canonical base64 of a PNG, JPEG or WebP of at most 512 KiB (`MAX_GAME_ICON_BYTES`). Re-encodes to a 256 px WebP, stores it content-addressed and records it for the account. Returns `{id, url}` with the absolute URL of the asset. 10 uploads per account per minute (`429 rate_limited`); `409 game_icon_collection_full` at 25,600 icons; `400 game_icon_invalid_image` for anything else |
| GET | `/api/game-icons/assets/:id.webp` | Public | Immutable WebP; anyone holding the link can read it. `404 game_icon_not_found` for an unknown id or a missing file |

## GIF (`routes/gif.ts`) — auth required
```
GET /gif/enabled                         → { enabled }
GET /gif/trending   ?limit=&pos=         → { results[], next }
GET /gif/search     ?q=&limit=&pos=      → { results[], next }
```
Backend: Klipy API (requires `gifApiKey` in instance_settings)

## Voice (`routes/livekit.ts`) — auth required
```
POST /livekit/token  { channelId | dmChannelId } → { token, url }
```
Permissions checked: CONNECT, SPEAK, STREAM (space channels). DM calls: always full grants.

## Instance (`routes/instance.ts`) — public
```
GET /instance/info → { name, version, registrationOpen, spaceCreationOpen, sourceCodeUrl, commit, maxStickerSizeMb }
```
The Support-card field was retired in 1.15.2 with the project hub; no active
response exposes it. Generated 0050 removes its inert database column.
Discovery/directory status fields are retired and omitted, not reported as false.
`sourceCodeUrl: string` and `commit: string | null` provide the **AGPL-3.0 § 13 network-use source offer** for the running version. `BACKSPACE_SOURCE_URL` defaults to `https://github.com/bernardokcosta/veyvox`; further forks MUST point to their own source. `BACKSPACE_COMMIT` is injected by `deploy.sh` at Docker build, null in local dev. `SourceCodeLink` exposes source/version in settings and pre-auth pages; desktop exposes it in tray/app menus and About.

## Settings (`routes/settings.ts`)
```
GET   /settings/streaming    (auth)        → InstanceStreamingLimits
PATCH /settings/streaming    (admin)       → InstanceStreamingLimits
GET   /settings/instance     (admin)       → InstanceAdminSettings
PATCH /settings/instance     (admin)       { instanceName?, registrationOpen?, spaceCreationOpen?,
                                              gifApiKey?, maxUploadSizeMb?, maxStickerSizeMb? } → InstanceAdminSettings
```
`registrationOpen` and `spaceCreationOpen` are independent boolean controls;
invalid types are refused. Native registration falls back to the configured env
default while its DB override is null. Space creation defaults to enabled and
does not restrict admins. A changed space-creation setting is broadcast as
`instance_settings_updated` to connected clients.

Legacy discovery/directory settings/status/count PATCH keys are ignored like
unknown fields on both settings routes. Responses omit them and their stored
inert columns are permanently removed by 0050. Instance name, native registration,
space creation, upload/sticker limits and GIF policy remain; no write marks a directory dirty.

Legacy `supportCardEnabled` input is ignored by the settings PATCH like any
unknown field. No current column remains for that switch.

## Notification settings (`routes/notificationSettings.ts`) — auth required
```
GET   /users/@me/notification-settings                 → { settings: NotificationSetting[] }
PATCH /spaces/:spaceId/notification-settings     { level?, mute?, suppressEveryone?, suppressRoles? } → NotificationSetting
PATCH /channels/:channelId/notification-settings { level?, mute? } → NotificationSetting
```
The signed-in native account's per-space/channel settings on the selected server.
The client uses its primary API, not an origin/credential resolver. Rules are in
[sounds.md](sounds.md) ("Notification settings"); persistence is
`notification_settings` ([database.md](database.md)).

`NotificationSetting` is `{ spaceId, channelId: string | null, level: 'all' | 'mentions' | 'nothing' | null, muted, mutedUntil: number | null, suppressEveryone, suppressRoles, updatedAt }`. The two suppress flags (booleans, false by default, sent by servers since MENTION_EVERYONE and absent before) belong to the space setting; a channel setting always has them false. `channelId` null is the space-wide setting. `level` null is "not chosen": a channel inherits its space, a space uses `mentions`. `muted` with `mutedUntil` null lasts until lifted; a timed mute ends at `mutedUntil` (epoch ms, server clock). `updatedAt` is the server's write time and is always later than the stored one, so clients merge last-write-wins.

The PATCH body changes only the fields it carries, and needs at least one: `level` is a level or null (clear), `mute` is `'1h' | '8h' | '24h' | 'indefinite'` or null (lift), and on the space route only `suppressEveryone` and `suppressRoles` are booleans. A suppress field on the channel route, or a field of the wrong type, is `400 validation_failed` and nothing changes. The server computes `mutedUntil` from the duration with its own clock; a mute that already ended is read as none. A write that leaves nothing chosen (level null, not muted, no suppress flag) deletes the row and answers the setting with level null, not muted and both flags false. A server from before MENTION_EVERYONE refuses a body with only suppress fields (`400 validation_failed`), and the client then shows the save as failed. Every successful write is pushed as `notification_settings_updated` to all of the user's sockets on this instance ([websocket.md](websocket.md)).

GET lists only rows of spaces the caller is a member of, and channel rows of channels they can see (`VIEW_CHANNEL` or `ADMINISTRATOR`). Rows outlive leaving a space or losing a channel: they come back if the user rejoins or regains it, and go with the user, space or channel row (cascade).

Errors: `400 validation_failed` (no known field, or a value of the wrong kind), `404 space_not_found`, `404 channel_not_found`, `403 not_space_member`, `403 missing_permission` (`{ permission: 'VIEW_CHANNEL' }`) for a channel the caller cannot see.

## Admin (`routes/admin.ts`) — admin required
```
GET    /admin/storage/stats                                → StorageStats
GET    /admin/storage/orphans                              → { orphans[] }
POST   /admin/storage/cleanup        { dryRun? }           → CleanupResult
POST   /admin/storage/cleanup-media  { maxAgeDays, dryRun? } → CleanupResult
GET    /admin/users  ?q=&page=&pageSize=&showDeleted=&role=&joinedAfter=&joinedBefore=&sort= → AdminUserListResponse
PATCH  /admin/users/:id/role         { isAdmin }           → AdminUser
POST   /admin/users/:id/reset-password                     → { temporaryPassword }
DELETE /admin/users/:id                                    → { success }
```

## Admin: Instance Updates (`routes/adminUpdates.ts`) — admin required
```
GET    /admin/instance/update-status  ?refresh=true    → InstanceUpdateStatus
```

Read-only. There is deliberately no endpoint that applies an update: doing so from
inside the container needs `/var/run/docker.sock` mounted, which is host root.
See [admin.md](admin.md) for the full rationale and [deployment.md](deployment.md)
for `./update.sh`, which the panel points at instead.

The GitHub lookup runs only on this request path, never on a timer, and is cached
6h (failures for a tenth of that). `?refresh=true` bypasses the cache for an
explicit re-check but cannot bypass `BACKSPACE_UPDATE_CHECK=false`, which makes
the endpoint return `checkEnabled: false, reason: 'disabled'` without opening a
socket. Every network failure is soft: `state: 'unknown'` with a `reason`, never a
5xx, so the panel always reports the running version.

## Admin: Invite Management (`routes/invites.ts`) — admin required

All endpoints sit behind `[authenticate, requireAdmin]`. Mutating endpoints wrap their read-modify-write in a SQLite transaction with an in-txn re-fetch + status re-derive; any state mismatch returns 409. Service layer: `packages/server/src/utils/inviteService.ts` (`InviteValidationError` → 400, `InviteNotFoundError` → 404, `InviteStateConflictError` → 409).

```
POST   /admin/invites                       { name, maxUses, expiresAt }              → InviteLinkSummary  (201)
GET    /admin/invites              ?status=active|archived (default: active)          → { invites: InviteLinkSummary[] }
PATCH  /admin/invites/:id                   { name?, maxUses?, expiresAt? }           → InviteLinkSummary
POST   /admin/invites/:id/revoke                                                       → { invite: InviteLinkSummary }
POST   /admin/invites/:id/reinstate         { maxUses?, expiresAt? }                  → { invite: InviteLinkSummary, tokenRotated: boolean }
DELETE /admin/invites/:id                                                              → { success: true }
GET    /admin/invites/:id/redemptions                                                  → { redemptions: InviteRedemption[] }
```

**`POST /admin/invites`** — `name` 1-64 chars trimmed; `maxUses` null (unlimited) or positive integer; `expiresAt` null (never) or epoch ms strictly greater than `Date.now()`. 400 on shape violation.

**`GET /admin/invites?status=`** — `active` returns rows whose derived status is `active`; `archived` returns `expired | exhausted | revoked`. Sort `createdAt DESC`. Joins `users` to surface `createdByUsername` (`'Deleted User'` if creator's `isDeleted = 1`).

**`PATCH /admin/invites/:id`** — partial body. 400 if `maxUses` is a positive integer less than the current `usedCount` (would retroactively exhaust — admin should revoke instead). 409 if the invite is currently `revoked` (status conflict — reinstate first).

**`POST /admin/invites/:id/revoke`** — sets `revokedAt = Date.now()`. 409 if already revoked.

**`POST /admin/invites/:id/reinstate`** — branches on the row's pre-reinstate derived status:
- **Path A — was `revoked`**: rotates the token (`crypto.randomBytes(16).toString('base64url')`), clears `revokedAt`, applies any provided `maxUses`/`expiresAt` overrides. Response includes `tokenRotated: true`. 400 if the resulting row would still derive non-`active` (caller must bump enough).
- **Path B — was `expired` or `exhausted`**: token preserved. Applies overrides. Response `tokenRotated: false`. 400 same rule.
- **Path C — already `active`**: 409 "Invite is already active." Pure no-op rejection.

**`DELETE /admin/invites/:id`** — hard-delete. CASCADE removes all `invite_redemptions` rows for this invite. Allowed in any status. 404 if not found.

**`GET /admin/invites/:id/redemptions`** — sort `redeemedAt DESC`. Each row includes the registration-moment snapshot (`registrantUsername`) plus the live joined state (`currentUsername` / `isDeleted`) so the UI can render `alice (now Deleted User)` for renamed/tombstoned users.

```typescript
type InviteLinkSummary = {
  id: string;
  token: string;
  name: string;
  status: 'active' | 'expired' | 'exhausted' | 'revoked';  // derived
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdBy: string;
  createdByUsername: string | null;  // 'Deleted User' if creator tombstoned
  createdAt: number;
  lastRedeemedAt: number | null;  // epoch ms of most recent redemption; null when usedCount = 0
  url: string;  // server-built `https://<host>/register?invite=<token>` — clients MUST NOT assemble
};

type InviteRedemption = {
  id: string;
  userId: string | null;       // null only on hard-delete (defensive — tombstone keeps row)
  registrantUsername: string;  // snapshot at registration moment
  currentUsername: string | null;
  isDeleted: boolean;
  redeemedAt: number;
};
```

## Retired protocol endpoints

Federation and detached-account reattachment endpoints are unregistered and
return the normal JSON 404. There is no compatibility adapter, disabled peer
setting, approval queue or user-facing peer subscription/notification API.
Native account, invitation, social, DM, bot and storage routes above retain their
own authentication and authorization gates.

## Utilities (`routes/utils.ts`) — auth required
```
GET /utils/metadata  ?url= → { title?, description?, image?, siteName? }
GET /health          (public) → { status: 'ok', timestamp }
```

## Security reporting (`routes/cspReport.ts`), public
```
POST /csp-report     (no auth) -> 204
```

**`POST /api/csp-report`** is the Content Security Policy violation sink named by the policy's `report-uri` and `report-to`. Unauthenticated on purpose: a violation can happen on the login screen before any token exists. It registers content-type parsers for `application/csp-report` and `application/reports+json` in addition to the built-in `application/json`. Fastify ships parsers for neither of the first two and would otherwise answer 415, leaving an empty report log that looks exactly like a clean policy. Admitted reports answer `204`, including malformed bodies, because a browser cannot act on an error and would only retry. It reads at most 16 KB off the wire and logs at most 4096 characters per report at `warn` level with the message `CSP violation reported`. Registered after `@fastify/rate-limit` with an explicit 200/min/address override and independent early API admission. See `docs/systems/web-security.md`.

## Bots (`routes/bots.ts`, `routes/reactions.ts`)

Full reference in [bots.md](bots.md). Owner endpoints need the JWT of a native human account.

```
GET /bots → { bots: BotSummary[] }
POST /bots { name } → 201 { bot, token } [5 per 15 min; max 10 per owner]
PATCH /bots/:id { displayName?, avatar?, bio?, activity?, requestedPermissions? } → { bot } [owner; displayName any non-empty name (400 display_name_empty); bio ≤ 190 (400 bio_too_long); activity { type: custom|playing|listening|watching, name 1-128 } or null (400 bot_activity_invalid); requestedPermissions: canonical decimal mask (400 bot_permissions_invalid); a new displayName renames the bot's managed roles; bots.md 3, 4]
POST /bots/:id/token → { token } [5 per 15 min; replaces earlier native tokens and disconnects the bot's authenticated sockets]
GET /bots/:id/tokens → { tokens: BotTokenSummary[], legacy } [owner; no secrets; 30 per 15 min]
POST /bots/:id/tokens { name? } → 201 { id, name, createdAt, lastUsedAt, token } [owner; 5 per 15 min; max 5 per bot; the secret is shown once]
DELETE /bots/:id/tokens/:tokenId → { success } [owner; closes the bot's sockets; 30 per 15 min]
DELETE /bots/:id → { success }
GET /bots/search?q= → { bots: BotSearchResult[] } [discoverable native bots a manager may add; username substring of 2-32 chars, up to 25; each result adds ownerUsername, null when the owner is deleted or not discoverable; 60 per min]
GET /bots/:id/spaces → { spaces: [{ id, name, icon, botIsMember }] } [owner; the caller's MANAGE_SPACE spaces plus every space the bot already sits in]
POST /bots/:id/spaces { spaceId, permissions? } → { success } [native bot; MANAGE_SPACE in the space; permissions ⊆ requested (400 bot_permissions_not_requested) and held (403 cannot_grant_unowned_permissions); omitted: requested ∩ held; a non-empty grant creates the bot's managed role; bots.md 4]
DELETE /bots/:id/spaces/:spaceId → { success } [the bot's owner, or MANAGE_SPACE in the space]
PUT /messages/:id/reactions/:emoji → { success, changed } [ADD_REACTIONS for space messages; channel or DM message, found by id]
DELETE /messages/:id/reactions/:emoji → { success, changed } [own reaction]
```

`Authorization: Bot <token>` is accepted by the existing bot-aware authentication
seam, including tus ownership checks. Humans create bots through the native owner
endpoints; public registration cannot create a bot through proof/identity input.

### Slash commands (`routes/botCommands.ts`, `routes/interactions.ts`)

Full reference in [bots.md](bots.md), section 5b.
```
PUT    /bots/@me/commands          { commands } → { commands }          [bot token; replaces the whole list; 10 per 5 min]
GET    /bots/@me/commands          → { commands }                       [bot token]
GET    /commands                   ?channelId= | ?dmChannelId= → { commands } [caller sees the chat; commands of the bots in it the caller may use (requiredPermissions), with `bot`]
POST   /interactions               { botId, command, subcommand?, options?, channelId | dmChannelId } → 201 { id, expiresAt } [a person (a bot caller: 403 bots_cannot_invoke_commands); member + SEND_MESSAGES; bot in chat and connected; 5 per 5 s]
POST   /interactions/:id/respond   { content?, attachments?, ephemeral? } → 201 message | ephemeral reply [the invoked bot; 15 min, 5 responses; goes through the message routes; `ephemeral: true`: text only, not stored, sent to the invoker alone]
```
Errors: `bot_account_required`, `command_not_found`, `missing_permission` (403, the command's requiredPermissions), `bot_unavailable` (409), `interaction_not_found`, `interaction_expired` (410), `interaction_responses_exceeded` (429), and `validation_failed` with `details.field` for a bad definition or option value.
