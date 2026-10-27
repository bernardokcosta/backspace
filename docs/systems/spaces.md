# Space & Membership System

Source files:
- `packages/server/src/routes/spaces.ts` — Space CRUD, invite, join, members, roles, bans, ownership transfer, invite preview
- `packages/server/src/routes/channels.ts` — Channel CRUD, category CRUD, channel layout reordering, channel/category permission overrides
- `packages/server/src/routes/joinRequests.ts` — Retained invitation-request/manager workflow
- `packages/server/src/utils/spaceJoinPayload.ts` — Permission-filtered `buildJoinedSpace` payload for approval acceptance
- `packages/server/src/routes/users.ts` — Space layout (sidebar folders/ordering) persistence via `PUT /api/users/@me/space-layout`
- `packages/web/src/stores/spaceStore.ts` — Client-side space state, multi-instance merge, LWW layout sync
- `packages/web/src/components/modals/CreateSpace.tsx` — Space creation modal (icon crop, color, visibility)
- `packages/web/src/components/modals/JoinSpace.tsx` — Join-by-code modal with federation connect phases
- `packages/web/src/components/modals/InviteModal.tsx` — Invite link generation and copy
- `packages/web/src/components/modals/TransferOwnershipModal.tsx` — Ownership transfer member picker
- `packages/web/src/components/modals/SpaceSettings.tsx` — Space settings: overview (including access/description and approval requests), members, roles, bans and soundboard
- `packages/web/src/components/JoinPage.tsx` — Public invite landing page with federation redirect
- `packages/web/src/hooks/useDragManager.ts` — Channel/category/voice-user drag-and-drop
- `packages/web/src/utils/inviteParser.ts` — Invite code/URL/qualified-code parser
- `packages/web/src/utils/joinErrors.ts`, `utils/inviteJoinRequest.ts` - `JoinRequestRequiredError` and the join refusal checks; `sendInviteJoinRequest`, the join request an invite to a request space leads to

Cross-references: [database.md](database.md) (table schemas), [permissions.md](permissions.md) (resolution algorithm, override tiers), [websocket.md](websocket.md) (event types), [federation.md](federation.md) (peer relay), [voice.md](voice.md) (voice channel join)

---

## Space Lifecycle

Space Settings includes a MANAGE_SPACE-only [Soundboard](soundboard.md) panel
for activation, member uploads, duration (including unlimited) and capacity.
Each space hosts its own shared catalog and settings.

### Creation

**Endpoint:** `POST /api/spaces` (`spaces.ts:spaceRoutes`)
**Auth:** Required
**Permission:** Any authenticated user when `instance_settings.spaceCreationOpen = 1`; restricted to instance admins (`users.isAdmin = 1`) when `spaceCreationOpen = 0` (returns `403 space_creation_disabled` for non-admin users). Desktop (`SpaceSidebar`) and mobile (`MobileSpacesScreen`) hide the create-space affordances for non-admins when `spaceCreationOpen` is `false`.

**Request body (`CreateSpaceRequest`):**

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| name | string | yes | trimmed, 1-100 chars |
| icon | string | no | Upload filename |
| banner | string | no | Upload filename |
| avatarColor | AvatarColor | no | Must be in `AVATAR_COLORS`; random if omitted |
| visibility | SpaceVisibility | no | `'public'` / `'request'` / `'private'`; defaults to `'private'` |
| description | string | no | trimmed, max 200 chars |

**AVATAR_COLORS:** `['mint', 'sky', 'lavender', 'coral', 'rose', 'teal', 'amber']`

**Atomic transaction creates:**

| Entity | ID | Details |
|--------|----|---------|
| Space | `spaceId` (snowflake) | With `inviteCode` = `crypto.randomBytes(4).toString('hex')` (8 hex chars) |
| Owner membership | `(spaceId, userId)` | Creator auto-joined |
| Category: "text-channels" | `textCategoryId` (snowflake) | position 0 |
| Category: "voice-channels" | `voiceCategoryId` (snowflake) | position 1 |
| Channel: "general" (text) | `channelId` (snowflake) | position 0, in text-channels category |
| Channel: "voice" (voice) | `voiceChannelId` (snowflake) | position 0, in voice-channels category |
| @everyone role | id = `spaceId` | `DEFAULT_EVERYONE_PERMISSIONS`, position 0, color `#b9bbbe` |

**DEFAULT_EVERYONE_PERMISSIONS bits:** VIEW_CHANNEL, SEND_MESSAGES, CREATE_INVITE, CONNECT, SPEAK, ATTACH_FILES, READ_MESSAGE_HISTORY, ADD_REACTIONS, STREAM

**Post-transaction:**
1. `connectionManager.addUserSpace(userId, spaceId)` — registers creator for WS broadcasts
2. Icon/banner attachment records cleaned up (reference now in `spaces` table)
3. Icon/banner resized via `resizeProfileImage(filePath, 'icon'|'banner')`

**Response:** 201, `Space` object

### Read

**List user's spaces:** `GET /api/spaces` — returns all spaces where user is a member. Response: `Space[]`.

**Get space detail:** `GET /api/spaces/:id` — membership required. Returns `SpaceWithChannelsAndMembers`:
- Channels filtered by `VIEW_CHANNEL` permission per-channel (computed per-user)
- Each channel includes `isPrivate` (true if @everyone has VIEW_CHANNEL deny override, `isHiddenFromEveryone`; see permissions.md, "Private channels and categories") and `myPermissions`
- Categories include `isPrivate` flag (same rule)
- Roles carry their display fields for every member and their `permissions` only when the requesting user holds `MANAGE_ROLES`; member rows list their roles with display fields only (permissions.md, "Who receives role and override data")
- `myPermissions` at space level included

### Update

**Endpoint:** `PATCH /api/spaces/:id`
**Permission:** `MANAGE_SPACE`; `ownerTitle` the owner only

**Updatable fields:** name (1-100 chars), icon, banner, avatarColor (validated against AVATAR_COLORS), visibility (public/request/private), description (max 200 chars), ownerTitle (see "Owner title" below), afkChannelId (a same-space voice channel id, or `null` to switch the feature off) and afkTimeoutSeconds (one of 60/300/900/1800/3600; api.md, "Spaces").

Every field is checked before anything is written. A body with `ownerTitle` from anyone but the owner is refused with `403 space_owner_only` as a whole, so a member with `MANAGE_SPACE` cannot rename the space in the same request either. An `afkChannelId` naming an unknown id, a text channel or another space's channel is `400 space_afk_invalid_channel`; any other `afkTimeoutSeconds` is `400 space_afk_invalid_timeout`.

Every field is checked before anything is written. A body with `ownerTitle` from anyone but the owner is refused with `403 space_owner_only` as a whole, so a member with `MANAGE_SPACE` cannot rename the space in the same request either.

**Directory retired in 1.15.2:** legacy listing input is ignored. No response
exposes the flag, no retained edit clears its historical value and no write
schedules directory work. See [directory.md](directory.md).

**Side effects:**
- Old icon/banner files deleted from disk when replaced
- New icon/banner resized via `resizeProfileImage`
- Attachment records cleaned up for newly-set images
- `space_updated` WS event broadcast to all space members

### Delete

**Endpoint:** `DELETE /api/spaces/:id`
**Permission:** Owner only (`isSpaceOwner` check)

**Transaction deletes (in order):**
1. `read_states` for all channels in the space (no FK cascade)
2. All channels (messages cascade via FK)
3. All `space_members`
4. All `space_folder_members` referencing this space
5. The space itself

**Post-transaction:** All attachment files and space icon/banner files deleted from disk.

---

## Invite System

### Invite Code Generation

**Endpoint:** `POST /api/spaces/:id/invite`
**Permission:** `CREATE_INVITE`

**Behavior:** Returns existing `inviteCode` if one exists. Only generates a new one (`crypto.randomBytes(4).toString('hex')`) if the space has no invite code. Invite codes are permanent (no expiration).

**Every visibility has a link.** A `request` space gets its code like any other. The code never admits anyone to it: a join by code answers `join_request_required` and the client turns that into a join request (see "Join by Invite Code" and "Invite links to a space joined by request" below). Up to 1.9.0 this endpoint refused a request space with `403 space_uses_join_requests`, and `POST /api/dm/space-invite` refused a local one with `403 space_requires_approval`; neither is sent any more, and both stay in the code list because an older instance still sends them.

**Response:** `{ inviteCode: string }`

### Invite URL Format

Built by `spaceInviteUrl(instanceOrigin, inviteCode)` in `inviteParser.ts`, the one builder for every surface that hands out a link (`InviteModal`, and the Invite People item of the space context menu in `SpaceSidebar` and `MobileSpacesScreen`):
- **Web:** `{instanceOrigin}/join/{inviteCode}` (e.g., `https://nova.ddns.net/join/a3f1b2c4`). `instanceOrigin` is the space's `_instanceOrigin`, the instance that issued the code; `''` (a space on the page's own instance) becomes `window.location.origin`.
- **Deep link (Electron):** `backspace://join/{inviteCode}` or `backspace://join/{inviteCode}@{host}` for remote instances

### Invite Code Parser (`inviteParser.ts`)

Parses three input formats into `{ code: string; origin?: string }`:

| Format | Example | Parsed |
|--------|---------|--------|
| Bare code | `a3f1b2c4` | `{ code: 'a3f1b2c4' }` |
| Full URL | `https://remote.com/join/a3f1b2c4` | `{ code: 'a3f1b2c4', origin: 'https://remote.com' }` |
| Qualified code | `a3f1b2c4@remote.com` | `{ code: 'a3f1b2c4', origin: 'https://remote.com' }` |

If the parsed origin matches `window.location.origin`, it is treated as a bare code (origin stripped).

### Direct Friend Invitation (in-app)

`POST /api/dm/space-invite` (see [dm-system.md](dm-system.md)) sends a structured invite card to a friend via DM. The card carries a snapshot of the space (name, icon, member count, description) plus the canonical identifiers (`spaceId`, `spaceInstanceOrigin`, `inviteCode`).

The endpoint lives on the **caller's home instance**, not the space's home. The caller's instance fetches the snapshot server-to-server from the space's `GET /api/spaces/invite/:code/preview` endpoint, then inserts a `type='system'` DM message with `event: 'space_invite'` content. Three-way federation (sender on X, recipient on Y, space on Z) is supported without new federation event kinds. A space of any visibility can be invited to; for a `request` space the card leads the recipient to a join request (see "Invite links to a space joined by request").

`InviteModal` sends the request to `getFriendsHomeOrigin()` (`instanceStore.ts`, see [client-federation.md](client-federation.md) §5): the page's instance for a native account, and the connected true home for a federated account signed in to another instance, whose friends are checked there (#391). Each friend is named as that instance knows them (`personRequest(friend, origin, home)`), and the space's origin is translated for it: `''` only when the space is on the receiving instance, else the space's absolute origin (the page's own `window.location.origin` for a space on the page's instance). With no live session on the true home it falls back to the page's instance.

The invite is relayed like every DM message (`queueDmRelay`), to each instance that hosts a participant: the recipient's home when they are homed elsewhere, and the sender's home when the sender is a federated account acting on this instance, which is where the sender reads the conversation. Up to 1.8.0 the route relayed only when the recipient was homed elsewhere, so an invite sent through a federated account reached the recipient but never the sender's own copy of the conversation.

The friend-picker surface in `InviteModal` uses the same per-space invite code as the link-share footer — there is exactly one invite code per space at any time, and revocation (when implemented) invalidates all outstanding cards atomically.

### Invite Preview

**Endpoint:** `GET /api/spaces/invite/:code/preview` (no auth required)

**Response (`InvitePreview`):**

```typescript
{
  spaceId: string;
  spaceName: string;
  description: string | null;
  icon: string | null;
  avatarColor: AvatarColor | null;
  memberCount: number;     // live count from space_members
  instanceName: string;    // from instance_settings
  visibility?: SpaceVisibility; // read on every call; absent from an instance up to 1.9.0
}
```

Built by `getLocalInvitePreview` (`utils/spaceInviteSnapshot.ts`). `getLocalInviteSnapshot`, which the DM invite route stores in the card, is the same read without `visibility`.

### Join by Invite Code

Two endpoints serve the same purpose:

| Endpoint | Use case |
|----------|----------|
| `POST /api/spaces/:id/join` | Join when spaceId is known (body: `{ inviteCode }`) |
| `POST /api/spaces/join` | Join by code only, spaceId looked up from `inviteCode` |

Both run the same check after the code matches (`inviteJoinRefusal` in `spaces.ts`), against the space's visibility at the time of the call, so a link follows the space when its visibility changes:

| Case | Answer |
|------|--------|
| Banned | `403 user_banned` |
| Already a member | `409 already_member` |
| `request` space, a request of theirs is pending | `409 join_request_pending` (the answer `request-join` gives) |
| `request` space, otherwise (a declined request included) | `403 join_request_required`, `details: { spaceId }` |
| `private` or `public` space | joins (side effects below) |

**A code never admits anyone to a `request` space.** Entry is `POST /api/spaces/:id/request-join` and a manager's approval; `details.spaceId` is the id to send that request to, so a client holding only a code can do it. An instance up to 1.9.0 sends `join_request_required` without `details`; the client then reads the id from the invite preview. `private` and `public` spaces are joined by code; discovery-only public join was retired in 1.15.2. Combined with the permission membership gate (a non-member cannot obtain `CREATE_INVITE`, see [permissions.md](permissions.md)), a non-member cannot mint a code for a request space, and a code to one leads only to a request.

**Side effects:**
1. Insert `space_members` row
2. `connectionManager.addUserSpace` for WS broadcasts — also pushes a scoped `space_voice_state` snapshot to the joining user so voice-channel occupants appear without a reload (see `docs/systems/websocket.md` → "Mid-session space join")
3. `member_joined` WS event broadcast to space
4. Response: `Space` object

### Join Page (`JoinPage.tsx`)

Public route at `/join/:inviteCode`. Handles six phases:

| Phase | Trigger | UI |
|-------|---------|-----|
| `preview` | Initial load | Space preview card + join button (auth) or login/register links (unauth); for a request space, the request notice, an optional note and "Ask to join as {name}" |
| `connect` | `NotConnectedError` on join or request attempt | Password prompt for federation connect ("Connect & Ask to Join" for a request) |
| `fallback` | `RemoteLoginRequiredError` on connect | Username + password for an account on the remote, under the `FallbackNotice` its `reason` selects |
| `other-instance` | User clicks "I use another instance" | Domain input for federation redirect |
| `already-member` | Join or request returns `already_member` | Green checkmark + auto-redirect (2s timer) |
| `request-sent` | Request sent, or one was already pending | "Request sent to {space}" or "Your request to join {space} is waiting", and Back to Backspace |

**The page's action** is `join` or `request`, read from the preview's `visibility` on load. `request` sends `sendInviteJoinRequest(preview.spaceId, origin, note)` to the space's instance, after the connect step when that instance is remote. It changes when the server says otherwise: a join answered with `join_request_required` (an instance without `visibility` in its preview, or a space switched to `request` after the page loaded) switches to `request` for the user to send; a join answered with `join_request_pending` shows the waiting request; a request answered with `space_not_requestable` (the space left `request`) joins by the code instead. Banned is shown as the refusal text, as on every join path. While the action is `request` the heading above the space name is `auth:join.invitedToRequest` ("You've been invited to ask to join") in every phase, signed out included, so the page never promises entry.

**Federation redirect flow (other-instance):**
1. User enters their home domain (e.g., `my-instance.com`)
2. Constructs qualified invite: `{code}@{currentHost}`
3. Redirects to `https://{domain}/join/{qualifiedCode}`
4. Their home instance's JoinPage receives the qualified code, parses origin, and handles federation connect

**Preview fetching:** For remote invites, creates a temporary API client via `createApiClient(origin, () => null)` to fetch the preview without authentication.

### Invite links to a space joined by request

Every surface that takes a code reaches the join request flow the same way, so none of them ends at the refusal:

- `spaceStore.joinByCode` turns a `join_request_required` refusal into `JoinRequestRequiredError` (`utils/joinErrors.ts`), an `HttpError` with that code plus `spaceId` and `origin` (`''` for the page's instance). The id comes from `details.spaceId`, else from the invite preview; when neither names it the original refusal is thrown. `connectedJoinOrigin(origin)` is the shared origin check: `''` for the page's own instance, the origin when it holds a connected session, else `NotConnectedError`.
- `sendInviteJoinRequest(spaceId, origin, message?)` (`utils/inviteJoinRequest.ts`) sends `POST /api/spaces/:id/request-join` through `client.joinRequests.request` on the exact connected origin, without discovery or a shared request store. It reports `join_request_pending` as `'pending'`; all other errors propagate. A disconnected/missing remote is `NotConnectedError`, never a home-client fallback. Account changes and the desktop session lifecycle reject obsolete replies. The route's rate limit (5 per minute) and manager approval are unchanged.
- The space on another instance is reached as for a join: the request goes to the space's instance through the user's connected session there, so the request, the ban check and the membership check all use the user's row on that instance.
- Surfaces: the Join Page (above); the Join Space dialog, which moves to a `request` step (note, Send Request) and then to `request-sent`; and a DM invite card (`SpaceInviteCard`), which shows "Ask to join" when the live preview says `request` or the join was refused with `join_request_required`, then "Request sent" or "Request pending".
- Inviters: Invite Friends (`InviteModal`) shows the friend list and the link for a request space, with an intro that says people who open it ask to join; the space menu's Invite People (`SpaceSidebar`, `MobileSpacesScreen`) copies the link and confirms with "Invite link copied. People who open it can ask to join."

### Join Space Modal (`JoinSpaceModal`)

Opened from the space sidebar "Join a Space" action. The `input` phase is
**invitation-only**: it neither fetches nor previews discovery. A supplied
code/URL runs `parseInviteInput` → `joinByCode(code, origin?)`, with the retained
federation phases:
- `connect` — password prompt for federation
- `fallback` — different-password login for remote instance

The `request` and `request-sent` phases use the independent invitation request
utility. Desktop/mobile Explore launchers, previews, stores and workbenches
were removed in 1.15.2; old `/explore` bookmarks redirect to Friends with history
replacement. Existing remote memberships and explicit Connections remain.

Space managers edit visibility and invitation description in Overview's
`AccessPanel`, without directory flags or requests for instance discovery
settings. Pending requests retain per-origin listing/approval there.

---

## Space access and join requests

### Space Visibility

| Value | Join mechanism |
|-------|----------------|
| `private` | Invite code only |
| `request` | Submit request, requires manager approval; an invite leads to the same request |
| `public` | Immediate entry with an invite code |

Visibility still controls invitation admission, not discovery. No spaces are
enumerated by Explore or a global directory, and there is no public-join route.
Overview's access/description fields are shown only to `MANAGE_SPACE` holders.

### Join Request Workflow

**Submit request:** `POST /api/spaces/:id/request-join`
- Space must have `visibility === 'request'`
- Rate limited: 5 per minute
- Message: optional, max 500 chars
- Checks for existing pending request (409 if exists)
- Creates `join_requests` row with status `'pending'`
- Sends `join_request_received` WS event to all space managers (owner + `MANAGE_SPACE` holders)

**List requests:** `GET /api/spaces/:id/join-requests?status=pending`
- Permission: owner or `MANAGE_SPACE`
- Status filter: `pending` (default), `accepted`, `declined`
- Returns `{ requests: JoinRequest[] }` with populated user data

**Decide request:** `PATCH /api/spaces/:id/join-requests/:requestId`
- Permission: owner or `MANAGE_SPACE`
- Body: `{ action: 'accept' | 'decline' }`
- Must be pending (400 if already decided)

Accept flow (atomic transaction):
1. Insert `space_members` row
2. Update request status to `'accepted'`, set `decidedBy` and `decidedAt`
3. `connectionManager.addUserSpace`
4. Broadcast `member_joined` to space
5. Build full `SpaceWithChannelsAndMembers` for accepted user, roles shaped for them as in `GET /api/spaces/:id`
6. Send `join_request_accepted` WS event to requesting user (includes full space data)

Decline flow:
1. Update request status to `'declined'`
2. Send `join_request_declined` WS event to requesting user

**User's own requests:** `GET /api/users/@me/join-requests?status=<optional>`
- Returns all requests for the current user, optionally filtered by status
- `BackspaceApiClient.joinRequests.mine` retains this API independently; no
  discovery store or background request fan-out is recreated.

The manager UI uses `getJoinRequestClient(origin)` for listing and decisions,
not a home-only client; changing origin/account or unmounting retires its
in-flight view updates. The accepted-user payload is built by
`buildJoinedSpace`, with effective channel permissions and role-data filtering.

### Space Managers Resolution (`joinRequests.ts:getSpaceManagers`)

Used to target `join_request_received` events. Iterates all space members and returns IDs where:
- `userId === space.ownerId`, OR
- `hasPermission(userId, spaceId, PermissionBits.MANAGE_SPACE)` returns true

---

## Membership

### Join

Two retained join paths:
1. **Invite code**: `POST /api/spaces/:id/join` or `POST /api/spaces/join` (`private` and `public` spaces; a code to a `request` space leads to path 2)
2. **Request accept** — `PATCH /api/spaces/:id/join-requests/:requestId` with `action: 'accept'`

All paths: insert `space_members`, register in `connectionManager`, broadcast `member_joined`.

### Leave / Kick

**Endpoint:** `DELETE /api/spaces/:id/members/:uid`

| Scenario | Condition | Permission |
|----------|-----------|------------|
| Self-leave | `uid === request.userId` | Any member (unless owner) |
| Kick | `uid !== request.userId` | `KICK_MEMBERS` |

**Owner restriction:** Owner cannot leave. Must transfer ownership or delete the space.
**Owner protection:** Cannot kick the owner.

**Role hierarchy:** kicking someone else needs a higher top role than theirs (`403 role_hierarchy`, permissions.md).

**Live delivery:** leaving, being kicked and being banned all end the delivery of the space's events to the user's open sockets at once (`ConnectionManager.removeUserSpace`), not only at the next reconnect. A bot is also taken out of that space's voice channels. A kick or an owner's removal of a bot goes through `removeUserFromSpace` (`utils/spaceMembership.ts`).

**Cleanup on removal:**
1. Delete `space_members` row
2. Delete `voice_restrictions` for the member in this space
3. Delete `read_states` for the member in all space channels
4. Broadcast `member_left` WS event

### Ban

**Endpoint:** `POST /api/spaces/:id/bans`
**Permission:** `BAN_MEMBERS`
**Body:** `{ userId: string, reason?: string }`

**Protections:** Cannot ban owner, cannot ban self, 409 if already banned, `403 role_hierarchy` unless the actor outranks the target.

**Atomic transaction:**
1. Insert `bans` row (with `reason`, `bannedBy`, `createdAt`)
2. Delete `space_members`
3. Delete `member_roles`
4. Delete `read_states` for all space channels
5. Delete `voice_restrictions`

**WS events:**
- `member_left` to space (so other members update their list)
- `member_banned` to the banned user (with `reason`)

**List bans:** `GET /api/spaces/:id/bans` — requires `BAN_MEMBERS`. Returns ban records with both banned user and moderator user objects.

**Unban:** `DELETE /api/spaces/:id/bans/:uid` — requires `BAN_MEMBERS`. 404 if no ban found.

### Ownership Transfer

**Endpoint:** `PATCH /api/spaces/:id/transfer-ownership`
**Permission:** Owner only
**Body:** `{ newOwnerId: string }`
**Validation:** New owner must be a member, cannot transfer to self.

Updates `spaces.ownerId` and clears `spaces.ownerTitle` in the same write (the title was the former owner's), broadcasts `space_updated` WS event, then `space_access_changed` to the space with the former and the new owner as the members whose own permissions changed (each also gets a `space_voice_state`; websocket.md). Their clients refetch the detail, so the new owner gets the role bits and the former owner loses them unless a role still grants `MANAGE_ROLES` (permissions.md, "Who receives role and override data"). Voice permissions are re-checked.

**Client (`TransferOwnershipModal`):** Member picker with search, two-step confirm. Shows warning "You will become a regular member." Uses toast notification on success.

### Member Role Management and Nicknames

**Set roles (replace) and nickname:** `PATCH /api/spaces/:id/members/:uid`
- Body: `{ roleIds?: string[]; nickname?: string | null }`, at least one of them
- Every field is checked before anything is written; both are written in one transaction
- `roleIds` needs `MANAGE_ROLES` and follows the rules below
- `nickname` is the member's name in this space (`space_members.nickname`), separate from the account name and from their nickname in any other space. Anyone may set their own; another member's needs `MANAGE_SPACE`, never the owner's, and a higher rank (`403 role_hierarchy`). `normalizeMemberNickname` decides the stored form: null or blank clears it, otherwise trimmed, at most 32 UTF-16 code units, no control characters, line or paragraph separators or bidirectional controls, at least one visible character (`400 member_nickname_invalid`)
- Followed by `member_updated` to the space (websocket.md)

Rules for `roleIds`:
- Cannot change own roles
- Cannot modify owner's roles (unless you are the owner)
- @everyone role (id=spaceId) cannot be assigned
- Role hierarchy: the member must rank below the actor, and every role added or removed must sit below the actor's top role (`403 role_hierarchy`, permissions.md)
- Atomically deletes all existing `member_roles` then inserts new ones
- Answers the member with their roles (display fields only)
- Followed by `space_access_changed` to the space, and a `space_voice_state` to the member (websocket.md); their client refetches the space's detail, which carries role bits only once they hold `MANAGE_ROLES`
- Triggers `checkVoicePermissions(spaceId)` to enforce voice changes

**Add single role:** `POST /api/spaces/:id/members/:uid/roles` — body `{ roleId }`, requires `MANAGE_ROLES`

**Remove single role:** `DELETE /api/spaces/:id/members/:uid/roles/:roleId` — requires `MANAGE_ROLES`

Both single-role routes apply the same checks as the replace route (not own roles, not the owner's, member of the space, role of this space other than @everyone, role hierarchy) and are followed by `space_access_changed` in the same way.

**Where a nickname shows.** `spaceMemberName` in `web/src/utils/identity.ts` names a member inside a space: the nickname from the space's roster row, else the display name. The member lists (desktop and phone), a space message's author and reply line, mentions, the mention picker (which also matches on it), the typing line and the poke row (both people; websocket.md, "Channel pokes") use it. DMs, friends and the profile's name and username show the account; the profile card adds a "Nickname in this space" line above the name.

**Owner title.** The owner may replace the owner group's heading in the member list ("Owner") with a title of their own (`spaces.ownerTitle`), visible to every member. It is a heading, not a name: the owner's row under it, their messages, mentions, the typing line and the profile card name them by `spaceMemberName` like anyone else, and the settings Members panel keeps its "Owner" marker. `ownerGroupTitle` in `web/src/utils/memberGroups.ts` reads it for every surface that shows the heading, and `OwnerTitleHeading` renders it on the desktop member list and the phone members screen; a custom title keeps its own capitalization, the default stays uppercase like the other group headings. The heading shows only while the owner is online, because offline members are listed together under Offline. The owner gets a pencil beside it (a 44px tap target on the phone) that opens a dialog laid out like the nickname dialog: Save, Cancel, and Reset while a title is set. The dialog checks the value with `normalizeOwnerTitle` before sending, writes through `spaceStore.updateSpace` to the space's own instance, and changes the heading only from that instance's answer; other members get it through `space_updated`. Server rules: `PATCH /api/spaces/:id` above and api.md. Version mix: a client up to 1.10.0 ignores the field and shows "Owner"; on a space hosted by an instance up to 1.10.0 the field is absent, the heading stays "Owner" and the pencil is not offered (`hostKeepsOwnerTitle`), because that instance would answer 200 and drop the title. No federation event carries the title; each instance serves it for the spaces it hosts.

**Member list right-click menu** (`layout/memberMenu/`, desktop member list). A right click, the menu key or Shift+F10 on a member row opens it; a left click, Enter or Space opens the profile. Items: View profile; Send message and the friend action that fits (add, cancel, accept or decline, remove), both through the origin-aware helpers (`openDirectMessage`, `friendRequestTarget`); Change space nickname; a Roles submenu of checkboxes; Kick and Ban, each after a confirmation. Which items show follows permissions.md, "Client gating". Writes go to the space's own instance (`getApiForOrigin(space._instanceOrigin)`) with the member's id there. A role checkbox changes only after the server accepts the write, and is disabled while one is in flight. The menu closes when the space changes. On a space hosted by a 1.9.x instance the nickname item is offered but the instance refuses the request, and the dialog shows its reason.

---

## Role Management

### Create Role

**Endpoint:** `POST /api/spaces/:id/roles`
**Permission:** `MANAGE_ROLES`
**Body:** `{ name: string, color?: string, permissions?: string }`

- Name defaults to `'new role'` if empty
- Duplicate name check (case-insensitive, raw SQL COLLATE NOCASE)
- Permissions default to `DEFAULT_EVERYONE_PERMISSIONS` limited to the bits the actor holds; given permissions must all be held (`403 cannot_grant_unowned_permissions`, permissions.md "Held-bits rule")
- Created at the bottom: position 1, the other roles move up one (`normalizeRolePositions`); refused with `403 role_hierarchy` unless the actor ranks above 1
- Color defaults to `'#b9bbbe'`
- After creation: `space_access_changed` to the space, checks voice permissions
- Answers the role, with `permissions` (the actor holds `MANAGE_ROLES`)

### Update Role

**Endpoint:** `PATCH /api/spaces/:id/roles/:roleId`
**Permission:** `MANAGE_ROLES`
**Body:** `{ name?, color?, position?, permissions? }`

- Name: trimmed, non-empty, duplicate check (case-insensitive, excludes self)
- Permissions: a non-negative integer string (`400 permissions_invalid`); only bits the actor holds may be switched (`403 cannot_grant_unowned_permissions` on, `403 cannot_change_unowned_permissions` off; permissions.md "Held-bits rule")
- `404 role_not_in_space` for a role of another space; `403 role_hierarchy` for a role at or above the actor's top role
- Position: an integer from 1 (not for @everyone, `400 validation_failed`) below the actor's top role; the role moves there and the others are renumbered so positions stay distinct
- Client: the role list in Space Settings > Roles sends `{ position }` alone to reorder (drag handle, arrow keys, up and down buttons; permissions.md, "Setting the order")
- After update: `space_access_changed` to the space, checks voice permissions
- Answers the role, with `permissions` only while the actor still holds `MANAGE_ROLES` after the change

### Delete Role

**Endpoint:** `DELETE /api/spaces/:id/roles/:roleId`
**Permission:** `MANAGE_ROLES`

- Cannot delete @everyone role (roleId === spaceId)
- `404 role_not_in_space` for a role of another space; `403 role_hierarchy` for a role at or above the actor's top role; `403 cannot_change_unowned_permissions` for a role carrying a bit the actor does not hold (permissions.md "Held-bits rule")
- Deletes channel and category overrides referencing this role, then renumbers the remaining roles
- After delete: `space_access_changed` to the space, checks voice permissions

---

## Channel Management

### Channel Types

| Type | Semantics |
|------|-----------|
| `text` | Message-based channel with read states, embeds, reactions |
| `voice` | Voice/video channel (LiveKit integration, see voice.md) |

### Create Channel

**Endpoint:** `POST /api/spaces/:id/channels`
**Permission:** `MANAGE_CHANNELS`

| Field | Validation |
|-------|------------|
| name | Required, a string; stored as `normalizeChannelName(name)` from `@backspace/shared` (trimmed, lowercased, each whitespace run → one hyphen), 1-100 chars |
| type | Required, `'text'` or `'voice'` |
| topic | Optional, a string; stored as `normalizeChannelTopic(topic)` from `@backspace/shared` (line endings unified to `\n`, trimmed, blank → `null`), at most `CHANNEL_TOPIC_MAX_LENGTH` (1024) UTF-16 code units after normalization. A non-string answers `400 channel_topic_invalid`; a longer topic answers `400 channel_topic_length` with `{ max }` and is never cut |
| categoryId | Optional, validated against space's categories |

Position: `max(existing positions) + 1`.

**Response (201):** the created channel including the creator's computed `myPermissions` and `isPrivate: false` — same shape as the `channel_created` event payload — so the creating client can render it immediately without waiting for the broadcast to round-trip.

**Broadcast:** `channel_created` sent per-user (only to users with VIEW_CHANNEL on the new channel). Each user's event includes their computed `myPermissions`.

**Client reconciliation:** both the create response and the `channel_created` event are applied through the `upsertChannel` store action (see client-federation.md, "Channel index and lookup maps").

### Update Channel

**Endpoint:** `PATCH /api/channels/:id`
**Permission:** `MANAGE_CHANNELS` (checked with channel-level override context)
**Body:** `{ name?, topic?, position?, categoryId? }`

- Name: same normalization as create; a non-string answers `channel_name_required`
- Topic: same normalization and limit as create (`checkChannelTopic` in `utils/channelTopic.ts` serves both routes); `null` or a value that trims to nothing clears it
- Position: non-negative number
- categoryId: `null` to unassign, or valid category ID in same space

**Broadcast behavior:**
- If `categoryId` changed: calls `broadcastOverrideChange` (per-user VIEW_CHANNEL recheck, may send `channel_deleted` to users who lost access, and `space_voice_state` to viewers of a voice channel; see "Channel/Category Permission Overrides" below), and `checkVoicePermissions` for a voice channel
- Otherwise: simple `channel_updated` broadcast to channel viewers

**Client:** the Overview tab of channel settings renames through the `updateChannel` store action, which sends the request to the space's own instance and applies the returned row, so the editor shows the stored (normalized) name at once. The editor is the shared `InlineNameEditor` (`components/ui/`): Save or Enter commits, Cancel or Escape abandons, blur does nothing, and Escape never reaches the settings modal's own close handler. It compares edits with `normalizeChannelName` and sends nothing when the stored name would not change. The control shows when the user holds `MANAGE_CHANNELS` on that channel (see "Client gating" in permissions.md).

The same Overview edits a text channel's topic with `ChannelTopicEditor` (`components/modals/`), also through `updateChannel`. The field always holds the stored topic; Save and Discard Changes appear only while `normalizeChannelTopic(draft)` differs from it, Ctrl/Cmd+Enter saves, and Escape with unsaved changes discards them without closing the modal. Its counter measures the normalized draft against `CHANNEL_TOPIC_MAX_LENGTH`, so it agrees with the server; a topic stored before the limit existed is shown whole and can be saved once it is short enough. Without `MANAGE_CHANNELS` the topic is read-only text. Voice channels get no topic field, as in the create dialog.

**Channel header topic:** `ChannelHeaderTopic` (`components/layout/`) shows the topic on one line with an ellipsis. The full text is always reachable: the native tooltip shows it on hover, and the line is a button that opens it in a `Modal` (titled `#name`, line breaks kept), which also covers keyboard and touch.

### Delete Channel

**Endpoint:** `DELETE /api/channels/:id`
**Permission:** `MANAGE_CHANNELS` (checked with channel-level override context)

**Cleanup sequence:**
1. Disconnect all voice participants (if voice channel)
2. Collect viewer IDs before deletion (for targeted broadcast)
3. Collect attachment filenames before cascade
4. Delete `read_states` (no FK)
5. Delete `messages` (attachments cascade)
6. Delete `channels` row
7. Delete attachment files from disk
8. Broadcast `channel_deleted` only to users who could see the channel

### Category Management

**Create:** `POST /api/spaces/:id/categories` — permission: `MANAGE_CHANNELS`, name 1-100 chars, auto-position. Broadcasts `category_created`.

**Update:** `PATCH /api/categories/:id` — permission: `MANAGE_CHANNELS`, updatable: name (a string, stored as `normalizeCategoryName(name)`, which trims and keeps case and spacing, 1-100 chars; a non-string answers `category_name_required`), position. Broadcasts `category_updated` (includes `isPrivate` flag). The category settings Overview renames through the `updateCategory` store action with the same `InlineNameEditor` as channels.

**Delete:** `DELETE /api/categories/:id` — permission: `MANAGE_CHANNELS`. Transaction nulls `categoryId` on child channels, then deletes category. Broadcasts `category_deleted` then `channel_layout_updated` (per-user filtered). The child channels lose the category's overrides, so they count as moved for `broadcastChannelLayout` (below), and `checkVoicePermissions` runs when one of them is a voice channel.

### Channel Layout Reorder

**Endpoint:** `PATCH /api/spaces/:id/channel-layout`
**Permission:** `MANAGE_CHANNELS`

**Body:**
```typescript
{
  channels: Array<{ id: string; position: number; categoryId: string | null }>;
  categories: Array<{ id: string; position: number }>;
}
```

**Validation:**
- All channel IDs must belong to the space
- All category IDs must belong to the space
- All positions must be non-negative numbers
- Channel categoryId references must point to valid space categories

Applied atomically in a transaction. Broadcasts via `broadcastChannelLayout(spaceId, movedChannelIds)` which sends `channel_layout_updated` per-user (each user sees only channels they have VIEW_CHANNEL on). A channel whose `categoryId` changed takes the overrides of its new category, so who can see it may change: a member who can see a moved voice channel is then also sent `space_voice_state` (`pushSpaceVoiceState`), since the layout carries no voice presence, and `checkVoicePermissions` runs when a voice channel moved. A layout that only reorders sends neither.

### Channel/Category Permission Overrides

OUT OF SCOPE for this document. See [permissions.md](permissions.md) for the three-tier override system (category overrides, channel overrides, member overrides) and the `computePermissions` algorithm.

Override endpoints documented here for API completeness:

| Endpoint | Permission | Notes |
|----------|------------|-------|
| `GET /api/channels/:id/overrides` | `MANAGE_ROLES` | List channel overrides |
| `PUT /api/channels/:id/overrides` | `MANAGE_ROLES` | Upsert (delete+insert in tx). Role hierarchy on the target, held-bits rule against the stored row. |
| `DELETE /api/channels/:id/overrides/:targetType/:targetId` | `MANAGE_ROLES` | Remove override; refused for a target at or above the actor, or when it sets a bit the actor does not hold |
| `GET /api/categories/:id/overrides` | `MANAGE_ROLES` | List category overrides |
| `PUT /api/categories/:id/overrides` | `MANAGE_ROLES` | Upsert; role hierarchy on the target, held-bits rule against the stored row |
| `DELETE /api/categories/:id/overrides/:targetType/:targetId` | `MANAGE_ROLES` | Remove override; refused for a target at or above the actor, or when it sets a bit the actor does not hold |

All override mutations call `broadcastOverrideChange` (channel) or `broadcastCategoryOverrideChange` (category, every channel in it). Both go through `broadcastChannelVisibility(spaceId, channelIds)`, which re-evaluates VIEW_CHANNEL per-user and sends `channel_updated` (can see it, with `isPrivate` and their `myPermissions`) or `channel_deleted` (cannot). A member who can see a voice channel among them is then sent `space_voice_state` once (`ConnectionManager.pushSpaceVoiceState`), as after a role change: `channel_updated` carries no voice presence, so a voice channel an override just showed them would otherwise appear empty until the space is loaded again. Voice permission enforcement via `checkVoicePermissions` runs after every override change.

### Drag-and-Drop (`useDragManager.ts`)

Client-side hook managing three drag types:

| Type | Draggable | Drop target | Permission |
|------|-----------|-------------|------------|
| `channel` | Channel items | Before/after channels or categories | `MANAGE_CHANNELS` (`canManage`) |
| `category` | Category headers | Before/after channels or categories | `MANAGE_CHANNELS` (`canManage`) |
| `voiceUser` | Voice participant | Different voice channel | `MOVE_MEMBERS` (`canMoveMembers`) |

**Drop position normalization:** "before B" is normalized to "after A" (the preceding item in `orderedItems`) to prevent double drop-indicator rendering.

**Auto-scroll:** When dragging near top/bottom edges (40px), scrolls the sidebar container proportionally to edge distance.

**Self-drop guard:** Dropping on the same item is a no-op.

---

## Space Layout (Sidebar Ordering & Folders)

### Data Model

**Layout items (`SpaceLayoutItem`):**
```typescript
type SpaceLayoutItem =
  | { t: 's'; id: string }   // space reference
  | { t: 'f'; id: string };  // folder reference
```

**Folders (`SpaceFolder`):**
```typescript
interface SpaceFolder {
  id: string;
  userId: string;
  name: string | null;
  color: string | null;
  position: number;
  spaceIds: string[];   // ordered list of spaces in the folder
}
```

### Server Persistence

**Tables (see database.md):** `user_space_layout`, `space_folders`, `space_folder_members`

**Endpoint:** `PUT /api/users/@me/space-layout` (`users.ts`)

**Request body:**
```typescript
{
  items: SpaceLayoutItem[];
  folders: Record<string, {
    name: string | null;
    color: string | null;
    spaceIds: string[];
  }>;
  updatedAt?: number;   // LWW timestamp
}
```

**Server-generated folder IDs:** Clients use `new:*` prefixed keys for new folders. The server maps each `new:*` key to a `generateSnowflake()` ID. The response returns resolved IDs so the client can update references.

**Remote folder adoption:** If a folder ID does not match an existing folder and does not start with `new:`, the server creates it with the provided ID (handles folders created on another instance being pushed to this one).

**Transaction:**
1. For each folder in request: create new / update existing / adopt remote
2. Clear and re-insert `space_folder_members` with ordered positions
3. Delete folders not in request (with their members)
4. Replace `new:*` keys in items array with resolved IDs
5. Upsert `user_space_layout` row (JSON string of items)

**WS broadcast:** `space_layout_updated` sent to the user's other connections (multi-tab sync).

**Response:** `{ items, folders, updatedAt }`

### LWW Conflict Resolution

**Server-side guard** (`users.ts`): If the request includes `updatedAt` and it is older than the stored `updatedAt`, the write is rejected and the current layout is returned without modification.

**Client-side algorithm** (`spaceStore.ts:populateFromReady`):

```
On receiving ready payload from any instance:
  incomingTs = payload.layoutUpdatedAt ?? 0
  currentTs = store._layoutUpdatedAt

  if incomingTs >= currentTs:
    Accept incoming layout (overwrite local)
    _layoutUpdatedAt = incomingTs
  else:
    Keep local layout
    Push local layout to the stale instance via pushLayoutToOrigin()
```

**`pushLayoutToOrigin(origin, layout, folders, updatedAt)`:** Calls `targetApi.spaceLayout.update()` on the specific instance that had the stale layout. This ensures all instances converge to the newest layout.

### Multi-Instance Layout Push

**`updateSpaceLayout(items, folders)`** in spaceStore:
1. Optimistically applies the layout with `Date.now()` timestamp
2. Collects all targets: home API + all connected remote instance APIs
3. `Promise.allSettled` pushes to all targets in parallel
4. Uses the first successful response to resolve `new:*` folder IDs
5. Updates store with resolved layout

---

## WS Ready Payload

The space layout and folder data are delivered in the WS `ready` event (`handler.ts:buildReadyPayload`):

```typescript
{
  spaces: SpaceWithChannelsAndMembers[];
  folders: SpaceFolder[];
  spaceLayout: SpaceLayoutItem[] | null;
  layoutUpdatedAt: number | null;
  dmChannels: DmChannel[];
  // ... other fields
}
```

`populateFromReady` merges incoming data by origin:
- Replaces all spaces from the incoming origin, keeps spaces from other origins
- Replaces this origin's entries in the space-channel index and `channelPermissions` (client-federation.md, "Channel index and lookup maps"), and adds this origin's categories to `categoryOriginMap` (entries of categories it no longer lists stay)
- DM channels: removes existing DMs from this origin, appends incoming, deduplicates 1-on-1 DMs by canonical member pair (prefers home-origin copy)
- Applies LWW layout merge as described above

---

## WS Events Summary

| Event | Direction | Trigger |
|-------|-----------|---------|
| `space_updated` | S→C (space) | Space metadata changed |
| `member_joined` | S→C (space) | New member via any join path |
| `member_updated` | S→C (space) | A member's nickname or role set changed (`PATCH /members/:uid`) |
| `member_left` | S→C (space) | Member left, kicked, or banned |
| `member_banned` | S→C (user) | Sent to the banned user with reason |
| `join_request_received` | S→C (user) | Sent to space managers when request submitted |
| `join_request_accepted` | S→C (user) | Sent to requester with full space data |
| `join_request_declined` | S→C (user) | Sent to requester |
| `channel_created` | S→C (per-user) | New channel, per-user VIEW_CHANNEL filter |
| `channel_updated` | S→C (per-user/channel) | Channel or override changed |
| `channel_deleted` | S→C (per-user) | Channel deleted or user lost VIEW_CHANNEL |
| `category_created` | S→C (space) | New category |
| `category_updated` | S→C (space) | Category name/position/privacy changed |
| `category_deleted` | S→C (space) | Category removed |
| `channel_layout_updated` | S→C (per-user) | Batch reorder, per-user channel filtering |
| `space_layout_updated` | S→C (user) | Sidebar layout changed (multi-tab sync) |

---

## Federation Considerations

### Instance Origin Tagging

Every space in the client store has `_instanceOrigin: string`:
- `''` (empty) = home instance
- `'https://remote.com'` = remote federated instance

All store actions resolve the correct API client via `getApiForOrigin(origin)` before making HTTP requests. The resolver is registered by `instanceStore` on import (breaks circular dependency).

### User ID Resolution

`getMyUserIdForOrigin(origin)`, the user's row id on the instance at `origin`, is defined in client-federation.md section 5. Used for self-leave (`leaveSpace` calls `removeMember` with the correct user ID for the instance).

### Remote Invite Join Flow

```
1. User enters invite URL pointing to remote instance
2. parseInviteInput extracts code + origin
3. joinByCode(code, origin) called
4. If not connected → NotConnectedError thrown
5. JoinSpaceModal/JoinPage enters 'connect' phase
6. User provides password → connectToRemote(origin, password)
7. If only the account's own credentials can get in → RemoteLoginRequiredError → 'fallback' phase (reasons: client-federation.md, connect flow step 7)
8. On success: joinByCode retried, space added to store with _instanceOrigin
```

### Asset URL Normalization

Remote space icons, banners, and member avatars are resolved via `resolveAssetUrl(path, origin)` when:
- `populateFromReady` processes spaces from a remote origin
- `loadSpaceDetail` loads a remote space
- `joinByCode` returns a remote space
- Manager request avatars use the request's owning origin

### Client Load State (`useSpaceStore`)

Two distinct flags track per-space load progress:

- `loadingSpaceId: string | null` — set when a plain `loadSpaceDetail` starts (a `quiet` one never sets it) and cleared when the newest load of that space lands or fails. Drives the channel-list and member-list skeletons (gated through `useDelayedLoading`).

Only the newest `loadSpaceDetail` of a space applies its response; an older one landing later changes nothing and resolves to what the newest resolves to. A detail lands in `channels`/`categories`/`members`/`roles` only when its space is still the open one (`currentSpaceId`; every caller opens the space before loading it); otherwise only that space's channel index entries and permission entries are updated. websocket.md (`space_access_changed`) says why loads of one space overlap.
- `loadedSpaceIds: Set<string>` — populated only on successful `loadSpaceDetail` completion. Used to differentiate "load not yet attempted" from "loaded with empty result." Required by mobile UI to gate the empty-state mascot — without it, the mascot flashes during the pre-skeleton load window because `state.channels` is overwritten on each `loadSpaceDetail` and a fresh space switch leaves `spaceChannels` momentarily filtered to `[]`.

`loadedSpaceIds` lifecycle:
- Added when a `loadSpaceDetail` response lands in the open space (the same `set()` that replaces `channels`/`categories`/`members`).
- Pruned per-space on `deleteSpace`, `leaveSpace`, `removeSpace`, `removeInstanceSpaces`.
- Wiped entirely on `reset` (logout).
- Ephemeral — not persisted.
