# Spec: standalone-client

## Objective and status

Approved consumer of [standalone-core](2026-11-10-standalone-core.md), under the
[approved map](2026-11-10-standalone-security-map.md). Use one current instance
with one local identity and one socket; remove client-side federation completely.
Hiding Connections/Federation panels while retaining stores, tokens or requests
does not satisfy this specification. No visual redesign beyond voice polish.

## Tech stack and structure

Existing React 19, Zustand 5, Vite 8, Tailwind 3 and current i18n catalogs. Reuse the
primary API client, auth/session reset, socket heartbeat and local stores.

- `api/client.ts`, `stores/{auth,space,social,voice,activity,chat}Store.ts`,
  `hooks/useWebSocket.ts`: simplify existing interfaces and their callers.
- `stores/instanceStore.ts`, cross-store origin resolvers, remote account/profile
  sync, copy/failover modules and federation-only helpers: remove, not stub.
- Settings/admin/registration/people/DM/invitation views: local consumers only.
- `src/i18n`, all 25 catalogs, desktop instance selection and installed-acceptance
  fixtures: update actual consumers without dropping translations wholesale.

## Interface and behavior

- The current verified `user.id` is the only "me" id. Remove home identity maps,
  registry sync, per-remote secrets, auto-attach and remote password fallback.
  Keep chosen status and native account/profile/password/deletion flows.
- Reuse the existing primary `api` and selected server base. Remove alternate-
  peer origin parameters from operation interfaces and every caller; do not leave a
  `getApiForOrigin` wrapper that ignores its argument.
  The current server identity still scopes native caches and request generations
  where needed: a single session must not conflate equal user/channel ids when
  an operator explicitly switches servers. Current-base upload URLs and cache
  scope are legitimate local functionality, not an alternate-origin registry.
- Keep one live WS connection with heartbeat/reconnect and account generation.
  Remove multiplexing, peer notifications, replica presence and relay callbacks.
- DM state is keyed by local channel id, not a merged collection of copies.
  Retain local optimistic messages, history paging, read pointers, selection,
  drafts and account-scoped IndexedDB rehydration.
- Keep the completed operational-resilience work: bounded GET recovery, typed
  rate limits, explicit bootstrap retry, authoritative401-only credential expiry,
  stale-response cancellation, SW update lifecycle and media-probe recovery.
- Current-instance invitations and request/approval gates remain. A supplied
  foreign-host invitation cannot silently register/login on another server or
  strip its host and join a colliding local invite. It may be opened independently
  outside the current session, never merged into it. Reuse existing navigation
  and error presentation rather than invent a remote-connection fallback.
- The desktop still accepts an initial instance URL and its existing Change
  Instance action. Changing instance ends old calls/sockets and clears that
  session before another server can receive requests. Never forward an old
  instance's password, bearer token or stored bot credential to the new one.
- Local DM calls use the core's non-null channel id and `answeredByUserId`;
  remove host/copy fallbacks without removing valid local refusal correlation.

## UI and catalogs

Remove the admin Federation tab/panel, peer approvals/reset/orphan UI, Connections
settings and linked-account registration controls, badges and help specific to
other instances. Remove retired namespaces/resources/imports and matching keys
from every catalog, including native catalogs if they contain actual feature UI.
Preserve unrelated local strings within mixed namespaces and AGPL/source offers.

The sticker store remains local: remove peer sync/policies, replica badges and
source-instance filters, not pack creation, moderation, installation or rendering.

Keep existing Aether Drift styling and mobile settings navigation. Do not delete
voice, streaming, storage, users, updates, games, soundboard or diagnostics as a
side effect of removing a neighboring tab. Remove stale modal names/unions and
navigation branches as well as the displayed entries.

## Persisted state transition

Before session/bootstrap can reconnect, remove exactly the retired keys:
`backspace_instances`, `backspace_instances_<accountId>` and scoped
`backspace_true_home_status:*` reports, plus any additional federation-exclusive
key proven by the inventory. Enumerate storage keys first; deleting while
incrementing an indexed storage iterator must not skip entries.

Keep `backspace_token`, the current instance URL, language/scale, audio settings,
native pending transfers, local drafts and other unrelated settings. Never use
`localStorage.clear()`, reset the whole Electron profile or reinterpret remote
tokens as local sessions. If storage is unavailable, federation still cannot run;
the UI stays usable under the existing storage-failure rules.

No permanent compatibility store or background legacy reconnect remains. A
small isolated one-time removal function is permitted, with exact key tests.
Update installed acceptance so that intentional removal of obsolete remote
tokens is checked alongside preserved local session/cookie/preferences/IndexedDB.
Do not remove the six-platform acceptance gate or change its approved fixed
Veyvox 1.17.0 baseline merely to hide a failed upgrade.

## Style and testing

Use existing modules and direct local ids, for example:

```ts
const selfId = useAuthStore.getState().user?.id;
const mine = selfId !== undefined && message.userId === selfId;
```

Test local login/register/profile/logout/bootstrap, one socket across reconnect,
session/instance replacement races, no token leakage to foreign URLs, 403/404/429
handling, native invitations, own/other user comparisons, friends and DM/group
lifecycle, calls, notifications, games, soundboard and pending-transfer recovery.
Add a storage transition matrix with several old keys, malformed values,
storage-denied mode and preserved native values. Keep module interfaces as the
test surface, not dozens of copied implementation snapshots.

Verify admin/mobile settings and voice controls in a real disposable browser
fixture. Assert no HTTP/WS requests to old peer origins even with seeded old
remote-token storage. Generic web links/media and configured LiveKit remain
legitimate external resources, not evidence that federation still runs.

## Commands and acceptance

```bash
corepack pnpm --filter @veyvox/web exec vitest run src/stores/authStore.sessionReset.test.ts --maxWorkers=2
corepack pnpm --filter @veyvox/web typecheck
corepack pnpm check:i18n
corepack pnpm --filter @veyvox/web test --maxWorkers=2
corepack pnpm --filter @veyvox/desktop build:ts
corepack pnpm test:tooling
```

The implementation plan must inventory additional affected suites before
execution. All 25 catalogs pass,
retained desktop/session identity survives, no origin registry/multiplexing or
federation-only UI is built, and old cached credentials generate zero connections.

## Boundaries and open questions

Always preserve permissions, accessibility, local persistence and cancellation.
Ask before another feature removal or changing installed crypto/profile IDs.
Never replace deleted helpers with constant-return stubs, weaken i18n checks,
reuse foreign credentials or claim a screenshot proves runtime security.
No product question remains; exact consumer inventory belongs to the plan.
