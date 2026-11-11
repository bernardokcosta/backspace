# Authentication & Session System

`routes/auth.ts` and `utils/auth.ts` authenticate local accounts only. Credentials
are never forwarded to another server, and a failed password never rewrites a
stored hash. The standalone auth/DM conversion is implemented; remaining account,
client/desktop conversion still needs whole-application acceptance before release.

## Sources

- `packages/server/src/routes/auth.ts`: register/login, username/invite checks.
- `utils/auth.ts`: password hashes, JWT verification, authentication and admin gate.
- `utils/botTokens.ts`: native bot tokens, hashes, revocation and legacy JWT cutover.
- `utils/inviteService.ts`, `routes/invites.ts`: invitation admission and audit.
- `routes/users.ts`, `routes/admin.ts`: protected account/password operations.
- `utils/userDeletion.ts`, `utils/sanitize.ts`: tombstones and public profiles.
- `ws/handler.ts`: socket authentication, connection-owned presence and ready.
- `packages/web/src/stores/authStore.ts`: current session and user-scoped reset.

## Passwords and access tokens

`bcryptjs` uses cost 12 in production; tests use cost 4 through the existing
non-configurable test policy. Stored hashes retain their encoded cost.
`PASSWORD_MIN_LENGTH` is the single shared minimum (8), consumed by signup,
password change and client validation. Temporary admin passwords exceed it.

User JWTs carry `{userId,username,iat}`. Signing uses the configured secret and
expiry (default 30 days); verification enforces HS256. `JWT_SECRET` must contain
at least 32 characters or configuration fails. `verifyAccessToken`:

1. Resolves a native bot token or verifies a JWT signature/expiry, requiring a
   nonempty string account ID/name, positive finite issued-at and later expiry.
2. Loads the account and rejects missing/deleted rows.
3. Enforces existing password-change revocation (`iat` seconds compared with
   `passwordChangedAt/1000` without rounding). New sessions use NumericDate seconds
   with millisecond precision, permitted by RFC 7519; existing integer-issued
   sessions remain accepted when not older than an actual cutoff.
4. Enforces the native legacy-bot JWT cutover.
5. Returns the verified local user id/name and bot flag; no home identity exists.

`authenticate` extracts `Bearer <token>` or the existing `Bot <token>` alias,
verifies it and attaches local identity to the request. `requireAdmin` separately
checks the stored account's admin flag. Removing the obsolete local-versus-remote
predicate must never remove these authentication/authorization checks.

Raw upload/tus hooks share `verifyAccessToken` and its typed `AuthError`; they do
not bypass account deletion, password revocation or bot token validation.

Native bot tokens use `bsb_<16-hex-id>.<43-character-base64url-secret>` with 256-bit
random secrets. Store only SHA-256, compare in constant time, reveal the secret
once, never return hashes in list responses. Per-token revoke does not affect
another token/bot; all-token revoke and account deletion remove their authority.
`last_used_at` updates at most once/minute. A native bot's historical long-lived
JWT works only until its first hashed token is issued; human JWTs are unaffected.

## Admission and temporary failures

HTTP admission preserves the operational-resilience budgets:

- Login: 120 requests/2 minutes per normalized trusted client address.
- Credential attempts: independent address + normalized username token bucket,
  burst 10/refill 1 per 12 seconds; reserve before bcrypt, refund once only after
  verified successful login. Long retained handles remain usable; limiter keys
  retain the existing length bound.
- Register: 10/2 minutes/address. Username/invite checks: 30/minute/address.
- Password verification: 10/2 minutes/account. Protected password/deletion quotas
  remain keyed by authenticated account after authentication.

These are independent of early flood and ordinary verified-account gates in
[api.md](api.md). NAT neighbors do not share an account's action bucket.

The client preserves session/data on temporary 429/network/5xx; only an
authoritative 401 expires credentials. A saved-token bootstrap refusal settles
as `userLoadError`, with explicit retry rather than an infinite pending load or
automatic relogin. Retry/success/new session/logout clear that error. Logout/reset
cancels recovery and stale request generations.

## Registration

`POST /api/auth/register` accepts `{username,password,displayName?,avatarColor?,
inviteToken?}`. Username is trimmed/lowercased, 3–32 characters, `[a-z0-9_]+`.
An `@domain` name is invalid for new signup regardless of extra submitted fields.
Existing retained legacy handles may still log in with their local password.

There is one admission gate: explicit `instance_settings.registration_open`, or
`config.registrationOpen` when unset. Closed signup requires an active local
invite; open signup ignores any invite token without validating/consuming it.
Submitted identity/bot/admin fields grant no authority and cannot select another
admission path. Native bot creation remains the authenticated owner's bot flow.

After validation and inexpensive invite preflight, hash the password, check name
uniqueness and create a fresh Snowflake account. The first account in an empty
database becomes admin; later accounts do not, regardless of submitted flags.
Signup never binds credentials to an existing id/name. Color comes from the
existing palette or random fallback. Return `201 {token,user}` with a sanitized
self profile, never a hash, private identity or credential registry.

Neither successful signup nor login sets presence online: only a real authenticated
socket owns live presence. A client that never connects must not remain stuck online.

### Invitations

Invitation tokens are 22-character base64url, generated from 16 random bytes.
Status is derived from revoke/expiry/use count, not a stored state. Admin invite
CRUD, rotation/reinstatement and audit remain unchanged.

Closed signup uses `redeemInvite`'s existing transaction to re-fetch/revalidate the
token, insert the account, increment use count and write `invite_redemptions`.
Concurrent exhaustion/revoke/expiry or username collision rolls everything back:
failed signup never consumes a slot. Audit retains invitation id, local user id,
registration-time username and timestamp. Public `/auth/check-invite` collapses
malformed/unknown/revoked inputs to the same invalid response, without metadata;
only valid names and legitimate expired/exhausted UX states are exposed.

`GET /auth/check-username` uses the same native name validation and registration
gate, returning `{available,reason?,code?,details?}`. Login is independent of the
signup gate, so closing registration never locks existing users out.

## Login and protected account operations

`POST /api/auth/login` normalizes the full submitted username, finds the existing
local row, rejects deleted accounts and verifies only that row's bcrypt hash.
Wrong/missing credentials are refused without HTTP/DNS or password self-healing.
After bcrypt, re-read that native account and require a live row with the exact
verified hash and password cutoff. A reset/deletion committed during verification
refuses issuance; otherwise refund the reservation and return a fresh JWT/current
sanitized user with no intervening await.

Password changes require the verified local session and current password, the
shared new-password minimum, then a new hash and `passwordChangedAt`; return a
fresh token only if an atomic hash/cutoff/live-row comparison still matches the
verified credential. The cutoff advances monotonically, including same-millisecond
changes or a backward wall clock. A concurrent reset/deletion refuses the write
and token instead of overwriting it. Admin reset separately requires actual admin authority and a live
target, generates a random 16-character temporary password, revokes older sessions
and disconnects the target. No submitted origin or profile field changes authority.
Preserved legacy `is_deleted=NULL` remains active like `0`; the atomic password
UPDATE accepts either without rewriting the flag or weakening hash/cutoff checks.
Self-service password changes also disconnect already-authenticated sockets after
the hash/cutoff commit. Their old REST/tus/reconnect credentials are refused even
when issued earlier in the same second; the returned replacement token uses the
committed cutoff and remains valid. Login issuance respects the persisted cutoff
if the wall clock has moved backward. See [the precision decision](../decisions/0003-native-session-revocation-precision.md).

Self-deletion requires username confirmation and local password verification,
and refuses while the user owns spaces. Tombstoning anonymizes the row without
reusing its id. Relationship/content cleanup is transactional; attachment/profile
files and socket disconnects follow commit. One-on-one history remains reachable
to a surviving member as a read-only Deleted User archive; group membership and
ownership follow [dm-system.md](dm-system.md). Do not remove surviving native history
merely because its other author was deleted.

## Current session lifecycle

The target client model is one selected server/account/session and one socket.
Changing server ends the old session/call/socket and resets user-scoped state
before any request reaches a new base. Never send an old instance's bearer token,
password or stored bot credential to the replacement server. Current-server cache
scope/generations remain necessary when explicit switching encounters equal ids.

`resetUserStores` remains the shared account boundary for chat, spaces/access,
social, voice, activity and session-scoped settings. Initial selection/desktop
Change Instance stay supported; simultaneous peer sessions, remote credential
issuance, attach/provision and registry synchronization are removed, not emulated
with no-op adapters. Complete client/desktop acceptance remains pending.

Native account settings keep profile/status/image/password controls; they no
longer offer detached-account reattachment. Drafts, image waits and mutation
feedback are session-owned. Password rotation retains native current-password
verification, replaces the JWT and resets sensitive fields. Account deletion
still requires the exact full username and password. Owned spaces must be
explicitly transferred/deleted before confirmation, and Continue stays disabled
while their roster snapshot loads. Deletion never propagates to other servers;
its completion/logout timer cannot expire a replacement login.
