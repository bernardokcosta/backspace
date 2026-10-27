# Telemetry — retired

The optional daily usage ping ("Say hi to Jannis" / `hello.backspacechat.com`) and all associated telemetry code are removed. Their UI (`TelemetryAsk`, `HelloModal`, `TelemetryPanel`, `PayloadPreview`, scene and answer buttons), store slice, translations, server reporter/state/payload/activity modules, startup/shutdown hooks, admin routes, installer prompt/flags, configuration and shared contracts no longer exist.

## Compatibility

- `GET /api/admin/telemetry`, `PUT /api/admin/telemetry`, and `GET /api/admin/telemetry/preview` are unknown APIs and return JSON 404.
- `TELEMETRY_ENDPOINT` and `TELEMETRY` are no longer parsed or used. Old enabled database flags and an old endpoint cannot start timers or send outbound requests.
- WebSocket authentication and heartbeat `pong` frames no longer touch `users.last_active_day` or `users.last_client`.

## Persistence

Historical columns and migrations remain unchanged for upgrade/rollback compatibility:
- `instance_settings`: `telemetry_enabled`, `telemetry_id`, `telemetry_last_day`, `telemetry_last_error`, `telemetry_declined_version` (and `installed_at`, which remains backfilled by `ensureDefaults`).
- `users`: `last_active_day`, `last_client`.

ORM mappings remain only to preserve those schemas; no active feature reads, writes, clears or serializes the retired telemetry columns.

See [admin.md](admin.md), [api.md](api.md), [database.md](database.md) and [websocket.md](websocket.md).
