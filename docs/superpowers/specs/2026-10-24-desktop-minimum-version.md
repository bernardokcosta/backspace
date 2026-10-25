# Spec: Desktop minimum version

**Module id:** `desktop-minimum-version`
**Status:** Implemented; validation/review and historical-host acceptance pending. Default disabled.
**Initiative:** [Desktop 1.15.1](2026-10-24-desktop-1.15.1-design.md)

The initiative defines shared commands, style, dependencies and boundaries.

## Objective

When enabled by the operator, require desktop **1.15.1 or newer** to use the
instance. An older desktop shows a blocking update screen, not a dismissible
toast or a screen-share-only restriction. Ordinary browser access remains
available. Do not confuse server version with installed desktop version.

## Policy and compatibility contract

- Add optional operator configuration `BACKSPACE_MIN_DESKTOP_VERSION`, disabled
  when unset/empty. Invalid configured versions fail validation at startup.
- Publish its stable semantic-version value, or null when disabled, as
  optional `minimumDesktopVersion` in `GET /api/instance/info`. An older
  instance without this field has no announced minimum.
- Compare semantic versions numerically, including correct prerelease
  ordering. `1.15.10` is newer than `1.15.2`; a `1.15.1` prerelease does not
  satisfy stable `1.15.1`. Build metadata does not change ordering. Unknown or
  malformed installed versions must not be treated as current.
- The instance serving the client owns its policy. Do not replace it with a
  federation peer's policy or a GitHub-provided minimum. No server-selected
  updater feed, executable URL or shell command is trusted.
- Keep bots, ordinary web/mobile browsers, server-to-server federation and
  health/public policy/static-asset access outside the desktop restriction.
- This is an operational compatibility policy for identifiable ordinary
  desktop clients, not device attestation or an authorization boundary.
  A modified client can identify itself as a browser; do not claim otherwise.

## Blocking experience

1. Read the installed desktop version using the existing bridge, including
   previously shipped hosts that already expose `getVersion()`.
2. Check policy before mounting ordinary app/session activity. Prevent login,
   chat, call, screen share, federated auto-connect and pending-message replay
   while the desktop is blocked; preserve account credentials and drafts.
3. Show current version, required version and real updater state. There is no
   close, Escape, backdrop, route or Later action that enters the outdated app.
4. In `auto` mode, trigger a real update check, show bounded download progress
   and offer restart/install only for an actually ready update satisfying the
   minimum. Do not restart mid-download or install a known insufficient build.
5. In `manual` mode, explain that the installer must be downloaded and offer
   the fork's trusted release page. Do not show a nonfunctional Restart button
   or download archives the app cannot install.
6. In `external` mode, explain how to update through the package manager. Do
   not bypass that update owner. The app remains blocked until compatible.
7. On failed checks/downloads, unavailable bridge/version, malformed policy or
   timeout, offer retry and a trusted manual recovery path. Failure must not
   quietly unlock an already blocked client. On first policy lookup failure,
   desktop waits with actionable retry instead of guessing that no policy
   exists. A normal browser is not gated on desktop IPC or policy availability.
8. Opening the serving instance in a normal browser is an allowed escape from
   the desktop restriction, not a way to unlock the old desktop itself.
9. The screen stays keyboard-accessible, localized and compatible with desktop
   title-bar/window controls. Existing dismissals cannot suppress it.

## Existing and already-open desktop clients

Changing only the new desktop binary would never reach users who have not
installed it. The blocking screen therefore lives in the instance-served web
client and works with the older version/updater bridges.

Do not rely exclusively on that screen to restrict already-open clients still
executing an older web bundle. Add consistent REST/WebSocket compatibility
checks for identifiable desktop requests when the minimum is enabled. Verify
the real version/identification sent by existing packaged **1.14.2** and
**1.15.0** before choosing a parser; do not assume that the `Electron/…` token
contains the Backspace app version. New hosts should identify the fork and
installed version unambiguously. Keep static assets, instance info and recovery
reachable so a blocked client can obtain the updated screen.

Use the existing error-code contract for desktop-update-required REST errors;
WebSocket refusal must terminate the unsupported session without a reconnect
storm in the updated client. Old bundles may display a generic refusal until
the service worker loads the new UI. The rollout must verify that transition
and record any already-open-session limitation instead of claiming an instant
remote install. Existing refresh behavior intentionally waits for calls;
policy enforcement and recovery must not depend on waiting indefinitely for
an obsolete client to stop a call voluntarily.

## Tests and success criteria

- Disabled/missing policy preserves current desktop behavior.
- Browser never calls desktop IPC and remains usable with the policy enabled.
- Stable versions below `1.15.1` are blocked; `1.15.1` and newer are accepted.
  Include prerelease/build metadata, malformed values and ordering tests.
- Required UI works with old bridge, dismissed update, downloading, ready,
  unavailable, failed, manual and external states, without dead buttons.
- No session initialization or pending outgoing message runs behind the block.
- REST and WebSocket reject recognized outdated desktops while current
  desktop, web/mobile, bot and federation tests continue to pass.
- Real packaged 1.14.2/1.15.0 clients reach the update screen and can obtain a
  compatible installer, including an already-open-client rollout test.
- After actual update/relaunch, the same account can use the app; no token,
  draft or instance identity is erased to achieve the upgrade.
- Deployment with policy disabled is verified before setting
  `BACKSPACE_MIN_DESKTOP_VERSION=1.15.1`; recovery can disable this setting
  without rolling back or restoring application data.
