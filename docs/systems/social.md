# Social & Friends System

The native server graph is implemented in `routes/social.ts`, using existing local
`users`, `friends` and `friend_requests` rows. All endpoints authenticate. There
are no remote lookups, account provisioning, pair clocks, queueing or peer calls.
The client uses the current server's native graph. Whole-application acceptance
of the coordinated retirement remains a separate validation gate.

## Requests and friendships

| Method/path | Contract |
|---|---|
| GET `/api/social/friends` | `Friend[]`, other account's sanitized profile plus `addedAt` |
| GET `/api/social/requests` | Pending `FriendRequest[]`, each with the other account's profile |
| POST `/api/social/requests` | `{username}`; `201 {success,requestId}` |
| PATCH `/api/social/requests/:id` | `{status:'accepted'|'declined'}`; recipient only, pending only |
| DELETE `/api/social/requests/:id` | Sender only, pending only; delete row |
| DELETE `/api/social/friends/:id` | Remove the caller's friendship with this local account |

Usernames are trimmed/lowercased and looked up exactly. A sovereign legacy handle
containing `@` remains a local account's full username, never a routing directive.
An unknown `name@host` is not stripped to `name` or looked up over HTTP. Obsolete
identity fields cannot select another target; an identity-only body is invalid.

Creation refuses absent/deleted targets, self, bots, an existing friendship in
either orientation, or any pending request between the pair in either direction.
The authenticated sender must be a live human. Both broadcasts follow insertion:
`friend_request_received` to the target includes the sender profile, while
`friend_request_sent` to the sender's other devices includes the target profile.

Only the recipient may answer a pending request. Accept atomically inserts the
native friendship and updates request status, then sends the sender
`friend_request_accepted {friend,requestId}` and exchanges both accounts' current
presence snapshots through `exchangeFriendPresence`. Decline sends
`friend_request_declined {requestId,userId}`. An already declined/accepted request
cannot be answered again to recreate an unfriended or declined relationship.

Cancel removes only an authenticated sender's pending row and sends
`friend_request_cancelled {requestId,userId}` to its recipient. Unfriend checks and
deletes only the caller/target pair in either orientation, then sends the other
user `friend_removed {userId}`; unrelated relationships remain unchanged.

## Discovery and search

GET `/api/social/discover?q=&limit=&offset=` and `/api/social/search?q=` are
authenticated, rate-limited to 30/minute. Both require `discoverable=1`, live
accounts and exclude the caller. Match username or display name by SQL LIKE.
No provenance field participates in the query or the response.

Discover defaults to 24 results, clamps limit to 1–100 and offset to nonnegative.
Count matching rows before paging; load the caller's friend/space/request graph
and the page users' relationships in batches. Each `DiscoverUser` includes native
profile fields, mutual-friend/space counts, relationship (`none`, `friends`,
`outbound_pending`, `inbound_pending`) and the pending request id when applicable.
Order the page by mutual friends descending, then creation date descending.
Search returns at most 10 sanitized users, without mutual enrichment.

## Mutuals and profile audience

GET `/api/users/:id/mutuals` intersects the caller's and the exact local target's
friend ids/space memberships. Return sanitized mutual friends and
`{id,name,icon,avatarColor}` mutual spaces. Obsolete query identity fields never
resolve a different target; an absent target has empty intersections.

`collectProfileBroadcastTargetIds` deduplicates friends, DM co-members and space
co-members, excluding self. Profile changes send each observer the public profile
and self the self-view; `developerMode`/`showActivity` must not leak through a
profile broadcast. Presence uses the same audience and local account ids, with
snapshot activity fallback to custom status and empty activities while offline.
See [auth.md](auth.md), [activity-presence.md](activity-presence.md) and
[websocket.md](websocket.md).

## Native client graph and profiles

`socialStore` and `discoverStore` use the primary authenticated API and native
account/request IDs. `getFriendshipStatus` is shared by member menus, profile
actions and search-card enrichment: self/friends match IDs, and pending requests
must name the current account and the viewed account as their pair. Display names
and retained `@` handles never select an origin or equate different accounts.

Profiles request `api.users.getMutuals(userId)` once from the current server;
there is no connected-instance fan-out. The profile cache is keyed by native ID
and cleared by session reset. Old query/profile/mutual responses cannot populate
a replacement session or a different profile. Profile triggers pass the native
user, trigger rectangle, preferred placement and optional `{spaceId,userId}`
member context; mobile navigation carries those IDs, not an origin.

All Send Message entrypoints use `openDirectMessage(userId)`, reusing the native
pair or creating it with `{userId}` and adopting the current response. A response
owned by an earlier session cannot install a DM or navigate the next session.
Groups use native source/member IDs; owned-bot selection, sequential additions
and the ten-member capacity remain unchanged. No alternate copies, pin failover
or owner-instance routing remain in these flows.

Member context-menu mutations keep the existing in-memory session revision with
their native target IDs. Role, nickname, kick and ban results from an earlier
session cannot overwrite or remove an equal-ID next-session member. Role rank,
held-permission restrictions, server confirmations and local presence are retained.
