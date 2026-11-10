# Capability map: operational resilience

## Status and approved scope

On 2026-11-10 the user approved three correction areas for local implementation
and testing. Production publication is a separate decision. This map records that
scope; the user approved the linked specifications on 2026-11-10. No application
or production configuration changes are made by these documents.

| Module id | Responsibility | Depends on | Specification |
|---|---|---|---|
| `rate-limit-resilience` | Isolate anti-abuse budgets by verified actor/action, preserve voice controls, and recover safely from temporary refusals | Existing authentication, origin routing, message rules and outbox | [Rate limiting](2026-11-10-rate-limit-resilience.md) |
| `sw-update-lifecycle` | Own and dispose the periodic frontend update check; handle stale registrations without unhandled rejections | Existing service-worker registration and voice-session update locks | [Update lifecycle](2026-11-10-sw-update-lifecycle.md) |
| `media-probe-recovery` | Recover media-tool availability after a transient startup probe failure | Existing `checkFfmpeg` and media processing callers | [Media probes](2026-11-10-media-probe-recovery.md) |

Build order: `rate-limit-resilience` → `sw-update-lifecycle` →
`media-probe-recovery`. There are no new dependencies between these modules;
the order prioritizes the user's reported problem. Each is independently
testable and may be delivered separately after its specification is approved.

## Read-only production evidence

Inspection on 2026-11-10 covered the application diagnostics retained from
2026-11-02 through the inspection, current container state, selected proxy
directives, LiveKit logs and seven days of error-priority system journal.

- Application image: version `1.17.1`, revision `d7360a5`; healthy at inspection,
  no current OOM flag and no failed systemd units. Memory and disk were not
  exhausted. These snapshots are not proof against historical resource pressure.
- **765 completed HTTP requests returned 429**, including **46 on 1.17.1**.
  Counting completions rather than every status-bearing record avoids counting
  the limiter's exception log and request completion twice. Historical traffic
  may include tests; client reports are untrusted hints, not a second request
  count or a way to identify affected people.
- Refused operations included message history, assets, instance information and
  LiveKit token acquisition. In 1.17.1, history accounted for 15 refusals and
  LiveKit token acquisition for 8.
- The custom tunnel → loopback Nginx → application topology already normalizes
  the visitor address using `CF-Connecting-IP` and overwrites XFF with that
  address. `nginx -t` succeeded. No proxy change is proposed from this evidence.
- Retained application HTTP completion records contained no 5xx. Clients did
  report 502s; this does not identify whether a proxy, deployment interval or
  another origin produced them.
- Clients reported repeating `InvalidStateError` rejections, including 19
  reported occurrences on 1.17.1. These records have no stack identifying their
  source. The unhandled periodic `registration.update()` defect is reproduced
  locally and matches a one-minute pattern; historical attribution remains
  unconfirmed.
- The running version logged the media-tool availability warning five seconds
  after startup. Later `ffprobe -version`, including under the application's
  non-root user, succeeded. Locally, one failed probe permanently suppresses
  subsequent probes in the existing code. The original failure reason was not
  retained, so a startup timeout is plausible, not proven.
- LiveKit warnings concern packet sequencing, channel closure and external-IP
  validation; two error-level entries concern unhandled RTP streams. These are
  not sufficient evidence for a codec, transport or privilege change.
- System journal entries include ephemeral Docker interface races and an
  unavailable kernel-log source. Do not grant extra privileges or disable
  security boundaries to make these logs disappear.

No services were restarted, no configuration was changed, no database was
queried or modified, and no private raw log archive was added to the repository.

## Shared boundaries

- Reuse existing mechanisms before introducing a replacement. No new framework,
  dependency, database schema, telemetry destination or privileged bridge.
- Preserve authentication, authorization, identity attribution, SSRF defenses,
  HMAC verification, replay protection, upload ownership and active calls.
- Do not suppress unexplained failures or claim every historical log is fixed.
- Do not deploy, restart containers, rotate credentials, edit production data or
  change host permissions without a separately approved publication operation.
- After specification approval, write the implementation plan before code.
  Complete applicable build, lint, tests, runtime checks and one external final
  review using the non-trivial/security-sensitive review path before delivery.
