# Remove Explore and Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Explore and every active global-directory implementation while preserving independent invitation, approval and explicit federation behavior.

**Architecture:** Separate the retained join-request module from discovery, remove all discovery launchers/consumers, then remove its backend traffic/contracts. Preserve legacy DB columns/history inertly so ordinary upgrades/rollback do not destroy data.

**Tech Stack:** Existing strict TypeScript, React/Zustand/router, Fastify/Drizzle/SQLite, shared contracts and Vitest/e2e harness.

**Spec:** [remove-explore-directory](../specs/2026-10-25-remove-explore-directory.md).

## Global Constraints

Apply all [initiative constraints](2026-10-25-desktop-1.15.2.md#global-constraints).
Execute after H1. A store/API having “explore” in its name is not sufficient
reason to delete invitation/approval logic. Conversely, removed discovery
previews/admin controls are not independent consumers that justify retaining
the directory. No mass disconnect, protocol rewrite or data/schema drop.

## Review Focus

E1 tests equal IDs/different origins, stale account replies and permission
checks. E2 tests hidden launchers/mobile/bookmarks and invite-only UI. E3 tests
legacy enabled configuration, genuine JSON 404s, no hub traffic and inert data.

## Task E1: Separate the retained join-request module

**Files:**
- Create: `packages/server/src/routes/joinRequests.ts`, `joinRequests.test.ts` by moving retained handlers/tests from `routes/explore.ts` and its mixed suite.
- Create: `packages/server/src/utils/spaceJoinPayload.ts` by moving the current permission-filtered `buildFullSpace` implementation without changing its output.
- Modify: `packages/server/src/{index.ts,routes/explore.ts}`, `packages/web/src/{api/client.ts,stores/exploreStore.ts,utils/inviteJoinRequest.ts,components/modals/SpaceSettings.tsx}`, invitation/manager tests and auth-store tests.
- Preserve/rehome coverage from `packages/web/src/stores/exploreStore.requests.test.ts` only where it exercises retained consumers; do not retain a list/fan-out/store with no retained state reader.
- Update: `docs/systems/{api,spaces,client-federation}.md` only for the moved responsibility/retained contracts.

**Interfaces:**
- `joinRequestRoutes(app: FastifyInstance): Promise<void>` retains existing authenticated wire paths: `POST /api/spaces/:id/request-join`, `GET /api/spaces/:id/join-requests`, `PATCH /api/spaces/:id/join-requests/:requestId`, `GET /api/users/@me/join-requests`.
- `BackspaceApiClient.joinRequests` exposes `request(spaceId, message?)`, `list(spaceId, status?)`, `decide(spaceId, requestId, action)` and `mine(status?)` with the current `JoinRequest` responses. This is an internal grouping rename, not a new REST protocol.
- Existing `sendInviteJoinRequest(spaceId: string, origin: string, message?: string): Promise<'sent' | 'pending'>` keeps its interface. Use `connectedJoinOrigin` and the exact connected instance's client; missing/disconnected remotes throw `NotConnectedError`, never fall back to home. No discovery feed/list is fetched.
- Space managers list/decide through the owning origin with existing authorization/member/privacy filters. The server's accepted request still returns/broadcasts the full permitted space via the retained helper.
- `buildJoinedSpace(spaceId: string, forUserId: string): SpaceWithChannelsAndMembers | null` in `utils/spaceJoinPayload.ts` is the single moved payload builder. Both the temporary public-join handler and retained acceptance handler use it; do not duplicate the builder during the transition.
- Current public-join consumers are removed discovery/community/preview paths. Retire public-join with E3 unless execution finds a concrete retained production caller, then document that evidence before preserving it.

- [ ] **Step 1: Add failing retained-flow tests.** Use real API clients/routes and mocked transport only to assert remote same-ID requests reach the intended origin, disconnected origin sends nothing, duplicate pending maps to `'pending'`, bans/permissions propagate, and approval adds only permitted channels/members. Cover account-switch/desktop-policy stale replies using the existing client lifecycle seam; do not reintroduce an unguarded shared store.
- [ ] **Step 2: Observe RED.** Run `pnpm --filter @backspace/server exec vitest run src/routes/joinRequests.test.ts src/routes/invites.test.ts` and `pnpm --filter @backspace/web exec vitest run src/utils/inviteJoinRequest src/components/JoinPage.test.tsx src/components/modals/JoinSpace.test.tsx`. A not-yet-existing moved route/group is the intended failure.
- [ ] **Step 3: Move shared behavior, not discovery state.** Keep request paths/status/error codes, manager checks and full-space permission filtering. Update retained callers and temporary discovery-store request calls to `joinRequests`; the remaining `explore` client group contains only list/public-join until E3. `sendInviteJoinRequest` calls the origin-aware request directly instead of importing `exploreStore`. Move the shared payload builder once. Leave discovery functional until E2/E3; no aliases/stubs or duplicate route registration are needed.
- [ ] **Step 4: Verify GREEN.** Re-run Step 2 plus SpaceSettings manager/invite-message tests, existing invitations e2e and server e2e typecheck. Confirm there is no new call to `/spaces/explore` or `/directory` in the retained request flow.
- [ ] **Step 5: Commit.** Stage only E1 files and commit `refactor(spaces): separate join requests from discovery`.

## Task E2: Remove Explore, discovery previews and exclusive web resources

**Files:**
- Modify: `packages/web/src/App.tsx`, `components/layout/{ChannelSidebar,SpaceSidebar,MainContent,MobileShell,MobileSpacesScreen,AppLayout}.tsx`, `hooks/useMobileRouteSync.ts`, `stores/{uiStore,authStore}.ts`, `utils/homeNav.ts` and adjacent tests.
- Modify: `packages/web/src/components/modals/{JoinSpace,SpaceSettings}.tsx`, `instanceSettingsPanels/GeneralPanel.tsx`, related settings/store tests and catalog references.
- Delete: `components/chat/{ExplorePage,OuterSpaceSection,SpaceCard,InstanceDiscoveryHint}*`, `components/modals/{ExploreSpacePreviewCard,ConnectAndJoinModal,DirectoryConfirmations}*`, `hooks/useSpaceJoin*`, `stores/{exploreStore,directoryStore}*`, `utils/directory*` under `packages/web/src/` after E1 retained tests are rehomed.
- Delete: `packages/web/dev-explore.html`, `dev-directory-settings.html`, `src/dev/{explore-preview,directory-settings-preview}.tsx` and their exclusive preview wiring.
- Remove exclusive strings across `packages/web/src/locales/*/{spaces,settings,common}.json`; rehome still-used join errors/copy into the retained invitation keys rather than deleting them by prefix.
- Update: `docs/systems/{directory,mobile-ui,localization,spaces,admin}.md`.

**Interfaces:** `/explore` redirects with replacement to `/channels/@me`.
`HomeNavItem` is `'friends'` only. No mobile `'explore'`/`'backspace'` screen,
directory modal data, store reset/import or browse/discovery-preview callback
remains. Join Space accepts code/URL and retains connect/password/request steps.
Visibility/description needed by invitations or space metadata remain editable
outside removed discovery controls, using the existing space settings surface.

- [ ] **Step 1: Add failing absence/retention assertions.** Test no Explore row on desktop/mobile, old bookmarked routes redirect despite stale current-space IDs, Join Space does not fetch/pre-render discovery, and invitations/approval/password fallback still work. Test that public/request/private visibility and description remain manageable without the directory controls.
- [ ] **Step 2: Observe RED.** Run `pnpm --filter @backspace/web exec vitest run src/App.routes.test.tsx src/components/layout src/components/modals/JoinSpace.test.tsx src/components/modals/SpaceSettings src/components/JoinPage.test.tsx`. Current launchers/previews must fail the new absence assertions.
- [ ] **Step 3: Remove the exclusive web module.** Remove all entrypoints/content/stores/workbenches/types and current catalog registration/copy. Preserve explicit connection settings, remote password handling and update/source links. Split retained description/visibility controls from the retired directory UI rather than leaving a dead Discovery panel. Remove feature-only tests only after retained regressions are covered in E1/E2.
- [ ] **Step 4: Verify GREEN and imports.** Re-run Step 2, auth-session-reset/invite-message suites, `pnpm check:i18n`, web typecheck and lint. Exercise desktop/mobile navigation and Join Space in the real app. Search source/dev entrypoints for retired imports, modal names, catalogue keys and routes; allow only explicit compatibility redirects and retirement tests.
- [ ] **Step 5: Commit.** Stage only E2 files and commit `refactor(web): remove Explore and external space discovery`.

## Task E3: Remove server directory/discovery and active shared contracts

**Files:**
- Delete: `packages/server/src/directory/`, `src/routes/directory.ts` and exclusive tests; retire only the discovery/public-join portions of `src/routes/explore.ts` after E1, then delete the empty mixed module.
- Modify: `packages/server/src/{index,config}.ts`, `routes/{settings,spaces,instance}.ts`, `ws/handler.ts`, relevant tests and `test/directory-e2e.test.ts` (replace it with network-retirement e2e coverage).
- Modify: `packages/shared/src/{types,errors}.ts`, affected serializers/fixtures, `packages/web/src/{api/client,stores/settingsStore}.ts` and dependent declaration/error catalogs.
- Modify: `.env.example`, active directory references in `scripts/fixtures/`, server test harnesses and current deployment/setup docs; preserve unrelated federation-worker guards and telemetry.
- Preserve unchanged: `packages/server/drizzle/` and existing DB schema columns. Mark legacy directory/discovery/support mappings inert only if retained by the ORM; remove all active reads/writes/dirty marks for these features.
- Create: `packages/server/test/discovery-retirement-e2e.test.ts`; update existing `readyPayload.directory`/settings/spaces tests into absence/data-preservation coverage where appropriate.
- Update: `docs/systems/{directory,api,websocket,database,spaces,admin,deployment}.md`.

**Interfaces:**
- Retire `GET /api/directory`, `GET /api/directory/spaces`, `GET /api/spaces/explore` and discovery-only public-join. Unknown `/api/*` remains JSON 404 via the existing production not-found seam, never SPA HTML. Preserve E1 join-request paths.
- Remove `ExploreSpace`, `Directory*` and active discovery/directory/support-only fields from shared/public/admin/streaming/space/ready contracts after tracing retained callers. Keep `SpaceVisibility`, `JoinRequest`, description and core instance fields.
- Legacy directory/discovery/support PATCH keys are ignored like existing unknown keys; they cannot write legacy columns, start a worker or contact a hub. Old `DIRECTORY_ENDPOINT` is not parsed or used.
- No DB migration/data deletion; the only traffic to retained peer origins comes from explicit retained federation/invitation behavior, not a directory boot hook.

- [ ] **Step 1: Add failing real-server retirement tests.** Start the actual server through the existing e2e harness with isolated data and a loopback hub recorder. Seed old listing/browse/dirty flags enabled and set `DIRECTORY_ENDPOINT` to that recorder. Assert zero hub requests across boot/settings/space mutation/invite entry, JSON 404 for each retired route, unchanged legacy DB values and working E1 invite/approval/auth/private-space checks. Exercise the production static fallback with web output present, not only a minimal Fastify fixture.
- [ ] **Step 2: Observe RED.** Run `pnpm --filter @backspace/server exec vitest run test/discovery-retirement-e2e.test.ts src/routes/joinRequests.test.ts`. Current directory routes/boot pinger must fail the zero-traffic/not-found assertions, not merely time out due to a missing test helper.
- [ ] **Step 3: Delete directory runtime and exclusive contracts.** Remove startup/shutdown/pinger/cache/config imports, all dirty marks and active settings/space/ready serializers. Keep permission/rate-limit checks on retained routes, ordinary federation/telemetry lifecycles, and the existing API-versus-SPA 404 distinction. Adapt mixed test harnesses to the retained join route module instead of weakening them.
- [ ] **Step 4: Verify GREEN and persistence.** Re-run Step 2, settings/spaces/ready/permissions tests, `pnpm --filter @backspace/server typecheck:e2e`, federation e2e and both server/web typechecks. Fresh DB migration and a copy of legacy-enabled DB both boot; tables/values remain intact and no removed worker/network request starts. Do not send a real third-party delisting request or promise deletion from someone else's cache.
- [ ] **Step 5: Commit.** Stage only E3 files and commit `refactor(server): retire global directory and discovery`.
