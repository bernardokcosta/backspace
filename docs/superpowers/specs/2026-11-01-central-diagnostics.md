# Backspace Fork 1.15.9: central diagnostics

Approved direction: remove desktop compatibility enforcement, keep diagnostics
on the serving instance only (never in client files/storage), retain at most
5,000,000,000 bytes of application logs, and publish version 1.15.9 after tests
and external review. No upstream telemetry or third-party collector is restored.

## Capability map and order

| Module | Responsibility | Depends on |
| --- | --- | --- |
| diagnostic-contract | Bounded, privacy-safe event normalization | — |
| diagnostic-storage | Single-process rotated JSONL storage and safe server logging | diagnostic-contract |
| diagnostic-ingest | Rate/body/global-budget-limited public event sink and admin status | diagnostic-storage |
| diagnostic-capture | Memory-only renderer queue, errors/API/WS/voice/desktop snapshots | diagnostic-contract, diagnostic-ingest |
| release-1-15-9 | Version consistency, notes, validation, review, commit/tag/push | all above |

## Contract and privacy

- Events contain closed event/subsystem values, time, version, severity, numeric
  status/reason/attempt/duration/count, known error names/codes and stack frame
  basenames/line numbers. Dynamic route segments are replaced with `:id`.
- Never send/store message bodies, media, credentials, authorization headers,
  arbitrary exception messages, full URLs, queries, hashes, user identifiers,
  process lists, local paths or arbitrary console objects. Unknown fields drop.
- Client events are untrusted and marked as such; the public sink never confers
  authentication. Existing auth, permissions and federation routing stay intact.
- Public POST `/api/diagnostics`: at most 10 events and 16 KiB per request,
  12 requests/minute/IP plus a process-wide 256 KiB/minute accepted-byte budget.
  Invalid/oversized requests use existing validation errors. No read endpoint is
  public. Admin GET `/api/admin/diagnostics` reports bounded storage statistics.

## Storage and capture

- Default server directory is `diagnostics/` beside the configured database.
  Only files owned by this log store rotate; symlinks are refused. Single writer
  per directory. Files are private (0600, directory 0700 where supported).
- Central JSONL budget: 4,500,000,000 bytes, oldest segments removed before append.
  Segments are at most 25,000,000 bytes; records at most 16 KiB. Startup enforces
  the same bound. Full/unwritable storage drops diagnostics without stopping chat.
- Compose's backspace, LiveKit and Caddy stdout/stderr each rotate at 50,000,000
  bytes × 3 files: combined application logs stay below 5 GB with safety margin.
  This does not claim a limit on unrelated OS/services/old external log copies.
- Capture runtime errors, rejected promises, console warnings/errors (only safe
  metadata), failed API/network requests, WebSocket closure/reconnect, LiveKit
  connection state/reasons, and existing desktop recovery/updater/keybind signals.
  Reuse the current bridge; add no privileged IPC or local logging dependency.
- Browser/desktop queue exists only in memory: maximum 100 events, 5-minute TTL,
  deduplication, small batches, bounded timeout/backoff. Never use localStorage,
  IndexedDB, files, beacon credentials or third-party URLs. Offline/exit/crash can
  lose events; diagnostics must never block boot, auth or a call. Older servers
  returning 404 disable collection for that page lifetime.

## Verification and boundaries

Use existing TypeScript/Vitest, no new dependency or database migration. Test
privacy, malformed/untrusted input, request floods, small-budget rotation,
restart recovery, disk failures, memory-only retries and diagnostic recursion.
Run shared → server → web build, lint, affected tests, e2e and desktop typechecks,
version consistency and browser smoke before external review and publication.
Fix the confirmed voice-channel pin-load 404 without weakening the pins API.
Historical LiveKit DTLS disconnects alone do not justify speculative network fixes.
Preserve production data, rollback images and user work; no force-push or tag move.
