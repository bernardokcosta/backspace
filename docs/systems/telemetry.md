# Telemetry — retired

Version 1.15.9 adds separate [instance-owned operational diagnostics](diagnostics.md).
It does not restore the upstream ping, old telemetry columns or any third-party
destination. Diagnostic storage is server-only and bounded; clients retain only
a short-lived in-memory queue, never local log files.

The optional daily usage ping ("Say hi to Jannis" / `hello.backspacechat.com`) and all associated telemetry code are removed. Their UI (`TelemetryAsk`, `HelloModal`, `TelemetryPanel`, `PayloadPreview`, scene and answer buttons), store slice, translations, server reporter/state/payload/activity modules, startup/shutdown hooks, admin routes, installer prompt/flags, configuration and shared contracts no longer exist.

## Compatibility

- `GET /api/admin/telemetry`, `PUT /api/admin/telemetry`, and `GET /api/admin/telemetry/preview` are unknown APIs and return JSON 404.
- `TELEMETRY_ENDPOINT` and `TELEMETRY` are no longer parsed or used. Old enabled database flags and an old endpoint cannot start timers or send outbound requests.
- WebSocket authentication and heartbeat `pong` frames no longer touch `users.last_active_day` or `users.last_client`.

## Persistence

Generated migration `0050_standalone_cleanup` permanently removes the five old
`instance_settings.telemetry_*` columns and `users.last_active_day` / `last_client`.
Their ORM mappings are gone. Historical migrations remain immutable so old
installations can upgrade through the same validated transaction; rollback means
restoring the pre-migration snapshot, not retaining obsolete columns in production.
`installed_at`, worker identity and native operational diagnostics remain separate
and are preserved, including `ensureDefaults`' installation-date backfill.

See [admin.md](admin.md), [api.md](api.md), [database.md](database.md) and [websocket.md](websocket.md).
