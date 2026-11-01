# Retire desktop minimum-version enforcement

The desktop compatibility screen can prevent the entire application from opening
when a policy lookup fails. Remove the policy completely, as requested: no root
gate, polling, version comparison, HTTP/upload refusal or WebSocket refusal.
Ignore the old `BACKSPACE_MIN_DESKTOP_VERSION` environment setting and stop
advertising a minimum in instance info. Remove policy-only state, copy and tests.

Reuse ordinary app startup, updater prompts, authentication and per-origin
federation flows. Keep account/session isolation, explicit transfer cancellation
and pending-message delivery receipts. Do not change Electron security, capture
capability checks, database state or release artifact validation.

Disabling the environment variable alone or hiding only the screen would leave
the unwanted validation in place; neither meets the requested full removal.
Historical release notes/specifications remain historical, superseded by this note.
