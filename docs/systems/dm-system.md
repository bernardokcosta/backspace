# DM System

The server stores one native conversation, addressed by `DmChannel.id`. Its
participants, authors and owners use existing local `User.id` values. The database
retirement and DM REST conversion are implemented; the wider WS/client conversion
is still in progress in this worktree and must pass acceptance before release.

## Sources and storage

- `packages/server/src/routes/dm.ts`: CRUD, membership, ownership, history,
  message hydration, invitation cards and broadcasts.
- `utils/dmConversation.ts`: transactional pair lookup/insertion/reconciliation.
- `utils/dmChannelWire.ts`: the sole channel serializer and shared list/preview
  loaders for REST, ready and channel-created emissions.
- `utils/dmConversationEvents.ts`: announce a committed native reconciliation.
- `utils/dmMemberClosed.ts`: native membership open/closed state, without relay clocks.
- `utils/dmMessageRules.ts`, `utils/permissions.ts`: shared REST/WS write checks.
- `utils/userDeletion.ts`, `utils/storageJanitor.ts`: tombstones and deferred GC.
- `packages/shared/src/dmSystemEvents.ts`: system content definition/parser.

Tables: `dm_channels`, `dm_members`, `dm_messages`, `dm_reactions`, `read_states`,
`attachments`, `embeds`, and pending bot `interactions` references.

## Local pair identity

| Property | One-on-one | Group |
|---|---|---|
| `owner_id` | NULL | Creator/current owner's local id; never NULL |
| `pair_key` | Private 32-hex uniqueness key | NULL |
| Membership | Immutable pair | Mutable, up to 10 members |
| Name/icon | NULL | Optional, owner-managed |
| Close | Hide for this member without leaving | Same |
| Leave/kick | Not supported | Leave; owner can kick another member |
| Last member leaves | Not applicable | Soft-delete, GC after 24 hours |

`oneOnOneKey(a,b)` preserves the original native SHA-256 bytes: sorted local ids,
joined by `:`, first 32 lowercase hexadecimal characters. `idx_dm_pair_key` is
unique for non-null keys. The key is never serialized or derived by the client;
the stable local channel id identifies the conversation everywhere on the wire.

`findOrCreateOneOnOne(db,a,b,{open})` owns an immediate transaction:

1. Find the keyed row. A label under different native members is reconciled to
   their own pair, never used to expose their private history to another pair.
2. Otherwise reuse a row with exactly these two members, no owner and no soft
   deletion; order by creation time/id and key it.
3. Otherwise insert the keyed channel and both memberships. `open: 'first'`
   inserts the recipient closed; `open: 'both'` inserts both open.

Self-DMs, third-party private history/read pointers, invalid keyed groups and
unclassifiable participant sets are refused, with the transaction rolled back.
Tombstoned native participants retain their stable account id.

`reconcileDmChannelPairKey` requires an existing transaction. A duplicate native
pair merges into an existing correct holder; the migration otherwise prefers the
earliest creation/id. Messages keep ids/content, so attachments and reactions
remain attached. Pending bot interactions are repointed. Membership stays open
if either copy was open. `keepNewerReadPointer` moves the member's cursor and
keeps the numerically newer snowflake (`1000` is newer than `900`).

The generated standalone migration captures old provenance before dropping it,
refuses ambiguous ownerless legacy groups and mixed local references, and verifies
native row projections across SQL/reconciliation. See [database.md](database.md).
Native backfill is idempotent and snapshots before its first change.

## REST contracts and authority

All `/api/dm` routes authenticate first. Remote identity fields do not resolve or
create accounts, select another participant or cause network requests.

| Method/path | Body or gate |
|---|---|
| GET `/api/dm` | Open memberships, newest activity first |
| POST `/api/dm` | `{userId}`; existing local target, not self; 201 new / 200 existing |
| POST `/api/dm/group` | `{users:[{id}],fromDmChannelId?}`; 2–9 targets plus caller |
| PATCH `/api/dm/:id` | `{name?,icon?}`; group member and owner |
| DELETE `/api/dm/:id` | Member; hide, keep membership/history |
| POST `/api/dm/:id/members` | `{userId}`; group member, friend or own bot, cap 10 |
| DELETE `/api/dm/:id/members` | Group member leaves |
| DELETE `/api/dm/:id/members/:targetUserId` | Owner kicks another current member |
| POST `/api/dm/:id/transfer` | `{newOwnerId}`; owner, another live current member |
| POST `/api/dm/space-invite` | Existing local friend and valid current-instance invite |
| GET `/api/dm/:id/messages` | Member, cursor paging (`before`/`after`, limit 1–100) |
| POST `/api/dm/:id/messages` | Member, validated content/attachments/reply |
| PATCH `/api/dm/messages/:id` | Member and author; system messages immutable |
| DELETE `/api/dm/messages/:id` | Member and author |

Group creation rejects duplicate users, self, absent/deleted accounts and excessive
membership. Targets must be friends, except the caller's bots and existing members
of an authorized source one-on-one when creating a separate group. The source
private pair itself is not converted or made mutable.

Metadata updates trim names, allow null/empty clears and enforce existing length
limits. A changed local icon must be an owned, message-unclaimed image attachment within the existing
size limit; validated absolute HTTP(S) icon URLs retain their existing support.
No-ops write/broadcast nothing. Channel updates and name/icon system messages are
atomic; both changed fields produce separate native message ids. Old local icons
are cleaned after the transaction only without a surviving native holder; the new
file becomes a channel reference. Historical message-held files/thumbnail references
are preserved instead of deleting attachment records when replacing old icons.

Ownership transfer atomically changes `owner_id` and inserts an `owner_changed`
message authored by the previous owner. Broadcasts follow commit. A self-leaving
owner transfers to the first remaining member through this same helper. Kicks
cannot orphan the group: the owner remains. Leave/kick evicts the departing
member from the DM voice room, removes their read state, broadcasts the reason
and membership change, and closes the channel on their clients. Last-member leave
soft-deletes without nulling the group's owner/type.

## Close, reopen, serialization

Opening a private conversation only lists it for the opener. A recipient who
closed it stays closed until a new message or call. `reopenForClosedMembers`
first sends `dm_channel_created` with the current channel/last message, then the
message/ring. Other tabs receive `dm_channel_closed` when a user hides a thread.

`loadDmChannelWire` and `loadOpenDmChannels` share `toDmChannelWire`, sanitized
members, group metadata and message previews. Ready, GET/POST and broadcasts must
agree. Previews include `type`, avoiding raw system JSON in the sidebar.
The grouped newest-message lookup and chunked membership/attachment fetches avoid
quadratic history scans and SQLite variable-limit failures.

## Messages and read-only archives

`checkDmMessageCreate/Edit/Delete` preserve the same checks on REST and WS:
membership; existing recipient/deleted-partner restrictions; author ownership;
content types/length (4000); unlinked, caller-owned attachments; same-conversation
reply targets. Creation shares the verified-account channel/DM token bucket:
burst 12, refill 2/second across REST/WS/tabs. HTTP refusals include actual
`retryAfter`, `Retry-After` and `rateLimitScope: action`.

Message/attachment writes are atomic. Hydration batches authors, attachments,
reactions, embeds and same-channel replies. Every history/search/around read
confines reply hydration to the conversation; an old cross-channel reference
becomes `replyTo:null`, never another private message's content. Message delivery
clears typing and reopens closed memberships. Embed resolution runs asynchronously.
Edit clears old embeds before broadcasting; delete removes dependents atomically
and cleans files after commit. Leaving a group also removes edit/delete authority
over messages authored there earlier; closing it does not.

Tombstoning preserves a deleted partner's one-on-one membership and anonymizes the
profile to Deleted User. A surviving member can read history but cannot send,
edit/delete messages or mutate reactions in that archived pair. Group membership
is removed on account deletion and a departing owner is replaced. Purge only DMs
from the affected account's memberships with no other live members; do not sweep
unrelated channels. The supported historical missing-partner membership repair
uses existing message authors, never a guessed new identity.

## System messages and current-instance invitations

`DmSystemEvent`/`parseDmSystemEvent` are the content contract. Writers use
`dmSystemContent` and `dmSystemName`; malformed/unknown content renders a generic
localized label. System messages are never editable, including by their author.
Deleting follows ordinary author/member/archive checks.

| Event | Fields | Actor |
|---|---|---|
| `member_added` | targetUserId, targetDisplayName | Adder |
| `member_removed` | targetUserId, targetDisplayName, reason | Leaver/kicker |
| `owner_changed` | newOwnerId, newOwnerDisplayName | Previous owner |
| `name_changed` | oldName, newName | Owner |
| `icon_changed` | event only | Owner |
| `space_invite` | spaceId, spaceInstanceOrigin, inviteCode, snapshot | Inviter |

Invitation snapshots come directly from the local DB, not client content or an
HTTP self-request. Sending requires friendship but does not join the recipient:
public/private/request visibility and their real join/approval gates remain.
A supplied foreign origin is refused without HTTP, account provisioning or using
a colliding local code. Empty/current origin uses the configured current public
origin in stored content. Historical card content is preserved by the migration;
client navigation must never merge a foreign invitation into the current session.

The client timeline/sidebar share `parseDmSystemEvent`, `dmSystemText` and
`formatDmSidebarPreview`; group system text already includes its actor and must
not gain a second sender prefix. User messages retain their ordinary text/media
preview and group sender prefix.
