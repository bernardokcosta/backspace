# One selected server and native session

The client has one selected server, one native account, one authenticated API
client and one socket. It does not maintain peer sessions, project identities or
route operations using remote credentials. Ordinary external media and LiveKit
participants are not additional authenticated server sessions.

- `api/client.ts` owns native REST access and bounded scoped GET recovery.
  Mutations are never retried as reads. Logout/session replacement cancels
  outstanding requests; stale success or 401 responses cannot affect a new login.
- `authStore.ts` owns the native user/token and existing session reset.
- `hooks/useWebSocket.ts` owns the current socket and native event dispatch.
- Native IDs determine permissions, actor/self comparisons, DM partners and calls.
  A retained username containing `@` remains exact display/login data, not a host.
- Current-server ownership still scopes transfers, pending work and drafts.
  It never authorizes another API endpoint or credential source. See
  [uploads.md](uploads.md) for stale-session refusal and legacy recovery rules.
- Invitations to a foreign host are refused before preview/join/request. A foreign
  URL must not be reduced to a colliding local code.
- The isolated storage-removal transition deletes only obsolete peer keys.
  It does not import credentials, reconnect peers or alter native persisted work.

Desktop first-run selection and explicit Change Instance remain. Changing the
selected server replaces the current server/session; it is not federation. The
desktop trusts only its current URL for ordinary in-app navigation. See
[desktop.md](desktop.md) and [desktop-security.md](desktop-security.md).
