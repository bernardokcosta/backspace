# Juno integrated interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans inline. Steps use checkbox (`- [ ]`) syntax for tracking. Follow the parent plan's execution approval gate.

**Goal:** Bring the supplied initial/table/victory layouts and a functional space
ranking into Juno without changing call ownership or silently mutating a game.

**Architecture:** Keep `JunoTable` as the native surface rendered by `VoiceGrid`.
Reuse its existing store/controller semantics and factor focused lobby, match,
result, ranking and player-badge views locally; no new global UI mechanism.

**Tech Stack:** Existing React 19, Zustand 5, Tailwind 3, i18next, Vitest/Testing
Library and the existing browser automation tools for acceptance.

**Spec:** [juno-interface](../specs/2026-11-05-juno-upgrade/SPEC-juno-interface.md).

## Global constraints and review focus

Inherit every item from [the parent plan](2026-11-05-juno-upgrade.md).
No code until execution approval. P1–P7 supply authoritative contracts; A1/A2
supply original art. New copy is a task prerequisite, not a broken-key fallback.

## File/responsibility map

- Existing `packages/web/src/api/client.ts`: add `juno.ranking(spaceId, query?)`.
- Existing `packages/web/src/stores/junoStore.ts`: transient scoped ranking read
  with independent request generation, alongside existing private game state.
- Existing `components/games/JunoTable.tsx`: common header/errors/leave confirmation
  and local game/ranking view selection. It remains the `VoiceGrid` entry point.
- New colocated `JunoLobby.tsx`, `JunoMatch.tsx`, `JunoResult.tsx`,
  `JunoRanking.tsx`, `JunoPlayerBadge.tsx`: focused screen/presentation modules.
- Existing `components/games/juno.css`: scoped skin and responsive composition;
  retain tile selectors consumed by picker/mosaic, remove obsolete table rules
  as the corresponding old markup is replaced (not a global CSS redesign).
- All five `src/locales/<lng>/voice.json`: complete localized Juno copy.
- Colocated new tests and existing table/store/picker/mobile/grid tests; existing
  real HTTP/WS acceptance from progression P7; screenshot fixtures are clearly
  identified as controlled UI state, not live-media evidence.

### I1: Localize the approved interface and color names

**Files:** `packages/web/src/locales/{en,pt,de,ru,zh}/voice.json` and
`components/games/JunoTable.test.tsx` where old color-label assertions change;
create `components/games/junoCopy.test.ts` for direct catalog assertions.

- [ ] Add direct catalog assertions for ranking title, total/earned XP, rank/no rank,
  wins/completed-round plurals, empty state, pending credit, abandoned/unranked,
  unsupported older host, pagination and spectator/neutral-result copy. Observe
  RED through focused tests, not by suppressing i18n checking.
- [ ] Reuse existing common retry/back/cancel/loading keys. Define missing
  semantic keys under `voice:juno`, keeping all five catalogs complete. Change
  **display labels only** at `juno.colors.{coral,amber,mint,sky}` to the art's
  red/yellow/green/blue; keep wire enums and rules unchanged. English selection
  tests must expect Green instead of Mint. No Portuguese labels baked into art.
- [ ] Run `pnpm check:i18n` and
  `pnpm --filter @backspace/web exec vitest run src/components/games/junoCopy.test.ts src/components/games/JunoTable.test.tsx`;
  expect GREEN. Continue to A2 before rendering the new colors in the final UI.

### I2: Add origin/account/space-scoped ranking transport and state

**Files:** `packages/web/src/api/{client.ts,client.test.ts}` and
`stores/{junoStore.ts,junoStore.test.ts}`; extend `components/games/JunoSession.tsx`
only where needed for cleanup using its existing owner.

**Consumes:** `JunoRankingPage` from P1 and endpoint from P5.
**Produces:** `ApiClient.juno.ranking(spaceId: string, query?: { limit?: number;
offset?: number }): Promise<JunoRankingPage>` and store methods
`loadRanking(target: JunoRankingTarget, query?: {limit?:number;offset?:number}):
Promise<void>`, `clearRanking(): void`; `JunoRankingTarget` is `{ accountId,
origin, spaceId, selfId }` with string fields.

- [ ] Write API URL/query/auth tests and deferred-response store tests: remote
  origin, same-id/different-space/host, out-of-order pages, logout/room-context
  reset, stale failure after newer success and permission loss. Observe RED.
- [ ] Add nested transient `ranking` state `{target,page,loading,error,unsupported}`;
  use independent read generation and exact target checks, never the private
  hand epoch to accept another space. No new persisted store or automatic POST.
  Clear old private ranking immediately when the target/account changes.
- [ ] Treat a valid old host's missing ranking route (404) as unavailable, not
  an empty successful ranking. 401/403 clears stale data and stays a real access
  failure. Missing optional scoreboard/profile fields must not break gameplay.
- [ ] Ranking refresh is initiated on opening the view and after a newly
  credited round while that view is visible, not on every five-second game poll.
  Preserve `JunoSession` as the single account/origin/voice lifecycle owner.
- [ ] Run `pnpm --filter @backspace/web exec vitest run src/api/client.test.ts src/stores/junoStore.test.ts`;
  expect GREEN, including existing GET/POST-race regression cases.

### I3: Render real profiles and deterministic seat positions

**Files:** new `components/games/{JunoPlayerBadge.tsx,JunoPlayerBadge.test.tsx,
junoSeats.ts,junoSeats.test.ts}`.

**Consumes:** P5 hydrated `JunoPerson`, current host/space context, existing
`Avatar`, `useCanonicalUserView`, `uploadUrlOn` and A2 named decoration URLs.
**Produces:** `JunoPlayerBadge({person, origin, spaceId, active?, self?, detail?})`
and `junoSeats(players: readonly JunoPerson[], selfId?: string)` returning the
four named slots `top`, `left`, `right`, `bottom` with person-or-null values.

- [ ] Test self stays bottom, opponents keep positions across turn changes,
  2/3-player empty slots stay empty, 4-player layout is complete and spectator
  never gets a fabricated self. Observe RED before implementing the seat mapping.
- [ ] Resolve only a provided host profile or an exact same-space/same-origin
  existing row; never copy `useVoiceParticipantMeta`'s broad id-only search into
  a new lookup. Reuse canonical profile/asset utilities and existing Avatar
  fallback; frame it with the supplied passive art. Do not fetch demo profiles.
- [ ] Test nicknames/updated names/avatars, fallback initials, remote upload URL,
  equal ids on another origin, deleted/missing profiles and long translated
  strings. Use `person.name` only as a real server-provided fallback, no fake names.
- [ ] Run `pnpm --filter @backspace/web exec vitest run src/components/games/JunoPlayerBadge.test.tsx src/components/games/junoSeats.test.ts`; expect GREEN and no game
  commands/call changes.

### I4: Show authoritative results and a real space leaderboard

**Files:** new `components/games/{JunoResult.tsx,JunoResult.test.tsx,
JunoRanking.tsx,JunoRanking.test.tsx}`; modify `JunoTable.tsx` and `juno.css`.

**Produces:** `JunoResult()` and `JunoRanking({onBack: () => void})`, consuming
P1 scoreboard, I2 ranking state and I3 badge; no fabricated client standings.
Introduce `JunoTable`'s local `'game' | 'ranking'` selection here, resetting it
with the target context. Both views are functional before adding navigation
from the later cosmic lobby; no temporary missing Ranking screen.

- [ ] Test winner's victory vs neutral loser/spectator result, ties, abandonment,
  no-winner, pending→credited, older response with no scoreboard, host-only
  rematch and return-to-mosaic without leaving. Observe RED.
- [ ] Render crown/medals and round XP from the authoritative scoreboard only.
  A pending award never claims credit; unranked shows zero and true reason;
  an old host shows its existing winner/result without invented XP. Non-hosts
  wait rather than sending a forbidden rematch; pending credit cannot rematch.
- [ ] Test ranking fetch on entry/confirmed result, empty/loading/retry/403/404,
  tied ranks across pages, off-page self and stale context responses. Observe RED.
- [ ] Show the owning space, server-returned rows/ranks/XP/wins/round counts,
  pagination and viewer summary; retain the existing private game store when
  navigating. Use real profiles and the supplied ranking decoration with DOM
  text; no leaderboard assembled from only current players.
- [ ] Run `pnpm --filter @backspace/web exec vitest run src/components/games/JunoResult.test.tsx src/components/games/JunoRanking.test.tsx src/components/games/JunoTable.test.tsx src/stores/junoStore.test.ts`
  and `pnpm check:i18n`; expect GREEN.

### I5: Compose the cosmic initial screen and lobby

**Files:** new `components/games/{JunoLobby.tsx,JunoLobby.test.tsx}`;
modify `JunoTable.tsx`, `JunoTable.test.tsx` and `juno.css`.

**Produces:** `JunoLobby()` reading existing game/target/pending state; `JunoTable`
keeps its public no-props entry point and I4's working game/ranking selection.

- [ ] Test empty initial create, explicit join/full lobby, host start requiring
  two players, waiting non-host, reconnect/pending/error/leave confirmation and
  Mosaic/Ranking navigation without a game mutation. Observe RED.
- [ ] Build the supplied logo/background/buttons composition with real identity
  and contextual create/join/start only. Keep rules functional; no empty menu
  settings, duplicate matchmaking/room-code UI or replaced call controls.
- [ ] Keep common header/errors/leave confirmation and target-scoped selection.
  Reserve safe space/scrolling inside the call tile; the new skin applies only
  under Juno roots. Retain I4's real result/ranking and the existing match until
  I6 replaces it; no TODO/placeholder components or dead menu entry.
- [ ] Run `pnpm --filter @backspace/web exec vitest run src/components/games/JunoLobby.test.tsx src/components/games/JunoTable.test.tsx src/components/games/GamesPicker.test.tsx`; expect GREEN and both Games launchers still
  open the shared list first. No `.glass*`/general theme regression.

### I6: Implement the responsive interactive table

**Files:** new `components/games/{JunoMatch.tsx,JunoMatch.test.tsx}`;
modify `JunoTable.tsx`, `JunoTable.test.tsx` and `juno.css`.

**Consumes:** existing private store state/actions, P1 public fields, I3 seats/
badges and A2 art. **Produces:** `JunoMatch()` for the playing phase, preserving
the same localized control names and commands as the old table.

- [ ] Carry existing draw/pass/wild/announce tests into the new surface and add
  all four positions, current-turn/timer, draw/discard separation, final action
  labels, large hands (including near the deck limit), spectator/no-hand privacy
  and keyboard wild Escape cases. Observe RED.
- [ ] Move the existing interaction state/command guards to this focused match
  view, not another authority. Keep revision-bound wild/Juno choices, no automatic
  action replay and the server-anchored countdown. Opponents use **back only**
  with exact public count and at most 10 decorative card images per opponent.
- [ ] Compose orbit/piles/hand/badges with container-aware horizontal desktop
  and vertical mobile layouts. Card art keeps 720:1056 aspect; viewer hand
  scrolls accessibly, active color has text/symbol cues and short tiles scroll
  internally without covering draw/pass/announce with the call overlay.
- [ ] Scope/cancel transient choice state when the game/revision/target changes.
  Opening ranking or mosaic cancels only local choice, never leaves voice/game.
- [ ] Run `pnpm --filter @backspace/web exec vitest run src/components/games/JunoMatch.test.tsx src/components/games/JunoTable.test.tsx src/components/voice/VoiceGrid.test.tsx src/components/layout/MobileVoiceFullScreen.test.tsx`; expect GREEN.

### I7: Integrate, document and prove the complete experience

**Files:** affected existing `components/{games,voice,layout}` tests only where
integration needs coverage; update `docs/systems/{juno,database,api,voice,
mobile-ui,localization,client-federation}.md` and federation/deletion docs if
their behavior changed. Record evidence in the parent execution ledger.

- [ ] Add any missing integrated Games picker→Juno→Ranking/back cases before
  fixing them. All interaction paths use the connected call target, never a
  separately viewed text/DM/space, and never alter mute/RNNoise/capture ownership.
- [ ] Run the actual UI with clearly controlled fixtures, plus the real P7
  HTTP/WS acceptance. Capture initial, lobby, four-player match, result, ranking,
  spectator and 2-player states at 1280×800 and 390×844; also short 640×360 tiles
  and interface scale 50%/200%. Check every hand/action, name/avatar, image
  request, overflow, keyboard focus/Escape and reduced-motion/transparency state.
- [ ] Run `pnpm typecheck`, `pnpm check:i18n`, `pnpm lint`, `pnpm build` in its
  fixed sequence; server `typecheck:e2e`, desktop `build:ts`, full affected web/
  server suites and identity/migration tests. Budget 600s+ for the web suite on
  this machine. Run `node scripts/check-precache-size.mjs` after build.
- [ ] Confirm all manifest URLs exist in `packages/web/dist/games/juno/`, no
  unnecessary PNG/demo/preview file shipped and no global service-worker policy
  changed. Start API/web dev servers with fresh isolated test DB/uploads and
  random test secret; never use `.env`/runtime `data/`. Stop only own fixtures.
- [ ] Update subsystem specs to match implemented behavior and mark ledgered
  limits honestly: real HTTP/WS is not proof of actual multi-device LiveKit;
  capture failure/native fullscreen gaps must not be called validated.
- [ ] Request the required single GPT final review with the **whole** dirty/staged/
  new-file scope, prior picker work, generated migrations, assets/manifest and
  any external harness paths. Fix concrete findings and rerun affected checks.
  Do not substitute an intermediate review or call a second reviewer flavor.

## Module completion

- [ ] I1–I7 pass and evidence is in the parent ledger. No placeholder UI, fake
  score/profile, unauthorized state retention, unresolved integrity issue or
  undisclosed validation gap; no commit/push/release/deploy performed.
