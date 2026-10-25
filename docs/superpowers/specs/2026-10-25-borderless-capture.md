# Spec: borderless-capture

Status: scope and plan approved; inline implementation in progress.
Initiative: [1.15.2 design](2026-10-25-desktop-1.15.2.md).

## Objective

Remove the outline associated with Backspace's Windows native HDR-to-SDR
capture. Starting or publishing that capture must fail closed when supported
borderless capture cannot be authorized/configured. The operator explicitly
chooses blocking over fallback with a border and requests permission retry.

## Current implementation and boundaries

`packages/desktop/native/sdr-capture/capture_session.cpp` creates a WGC session
on a worker and calls `StartCapture()` without configuring `IsBorderRequired`.
The main/preload/web path already requires an explicitly selected source,
focus/main-frame checks, a one-use grant and generation-bound ownership.
The web stage starts Chromium `getDisplayMedia` before replacing its video
with the native track. Permission denial must move ahead of that acquisition;
the duplicate capture's effect on the outline is part of feasibility testing.

Affected boundaries: that native module, `packages/desktop/src/sdrCapture*`,
the existing preload declarations, `packages/web/src/utils/sdrScreenCapture.ts`
and screen-sharing setup/error UI. Keep the working FP16 conversion, SDR
preference, same-track preview/publication, audio routing and bounded cleanup.
Ordinary browser/macOS/Linux capture is not replaced by this Windows change.

## Behavior and interfaces

- Request borderless access only because the user explicitly starts/retries
  the affected share, never at boot, sign-in, capability probing or polling.
- Use `GraphicsCaptureAccess.RequestAccessAsync(Borderless)` where available
  and require an **Allowed** result before starting the affected capture.
- Configure `GraphicsCaptureSession.IsBorderRequired(false)` before
  `StartCapture()`. Unsupported APIs, refusal, errors or inability to configure
  the session produce a typed, translated failure, not a bordered fallback.
- No frames from an unauthorized/unconfigured session reach preview or LiveKit.
  No replacement capture or audio-only publication starts behind the error.
- Show **Request permission again** as an explicit recovery action for an
  access failure. Each click makes a fresh supported OS request through the
  same trusted source/owner lifecycle; duplicate clicks coalesce while pending.
- Do not treat a prior denial as permanent in app storage. Do not repeatedly
  prompt on a timer or promise the OS will display a dialog on every request.
- Distinguish user denial, system-policy denial, missing app declaration and
  unsupported OS/configuration. Re-request where meaningful; otherwise explain
  the required recovery without fabricating a working Settings deep link.
- A fresh successful request permits a new selected capture. A late grant
  after cancel/navigation/logout cannot restart or publish it automatically.
- OS permission UI must not block the Electron event loop or make native stop,
  cancel, window destruction or shutdown wait indefinitely. Dispose pending
  operations safely and ignore late replies after ownership changes.
- Preserve the focused main-frame/one-use source grant. Any narrow IPC/type
  additions must carry the same authorization, not expose arbitrary capture,
  window handles, OS URLs or a background permission-request primitive.

Illustrative invariant, not a replacement for OS/package verification:

```ts
const mayStart = access === 'allowed' && borderlessConfigured && work.isCurrent();
```

## Windows feasibility and limitations

Microsoft documents these controls from build 20348 and states that packaged
apps need `graphicsCaptureWithoutBorder`. Confirm the shipped Win32/NSIS app's
actual behavior; do not invent a capability manifest or silently migrate to
MSIX. A packaging change requires a separate decision.

Windows can keep an indicator for another application capturing the same
source. Backspace must not interfere with that application or claim its own
property/permission result proves the global desktop has no other indicator.
This constraint must remain explicit in acceptance evidence and error copy.

## Commands, style and testing

Use the [initiative commands](2026-10-25-desktop-1.15.2.md#stack-commands-and-conventions)
and existing C++/strict TypeScript style. Add adjacent native/controller/preload,
web adapter and setup tests. Observe denial/fallback tests fail before fixing.

Cover Allowed, user/system denial, NotDeclaredByApp, unavailable APIs, API
exceptions, retry after changed permission, duplicate retries, cancellation
during consent, late grant, navigation/destruction and zero retained frames.
Run matching-host x64/ARM64 native/package checks and actual installed Windows
grant/deny/retry/monitor/window sharing; preserve the received HDR/SDR result.

## Success and non-goals

The operator can share without Backspace's outline after OS authorization;
otherwise that capture stays stopped with actionable localized recovery.
Retry is user-controlled and never bypasses OS policy. No registry/privacy
hacks, new global permission mechanism, HDR toggle or unrelated media rewrite.

## Official references

- [IsBorderRequired](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscapturesession.isborderrequired?view=winrt-26100)
- [RequestAccessAsync](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.graphicscaptureaccess.requestaccessasync?view=winrt-26100)
- [AppCapabilityAccessStatus](https://learn.microsoft.com/en-us/uwp/api/windows.security.authorization.appcapabilityaccess.appcapabilityaccessstatus?view=winrt-26100)
