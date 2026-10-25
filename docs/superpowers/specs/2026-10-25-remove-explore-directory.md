# Spec: remove-explore-directory

Status: scope and plan approved; inline implementation in progress.
Initiative: [1.15.2 design](2026-10-25-desktop-1.15.2.md).
Dependency: `remove-project-hub`, whose community card consumes this network.

## Objective

Completely remove Explore and the external/global **space directory network**,
including the pictured external communities, not merely hide their cards.
This includes local discovery UI and exclusive frontend/backend services,
automatic network activity, configuration controls, types, translations and
workbenches. Genuine invitation, approval and explicit federation behavior
must survive independently.

## Current structure and required separation

- Web: `components/chat/{ExplorePage,OuterSpaceSection,SpaceCard,InstanceDiscoveryHint}`,
  `stores/{exploreStore,directoryStore}`, directory utilities, dialogs, desktop
  routes/sidebar and mobile discovery screens/entrypoints.
- Server: `directory/{state,document,pinger}`, `routes/directory.ts`, discovery
  portions of `routes/explore.ts`, startup/shutdown hooks, config, settings and
  space mutation dirty marks.
- Shared: directory/discovery-only types, settings fields and error contracts.

`exploreStore` and `routes/explore.ts` also contain invitation-request behavior
used by `JoinPage`, `JoinSpace`, invite message cards and space managers.
Separate and rename that retained responsibility before deleting discovery.
The existing origin-aware API/client/federation and authorization rules stay
the source of truth; do not copy permissive join logic into a second path.

## Removal and retained interfaces

- Remove desktop/mobile Explore navigation and screens. Old `/explore` links
  land on Friends/home; no other modal advertises a removed discovery screen.
- Remove discovery previews/list/search/browse actions from Join Space. Joining
  by a supplied code/URL, connecting/logging in to its origin and requesting
  manager approval continue to work without fetching a directory or listing.
- Delete directory feed proxy, public listing document, pinger/retries/caches,
  endpoint configuration and global-listing/browsing controls in instance/space
  settings. A legacy `DIRECTORY_ENDPOINT` value must not trigger any traffic.
- Remove retired discovery API registration and exclusive serializers/types;
  old discovery/directory JSON endpoints return an intentional not-found
  response, never SPA HTML or a private-space list.
- Keep existing request-join, request listing/approval and membership/WS flows
  needed outside discovery, with their existing authenticated paths/permissions.
  Preserve public-join only if retained callers actually require it; otherwise
  retire that discovery-only entrypoint rather than inventing a new consumer.
- Remove active directory/support/discovery-only metadata from settings,
  public instance info, space responses and ready events consistently with
  updated shared types. Keep visibility and join-request metadata required by
  invitations and permissions; these are not directory listing.
- Preserve explicit remote connections, federation credentials, connected
  spaces/memberships, private-space protection and per-origin ID handling.
  Do not disconnect a space just because it was once discovered in the feed.
- Preserve database migration history and existing rows/legacy columns inertly;
  no destructive migration/data cleanup in this release. Do not edit old SQL
  or pretend retained migration history is active directory implementation.
- Remove feature-only tests/assets/catalog keys/dev previews/config/docs
  claims; rehome retained invitation/approval regressions instead of dropping
  them to make the suite green.

## Network retirement limits

1.15.2 must neither fetch the global feed nor publish/ping this instance to it,
even when an old database has listing enabled or an old environment names a
hub. The application will no longer expose a directory document. Copies
already held by a third-party index are outside this repository's control;
do not promise immediate global erasure or send a new external delisting
request without explicit operator approval.

## Commands, style and testing

Use the [initiative commands](2026-10-25-desktop-1.15.2.md#stack-commands-and-conventions),
strict origin-aware TypeScript, existing ErrorCode/i18n contracts and adjacent
tests. Server production typecheck does not cover e2e: run its separate command.

Observe failing tests for absent navigation/routes and zero directory network
activity before cleanup. Cover legacy enabled DB/env configuration, signed-in
boot, mobile stacks, Join Space and direct invitation links. Test local and
remote invitations, approval-required spaces, pending/approved/rejected
requests, manager permissions, auth/session reset, private-space protection
and existing connections with real stores/routes and federation e2e tests.

## Success criteria and non-goals

Neither frontend nor backend can browse, advertise or contact the global
directory. No exclusive Explore/directory runtime remains. An invitation is
still enough to enter/request a permitted local or remote space; no catalogue
dependency is needed. No removal of federation, existing remote communities,
messages or memberships, and no schema rewrite/new protocol/dependency.
