# Standalone Client Implementation Plan

> **For agentic workers:** Use `executing-plans` for native execution, or the
> explicitly selected subagent-driven workflow. Track checkbox steps task by task.

**Goal:** One chosen server, one native identity and one socket, without federation
stores, secrets, cross-origin operation routing or peer UI.

**Architecture:** Reuse the primary `api`, auth/session reset and existing stores.
Remove alternate-peer arguments and their callers rather than returning a fixed
client from an obsolete wrapper. Retain current-server cache/request scoping for
explicit server replacement, independent of deleted peer identity concepts.

**Tech Stack:** React 19, Zustand 5, Vite 8, Tailwind 3, existing 25 catalogs and
Electron bridge. No dependency or design-system change.

**Spec:** [Standalone client](../specs/2026-11-10-standalone-client.md);
[orchestration/global constraints](2026-11-10-standalone-security.md).

## Global Constraints

- Node `^22.22.2 || ^24.15.0 || >=26.0.0`, pnpm `10.34.3`; no `any`/stubs.
- Consume Core's `{ userId }`/group `{ id }`, local channel IDs and
  `dm_call_accepted.answeredByUserId`; no federation wire compatibility layer.
- Preserve native session/settings/drafts/pending transfers/IndexedDB, current
  instance selection, app IDs/crypto identity and fixed installed v1.17.0 baseline.
- Preserve bounded GET recovery/rate limits/bootstrap retry/authoritative401-only
  expiry, request cancellation, SW lifecycle and media-probe fixes.
- All user-facing copy uses catalogs; native Aether Drift/mobile/accessibility
  behavior remains. No production, Git publication or personal-profile tests.

## Review Focus

1. Enumerating and deleting adjacent old storage keys cannot skip entries (W1).
2. Server B with equal IDs cannot receive server A's token or pending response (W1–W3).
3. An old absolute tus URL must not receive the current bearer token (W3).
4. Foreign invite with colliding local code cannot autojoin or autoprovision (W4).
5. Mixed catalog/store tests keep local settings, calls, packs and diagnostics (W4–W5).

---

## File/consumer map

| Paths under `packages/web/src/` unless noted | Action |
|---|---|
| `platform/retireFederationStorage{,.test}.ts` (new), `main.tsx` | Isolated exact-key cleanup before auth/socket bootstrap |
| `api/client.ts`, `stores/authStore.ts`, `hooks/useAuth.ts` | Native identity/status/profile/password/deletion; primary request lifecycle |
| `stores/{space,social,voice,activity,chat,discover,transfer}Store.ts` | Native IDs/actions; preserve local reset, pending transfers and current-server scope |
| `hooks/useWebSocket.ts`, `hooks/useLiveKit.ts`, `audio/{SpeakingDetector,soundboardPlayback}.ts`, `hooks/useAfkVoiceMove.ts` | One session socket, local room identity and retained sound/voice behavior |
| `utils/{identity,selfStatus,mutuals,friendRequestTarget,groupDmOwnerActions,inviteJoinRequest,spaceInvite,dmFormatters,tusUrl}.ts` | Keep actual local display/status/invite/upload rules; remove alternate origin/home identity APIs |
| `stores/{instance,federation}Store.ts`, `utils/{crossStoreResolvers,federationOps,dmOriginFailover,dmConversationKey,peerRejectedToast}.ts`, `hooks/{useFederationToasts,useSpaceOrigin}.ts` | Delete after caller migration, not constant-return substitutes |
| `components/modals/{ConnectedInstances,RemotePasswordStep,ReauthForm}.tsx`, `components/modals/instanceSettingsPanels/FederationPanel.tsx`, `dev/{peer-states-preview,peering-reasons-preview}.tsx` | Delete feature-only code/fixtures; preserve any actual native reauthentication caller before deletion |
| `components/{JoinPage,auth/RegisterPage}.tsx`, `components/modals/{JoinSpace,InviteModal,InviteFriendModal,NewDmModal,AddDmMemberModal,GroupDmSettings,DeleteAccountModal,UserProfileModal,UserSettings}.tsx` | Native account/invitation/group/settings behavior |
| `components/layout/{AppLayout,SpaceSidebar,ChannelSidebar,ActivityPanel,DmListItem,DmMemberRow,DmRosterPanel,DmSearchBar,MainContent,MemberSidebar,MobileDmsScreen,MobileGroupDmInfo,MobileInstancePanel,MobileMembersScreen,MobileSpacesScreen,MobileYouScreen}.tsx`, `components/chat/{FriendsPage,Message,MessageList,ReactionPill,StickerStoreModal,StickerPackManageModal}.tsx` | Remove merged-peer identities/origins/globes, preserve local feature/roster/store behavior |
| `components/modals/settingsPanels/{InstancePanel,AccountPanel}.tsx`, `components/ui/{Username,AvatarStack,UserProfilePopout}.tsx`, `hooks/useVoiceParticipantMeta.ts` | Remove peer settings, badges and profile projection; retain local UI |
| `i18n/{resources,index,errors}.ts`, `locales/<each of 25>/{federation,settings,auth,errors,...}.json` | Delete exclusive namespace/files/keys, retain unrelated translations; P1 records exact mixed-file keys |
| `packages/desktop/src/{main,preload,navigationPolicy}.ts`, desktop bridge declarations/callers captured by P1 | Remove renderer-maintained connected-peer navigation trust, preserve picker/current-origin and sender/frame guards |
| `scripts/{verify-installed-rebrand,installed-rebrand.test}.mjs`, `platform/rebrandCompatibility.test.ts`, `packages/desktop/test/rebrand/fixture.html` | Phase-specific expected removal versus native persistence, no acceptance weakening |

P1 expands import consumers of `instanceStore`, `getApiForOrigin`,
`getChannelOrigin`, `getMyUserIdForOrigin`, `homeIdentityOf` and `userKey` to literal
files, including soundboard/game/notification/mention/bot/upload callers. Names
alone are not proof of exclusivity: preserve display-name/nickname and URL safety.

### Task W1: Retire persisted peer state and retain safe session reset

**Files:** New storage transition/tests, `main.tsx`, `authStore.ts`, `useAuth.ts`;
adapt `authStore.{sessionReset,statusRouting,trueHomeSeed}.test.ts`,
`hooks/useAuth.recovery.test.tsx`, `api/{client,readRecovery}.test.ts`.

**Interfaces:** `retireFederationStorage(storage: Storage): void` snapshots keys
before removing exactly `backspace_instances`, nonempty-suffix
`backspace_instances_<accountId>` and `backspace_true_home_status:*`. Invoke before
any module can bootstrap connections; catch unavailable storage without enabling
legacy activity. Keep auth's existing public local methods; remove row-id map/
remote-session/true-home status fields and methods from all callers.

- [ ] Add cases `removesEveryAdjacentRetiredKey`, `malformedValuesDoNotReconnect`,
  `preservesLookalikeAndNativeKeys`, `storageDeniedStillHasNoPeerRuntime`,
  `lateBootstrapCannotReplaceNextSession`; assert token/language/scale/audio/
  drafts/current URL/transfer handles unchanged and repeated cleanup idempotent.
- [ ] Run `corepack pnpm --filter @veyvox/web exec vitest run src/platform/retireFederationStorage.test.ts src/stores/authStore.sessionReset.test.ts src/hooks/useAuth.recovery.test.tsx --maxWorkers=2`;
  expect RED for missing cleanup/current auto-connect.
- [ ] Implement the isolated key transition and native auth/status routing;
  retain real session generation, cancellation and complete user-store reset.
  Remove autoConnectAll/home status persistence; never clear all storage.
- [ ] Rerun named suites and API recovery tests; expect GREEN for 401 expiry,
  403/404/429 non-expiry, explicit retry and stale-generation suppression.
  Checkpoint W1; follow W2 immediately before complete application validation.

### Task W2: Direct native IDs/actions and one socket

**Files:** API/stores/socket/identity/voice consumers in map; remove registry/
copy/failover modules; add `hooks/useWebSocket.standalone.test.tsx` and
`stores/standaloneSession.test.ts`.

**Interfaces:** Use `api` from `api/client.ts` and `useAuthStore.getState().user?.id`.
Remove peer-origin operation parameters and tagged copy unions at definitions and
every caller. Local message/DM maps use native IDs; session ownership still uses
the current origin/account generation, not a connected-instance map.

- [ ] Test one socket after mount/reconnect/StrictMode, stale socket cannot write
  new session, logout tears down calls/timers, current chosen status survives,
  own/other comparisons across equal IDs on sequential server visits, local
  friend/DM/group/optimistic message/read/draft behavior and call refusals.
- [ ] Run new suites plus existing `useWebSocket.{dmCallRefusal,spaceAccess,refreshReady,notificationSettings,friendActivity,wsSend}.test.*`;
  expect RED on multiplexer/remote event shape; preserve all local assertions.
- [ ] Simplify existing stores/hook and consumers to Core contracts. Remove
  `createApiClient` if no legitimate current-base consumer remains; no no-op
  `getApiForOrigin`/origin-resolver export remains. Retain source/display/nickname
  formatting helpers with honest local signatures; remove home/canonical-row
  resolution, globe predicates, replica presence and registry event handlers.
- [ ] Delete only remote-exclusive tests after their local portions move into
  native suites; keep notification/game/soundboard/voice tests. Run `corepack pnpm
  --filter @veyvox/web typecheck` and focused suites, expect GREEN; update client
  API/WS/auth/DM/voice docs. Checkpoint W2.

### Task W3: Current-server uploads, cache privacy and desktop switching

**Files:** `transferStore.ts`, `utils/{tusUrl,idbHandles}.ts` and tests;
`authStore.sessionReset.test.ts`, new `stores/transferStore.instanceScope.test.ts`;
desktop navigation/main/preload declarations and `navigationPolicy.test.ts`.

**Interfaces:** Reuse current page/selected server origin, no peer resolver.
`resolveTusUrl(location: string, instanceOrigin?: string): string` resolves and
verifies the URL has that current origin and the existing `/api/files/` endpoint
shape before attaching credentials; `tusEndpoint(instanceOrigin?: string): string`
continues to support the selected server's scheme/host/port. A transfer's captured
instance/account identity must match current session before start/resume/cancel.

- [ ] Add `foreignTusLocationGetsNoBearer`, `oldTransferAfterInstanceSwitchStaysPaused`,
  `sameIdOnNewServerCannotRehydrateOldData`, relative URL/non-default port,
  valid same-origin resume and storage-denied tests. Verify no credentialed
  request on any reject path, not merely a displayed error.
- [ ] Run transfer/tus/session/navigation tests; expect RED for unchecked absolute
  upload URLs/renderer-reported peer trust.
- [ ] Remove peer token resolver and enforce session scope at every raw tus
  POST/PATCH/HEAD/DELETE. Keep native pending files/handles intact; mismatched
  old transfers remain non-running, not silently retargeted or globally erased.
  Keep current-server cache ownership/cancel paths; no new cache subsystem.
- [ ] Remove connected-peer origin IPC/state from main/preload/types/callers;
  native `isNavigationAllowed` uses current URL/picker only. Preserve initial
  URL and Change Instance through main-owned navigation, sender/frame validation,
  context isolation/sandbox, CSP and legitimate media/LiveKit trust separately.
- [ ] Rerun web tests plus `corepack pnpm --filter @veyvox/desktop test --maxWorkers=2`
  and `build:ts`; expect GREEN, old session/socket/call gone before next-server
  requests, no password/token forwarding. Update desktop/security/uploads docs.

### Task W4: Remove feature UI/catalogs, retain local invitation/settings/store flows

**Files:** Components/i18n/catalogs in map; adapt `JoinPage.test.tsx`,
`modals/{JoinSpace,InviteModal,GroupDmSettings,lazySettingsPanels}.test.tsx`,
`chat/StickerStoreModal.test.tsx`, i18n `*Content.test.ts` and `terminology.test.ts`;
new `components/modals/StandaloneSettings.test.tsx`.

**Interfaces:** Native API request bodies from Core; foreign invitation origin is
never replaced with current origin or used to provision a second session. Reuse
existing safe external-open/navigation and localized errors. No new modal type.

- [ ] Test absent Federation/Connections/peer-reset entries in desktop and mobile,
  retained users/storage/voice/games/soundboard/updates/diagnostics tabs, local
  invite approval and foreign URL with identical local invite code (zero join/
  register/login calls). Test pack upload/review/install without remote policy UI.
- [ ] Run focused tests; expect RED on existing UI and catalog resources.
- [ ] Delete obsolete panels/modal unions/routes/lazy imports/preview entrypoints,
  linked-account registration, peer sync controls/badges/filters, source-copy DM
  actions and retired namespace/key imports in **all 25** catalogs. Keep unrelated
  local translation assertions in mixed tests and local native username text
  (including preserved detached handles); do not reinterpret a username as a URL.
- [ ] Run focused tests, `corepack pnpm check:i18n` and full web tests; expect GREEN.
  Update localization/mobile docs where behavior/contracts changed; UI-only edits
  do not require unrelated design-system rewrites. Checkpoint W4.

### Task W5: Installed upgrade contract and real UI/network inspection

**Files:** Installed tooling/browser/desktop fixture paths in map; update
`docs/systems/{desktop,desktop-security,client-federation}.md` retirement text and
the final validation report owned by S5. Do not run installed harness locally.

**Interfaces:** Installed report assertions distinguish baseline seed (old peer
state present) from candidate launch/relaunch (retired keys absent), while native
token/cookie/encryption/preferences/IndexedDB/startup values remain unchanged.

- [ ] Add tooling tests that reject candidate reports containing peer keys or
  missing any native field, while accepting the pinned baseline's old state.
  Seed multiple scoped/status keys; never reseed the candidate. Make fixtures
  exercise the actual compiled transition imported from the production module,
  not an independently copied key-deletion implementation.
- [ ] Run `corepack pnpm test:tooling` and the web compatibility test; observe RED,
  update phase-specific reports/fixtures to actual transition, rerun GREEN.
  Preserve all six hosted OS/arch acceptance legs and eight fixed installer hashes.
- [ ] Load browser automation skills and run disposable web/server fixtures with
  synthetic auth and seeded stale peers. Inspect admin/mobile and the real voice
  controls at 284/240px; capture absence of peer HTTP/WS and console errors.
  Keep 8px gap/radii and 28×28px buttons, no overflow; record screenshot path.
- [ ] Run web typecheck/full tests/i18n, desktop build:ts/tooling and sequential
  production build; all pass. Native/installed OS gates unavailable here remain
  pending protected CI, not a fabricated local success. Checkpoint W5.
