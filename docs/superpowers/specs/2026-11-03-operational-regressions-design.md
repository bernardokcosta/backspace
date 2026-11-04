# Operational regressions: evidence and design

## Intent and authorization

Investigate every diagnostic group observed on the production VM on 2026-11-03,
fix reproducible causes, and add regression tests rather than suppressing errors.
The operator identified soundboard 403s as a real user complaint and explicitly
requested proceeding without further questions. Implementation is local; a release,
production configuration change or restart is not authorized by this plan.

## Capability map and order

| Module id | Responsibility | Depends on |
| --- | --- | --- |
| diagnostic-context | Preserve closed error codes and safe source locations | — |
| voice-resume | Restore the voice-owning socket after a signaling reconnect | — |
| soundboard-playback | Consistent authorization and bounded playback cooldown | voice-resume |
| pins-lifecycle | Fetch pins only for known text channels; reject stale replies | — |

Order: diagnostic-context → voice-resume → soundboard-playback → pins-lifecycle.
These are independently testable fixes using existing seams, not new subsystems.

## Evidence and acceptance criteria

Initial production window: 2026-11-02 00:33 through 2026-11-03 19:17 UTC,
Backspace 1.16.0 / 9fd1dec. 6,125 JSONL records, 140 from clients. Application
server had no logged exceptions/5xx and no container restarts. This does not
exonerate failures returned through REST or WS.

### diagnostic-context

- 111 repeated console errors map to the client's WS `error` handler. Their
  historical messages/codes were not retained; do not invent their causes.
- REST failures currently retain status/route but discard the wire error code.
  Preserve only existing `ErrorCode` values after parsing the response once,
  including rate-limit failures. Do not record bodies, error details or text.
- Record WS error codes explicitly with subsystem `websocket`, including an
  explicit uncoded event for older servers. Keep existing console behavior.
- Four runtime events have no stack: preserve a verified script basename and
  bounded line/column from `ErrorEvent` when an Error object is absent. No URLs,
  query strings, usernames, identifiers, messages or arbitrary new properties.
- Ten console errors map to LiveKit publisher data-channel closure; five warnings
  are `InvalidStateError`. They remain open until reproduced or independently
  identified. Network loss and the 296 LiveKit RTP/data-channel warnings are not
  declared fixed by making the client quieter.

### voice-resume

`removeConnection` clears the voice socket and starts grace. On the next initial
`ready`, a client with a live/reconnecting local voice session must send
`voice_join` and voice status even if the server snapshot still lists it. A
permission-refresh `ready` on the same socket does not claim another session.
Do not rejoin a disconnected retained Retry intent, a different origin or a
session with no local live voice intent. Preserve moderation and displaced tabs.

Also validate connecting/signal-reconnecting/disconnected state transitions:
disconnected must not temporarily be advertised as connecting; stale room events
must not overwrite the current room. Reconnect tests cover space and DM origins.

### soundboard-playback

Keep membership, VIEW_CHANNEL, CONNECT, SPEAK, moderator mute/deafen and actual
voice-session checks. Self microphone mute continues to allow playback.
Restore playback after WS resume without requiring leaving/rejoining LiveKit.
Do not let closed voice sockets produce a false successful playback.

Refusals must have actionable closed codes instead of combining all conditions
into `forbidden`; use existing codes where accurate. New soundboard-specific
codes, if required, are translated in all five catalogs.

One play per user and per room per 2 seconds remains an abuse boundary. A room
refusal must not consume an otherwise eligible user's cooldown. Return the real
Retry-After rather than making the client assume 60 seconds. Button and shortcut
playback share the same in-flight/cooldown path; reject stale session/permission
state and do not automatically replay a possibly already-committed sound.

### pins-lifecycle

Five server GETs for pins returned 404, three reported by the web client. The
existing voice guard works only after channel metadata has arrived. Unknown,
deleted and voice channels must not request text-only pins. When index metadata
arrives, the open text channel still loads its pins. Replies for removed channels
or changed sessions/origins must not restore stale boards. Latest request wins.

## Approach and alternatives

Selected by the implementer under the operator's proceed-directly instruction:
targeted fixes and tests at existing HTTP, WS, store and SDK lifecycle seams.
An unconditional soundboard allow/automatic REST retry would bypass authorization
or duplicate audio; reject it. A network/voice rewrite or dependency upgrade is
not justified by sanitized historical evidence; reject it. Better diagnostics
are necessary but are not a substitute for a demonstrated functional fix.

## Constraints and verification

TypeScript strict; no new dependencies, migrations, persistent client logs,
identifying diagnostics, hardcoded home origin, permission bypass or production
changes. Reuse existing stores, error contracts and services. Vitest tests live
beside affected source. Update subsystem contracts with behavior changes.

Commands (pnpm 10, Node >=22.12): affected server/web Vitest suites, `pnpm build`
(shared → server → web), `pnpm lint`, `pnpm check:i18n`, full server/web tests,
`pnpm --filter @backspace/server typecheck:e2e`, and local dev server smoke checks.
UI behavior must be exercised in the browser. External final review is required.

## Definition of done and remaining evidence

Every diagnostic group receives a disposition backed by a reproduced regression,
specific evidence, or an explicit unresolved limitation. Tests must fail before
the corresponding fix and pass afterward. A passing suite is not a guarantee of
zero future network failures. Historical uncoded WS/runtime/SDK failures cannot
be retrospectively recovered; do not mark them all solved without new evidence.

## Evidence disposition after implementation

| Observed group | Demonstrated result | Still unproven |
| --- | --- | --- |
| Soundboard: two 403s | Reproduced missing voice-socket resume while the server still lists the user; client regression fails before the fix. Local browser + real WS/REST confirmed one rejoin and successful playback after reconnect. Closed sockets now refuse explicitly; self mute remains allowed. | The historical 403s did not retain their specific gate, so their exact cause is not recoverable. Production remains on the old version. |
| Soundboard: one 429 | Reproduced phantom personal cooldown after a room refusal; atomic budgets fix it and return real Retry-After. Button/shortcut requests share a tested lock/cooldown. | Cannot prove whether the historical request crossed the intended room budget or hit this bug. |
| Seven WS 1006 closures/retries | Server-known space voice resumes on a replacement socket, on home and remote origins; same-socket refresh and disconnected intent do not reclaim it. | Network interruption itself is not eliminated or historically attributed. |
| 111 WS application error occurrences | Reports now distinguish WS refusal from transport closure and retain recognized codes when the server supplies them. | Exact historical errors were discarded by the previous collector. Older uncoded server refusals remain uncoded; no arbitrary text is logged to guess a cause. |
| Ten LiveKit data-channel errors | Connection-state regressions now cover signal-only reconnect and prevent disconnected → connecting flicker. No SDK logs were silenced. | Unexpected publisher data-channel closure was not reproduced; these changes are not asserted to repair it. |
| Four opaque runtime errors | Script-location fallback has unit coverage and was persisted end-to-end as `smoke.js:12:34`, without host/query/message canaries. | Historical events without an Error or filename cannot be attributed. |
| Five InvalidStateError warnings and one closed-PC warning | Existing recovery/capture suites and all web tests passed. | Insufficient SDK context to identify their causes; remain open. |
| Five pin GET 404s (three client reports) | Reproduced unknown-channel requests, metadata-arrival omission, stale/session/deletion/origin reply races. Guards, retry-on-known-text metadata and pin cleanup now pass their regressions. | Historical anonymized channel identities cannot prove which invalid channel produced each response. |
| 296 LiveKit server warnings | Reviewed groups: 235 old packets, 41 sequence-gap warnings, 12 bucket failures, six data-channel read warnings and two startup external-IP validation warnings. No production mutation or warning suppression. | Packet/transport causes require fresh network/media evidence; not claimed fixed by application tests. |
| Local smoke ResizeObserver loop | Vite reported `ResizeObserver loop completed with undelivered notifications.` during the local UI smoke; this is a real additional observation, not the later synthetic PRIVATE_CANARY ErrorEvent. | The responsible observer was not identified. Vite's capturing stack does not identify the source; no causal link to the four historical runtime events or these changes is asserted. Remains open. |

The local browser smoke uses real application components, API and WebSockets
against a fresh temporary database. Media connection state was simulated: this
is not an end-to-end installed-desktop/WebRTC call acceptance test. Browser DOM
interaction verified HTTP 200 playback, disabled cooldown and later re-enable.
The browser click/screenshot capture backend was unavailable (`UnknownVizError` /
visible-tab requirement); DOM interaction and accessibility inspection succeeded.
No screenshot or production acceptance is claimed.
