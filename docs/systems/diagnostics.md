# Central operational diagnostics

Added in 1.15.9. This is instance-owned fault diagnosis, not the retired upstream
usage telemetry. No reports go to the project maintainer or a third-party host.

## Sources and privacy

- `packages/shared/src/diagnostics.ts`: closed event/subsystem vocabulary,
  numeric bounds, known error codes/names, API route vocabulary and basename-only
  stack frames. Both sender and receiver normalize; unknown properties drop.
- `packages/web/src/utils/diagnostics.ts`: runtime errors, rejected promises,
  console warnings/errors, API failures, WS closure/reconnect, LiveKit state and
  existing desktop recovery/updater/keybind signals. `diagnosticsBootstrap.ts`
  installs listeners before ordinary application imports. Reporting never gates
  app startup or compatibility and introduces no privileged desktop IPC.
- `packages/server/src/utils/diagnosticLogs.ts`: the existing Fastify/Pino stream
  and server console output become safe structured records. Arbitrary objects,
  free-text messages and exception messages are not retained. Request ids allow
  request/completion correlation without recording user ids or addresses.
  Fatal exceptions/default fatal rejections are written synchronously as safe
  records and terminate with exit code 1; Node's raw exception printer is not
  left active. Stack extraction removes the verified complete message prefix
  (including multiline messages) before examining actual V8 code-frame lines.
  Unknown formats omit frames rather than searching free text for locations.

No diagnostic files, localStorage, IndexedDB or persistent retry queue are created
on client devices. Browser developer-console output is unchanged. The queue holds
at most 100 normalized events in memory, coalesces duplicates and expires after
five minutes. Batches contain at most 10 events, have a five-second timeout and
at most three attempts. Failed reporting is silent and does not report itself.
Offline exit/crash can lose events. A server's 404/410 disables reporting for that
page, preserving independent app/server versions.

POSTs go only to the current serving origin's `/api/diagnostics`, without cookies,
bearer tokens or redirect following. Do not record usernames, message text,
media, authorization, URLs/queries/fragments, peer domains, device names or local
paths. Routes replace non-vocabulary segments with `:id`. Error frames contain
only source/bundle basenames and line/column numbers, not messages or arguments.
Client reports are untrusted operational hints, never authentication or audit
proof. The server records its own receipt time separately from client time.

HTTP failure reports retain the recognized wire `ErrorCode` (including 429),
never the response text/body/details. `ws-error` explicitly records a received
WS refusal under `websocket`, with its recognized code when supplied by the
server; uncoded legacy refusals remain identifiable as uncoded. Existing console
output is unchanged. A runtime `ErrorEvent` without an Error/stack can retain
only a validated script basename and bounded line/column, never its full URL,
query, message or local directory. Historical reports missing these fields
cannot be retrospectively diagnosed from the new instrumentation.

## API and abuse controls

`POST /api/diagnostics` is public, like CSP reporting, so failures before sign-in
can be diagnosed. It accepts `{ events: DiagnosticEvent[] }` (1–10), at most
16,384 request bytes. Its existing Fastify rate limiter allows 12 requests/minute
per client IP. A second, process-wide accepted-input budget is 256 KiB/minute
across all IPs. Client reports cannot claim server-only event types. Success is
204; malformed input 400, excessive body 413, exceeded budget 429. Nothing from
the request body is placed in ordinary request logs.

`GET /api/admin/diagnostics` requires existing `authenticate` and `requireAdmin`
hooks. It returns `{ diagnostics: { bytes, maxBytes, files, dropped,
writeFailures, available } }`, not log content. Operators inspect private JSONL
files over their existing trusted server access. There is no public log reader.

## Server storage and 5 GB budget

The single server process writes to `diagnostics/` beside `DB_PATH`, normally
`/app/data/diagnostics`. The directory is 0700 and newly created files 0600 where
the OS supports those modes. Only regular, store-owned `diagnostics-*.jsonl`
segments rotate. Symlinks/hard-linked segments are refused. Do not share this
directory across independent server processes or edit active files.

Central JSONL files have a hard **4,500,000,000-byte** aggregate budget. Oldest
segments are deleted before append and at startup when necessary; segments are
at most 25,000,000 bytes and a record at most 16 KiB. A disk/write failure disables
further file writes for that process and increases failure/drop counters instead
of failing chat; restart after repairing storage. No database migration or row
cleanup is involved. Backups, uploads and user data are never retention targets.

Compose caps each of Veyvox, Caddy and LiveKit stdout/stderr at 50,000,000 bytes
× 3 files. Together those are at most 450 MB plus small rotation overhead;
4.5 GB + 450 MB leaves margin under **5,000,000,000 bytes** of application logs.
This budget covers the managed application logs, not unrelated host services,
operator-made copies, backups or historical containers retained externally.

The Docker limits apply after containers are recreated with the updated Compose
configuration. Plan a maintenance window: `docker compose up -d --force-recreate`
restarts the active application/voice services and can interrupt calls. Other
deployment systems must apply equivalent stdout/stderr limits before claiming
the combined 5 GB budget. Diagnose storage availability through the admin status
endpoint and monitor disk space as usual.
