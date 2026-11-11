# Bots

A bot is an ordinary account that a program controls with a token. The server gives a bot exactly what it gives any member (events, REST, permissions) and applies **no behavioural policy of its own**: what a bot answers, when it reacts and whether it needs a mention is decided by the bot's code.

Juno's built-in computer opponents are **not** these accounts: they are ephemeral
game-only participants with no token, membership or voice connection, and their
rounds are unranked practice. They reuse Juno's server rules, not these account
management APIs. See [juno.md](juno.md).

Source files:
- `packages/server/src/routes/bots.ts` -- owner endpoints (create, edit, token, delete, add to a space)
- `packages/server/src/routes/reactions.ts` -- REST reactions, the twin of the WS events
- `packages/server/src/utils/spaceMembership.ts` -- `addUserToSpace`, `removeUserFromSpace`
- `packages/server/src/utils/auth.ts` -- `tokenFromAuthHeader` (`Bearer` / `Bot`), `verifyAccessToken` (session JWT or `bsb_` bot token)
- `packages/server/src/utils/botTokens.ts` -- issue, verify, list and revoke `bsb_` tokens
- `packages/web/src/components/modals/settingsPanels/BotsPanel.tsx` -- Settings > Bots, shown only while Settings > Developer > Developer Mode is on (`stores/developerModeStore.ts` mirrors `users.developer_mode`, stored with the account so every device agrees and written through `PATCH /api/users/@me { developerMode }`; it only shows or hides the tab and does not restrict the API)
- `packages/server/src/routes/botCommands.ts`, `routes/interactions.ts`, `utils/botAuth.ts` -- slash commands
- `packages/server/src/ws/handler.ts`, `ws/events.ts` -- bot voice seats (`botJoinRoom`, `bot_voice_join`)
- `packages/web/src/components/chat/CommandPopover.tsx` -- the command lists in the message box
- `examples/bots/` -- zero-dependency Node clients

---

## 1. Model

- A bot is a local `users` row with `is_bot = 1`, `bot_owner_id = <owner id>` and `password_hash = '!bot'` (not a bcrypt hash, so password login is impossible), and is `discoverable`.
- **Name.** The username is 3 to 32 characters of `[a-z0-9_]`, freely chosen — no required suffix. Bots are marked by the BOT badge, not by their name. The login handle stays immutable; the owner edits the display name and avatar.
- **Limit.** 10 bots per owner (`bot_limit_reached`).
- **Token.** `bsb_<id>.<secret>`: 16-hex id and 32 random bytes in base64url. Show the secret once; store only SHA-256 and compare in constant time. Up to 5 tokens per bot, each optionally labeled (1–32 chars), individually revocable; `last_used_at` writes at most once/minute. Full rotation revokes all tokens, sets `password_changed_at`, disconnects sockets and issues one new token, with no network fanout.
- **Owner.** Only an authenticated local human manages their own bots. Bots get `403 bots_native_only`; ownership is checked separately on every management operation.
- **Deletion.** `DELETE /api/bots/:id` tombstones the bot (DM threads stay readable). Deleting the owner's account tombstones every bot they own.
- The owner's profile rules do not apply to the bot: a bot cannot edit its own durable profile fields through `PATCH /api/users/@me` (`403 bot_profile_owner_only`); the owner does it through `PATCH /api/bots/:id`.

## 2. Authentication

```
Authorization: Bot <token>
```

`Bearer <token>` is accepted as an alias everywhere (REST and tus uploads). WebSocket: first message `{"type":"auth","token":"<token>"}`, no scheme.

## 3. Managing bots (owner, JWT of the human)

| Method | Path | Body | Answer |
|--------|------|------|--------|
| GET | `/api/bots` | -- | `{ bots: BotSummary[] }` |
| POST | `/api/bots` | `{ name }` | 201 `{ bot, token }` (5 per 15 min); the token is the bot's first `bsb_` token |
| PATCH | `/api/bots/:id` | `{ displayName?, avatar?, bio?, activity?, requestedPermissions? }` | `{ bot }` (`avatar`: a bare filename of the owner's own upload that no message holds, or the current avatar, or `null`; anything else is `avatar_url_invalid`. `bio`, `activity`: see "About and status" below; `requestedPermissions`: 4, "Permissions on invite") |
| POST | `/api/bots/:id/token` | -- | `{ token }` (5 per 15 min): revokes all tokens and issues one new token |
| GET | `/api/bots/:id/tokens` | -- | `{ tokens: BotTokenSummary[], legacy }` (30 per 15 min; no secrets; `legacy` is true while the bot still runs on its old JWT and holds no token) |
| POST | `/api/bots/:id/tokens` | `{ name? }` | 201 `{ id, name, createdAt, lastUsedAt, token }` (5 per 15 min; 400 `bot_token_name_invalid` / `bot_token_limit_reached`) |
| DELETE | `/api/bots/:id/tokens/:tokenId` | -- | `{ success }` (30 per 15 min; 404 `bot_token_not_found`) |
| DELETE | `/api/bots/:id` | -- | `{ success }` |
| GET | `/api/bots/search?q=` | -- | `{ bots: BotSearchResult[] }` (live discoverable local bots; username substring of 2–32 characters, up to 25; any signed-in account; `ownerUsername` null when private/deleted) |
| GET | `/api/bots/:id/spaces` | -- | `{ spaces: [{ id, name, icon, botIsMember }] }` (owner; the caller's MANAGE_SPACE spaces plus every space the bot already sits in) |
| POST | `/api/bots/:id/spaces` | `{ spaceId, permissions? }` | `{ success }` (existing live local bot; MANAGE_SPACE; requested/held-bit grant, see 4) |
| DELETE | `/api/bots/:id/spaces/:spaceId` | -- | `{ success }` (the bot's owner, or MANAGE_SPACE in the space; the bot gets `member_left` and no further events of that space; its role assignments, per-member channel overrides and managed role in that space are deleted too, whichever path removed it: this route, a kick or a ban) |

`BotSummary` is `{ id, username, displayName, avatarColor, avatar, bio, activity, requestedPermissions, createdAt }`. `avatar` is a bare upload filename (upload through tus first) or `null`. Errors use the project format `{ error, code, statusCode, details? }`; the codes specific to bots are `bot_not_found`, `bot_limit_reached`, `bot_name_invalid`, `display_name_empty`, `bots_native_only`, `bot_profile_owner_only`, `bot_home_not_peered`, `bot_proof_invalid`, `bot_account_required`, `bots_no_friends`, `bot_token_limit_reached`, `bot_token_not_found`, `bot_token_name_invalid`, `bot_activity_invalid`, `bot_permissions_invalid`, `bot_permissions_not_requested`, `role_managed_by_bot`.

`BotTokenSummary` is `{id,name,createdAt,lastUsedAt}` without secrets. A revoke (or first token issued to a legacy bot) closes its sockets; programs holding another valid token reconnect. Bot deletion removes all token hashes; owner deletion also tombstones/disconnects owned bots.

A name/avatar change broadcasts `user_updated` to the native profile audience.
New avatar uploads must also be unused by another native profile before resize;
unchanged current avatars are not resized. Replacement and bot tombstoning retain
historically shared files and thumbnails through the common upload cleanup seam.

### About and status

The owner edits both in the bot's card in Settings > Bots.

- **About** is the bot's ordinary profile `bio`: up to `PROFILE_BIO_MAX_LENGTH` (190) characters after trim, blank or `null` clears it, longer is `400 bio_too_long`. It shows wherever a person's bio shows and travels with the profile.
- **Status** is `activity: BotActivity | null`, `{type,name}` with custom/playing/listening/watching type and 1–128 trimmed characters. Invalid values give `bot_activity_invalid`, null clears. Stored in `users.bot_activity`, restored on the next native connection.

The status is shown as the bot's live activity, so it reaches everyone through the ordinary `presence_update` (member list, profile, activity panel) and is not shown while the bot is offline:

- When a bot socket authenticates and shows activities without an existing live activity, its stored status seeds the live activity. A second session keeps the first one's live state.
- Saving a changed status while connected replaces the live activity (`applyStoredBotActivity`), including one set by the bot code; other profile edits leave it alone.
- The bot code may still send `activity_update` (for example "Listening to" the current track). That replaces the stored status until the bot's next connection, when the stored status applies again.

## 4. Getting a bot into conversations

- **Space, by a manager:** `POST /api/bots/:id/spaces` admits any existing live local bot (their own or another person's) with MANAGE_SPACE. The owner sees every joined space and can remove their bot. Human/deleted targets give `bot_not_found`; bans and duplicate membership remain enforced. Management of the bot's profile/tokens/deletion remains owner-only.
- **Finding a bot:** `GET /api/bots/search?q=` searches live discoverable local bots, 2–32 characters with literal `%`/`_`, limit 25, username order. Owner names are included only while discoverable/live. The UI offers Add Bot in Space settings → Members.
- **Taking the bot out:** `DELETE /api/bots/:id/spaces/:spaceId` — by the bot's owner (any space of their bot) or by a space manager (MANAGE_SPACE); the ordinary member kick (KICK_MEMBERS) keeps working as before. Kick, ban and both removal routes end live delivery of that space to the bot's sockets at once and take the bot out of that space's voice channels.
- **Space, by the bot:** `POST /api/spaces/join { inviteCode }`, like any user. Request-only spaces answer `403 join_request_required`.
- **Group DM:** any member adds the bot with `POST /api/dm/:id/members { userId }`. The friendship requirement is waived for the **owner adding their own bot**, because bots take no friends.
- **1-on-1 DM:** a user finds the bot with `GET /api/social/search?q=<username>` and opens `POST /api/dm { userId }`. No friendship needed.

A bot holds the permissions of its roles in a space (`@everyone`, plus its managed role when it was added with permissions); the space's managers adjust them like for any member.

### Permissions on invite

- **Requested bits.** Owner-managed `requestedPermissions` is a canonical decimal mask of defined bits (`bot_permissions_invalid` otherwise), stored in `users.bot_requested_permissions` and returned in `BotSummary`. Changes apply to future additions; existing roles keep their bits.
- **What the manager grants.** Adding the bot (`POST /api/bots/:id/spaces { spaceId, permissions? }`), the manager picks any subset: the web client shows the requested permissions ticked, any can be unticked, and those the manager does not hold are locked. The server takes `permissions` as the grant: every bit must be requested (`400 bot_permissions_not_requested`) and held by the manager (held-bits rule, `403 cannot_grant_unowned_permissions`); malformed is `400 permissions_invalid`. Omitted: every requested bit the manager holds. MANAGE_SPACE is enough; MANAGE_ROLES is not needed for this role.
- **The managed role.** A non-empty grant creates a role for this bot alone (`roles.managed_bot_id`), named after the bot (its display name, else its handle; `Name (2)` when the name is taken in the space), at the bottom of the hierarchy just above @everyone, carrying exactly the grant, and gives it to the bot; the space gets `space_access_changed`. Nothing granted: no role. The role is ordinary everywhere else: permission checks do not know it is managed, and managers edit its name, colour, bits and position in Roles like any other.
- **What stays fixed.** The role is never given to anyone else (`400 role_managed_by_bot` from the single add route and from a member's role set), never taken from its bot (single remove: `400 role_managed_by_bot`; a role set saved for the bot keeps it whether it names it or not), and never deleted on its own (`DELETE /api/spaces/:id/roles/:roleId`: `400 role_managed_by_bot`). The web role editors do not offer another bot's role and show the bot's own one locked. `Role.managedBotId` names the bot.
- **Role lifecycle.** A display-name edit renames its local managed roles, avoiding collisions. Roles and their overrides go when the bot leaves, is kicked/banned or deleted.

## 5. What a bot receives and can do

### Events (WebSocket `/ws`)

After `auth` the server answers `{ "type": "ready", "user": { "id", ... }, ... }`; `user.id` is the bot's own id. From then on the bot receives **every event a member of that chat receives**: the list is in [websocket.md](websocket.md) (`message_created`, `message_updated`, `message_deleted`, `reaction_added`, `typing`, `dm_message_created`, `dm_channel_created`, `member_joined`, ...). The server does not filter by mention or by conversation kind.

The bot's own messages come back as events. A bot that answers messages must ignore `message.userId === <own id>` (and DM messages whose `type` is not `user`), or it answers itself.

Messages of other bots arrive as well (`message.user.isBot`). Two bots that answer every message answer each other without end; the examples ignore bots. A bot cannot invoke slash commands (`403 bots_cannot_invoke_commands`), its own or another bot's: a command is something a person asks of a bot.

A mention is the token `<@userId>` in `content`. Code spans and fenced blocks do not count as mentions in the clients; bot code that cares should skip them the same way (`examples/bots/mention-reply.mjs` does).

The socket has no resume. After a reconnect the `ready` payload carries the current state and anything missed is read back with the history endpoints. The server pings every 30 s and drops a dead connection after about 65 s; standard WebSocket clients answer pings themselves.

### One process per token

A bot runs as one process serving its channels: one credential holds **one** open socket. A second auth using an occupied credential gets `bot_token_in_use` and close **4409** (`BOT_TOKEN_IN_USE_CLOSE_CODE`); the original socket/events/voice seats remain untouched. Each of up to five `bsb_` tokens is independent; a legacy native bot JWT uses the account as its credential. Closing/closed sockets do not hold credentials. After network loss, heartbeat expiry can take about 65s; the example client retries after 30s. REST is not limited this way. `ConnectionManager.claimBotSession` / `releaseBotSession` manage ownership, released by `removeConnection`.

### Actions (REST)

| Action | Call |
|--------|------|
| Post in a channel | `POST /api/channels/:id/messages { content, attachments?, replyToId? }` |
| Post in a DM | `POST /api/dm/:id/messages { content?, attachments?, replyToId? }` |
| Edit / delete own message | `PATCH` / `DELETE /api/messages/:id` (channel), `PATCH` / `DELETE /api/dm/messages/:id` (DM) |
| React | `PUT /api/messages/:id/reactions/:emoji` (emoji URL-encoded, 1 to 64 characters) |
| Remove own reaction | `DELETE /api/messages/:id/reactions/:emoji` |
| Read history | `GET /api/channels/:id/messages?before=&limit=`, `GET /api/dm/:id/messages?before=&limit=` |
| Upload a file | tus on `/api/files/` (see [uploads.md](uploads.md)), then pass the attachment id in `attachments` |
| Typing indicator | WS `typing_start { channelId }`, `dm_typing_start { dmChannelId }` |

The reaction calls serve channel and DM messages alike (the kind is found by the message id), are idempotent (`{ success: true, changed }`), and use the same code as the WS events `reaction_add` / `reaction_remove`, including the DM relay. The WS events of [websocket.md](websocket.md) remain available for a bot that keeps a socket anyway.

### Limits

Channel and DM creates share burst 12/refill 2/s per verified bot account across credentials and REST/WS. Reactions share burst 20/refill 5/s (authorized duplicates do not spend mutation capacity). Bot creation, token regeneration and token creation remain 5/15min, now per verified account; independent address flood admission remains in force ([api.md](api.md), "Rate limiting"). Interaction invocation is 30/5s/account; bot responses use ordinary write admission plus the existing response ceiling and message creation budget, charged once by the message handler.

## 5b. Slash commands

A bot registers commands for itself. A person picks one in the message box (typing `/` opens the list), the server checks the call and hands it to the bot as an event, and the bot answers with ordinary messages. What a command does is the bot's code; the server only carries the call.

### Registering

```
PUT /api/bots/@me/commands   { commands: [ { name, description, requiredPermissions?, options?: [ { name, description, type, required?, choices?, minValue?, maxValue?, minLength?, maxLength?, channelTypes?, options?, requiredPermissions? } ] } ] }
GET /api/bots/@me/commands   → { commands: BotCommand[] }
```

Bot token only (`403 bot_account_required` for anyone else). `PUT` replaces the whole list in one call, so repeating it is harmless; a command that keeps its name keeps its id. 10 calls per 5 minutes.

Rules: command and option names are 1 to 32 characters of `a-z 0-9 _ -` and unique; descriptions are 1 to 100 characters; at most 100 commands and 10 options per command; required options come before optional ones; a `string`, `integer` or `number` option may list up to 25 `choices` (`{ name, value }`, the value of the option's type, unique, within the option's own limits). Choices are suggestions: the message box offers them by name, and any other value of the option's type within its limits is accepted too. `strictChoices: true` (only with `choices`) makes them the only values accepted.

### Option types

| Type | Value the bot receives | Limits the bot may set |
|------|------------------------|------------------------|
| `string` | text, 1 to 2000 characters by default | `minLength` (0-2000), `maxLength` (1-2000) |
| `integer` | a safe integer | `minValue`, `maxValue` (safe integers) |
| `number` | a finite number | `minValue`, `maxValue` |
| `boolean` | `true` or `false` | -- |
| `user` | the id of a person or bot in the chat | -- |
| `channel` | the id of a channel of the chat's space the invoker can see | `channelTypes`: a non-empty list of `text`, `voice` |
| `role` | the id of a role of the chat's space | -- |

A limit on the wrong type, a pair that crosses (`minValue` above `maxValue`), and a choice outside the option's limits are refused, as are `choices` on `boolean`, `user`, `channel` and `role` options. `channel` and `role` values exist only in a space: invoked from a DM, a value is refused. A violation answers `400 validation_failed` and `details.field` names the field, for example `commands[0].options[1].name`.

Commands are stored on the instance the bot registers them on: register them on every instance where the bot has an account.

### Subcommands

A command may split into subcommands, one or two words after its name (`/music play`, `/music queue add`). Its options are then the steps of a path instead of values:

```json
{ "name": "music", "description": "Music", "options": [
  { "name": "play", "description": "Play a track", "type": "subcommand", "options": [
    { "name": "query", "description": "What to play", "type": "string", "required": true } ] },
  { "name": "queue", "description": "The queue", "type": "subcommand_group", "options": [
    { "name": "add", "description": "Add a track", "type": "subcommand", "options": [ ... ] },
    { "name": "clear", "description": "Empty it", "type": "subcommand" } ] } ] }
```

A `subcommand` holds value options (the rules above apply to them, at most 10); a `subcommand_group` holds 1 to 25 subcommands. A command lists either value options or subcommands and groups (at most 25), never both, and a group holds subcommands only, so a path is at most two words. A subcommand or group takes no `required`, `choices` or limits. Breaking a rule answers `400 validation_failed` like any other (`details.field` e.g. `commands[0].options[1].options[0].type`). The stored command gives every subcommand and group `required: false` and an `options` list (empty for a subcommand without options).

An invocation of such a command names the path in `subcommand` (`["play"]`, `["queue", "add"]`); `options` are those of the subcommand it names and are checked against its definition. A path is required for a command with subcommands and refused for one without (`400 validation_failed`, `details.field` `subcommand`, the reason names what is expected). The bot gets the path in `interaction.subcommand`, and the subcommand's values in `options` as usual.

### Required permissions

A command, and each subcommand or group of it, may ask the people who use it for space permissions: `requiredPermissions` is a canonical decimal mask (`"2048"`) or a list of permission names (`["MANAGE_MESSAGES"]`, the names of `PermissionBits`); it is stored and handed back as the mask, and `"0"` or an empty list means none. A value option takes none (`400 validation_failed`, as do an unknown name, a mask that is not canonical, and bits that name no permission).

A person needs every permission the command and the steps of the path ask for, in the channel the command is invoked in (channel overrides apply; ADMINISTRATOR, the space owner and instance admins hold all). Whoever lacks them does not get the command, or that subcommand or group, in `GET /api/commands` (a group whose subcommands are all hidden goes too, and so does a command whose every subcommand is hidden), and a call is refused with `403 missing_permission`, `details.permission` naming the missing ones (`"MANAGE_MESSAGES, KICK_MEMBERS"`). A direct message has no space permissions: a command or step that asks for any is hidden and refused there. Checked on every listing and call, so a changed role counts at once (the message box asks for the list again at every new `/`). The bot's own permissions play no part.

### Invoking

```
GET  /api/commands?channelId=<id>  |  ?dmChannelId=<id>   → { commands: [ { id, botId, name, description, options, updatedAt, bot: { id, username, displayName, avatar, avatarColor } } ] }
POST /api/interactions   { botId, command, subcommand?, options?, channelId | dmChannelId }   → 201 { id, expiresAt }
```

`GET` lists the commands of the bots that are in that chat that the caller may use (see "Required permissions"); the caller must be able to see the chat. `POST` checks, in this order: exactly one of `channelId` and `dmChannelId`; the caller is a member and may write there (SEND_MESSAGES in a channel); the bot is in the chat (`404 bot_not_found`); the command exists (`404 command_not_found`); the `subcommand` path fits the command (see "Subcommands"); the caller holds the permissions the command and its path ask for (`403 missing_permission`); each option value fits its definition: type, range, length, `choices` when they are strict, and for `user`, `channel` and `role` an id the chat knows (a user in the chat; a channel or role of its space; a channel the caller can see, of an accepted type; anything else answers like a missing id) (`400 validation_failed`, `details.field` is `options.<name>`, `details.reason` says what is wrong); the bot has an open WebSocket (`409 bot_unavailable`). Invocation admission is 30 calls per 5 seconds per verified account.

Command names are unique per bot, not per chat: two bots may both offer `/play`. Every listing entry names its bot, and an invocation names it too (`botId`), so a clash reaches exactly the bot it addresses; the message box shows the bot's `@username` under each command. A command typed out by hand, without picking a row from the list, runs the first of the clashing commands in the listing's order (name, then the bot's username).

### The event

```json
{ "type": "interaction_created",
  "interaction": { "id": "...", "command": "kick", "options": { "who": "123", "reason": "spam" },
                   "resolved": { "users": { "123": { "id": "123", "username": "bob" } } },
                   "user": { "id": "...", "username": "..." },
                   "channelId": "...", "spaceId": "...", "expiresAt": 1790000000000 } }
```

`options` holds the parsed values with the types of the definition; an optional option that was not given is absent. For a command with subcommands `subcommand` holds the path invoked (`["queue", "add"]`) and `options` that subcommand's values; a command without subcommands has no `subcommand`. A `user`, `channel` or `role` value is an id; `resolved` carries the named objects by id (`users`: the user as any member sees it; `channels`: `{ id, spaceId, name, type }`; `roles`: name, colour and position, without the permission bits), and only the kinds the interaction uses. Without such options there is no `resolved`. A call from a space channel carries `channelId` and `spaceId`, a call from a direct or group DM carries `dmChannelId`. `user` is the person who invoked the command.

### Answering

```
POST /api/interactions/:id/respond   { content?, attachments?, ephemeral? }   → 201 (the created message, or the ephemeral answer)
```

Bot token only, and only the invoked bot. The message is posted through the same route as `POST /channels/:id/messages` or `POST /dm/:id/messages`, so permissions, the length limit, attachments, embeds and the rate limit are the ordinary ones. The interaction lasts 15 minutes and takes up to 5 responses. Errors: `404 interaction_not_found` (also for another bot's interaction), `410 interaction_expired`, `429 interaction_responses_exceeded`, and whatever the message route answers. The message is the bot's own; mention the invoker with `<@user.id>` if the answer is for them. A bot that never answers causes nothing more than silence until the interaction expires.

`ephemeral: true` makes an answer only the invoker sees. It is not a message and is never stored: the server checks it (text only, 1 to 4000 characters; `attachments` answers `400 validation_failed`, empty text `400 message_empty`, too long `400 content_too_long`), counts it among the 5 answers, and sends `interaction_ephemeral { reply: { id, interactionId, command, user, content, createdAt, channelId?, spaceId?, dmChannelId? } }` to the invoker's open sessions on this instance, and to no one else (`user` is the bot); the call answers 201 with the same `reply`. Nothing reaches the other people of the chat: no message, unread mark, notification or ping, and mentions in it ping no one. A bot may mix public and ephemeral answers to one interaction.

The message box shows such an answer in the timeline of its chat, by its time, marked "Only you can see this" with a "Dismiss" that removes it; it has no reply, reaction, edit or menu, and it is gone after a reload or a sign-out (`stores/ephemeralReplyStore.ts`, `chat/EphemeralReplyRow.tsx`). The rows of the chat are untouched: an answer is drawn after the last row it is not older than and does not take part in anchors, unread or paging.

### In the message box

Typing `/` at the start of a message lists the commands of the bots in the chat, a row for each subcommand of a command that has them (`/music play`, `/music queue add`). Choosing one writes it, with its path, and its required options as `name:` ready to be filled in; after a space the options not used yet are offered, required ones first (Tab picks one); pasting a full command works too. The form is: options first as `name:value` (several words in double quotes), then the rest of the line, which is the value of the last string option and may be any length: `/play volume:80 any long title`. The server only ever sees the parsed `options`.

Each argument of the command is drawn as a two-tone capsule: the option's name on the lighter half, its value on the darker one in a framed slot, dashed while no value is written. It is painted over the text without changing it, so the caret and editing work as in plain text. The room inside and between the capsules is spacing the composer writes (`spaceArguments`): `HEAD_GAP`, an em space, between the command and its first argument, `ARG_SEPARATOR`, an em and an en space, between arguments, and `VALUE_GAP`, a thin and an en space, after a colon. The colon and the thin space are drawn hidden as the name's padding, the en space is the value's. It is written whether an argument is picked from a list, typed or pasted (a command pasted before the bot's command list arrived is spaced when it does); only the whitespace around `name:` changes, a value's own spaces and line breaks stay, a `name:` inside a quoted value is part of the value, a deletion is never respaced, and a run of spaces the caret is in before a name is left as typed. After a colon the caret goes into the value's slot. How far a capsule's ends reach (the name's left end, the value's right end or empty slot) follows the spaces around it, so plain spaces typed by hand and left as they are (after a deletion) keep the capsules apart, only tighter.

A user, role or channel may be written by hand by any of its names, also one of several words (`who:Bob Smith`, `where:#Big Voice`): the parser and the capsule take the longest run of words that names exactly one of them in the chat, otherwise one word. While the second word is typed the value list offers the matching names; right after a space the next options are offered, as after any value. The parser reads any whitespace there, so the text means the same with plain spaces.

The composer puts the caret back after it rewrites the draft in a microtask (`placeCaret`), not an animation frame: a frame can come after the next key, which then lands at the old caret and leaves the caret in the middle of the text, where the command lists, which follow a caret at the end, stay shut.

The option list offers the options not written yet, the required ones first and marked as required, so an erased required option is offered again.

A path written by hand is offered step by step: after `/music ` a list of its subcommands and groups (a group is marked as such), after `/music queue ` the group's subcommands; Tab picks, as for options, and a picked subcommand writes its required options. The words of the path are the command's head (plain text before the first capsule); arguments start after the path. Sending a command with subcommands before its path reaches one (`/music`, `/music queue`) sends nothing and says "Choose a subcommand: …" with the names to choose from; the server refuses such a call too.

While the value of an option with `choices`, or of a `user`, `role`, `channel` or `boolean` option, is being typed (`who:`, `who:@bo`), a list offers the choices by name, the chat's people, the space's roles, the space's channels of the accepted types, or `true`/`false`; it also opens as soon as such an option is picked or prefilled. Tab picks, as for options. After a value is picked nothing more is offered until a space is typed, so Enter right away sends the command; a space offers the options not written yet. A choice goes in by name and the bot gets its value; a choice written by hand by its name or its value works too, and so does any other value the option accepts (`volume:34`). A picked person or role goes in as a mention token (`<@id>`, `<@&id>`) shown by name; a channel goes in as `#name` (in quotes when the name has a space: `"#Big lounge"`). Names written by hand also work when exactly one matches in the chat (`who:@bob` by login, display name or space nickname; `group:@Mods`; `where:#lounge`); the client turns them into ids before the call, and anything it cannot match goes to the server as written and is refused. A refused value is shown as "The value of <option> does not fit this command", naming the option.

The list is fetched again at the start of every new command (the text goes from not starting with `/` to starting with it), so a bot that registered, changed or lost commands, or joined or left the chat, shows up the next time a command is typed; the old list stays visible until the answer arrives. Enter while a command is being invoked does nothing: the composer is cleared as the request leaves and gets the text back if the invocation fails.

### Scope

Chats on the instance where the bot is connected. Not built: autocomplete (postponed by the owner), buttons and forms, commands of bots from other instances in direct messages.

## 5c. Voice channels

A person has one voice seat at a time. A bot may sit in several voice channels at once, one seat per channel, so a radio bot never has to be shared between channels. Each voice channel is its own LiveKit room, so the audio of the seats is independent.

### Client events (WebSocket, bots only)

| type | fields | notes |
|------|--------|-------|
| `bot_voice_join` | channelId | seats the bot in that voice channel without leaving the others |
| `bot_voice_leave` | channelId | takes the bot out of that one channel |

`bot_voice_join` makes the same checks as `voice_join` (the channel exists and is a voice channel, otherwise `Target channel is not a voice channel`; the bot is a member of the space; CONNECT) and is idempotent. One channel is never occupied twice by the same bot: `bot_voice_join` into the channel where the bot already holds its ordinary `voice_join` seat does nothing, and `voice_join` into a channel where it holds a bot seat does nothing. A bot may hold at most 25 seats. A refusal arrives as an `error` event; a person sending these events gets `code: 'bot_account_required'`. Space voice channels only: DM calls keep their rules. Voice moderation (space mute and deafen) does not reach a seat taken with `bot_voice_join`; a bot that joined with the ordinary `voice_join` is moderated like a person, and such a restriction is not applied to its later bot seats.

The rest of the space sees the bot like anyone else: `voice_state_update { action: 'join' | 'leave' }` per channel, and the `ready` payload lists the bot under `voiceStates` of every channel it sits in.

### Audio

For each channel the bot asks for a token of its own and connects to that room itself:

```
POST /api/livekit/token   { channelId }   → { token, url }
```

The call works for a bot exactly as for a person (a role without SPEAK or STREAM limits what the token may publish). One LiveKit connection per room, publishing one audio track each, is how a bot plays different audio in different channels; the track is produced by the bot's own code with a LiveKit client library, which the server neither provides nor needs. Which channel a command belongs to is the bot's decision as well: the interaction names the invoker, and `voice_state_update` and the `ready` payload say in which voice channel that person sits (`examples/bots/voice.mjs`).

**SPEAK and mute.** Whether a bot may speak is judged per channel (a role or channel override without SPEAK). A seat in such a channel is shown as muted there and only there: the bot's seats in other channels, also of the same space, keep their own state. `voice_permission_muted` carries the `channelId` of the seat. A listener's own "Mute User" and volume slider are kept per seat for a bot too (voice.md, 4), so muting the bot in one channel does not mute it in the others. The track the bot publishes is limited by its LiveKit token as for a person. A moderator mutes, deafens or disconnects one seat of a bot: the context menu of the bot in a channel sends `voice_space_mute` / `voice_space_deafen` / `voice_disconnect` with that `channelId`; the bit is checked in that channel. The mute and deafen are kept per channel (`bot_seat_restrictions`), come back when the bot takes the seat again, and are shown like a person's moderator mute, in that channel only; the bot gets `voice_space_muted` / `voice_space_deafened` with `botSeat: true` and is expected to stop publishing (or listening) there, as a person's client does (`examples/bots/voice.mjs`). A disconnect ends that seat only (`voice_disconnected` with its `channelId`). Bots are not moved between channels.

### When a seat ends

The bot leaves a seat with `bot_voice_leave`. All its seats end 5 seconds after its socket closes (a bot holds one socket per token, see "One process per token"), and at once when its token is regenerated or revoked or the account deleted, and the seats of one space end when the bot is removed from that space, kicked or banned.

### Limits

`voice_status` (mute, camera, screen share) is not wired for bot seats, and the voice moderation actions (move, disconnect, space mute) do not act on them; a moderator takes a bot out of its channels by removing it from the space.

## 6. Connecting from outside

`https://<instance>` for REST (`/api/...`), `wss://<instance>/ws` for the socket, both behind Caddy. The examples take `BACKSPACE_URL` and `BOT_TOKEN`.

## 8. Limitations

- A person can automate a human account without declaring it; the server cannot tell.
- A token is a full user session: a bot can call any REST endpoint a user can. Scopes (a token limited to some endpoints or spaces) are not built.
- When a person replies to a message and mentions a bot, the event carries the replied text in `replyTo`.
- Slash commands run only in chats on the instance where the bot is connected; the other things not built are listed in section 5b. Voice has no per-seat status of the bot's own (mute, camera) (section 5c).
- Not built: per-bot permissions beyond roles, resume after reconnect, private (visible to one person) answers to slash commands.

## 8b. Token migration

Before migration 0035 bots held a 3650-day JWT. It remains usable until the first
hashed `bsb_` token is issued; then REST/uploads/WS refuse it and disconnect its
sockets. This uses `isBot` and existing `bot_tokens`, never provenance. Revoke of
the last token sets `password_changed_at` so an old JWT cannot become valid again.
Human sessions are unaffected.

## 9. Database

Migration `0032_bots.sql` adds `users.is_bot`, `bot_owner_id` and its index. Profile
columns remain ordinary user fields. Owned bots are tombstoned/disconnected with
their owner; native token hashes, slash commands and managed roles are cleaned.

Migration `0039_bot_permissions.sql` adds the nullable canonical requested mask and
`roles.managed_bot_id`, with one unique managed role per `(space_id,managed_bot_id)`.

Migration `0038_bot_activity.sql` adds the nullable stored activity JSON;
tombstoning clears it.

Migration `0035_bot_tokens.sql` adds `bot_tokens`: `id` (16 hex, PK, the public part of the token), `bot_id` (FK to `users`, cascade), `token_hash` (SHA-256 of the secret, hex), `name` (nullable), `created_at`, `last_used_at` (nullable); index `idx_bot_tokens_bot_id`. A bot's rows are deleted when the bot is tombstoned.

The migration `0032_bots.sql` also adds the two tables of the slash commands. `bot_commands`: `id` (PK), `bot_id` (FK to `users`, cascade), `name`, `description`, `options` (JSON array, default `'[]'`), `updated_at`; unique index on `(bot_id, name)`. `interactions`: `id` (random 32-hex string, PK), `bot_id` and `user_id` (FKs to `users`, cascade), `channel_id` / `dm_channel_id` (exactly one is set), `command`, `options` (JSON object of the parsed values), `created_at`, `expires_at`, `responses` (default 0); index on `expires_at`. A spent interaction is dropped by the first invocation that comes a day after it expired. A bot's `bot_commands` rows are deleted when the bot is tombstoned.
