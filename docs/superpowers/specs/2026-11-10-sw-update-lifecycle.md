# Spec: safe periodic frontend update checks

## Status and objective

Approved by the user on 2026-11-10; module `sw-update-lifecycle` in the
[approved capability map](2026-11-10-operational-resilience-map.md).

Stop an unavailable/stale service-worker registration from producing an
unhandled rejection every minute. Keep browser updates working and preserve
all existing protections against applying an update or reloading during voice.

## Evidence and assumptions

- `SwAutoUpdate` currently starts an unowned `setInterval` in `onRegisteredSW`
  and ignores the promise returned by `registration.update()`.
- A local reproduction using the production callback produces an unhandled
  `InvalidStateError` on every tick when `update()` rejects. This is a confirmed
  code defect, not proof that it caused every matching historical client event.
- Desktop startup intentionally clears service workers. That security/update
  boundary remains unchanged; a previously registered worker is not guaranteed
  to remain current for the lifetime of an old registration reference.
- Use existing React 19, `vite-plugin-pwa` and Web Locks support. No new
  dependency, bridge, update channel or persistent setting.

## Required behavior

- Own the periodic check's lifecycle. At most one active checker belongs to the
  mounted component/registration; replace and dispose it on registration change
  and unmount, including development remounts.
- Handle synchronous failures and rejected update promises. No overlap when a
  check takes longer than the interval; no repeated unhandled rejections.
- Skip unnecessary checks while offline or without a usable registration.
  Recover from a replaced/unregistered registration without an aggressive loop;
  a valid replacement must still receive periodic update checks.
- Do not hide unexpected failures as successful updates. Preserve bounded,
  privacy-safe reporting through existing diagnostics/console behavior without
  a warning on every tick for the same terminal stale registration.
- Preserve `needRefresh`, own-build/controller tracking, waiting-worker
  activation and existing cross-tab voice locks. No reload, `SKIP_WAITING`, or
  forced update as a response to an update-check error.

## Structure and style

Change `packages/web/src/components/ui/SwUpdatePrompt.tsx` and its colocated
tests, extracting a small lifecycle helper only if it makes ownership clearer.
Follow existing `disposed`/cleanup and `catch (error: unknown)` patterns:

```ts
return () => {
  disposed = true;
  clearInterval(interval);
};
```

No visual redesign or new user-facing copy is required. Update the existing
deployment/desktop lifecycle documentation only if its behavior description
changes; do not alter the desktop's service-worker clearing policy.

## Success criteria and testing

- Fake-timer tests drive the actual `onRegisteredSW` callback and cover a
  successful check, synchronous throw, `InvalidStateError`, network rejection,
  offline intervals, slow checks, registration replacement, and unmount/remount.
- No rejected check escapes as `unhandledrejection`; disposed callbacks cannot
  act on a newer registration or leave timers behind.
- All existing `SwUpdatePrompt` tests still demonstrate no reload/apply during
  voice, including another tab's shared lock and a session starting mid-update.
- A local browser exercise verifies checking still occurs without modifying
  the real instance's worker or connected desktop clients.

```bash
pnpm --filter @veyvox/web test -- SwUpdatePrompt
pnpm check:i18n
pnpm typecheck
pnpm lint
pnpm build
```

## Boundaries

Always preserve voice/update safety and surface unexpected failures safely.
Ask before changing update/desktop contracts or production behavior. Never
clear user storage, disable offline support, relax CSP, or silence all runtime
rejections to make the logs appear clean.
