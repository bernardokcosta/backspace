# Spec: rate-limit resilience

## Status and objective

Approved by the user on 2026-11-10. The user selected this correction as part of the
[approved capability map](2026-11-10-operational-resilience-map.md).

Keep effective anti-abuse protection without turning ordinary navigation,
conversation, media loading or voice controls into a shared network-wide
lockout. A refusal must identify a temporary wait and permit safe recovery,
not silently lose an important action or misclassify a healthy federation peer.

## Assumptions and scope

- TypeScript strict, Fastify 5 with the installed `@fastify/rate-limit`, React 19
  and existing Zustand stores. No new dependency, Redis or database migration.
- The current application process owns its in-memory budgets. Cross-process
  distributed enforcement is not introduced or claimed.
- Authenticated budgets use the verified account row issued by the hosting
  instance, not a token string, unverified JWT payload, supplied username or
  claimed remote identity. Existing origin routing remains authoritative.
- Existing public asset delivery remains public. Do not require bearer tokens
  on images, audio, fonts, bundles or federated media to obtain fair budgets.
- HTTP transport admission, authenticated action admission and resource-specific
  safeguards serve different purposes and must not accidentally replace each
  other through plugin route overrides.

## Required behavior

### 1. Separate admission from ordinary use

- Keep an early, bounded client-address defense before expensive processing.
  Retain trusted-proxy semantics and normalize address keys, including IPv6.
- Ordinary assets, API reads, WebSocket admission and upload chunks must not
  consume a single small navigation quota. Health checking must not depend on
  a visitor having remaining navigation budget; keep any health-specific guard
  independent rather than making the handler an unlimited expensive endpoint.
- After authentication, scope ordinary reads and actions by actor and operation
  family. A busy authenticated account must not exhaust another account's
  ordinary budget merely because their public address is shared.
- Emergency address-wide/resource guards may still reject genuine floods.
  Their scope and thresholds must be explicit, not disguised as per-user limits.

### 2. Use one action policy through every transport

- Channel and DM message creation must share the chosen actor-scoped creation
  policy across REST and WebSocket. Opening another tab, changing channel,
  alternating transports or using another credential of the same account must
  not multiply the action allowance.
- Permit natural short bursts with gradual capacity recovery. Preserve the
  existing message validation, permissions, reply rules, attachments, mass
  mentions and federation attribution; do not build another send pipeline.
- Apply the same principle to reactions and other dual-transport actions that
  currently have incompatible counting. Idempotent no-ops must not bypass the
  coarse anti-flood guard, but should not unnecessarily burn committed-action
  capacity.
- Keep restrictive safeguards for credential verification, registration,
  expensive lookups, uploads, image decoding and disruptive operations. For
  login, distinguish credential failure control from broad request admission;
  legitimate successful sign-ins should not be treated as failed guesses.
  Never create an easy account-wide lockout from unverified attacker input.

### 3. Protect important real-time controls

- Typing, activity/presence updates and read acknowledgments must not exhaust
  the same small budget needed to leave voice, update mute/deafen, or end/reject
  a call. Give important controls a separate bounded allowance.
- Do not make control events unlimited or bypass permission checks. Sustained
  abuse must still be bounded without replaying stale call commands later.
- Refused actionable events carry the existing `rate_limited` code and a
  validated remaining wait, with the existing call correlation when applicable.
  A refused user action cannot disappear into an uncoded console-only message.
- Preserve ping/heartbeat operation and the existing socket ownership rules.

### 4. Make temporary refusal recoverable

- Standardize HTTP 429 on the existing error contract, with numeric
  `retryAfter` seconds and `Retry-After` where the protocol permits it. Compute
  the actual remaining wait for hand-written budgets as well as plugin limits.
- Expose the relevant response headers to federated clients. Parse only finite,
  bounded retry metadata; support valid HTTP header forms and old peers without
  trusting arbitrary response fields as timers or catalog keys.
- Use bounded, cancellable recovery for safe reads. Deduplicate retries for the
  same target and avoid retry storms. A cooldown on one origin/action family
  must not pause another origin or unrelated actions. Do not infer a global
  cooldown from legacy peers that provide no scope information.
- Preserve the last usable data, composer drafts, reply targets and attachment
  references during temporary refusal. Do not label a rate-limited upload as a
  permanent validation failure or discard its resumable state.
- Do not blindly replay mutations. User actions with uncertain delivery need
  reconciliation or an explicit retry, not speculative duplicate sends. A
  deferred message refused before processing remains recoverable without
  automatically submitting a previously failed action behind the user's back.
- Cancel stale recovery on logout, account/origin changes, teardown and target
  replacement. Timers and in-flight results cannot restore another session's
  private state. No new persistent client queue is introduced.

### 5. Respect federation backpressure and identity

- An HTTP 429 from relay delivery is a temporary per-peer cooldown, not a network
  or authentication failure. Honor bounded retry metadata, preserve outbox rows
  and ordering, and avoid spending the network-failure threshold on throttling.
- Retain bounded fallback waiting for peers without retry metadata; do not retry
  a throttled peer on every worker tick or block unrelated peers.
- Only verified peer requests may consume the authenticated peer's allowance.
  Keep a separate early untrusted-request defense before costly verification;
  preserve signature validation, rotation grace, nonce checks and body limits.
- Preserve old peer compatibility and existing REST/WS error codes. Any additive
  cooldown/scope fields need documented optional wire semantics, with a safe
  legacy fallback and no arbitrary server-selected client state keys.

## Reuse and design note

The installed plugin remains the coarse HTTP admission mechanism. The existing
WebSocket token bucket, `fixedWindowLimit` atomic multi-key result, authentication
hooks, Juno recovery, soundboard wait metadata, chat-load deduplication and
outbox retry fields are the starting points. The concrete gap is that current
plugin-private counters cannot coordinate REST/WS action admission and run
before account authentication. Extract or adapt only the shared actor/action
mechanism needed to close that gap; do not duplicate business handlers.

Initial constants and a complete route/event policy inventory belong in the
implementation plan before coding. They must satisfy the workloads below and
remain bounded under abuse. Production logs omit account/address identifiers,
so they cannot justify a measured per-user percentile or a promise that a
particular numerical default is universally optimal.

## Project structure and style

- Server: `packages/server/src/index.ts`, `utils/`, `routes/`, `ws/`; colocated
  unit/route tests, plus existing `packages/server/test/` integration harnesses.
- Shared contracts: `packages/shared/src/types.ts`, errors and diagnostics only
  where an existing contract actually needs an additive field.
- Web: `packages/web/src/api/client.ts`, affected stores, upload recovery and
  WebSocket event handling; tests beside the affected modules.
- Update `docs/systems/api.md`, `auth.md`, `websocket.md`, `dm-system.md`,
  `bots.md`, `federation.md`, `uploads.md` and other touched subsystem specs to
  describe the actual final policy. Preserve existing localization conventions.
- Match existing typed helpers and atomic admission style, for example:

```ts
const retryAfter = plays.consumeAll([`user:${request.userId}`, `room:${channelId}`]);
if (retryAfter > 0) {
  const seconds = Math.ceil(retryAfter / 1000);
  reply.header('Retry-After', seconds);
  return reply.code(429).send({ ...errorBody(429, 'rate_limited'), retryAfter: seconds });
}
```

## Success criteria and testing

- Simulated normal-load acceptance: 20 verified accounts share one address;
  each opens one session, fetches 60 distinct static resources and performs
  20 ordinary reads over 10 seconds. No normal-operation quota returns 429.
  This is a deterministic correctness workload, not a load test on production.
- A single account can send a short burst of 10 ordinary messages over two
  seconds; separate accounts on the same address do not spend that allowance.
  The plan must also bound sustained send rate and total process resources.
- Tests exhaust configured budgets and prove exact refusal/refill boundaries,
  bounded memory cleanup, multi-tab/credential sharing and REST/WS consistency.
- Forged/missing credentials cannot spend another authenticated actor's action
  quota. Invalid HMAC requests cannot spend a legitimate peer's quota. Coarse
  anonymous protection still rejects floods and keeps IPv6 rotation bounded at
  the documented address scope.
- Saturated ephemeral WS traffic does not block an ordinary leave/end/mute
  control; a flood of controls still reaches a separate enforced limit.
- Real Fastify/plugin tests exercise registration order and overrides with rate
  limits enabled, not only mocked helpers or bypassed integration harnesses.
- Fake-timer client tests cover valid/malformed/missing retry metadata,
  cross-origin headers, bounded retry, unchanged drafts/uploads, no mutation
  replay and no stale session recovery. Existing localization checks remain
  green. Test UI recovery in a disposable local instance, not production data.
- Federation tests cover 429 with/without metadata, no failure-count escalation,
  queue preservation/order, peer isolation and mixed-version fallback.

## Commands and boundaries

```bash
pnpm --filter @veyvox/server test -- rateLimit
pnpm --filter @veyvox/server test -- federationWorker
pnpm --filter @veyvox/web test -- client
pnpm --filter @veyvox/web test -- pendingMessage
pnpm --filter @veyvox/server typecheck:e2e
pnpm typecheck
pnpm lint
pnpm build
```

Run the full affected suites, both dev servers with isolated temporary data,
and a browser recovery exercise as well as these focused commands. Root build
order stays shared → server → web. No hand-edited lint suppressions or migrations.
Do not deploy, disable production limits, collect user identifiers in diagnostics
or claim historical errors have been fully attributed from anonymized logs.
