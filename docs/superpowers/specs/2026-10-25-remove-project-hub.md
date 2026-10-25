# Spec: remove-project-hub

Status: scope and plan approved; inline implementation in progress.
Initiative: [1.15.2 design](2026-10-25-desktop-1.15.2.md).

## Objective and scope

Remove the Backspace **project-hub page**, not the Backspace application or its
identity. Delete its desktop sidebar row, `/backspace` content/route, mobile
You-screen row/screen, version-seen badges, exclusive store/hooks/cards,
translations, assets, workbench and feature-only tests.

## Current structure and retained consumers

The implementation is in `packages/web/src/components/projectHub/`,
`stores/projectHubStore.ts`, `hooks/useHubUpdateState.ts`,
`utils/hubSeenVersion.ts`, `utils/projectLinks.ts`, related layouts/navigation,
`locales/*/project.json` and the project-hub preview entrypoints.

`useHomeInstanceInfo` also serves sticker upload/manage limits and settings
invalidation: preserve that shared reader and its non-hub tests. Preserve
source/version/commit links on auth/settings surfaces, desktop download and
updater/recovery code, and existing fork branding. Delete project-hub-only
report/environment helpers only after confirming no retained consumers.

## Behavior and compatibility

- No desktop/mobile navigation, update dot or other launcher opens the hub.
- Old `/backspace` bookmarks resolve to the retained Friends/home view without
  mounting/fetching the removed feature. No hub mobile-stack type remains.
- Delete exclusive code, catalog registration, preview HTML/scripts and active
  supporting config, not merely imports from the production entrypoint.
- Remove the admin Support-card control and active support-only wire fields;
  do not retain an otherwise dead mechanism because an admin form also uses it.
  Preserve the historical database column/migrations inertly for rollback.
- Do not erase arbitrary localStorage or credentials. The old feature's
  per-user seen-version values may be inert; no runtime code maintains them.
- Update current subsystem docs to describe retirement; preserve historical
  specifications/release notes as history, not shipping code.

## Commands, style and testing

Use the [initiative commands](2026-10-25-desktop-1.15.2.md#stack-commands-and-conventions),
adjacent Vitest tests, existing navigation/i18n patterns and the current design
system. No replacement landing-page design or new dependencies.

Write failing desktop/mobile route/navigation assertions before removal.
Test old bookmarks, account switching, badge aggregation, sticker limits,
settings refresh, desktop download/update recovery and the AGPL source offer.
Only retire tests whose feature is deliberately removed; preserve/rehome the
regression coverage for every retained shared helper.

## Success criteria

The hub and its exclusive implementation are absent from shipping/dev feature
entrypoints and current navigation. Friends, DMs, spaces, updates, branding and
the accurate source offer remain usable. The removal leaves no orphaned
namespace, stale route, dead badge subscription or feature-only admin control.
