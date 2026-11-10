# Rate-limit resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce fair bounded anti-abuse policies without shared-IP navigation lockouts, silent voice-control loss or unsafe retries.

**Architecture:** Keep the installed Fastify plugin for HTTP request admission, running ordinary quotas after existing authentication. Add a separate early address guard and extract the existing WS token-bucket algorithm into a bounded shared action limiter. Reuse current handlers, upload ownership, client deduplication and federation outbox instead of building parallel delivery flows.

**Tech Stack:** TypeScript strict, Fastify 5, existing @fastify/rate-limit, React 19, Zustand, Vitest; Node 24 and pnpm 10.

**Spec:** `docs/superpowers/specs/2026-11-10-rate-limit-resilience.md`

## Global Constraints

**Execution:** Tasks1–7 implemented and locally validated; see
[validation and rulings](2026-11-10-operational-resilience-validation.md).
The step lists below preserve the original execution recipe, not a second queue
of pending implementation work. External final review passed after the two
integration findings recorded in the validation report were corrected.

- No new dependency, Redis or database migration; per-process enforcement only.
- Keys are verified hosting-instance account rows, or trusted normalized client addresses before authentication; never supplied tokens/claimed identities.
- Preserve authentication, authorization, reply/attachment ownership, HMAC rotation/nonce rules, origin routing and active calls.
- No production deployment/restart, credential change, real-data cleanup, identifier collection or blind mutation replay.
- Build order remains shared → server → web. Reuse localization/error contracts; do not hand-edit suppressions.
- Work on an isolated feature worktree; retain the approved documents and all user work. Leave changes uncommitted unless the user asks for commits.

## Review Focus

- Hook order with plugin-level DM auth and route-level arrays: a rejected credential must not charge an actor; test real registration order in Task 2.
- Same account alternating tabs/transports/rooms: one creation allowance, independent NAT neighbors; test route/event interoperability in Task 3.
- Duplicate reaction after quota exhaustion: unchanged action succeeds without a new broadcast/relay; test Task 3.
- Old client/peer data with malformed wait metadata: no unbounded timer, global pause, stale-session apply or repeated mutation; test Tasks 5–6.
- Throttled peer with newly queued entities: exclude that peer before the outbox selection limit so unrelated peers do not starve; test Task 5.

## File map

- New server `utils/tokenBucketLimit.ts`: bounded reusable extraction of WS bucket arithmetic.
- New server `utils/rateLimits.ts`: shared action policies, HTTP/WS refusal helpers and test reset; no business validation.
- New server `utils/httpRateLimit.ts`: Fastify registration and early trusted-address admission.
- Modify existing `index.ts`, affected route configs, `utils/auth.ts` only if needed for hook integration, `ws/handler.ts`, `ws/events.ts` and `utils/dmMessageRateLimit.ts` compatibility exports.
- Modify existing `utils/fixedWindowLimit.ts`, `routes/files.ts`, `stickers.ts`, `gameIcons.ts`, `soundboard.ts`, `juno.ts`, `ws/channelPoke.ts` and federation rate helpers for accurate remaining waits.
- New shared `retryAfter.ts`: bounded numeric/date retry parsing, exported through the existing shared package pattern; parser tests live in the server's existing Vitest suite (shared has no test runner).
- Modify `routes/federation/handlers/s2sAuth.ts`, `routes/federation/rateLimits.ts`, affected handlers and `utils/federationWorker.ts` with existing delivery tests.
- New web `api/readRecovery.ts` and tests; modify `api/client.ts`, its tests, auth/instance lifecycle, `stores/transferStore.ts` and pending-message/UI retry handling only where necessary.
- Update affected subsystem docs and existing regression tests; add focused tests beside each new seam.

## Policy inventory and starting values

These are explicit engineering defaults, not claimed production percentiles.
All windows below are 60 seconds unless stated otherwise. Test bypass remains
explicit through `DISABLE_RATE_LIMITS=1|true`; production remains enforced.

| Boundary/family | Budget | Key and placement |
|---|---|---|
| Emergency API admission | 5,000/min | normalized address; onRequest, independent of actor quota |
| Static/public media admission | 12,000/min | normalized address; independent asset family |
| Upload transport admission | 6,000/min | normalized address; independent `/api/files` family |
| WS handshake admission | 300/min | normalized address; independent `/ws` family |
| Health admission | 120/min | normalized address; independent health family |
| Ordinary authenticated HTTP reads | 1,200/min | verified account, preHandler after authenticate |
| Ordinary authenticated HTTP mutations | 600/min | verified account, separate from reads |
| Anonymous API fallback | 600/min | normalized address, separate from assets/health/WS |
| Message creates, channel + DM, REST + WS | burst 12, refill 2/s | one actor-scoped bucket, admitted immediately before persistence |
| Reaction mutations, add + remove, REST + WS | burst 20, refill 5/s | one actor-scoped bucket; skip no-ops after authorization |
| WS ephemeral events | burst 60, refill 10/s | per account across sockets; typing/activity/read acknowledgments |
| WS controls/other authenticated events | burst 60, refill 10/s | separate per-account family; voice/calls/moderation/edits and unknown events |
| Login request admission | 120/2 min | normalized address, guards processing of every attempt |
| Login credential attempts | burst 10, refill 1/12s | address + normalized username, reserve before password work, refund only confirmed success |

Token buckets cap at 10,000 keys, evict fully replenished idle keys, never evict
an active exhausted key to grant fresh capacity, reject overflow until capacity
can be reclaimed, and clamp negative elapsed time. Failed admissions do not
extend cooldown. A successful login refund is generation-safe and cannot create
extra capacity through a stale reservation. No account-wide anonymous lockout.

### Existing route-specific HTTP overrides

After moving ordinary plugin enforcement to post-auth preHandler, remove raw-IP
key overrides from protected routes. Preserve each existing route's counts and
window unless named below. Overrides remain local route budgets, not a second
copy of action admission; the early address guard always remains in force.

- `auth.ts`: register 10/2min, username/invite check 30/min stay public normalized
  IP; login becomes the two policies above; attach-proof stays 5/15min/account.
- `users.ts`: password change 5/15min/account, deletion 3/15min/account, federation
  identity deletion 5/15min/account. Add verify-password 10/2min/account rather
  than letting password hashing use the generous ordinary-read/write budget.
- `bots.ts`: preserve 5/15min create/reset, 60/min search, 20/15min update,
  30/15min membership/token-operation routes, now per verified account.
- `botCommands.ts`: 10/5min per verified bot account.
- `messages.ts`, DM create and `interactions.ts` response creation: remove the
  old 5/5s transport quota; actual message handler spends the shared create
  allowance once. Interaction invocation keeps a dedicated per-account 30/5s
  route budget; bot response uses the ordinary write budget and the existing
  five-response ceiling plus the actual message action admission. Do not charge
  twice on an internal interaction response.
- `reactions.ts`: remove old 10/5s transport quota; shared mutation functions
  enforce the action quota after authorization/idempotence checks.
- `dm.ts` space invite 30/min, `gif.ts` 30/min, `joinRequests.ts` 5/min,
  `social.ts` discover/search 30/min, `juno.ts` read 600/min: retain per-account
  route-specific counts/windows.
- `diagnostics.ts`: retain 12/min/address and 256KiB process accepted-input
  budget. Public CSP reporting uses an explicit 200/min/address route budget.
- Federation attach route retains 5/15min/account. First-contact/ensure/lookup/
  relay handwritten budgets retain their counts and windows; verified peer
  budgets are charged after HMAC and nonce validation, not on a claimed origin.
- Files retain 30 creates/min/account and 1,000 PATCH/min/account; stickers 30,
  game icons 10, soundboard upload 10, Juno creation 5/actions 60, poke 5/min.
  Soundboard playback retains atomic account+room 1/2s. All manual refusals
  return remaining wait; these quotas do not share ordinary asset/read capacity.

### Task 1: Shared bounded admission primitives

**Files:** new server `utils/tokenBucketLimit.ts`, `utils/rateLimits.ts` and tests;
new shared `retryAfter.ts`, server `utils/retryAfter.test.ts`; shared exports.

**Interfaces:** `createTokenBucketLimit({capacity, refillPerSecond, maxKeys?})`
returns `{consume(key, now?): number, reserve(key, now?): Reservation, reset(): void}`;
consume returns remaining milliseconds (0 admits). `Reservation` has
`retryAfterMs:number` and a one-shot `refund():void` bound to the admitted
entry's identity; it does not refund a replaced/reset generation.
`consumeMessageCreate(userId)`
and `consumeReaction(userId)` return milliseconds. `sendRateLimit(reply, ms,
scope?)` uses the existing error shape. `parseRetryAfterSeconds(body, header,
now?, fallback?)` returns an integer in 1..3600; invalid input uses fallback
(default60), numeric body precedes header seconds/HTTP-date. Closed optional
`rateLimitScope` values: `http`, `action`, `resource`, `transport`.

- [ ] Write tests for burst12/refill2, refusal at499ms/admission500ms, independent keys, clock rollback, no extension, idle eviction and overflow rejection; parser rejects strings/NaN/Infinity/negative/objects, handles dates, caps3600.
- [ ] Run `pnpm --filter @veyvox/server test -- tokenBucketLimit retryAfter`; expect missing modules/exports failures.
- [ ] Implement extraction and helpers with no timers that keep the process alive; reuse typed errors and seconds conversion.
- [ ] Rerun focused commands; require green exact boundary assertions before proceeding.

### Task 2: Fair HTTP and credential admission

**Files:** server `utils/httpRateLimit.ts`, `index.ts`, named route configs above,
`routes/auth.ts`, `users.ts`; new `httpRateLimit.test.ts` and affected auth tests.

**Interfaces:** `registerHttpRateLimits(app): Promise<void>` owns plugin and
early guard; downstream routes keep ordinary `config.rateLimit` syntax. Request
keying reads only verified `request.userId` after existing auth. Expose
`Retry-After` and limit headers through current CORS configuration.

- [ ] Add real Fastify tests: 20 accounts/one IP, 60 resources+20reads each pass; forged credentials cannot spend another actor; API exhaustion leaves asset/health/WS/upload families independent; route auth function/arrays and plugin-level auth all precede actor charging.
- [ ] Add login tests: 20 successful sign-ins do not exhaust failure quota; 11 rapid failures at one username/IP refuse before bcrypt; another username or IP is independent; concurrent success cannot over-refund. Assert verification endpoint remains bounded.
- [ ] Run focused route tests and observe RED against old 200/min/IP behavior.
- [ ] Register early guard and post-auth plugin, normalize keys, migrate route overrides, implement reserved/refunded login admission without changing federation self-heal/epoch gates. Add explicit CSP quota.
- [ ] Run `pnpm --filter @veyvox/server test -- httpRateLimit auth users`; require GREEN. Read installed plugin documentation/source if order differs from assumptions; record a ruling rather than trusting hook names.

### Task 3: Shared message/reaction actions and independent WS controls

**Files:** server `routes/messages.ts`, `dm.ts`, `reactions.ts`, `interactions.ts`,
`ws/events.ts`, `ws/handler.ts`, `utils/dmMessageRateLimit.ts`, shared WS error
variant; existing/new action, reaction, DM and WS tests.

**Interfaces:** consume helpers from Task1; optional bounded `retryAfter` on
the existing WS `error` event. Do not add a new action/delivery protocol.

- [ ] Add integration assertions that 10 messages/2s pass, REST+WS channel+DM share actor quota, NAT neighbor remains admitted, another token/tab cannot reset allowance, rejected message stores/broadcasts/relays nothing.
- [ ] Pin reaction duplicate/add/remove semantics after quota exhaustion. Pin ephemeral saturation leaves end/leave/mute admission available, while 61 immediate controls refuse with coded wait/call correlation. Ping stays independent.
- [ ] Run action/WS suites for RED; replace obsolete tests that explicitly require the buggy address sharing with new identity assertions.
- [ ] Move shared create admission immediately before existing persistence; reaction admission only for a real authorized mutation. Replace generic WS bucket with separate bounded families and coded refusals; preserve disconnect ownership and all business checks.
- [ ] Run `pnpm --filter @veyvox/server test -- events reactions messages channelPoke`; require GREEN and full affected route/event behavior.

### Task 4: Accurate manual cooldowns and resumable uploads

**Files:** `fixedWindowLimit.ts`, manual server routes/events named in inventory,
web `stores/transferStore.ts`, related tests and existing tus handler integration.

**Interfaces:** reuse `consumeAll([key])` millisecond result and Task1 refusal
helper. Tus errors carry a JSON body with retryAfter and use `onResponseError`
to set Retry-After through the NodeRequest's available runtime Node response;
the installed hook cannot return arbitrary response headers. Preserve a body
fallback when no Node response is exposed. Do not use Fastify JSON after
`reply.hijack()` or replace tus/its ownership hooks.

- [ ] Add fake-time tests that a refusal near the end of a60s window reports1s rather than60; soundboard multi-key consumption stays atomic. Test all handwritten refusal families and bypass semantics.
- [ ] Add upload tests where429 retains resumable URL/file/attachments, is not permanent, and does not retry outside bounded tus behavior;401/403/validation failures remain permanent.
- [ ] Run focused suites for RED, inspect installed tus types/source for header support, implement exact remaining waits and classified upload failure using response status rather than free-text matching where available.
- [ ] Run server/manual upload suites plus `pnpm --filter @veyvox/web test -- transferStore pendingMessage`; require GREEN with no automatic message resubmission.

### Task 5: Authenticated federation quotas and peer backpressure

**Files:** federation `rateLimits.ts`, `handlers/s2sAuth.ts`, affected handlers;
`utils/federationWorker.ts` and its delivery/queue tests; s2s auth tests.

**Interfaces:** add delivery outcome `{kind:'rate_limited',retryAfterMs:number}`;
honor Retry-After seconds/date with30s fallback and1h cap. A bounded in-memory
peer cooldown excludes peers before the outbox batch limit; existing queued
rows receive `nextRetryAt=max(existing,deadline)` without attempts/failure
increments. Clear cooldowns on expiry/worker shutdown; no schema changes.

- [ ] Add tests: 60 invalid signatures do not exhaust a legitimate lookup peer; replay/nonce/rotation rules still refuse as before, with no allowance spent by unverified requests.
- [ ] Add delivery tests for429 (JSON/header absent/date/malformed), preserved queued rows/attempts/order, no unreachable transition, new entities held during cooldown and another peer delivered despite the throttled peer having50 due rows.
- [ ] Run `pnpm --filter @veyvox/server test -- s2sAuth federationWorker` for RED.
- [ ] Move verified-peer quota after HMAC/nonce checks while keeping early address guard. Make manual peer waits explicit. Handle relay429 separately, before network/auth-failure accounting, using existing retry fields and queue selection.
- [ ] Rerun focused suites and federation e2e; require GREEN including old peers and auth refusal behavior.

### Task 6: Scoped bounded safe-read recovery

**Files:** new web `api/readRecovery.ts` and tests; `api/client.ts` and tests;
`stores/authStore.ts`, `instanceStore.ts` and affected lifecycle tests; shared
parser from Task1. Reuse existing chat dedup and pending-message state.

**Interfaces:** `createReadRecovery(getSession, retrySeconds)` produces
`run<T>(key, read(signal): Promise<T>): Promise<T>` and `cancel():void`.
Client exposes `cancelPendingReads():void`. One automatic GET recovery only for
recognized current-server cooldown scope, max60s wait +0..250ms jitter; legacy
429 without scope still throws `RateLimitError`. Deduplicate identical reads,
not mutations. Cancel on account logout, remote disconnect/removal or API
replacement, and reject results from superseded sessions.

- [ ] Add fake-time tests: one scoped429 followed by success; no second auto retry, no POST replay, no global origin/family pause, identical GET sharing without Response-body reuse, malformed metadata bounds, explicit cancellation and account change during wait/fetch, no stale401 logout.
- [ ] Run focused client/recovery tests for RED. Implement recovery as a small request lifecycle seam, preserve default60 legacy error behavior and diagnostics code retention, and wire cancel before disposing/replacing clients.
- [ ] Preserve stale usable data on429 in stores touched by recovery; preserve explicit pending-message retry/drafts/reply/attachment state. Do not create persistent retry state or replay a rejected mutation automatically.
- [ ] Run `pnpm --filter @veyvox/web test -- client readRecovery instanceStore authStore chatStore pendingMessage transferStore junoStore soundboardStore`; require GREEN.

### Task 7: Documentation and whole-change validation

**Files:** affected `docs/systems/{api,auth,websocket,dm-system,bots,federation,uploads,localization,diagnostics,deployment,client-federation,juno,soundboard}.md`
only where policy changes; associated config/proxy comments and approved specs.

- [ ] Replace stale per-IP/200/min/5-per5s statements with the actual inventory, remaining-wait behavior and legacy compatibility. Document process-local limits and no deployment.
- [ ] Run all affected suites, `pnpm typecheck`, server `typecheck:e2e`, `pnpm lint` (prune only actually fixed old suppressions), and sequential `pnpm build`; record exact results.
- [ ] Start both dev servers against disposable temp data, exercise recovery/voice-control scenarios in a browser and retain a screenshot outside runtime/user data. Never run a load profile on the VM.
- [ ] Review complete staged/unstaged/new files with the selected external Sol reviewer after all three module plans and primary validations finish; fix concrete findings and rerun affected validation.

## Self-review and handoff

All five Review Focus conditions map to explicit tests. Shared units are
milliseconds internally and integer seconds on the wire; peer/read deadlines
are bounded independently. Existing wire codes remain stable and additive
scope is a closed vocabulary. Approval of this plan permits inline execution
of all tasks; there is no commit/push/release/production step.
