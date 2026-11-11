# Activity & Presence System

Source files:
- `packages/shared/src/types.ts` — Activity, ActivityType, ActivityTimestamps, ActivityAssets type definitions
- `packages/shared/src/activities.ts` — ACTIVITY_LIMITS, ACTIVITY_PRIORITY, getPrimaryActivity()
- `packages/web/src/stores/activityStore.ts` — Client-side activity state (Zustand), debounced push, visibility toggle
- `packages/web/src/platform/activityBridge.ts` — Electron IPC bridge: subscribes to desktop activity events
- `packages/web/src/hooks/useWebSocket.ts` — Ready payload handling, presence_update reception, reconnect re-push
- `packages/web/src/components/layout/ActivityPanel.tsx` — Friends activity sidebar (DM home view)
- `packages/web/src/components/layout/MemberSidebar.tsx` — Space member list with activity display
- `packages/web/src/components/ui/ActivityCard.tsx` — Activity display component (rows show the details line when the activity carries one; `ActivityDetailCard` is the profile popout's full card with state, elapsed time and assets), accent color helpers
- `packages/web/src/components/ui/UserProfilePopout.tsx` — Profile popout; renders the full activity card via `ActivityDetailCard`
- `packages/web/src/components/modals/settingsPanels/PrivacyPanel.tsx` — showActivity toggle UI
- `packages/server/src/ws/handler.ts` — ConnectionManager (in-memory activity state, rate limiting, disconnect cleanup)
- `packages/server/src/ws/events.ts` — handlePresenceUpdate, handleActivityUpdate, validateActivities
- `packages/server/src/utils/presenceBoot.ts` — boot-time reset of stale native `users.status` rows
- `packages/server/src/routes/users.ts` — REST showActivity toggle with server-side activity clear
- `packages/desktop/src/activityDetector.ts` — Process polling, dictionary + local-source matching, the IPC activity overlay (boundary: see Desktop section)
- `packages/desktop/src/steamGames.ts` — Steam source: library manifests → install dirs (see desktop.md)
- `packages/desktop/src/flatpakGames.ts` — Flatpak source: Game-category apps and their sandbox files dirs
- `packages/desktop/src/gogGames.ts` — GOG source: ~/GOG Games metadata
- `packages/desktop/src/richPresenceIpc.ts` — local rich presence IPC server (see desktop.md)
- `packages/desktop/src/preload.ts` — IPC channel exposure (activity-detected, activities-detected, get-current-activity, get-current-activities)
- `packages/desktop/src/main.ts` — startActivityDetection call, IPC handler registration

---

## Type Definitions

```typescript
// packages/shared/src/types.ts

type ActivityType = 'custom' | 'playing' | 'listening' | 'watching' | 'streaming';

interface ActivityTimestamps {
  start?: number;  // epoch ms
  end?: number;    // epoch ms
}

interface ActivityPlayback {
  positionMs: number;   // transport position, independent of any wall clock
  durationMs?: number;  // absent for live/unknown length
}

interface ActivityAssets {
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

interface Activity {
  type: ActivityType;
  name: string;
  details?: string;
  state?: string;
  timestamps?: ActivityTimestamps;
  playback?: ActivityPlayback;   // media only (listening / watching)
  assets?: ActivityAssets;
  url?: string;
}
```

---

## Field Limits & Validation

### ACTIVITY_LIMITS (`shared/src/activities.ts`)

| Constant | Value |
|----------|-------|
| `MAX_ACTIVITIES_PER_USER` | 5 |
| `MAX_NAME_LENGTH` | 128 |
| `MAX_DETAILS_LENGTH` | 128 |
| `MAX_STATE_LENGTH` | 128 |
| `MAX_ASSET_TEXT_LENGTH` | 128 |
| `MAX_URL_LENGTH` | 512 |

### Server-Side Validation (`ws/presenceEvent.ts:validateActivities()`)

The server validates every incoming native `activity_update` payload before publishing it:

1. Must be an array with at most `MAX_ACTIVITIES_PER_USER` items
2. Each item must be an object with a valid `type` (one of: `custom`, `playing`, `listening`, `watching`, `streaming`)
3. `name` is required, must be a string that is not empty after trimming and within `MAX_NAME_LENGTH`; trimmed on accept
4. Optional fields (`details`, `state`) accepted if string and within length limits; trimmed
5. `url` accepted only if it starts with `https://` or `http://` and is within `MAX_URL_LENGTH`
6. `timestamps.start` and `timestamps.end` accepted if numbers in range `[0, 4102444800000]` (epoch ms cap ~2100)
7. `assets` fields (`largeImage`, `smallImage`) validated against `MAX_URL_LENGTH`; text fields against `MAX_ASSET_TEXT_LENGTH`
8. `playback.positionMs` is kept only when it is a finite number in `[0, 7 days]` (`MAX_PLAYBACK_MS`); `durationMs` only when finite and in `(0, 7 days]`, and then `positionMs` is clamped to it. An invalid `playback` is dropped, not a reason to reject the activity
9. If any item fails validation, the entire payload is rejected (returns `null`)

---

## Activity Priority & Primary Selection

### Priority Ranking (`shared/src/activities.ts`)

| Activity Type | Priority |
|---------------|----------|
| `streaming` | 5 (highest) |
| `playing` | 4 |
| `listening` | 3 |
| `watching` | 2 |
| `custom` | 1 (lowest) |

### `getPrimaryActivity(activities)` Algorithm

Returns the single activity with the highest priority from the array. Uses `Array.reduce` — on ties, the first-encountered activity wins (leftmost in array). Returns `null` for empty arrays.

```typescript
// shared/src/activities.ts
function getPrimaryActivity(activities: Activity[]): Activity | null {
  if (!activities.length) return null;
  return activities.reduce((best, current) =>
    ACTIVITY_PRIORITY[current.type] > ACTIVITY_PRIORITY[best.type] ? current : best
  );
}
```

---

## Presence States

### Status Values

| Status | Meaning |
|--------|---------|
| `online` | Active connection |
| `idle` | User-set idle (no automatic idle detection exists) |
| `dnd` | Do not disturb. Withholds the user's own message and incoming-call alerts (sounds and OS notifications); see sounds.md ("Do Not Disturb") |
| `offline` | No active connections |

### DB Persistence

Two columns (see database.md):

- `users.chosen_status` — what the user picked (`online`/`idle`/`dnd`, default `online`). Never `offline`. Survives disconnects, restarts and the boot reset.
- `users.status` — live presence (default `'offline'`). The chosen status while the user has a connection, `'offline'` without one.

The rules live in `utils/presenceStatus.ts` (pure) and `ws/presence.ts`:

- **On connect:** WebSocket auth writes `status = statusOnConnect(row)` from the retained `chosen_status`, then publishes the same native account/status in `ready` and `presence_update`. REST login alone does not mark a user connected.
- **On manual change:** REST `PATCH /api/users/@me { status }` and the WS `presence_update` client event call `applyChosenStatus`. It persists `chosen_status`; while connected it also updates live status, the in-memory cache and the native profile audience/own sessions. Without a connection only the chosen value changes. `offline` is not a valid choice.
- **On disconnect:** After the existing 5s grace (`finalizeDisconnect`), set live status to `offline` and clear activities; retain the chosen status.
- **On boot:** Reset stale non-deleted native live statuses to `offline`, leaving chosen values unchanged.

### The client's copy of the user's own status

Every retained account owns its native chosen status. `authStore.user` receives
the current socket's own `ready`, user update and presence events; identity
comparisons use the account ID. `selectMyChosenStatus` is the shared read for
Do Not Disturb, ringing, settings and self-status display. `useShownStatus`
substitutes that choice only for the current native user; other roster rows keep
their published status. `authStore.updateProfile({ status })` writes through the
primary API. There is no secondary status authority, old-host cache or resend to
peer sessions. Logout/replacement invalidates old reports.

### Boot Reset (`utils/presenceBoot.ts`)

`users.status` is only flipped back to `'offline'` by `ConnectionManager.finalizeDisconnect()` after a real WS close + 5s grace timer. Those timers live in process memory, so a server restart (deploy, crash, OOM, kill) loses them and any row currently set to `'online'`, `'idle'`, or `'dnd'` stays frozen at that value forever — making the user appear permanently online to friends and space co-members until they next connect.

`resetStalePresenceOnBoot()` runs once during server boot in `index.ts`, after `getDb()`/`seedDatabase()` and before WebSocket route registration. It sets `status = 'offline'` on every row that passes three guards:

1. **Native live state belongs to this process.** No retained account's presence is projected from another server.
2. **`is_deleted = 0`** — tombstoned users are excluded from presence broadcasts already; their stored status is left alone as a maintenance courtesy (no behavioral effect either way, but avoids silent rewrites).
3. **`status != 'offline'`** — keeps the operation a no-op once steady-state is reached; `changes` is logged only when non-zero.

The candidate rows (guards 2 and 3) are selected in SQL. No provenance lookup or remote projection is consulted.

Because the in-memory `ConnectionManager` is empty at boot by construction, no live connection can be misrepresented by this reset.

### Connect/Disconnect Flow

1. **Server boot** → `resetStalePresenceOnBoot()` flips non-deleted live statuses to `offline`, retaining chosen values.
2. **Auth succeeds** → `status` set from `chosen_status` in DB → native `presence_update` to friends + DM members + space co-members via `collectProfileBroadcastTargetIds`.
3. **Last socket closes** → 5-second grace period (`scheduleDisconnect`) to allow tab refresh/reconnect.
4. **Grace period expires** → `finalizeDisconnect` sets live status to `offline`, clears in-memory activities and broadcasts to the native profile audience.
5. **Reconnect during grace** → `cancelDisconnect` prevents offline broadcast; new connection proceeds normally.

### Presence Broadcast Scope

A `presence_update` about a user goes to that user's **profile audience**: `collectProfileBroadcastTargetIds(userId)` (`utils/userDeletion.ts`), the same set `user_updated` uses. That is every co-member of every space the user is in, every co-member of every DM they are in, and every friend, never the user themselves. Each recipient gets it through `connectionManager.sendToUser()`, one send per user id, reaching all of that user's connections. There is no per-space broadcast (`sendToSpace` is not used for presence), so a recipient who shares several spaces with the user gets the event once.

Every emitter builds the event with `presenceUpdateFor` / `presenceUpdateEvent` (`ws/presenceEvent.ts`) and sends it to that audience:

| Trigger | Where | Also to the user's own connections |
|---------|-------|------------------------------------|
| Status change (REST or WS) | `applyChosenStatus` (`ws/presence.ts`) | yes |
| `activity_update` | `handleActivityUpdate` (`ws/events.ts`) | yes |
| `showActivity` turned off | `PATCH /api/users/@me` (`routes/users.ts`), `activities: []` | yes |
| Connect | WS auth (`ws/handler.ts`) | no |
| Disconnect after the grace period | `finalizeDisconnect` (`ws/handler.ts`), `offline` with `activities: []` | no (none left) |

The one targeted send is the friendship snapshot (`sendPresenceSnapshot`, below): the new friend only.

---

## Activity Lifecycle

Activities are **ephemeral** — stored only in server memory (`ConnectionManager.userActivities: Map<string, Activity[]>`), never persisted to the database. The publishing socket/account owns the entry; disconnect or disabling activity sharing clears it. No remote server projects activities into this map.

### Data Flow: Detection to Display

```
Desktop Process Scanner (15s poll)
  → IPC 'activities-detected' (list; 'activity-detected' for older web clients) → preload bridge
    → activityBridge.ts → activityStore.pushActivities()
      → 5s debounce (500ms when an activity carries `playback`; an empty list is sent at once) → wsSendAll('activity_update')
        → Server validates, rate-limits (3s; removing a published activity is exempt)
          → Stores in ConnectionManager.userActivities
            → Sends 'presence_update' to the user's profile audience (see Presence Broadcast Scope)
              → Client useWebSocket handler
                → activityStore.setUserActivities()
                  → UI re-renders (ActivityCard, MemberSidebar, ActivityPanel)
```

### Server-Side In-Memory State (`ws/handler.ts:ConnectionManager`)

| Map | Key | Value | Lifecycle |
|-----|-----|-------|-----------|
| `userActivities` | userId | `Activity[]` | Native account: set on validated `activity_update`, cleared on publisher disconnect or `showActivity=false` |
| `userShowActivity` | userId | boolean | Cached from DB at auth, updated via REST `PATCH /users/me` |
| `userStatuses` | userId | string | Cached from DB at auth, updated on `presence_update` |
| `lastActivityUpdate` | userId | timestamp (ms) | Used for 3s rate limiting |
| `activityObservedAt` | userId | timestamp (ms) | When the held `userActivities` were last set; `getUserActivities` advances every `playback.positionMs` by the time elapsed since (`projectActivityPlayback`, capped at `durationMs`), so a `ready` payload built later shows the current point, not the one last reported |
| `activityWs` | userId | `WebSocket` | The socket that published the held activities. When that socket closes (the desktop app quit) the activities are cleared and `presence_update` goes out with `[]`, even if the user's other sockets (web) stay connected |

### Rate Limiting

Two independent throttling mechanisms prevent activity spam:

| Layer | Mechanism | Interval | Location |
|-------|-----------|----------|----------|
| Client | Debounce timer in `activityStore.pushActivities()` | 5 seconds | `activityStore.ts:72` |
| Server | `checkActivityRateLimit()` — rejects if `< 3000ms` since last update | 3 seconds | `ws/handler.ts:349-355` |

The client debounce is a trailing-edge timer: each new `pushActivities()` call resets the timer, and only the final state is sent. The delay is 5 seconds for games (a scan can briefly report one process with different metadata) and 500 ms (`MEDIA_ACTIVITY_PUSH_DELAY_MS`) when any activity carries `playback`, so a track change appears promptly. A call that leaves no effective activity (music paused, sharing off) cancels the timer and sends `activity_update` with `[]` immediately, bumping `pushSeq` so an icon upload in flight cannot send afterwards.

The server rate limit is a hard gate: updates arriving within 3s of the last accepted update are rejected with an error message. The exception is an update that publishes fewer activities than the server holds (`checkActivityRateLimit(userId, removingPublishedActivities)`): without it a pause right after a track change was dropped and the old "listening" state stayed on other clients.

### Ready Payload — Initial Activity Snapshot

On WebSocket auth, `buildReadyPayload()` constructs a `userActivities` map for visible native users: space members, DM members and **friends** (a friend may share neither a space nor a DM with the user). Keys are native account IDs, with no companion projected-identity map.

`snapshotActivities(live, customStatus)` (`ws/presenceEvent.ts`) picks each entry: the user's live activities, else a synthetic `custom` activity from `customStatus`. The friendship snapshot (below) uses the same function.

This synthetic injection only occurs in snapshots (ready, friendship), not in live `presence_update` broadcasts.

### Friendship Snapshot

Presence events fire only on change, so a friend who was already in a game when the friendship formed would otherwise show no activity until it changed. When native request acceptance inserts the friendship, `exchangeFriendPresence(a, b)` (`ws/presence.ts`) provides a best-effort current snapshot without changing the transaction's success:

1. sends each side's sessions a `presence_update` about the other with its current status and snapshot activities (`sendPresenceSnapshot`; an offline subject reports none);

### Reconnect Re-Push

After receiving a `ready` event, the client performs two re-push operations (`useWebSocket.ts:217-236`):

1. **Electron re-query:** On desktop, calls the existing bridge's `getCurrentActivity()` and pushes the result. This handles sleep/wake scenarios where the process scanner did not fire a change event.

2. **Native re-push:** Republishes effective activities through the current socket, scoped to its account/session generation. There is no secondary connection fan-out.

---

## Visibility Control (`showActivity`)

### DB Column

`users.showActivity` — integer, NOT NULL, default `1`. See database.md.

### Toggle Flow

1. User toggles in Privacy panel → `api.users.update({ showActivity: enabled })` (REST PATCH)
2. Server persists `showActivity` to DB (`routes/users.ts:324`)
3. Server updates `ConnectionManager.userShowActivity` cache (`routes/users.ts:357`)
4. If toggled **off**, server immediately:
   - Clears `ConnectionManager.userActivities` for the user
   - Sends `presence_update` with `activities: []` to the user's profile audience (see Presence Broadcast Scope)
   - Sends same to user's own connections
5. Client calls `activityStore.setShowActivity(enabled)` (`PrivacyPanel.tsx:73`)
6. If toggled **off**, client immediately:
   - Cancels any pending debounce timer
   - Sends `activity_update` with `activities: []` to all connected instances via `wsSendAll`
   - Sets `myActivities` to `null`

### Server-Side Guard

When `showActivity` is false, the server silently drops incoming `activity_update` events (`ws/events.ts:505`):

```typescript
function handleActivityUpdate(event, userId) {
  if (!connectionManager.getUserShowActivity(userId)) return;
  // ...
}
```

### Client-Side Guard

`activityStore.pushActivities()` checks `showActivity` and returns early if false (`activityStore.ts:69`).

---

## Desktop Activity Detection (Boundary)

This spec covers how detected activities enter the broadcast pipeline. The detection internals (process scanning, dictionary matching, local game sources, dictionary sync, the rich presence IPC server) live in `desktop.md` → Activity Detection, Local Game Sources and Rich Presence IPC Server.

Detection combines three sources:

1. **Process scanning** — a curated process-name dictionary (`games.json`, synced from the repo) plus local install metadata for Steam, Flatpak and GOG games, so any installed title is detectable even when unlisted. The dictionary wins on conflicts; sources fill the gaps. Polled every 15s.
2. **Rich presence IPC pushes** — games speaking the rich presence IPC protocol (osu!lazer & co.) push rich activities to the desktop's IPC server: details, state, absolute timestamps and art. Applied immediately as an overlay over the scan result; the last push wins.
3. **Media detection** (`mediaDetector/`, `desktop.md` → Media Detection) — what is actually playing, read from the OS media session (Windows SMTC, Linux MPRIS, macOS Spotify / Apple Music notifications). Yields one `listening` (or `watching`, for video) activity with `playback`, a canonical track `url` (`sanitizeTrackUrl`, an allow-list of music services) and the player name in `assets.smallText`. A *running* media player found by the process scan (`type: listening | watching` in `games.json`) is **not** an activity by itself: `main.ts` drops those and only media detection can publish one, so a player idling in the tray shows nothing. Sessions from this app itself are never reported (`isOwnAppSession`: our AppUserModelId + document title would otherwise surface any in-app audible element — e.g. while screen sharing — as "Backspace Fork" music), and remote camera tiles render muted since all voice audio flows through the Web Audio pipeline.

The effective list sent to the renderer is process activities (minus listening/watching) followed by the media activity, so games keep their place at the front.

**Playback and clock skew.** `playback.positionMs` is a position, not a time of day. The sender anchors `timestamps.start`/`end` to its own clock for local display; every receiving client re-anchors the position to *its* clock on receipt (`activityStore.anchorActivityPlayback`: keeps an existing timeline when the new position is within 2s of it or is `0`, a stale snapshot some browsers repeat, otherwise starts a new one at `now - positionMs`). Remote progress therefore does not jump when the two devices' clocks differ. Receivers that predate `playback` ignore it and use `timestamps`.

### Game preferences (`utils/gameOverrides.ts`, `ActivityGameSection`)

The player has a say over the games shown as playing (Settings → Privacy, under the activity toggle; web and desktop alike). Everything below is remembered by this client (`backspace_game_overrides`) and the server sees ordinary `playing` activities:

- **Created manually.** A list of games rich presence missed (at most 30). On the desktop an entry is tied to a running program: the player picks one from `list-running-programs` (their own non-system processes; a Wine program under its Windows name) and names the game. The renderer hands the tied entries `[{ name, process }]` to the detector (`set-manual-game-bindings`, in memory; `initActivityBridge` and every change resend them; a desktop from before the list gets the first one through `set-manual-game-binding`), and the detector reports each game, with its own start time and icon lookup, only while a process matching `process` runs: `detectActivitiesWithInfo` lists them first and claims every process they match, so the dictionary and the stores do not list the same game again. An entry without a program (a browser sees no processes) is added by this client and shown until removed. A previous single manual game is migrated into the list on load. A listed game can be renamed (`renameManualGame`): the program stays, the hidden and order keys follow the new name, and the desktop gets the new bindings; a blank, unchanged or already used name is refused.
- **Hide.** A game can be hidden by name key: still detected (it stays in the settings list so it can be shown again), never sent.
- **Order.** The player's priority order of games, by name key (↑/↓ buttons or dragging a row by its left handle in settings (the row is the drag source, as in `RoleOrderList`, and only a press on the handle arms it; while dragging, the window's `dragover`/`drop` pick the row nearest to the pointer's height, so a game can be pulled just up or down without aiming at a row); HTML5 drag-and-drop does not work on touch screens, where the buttons remain). Games the order does not list come after the listed ones. The first game sent is what the member and friend lists and the profile popout lead with. The full profile (`ProfileGamesList`) lists every game with its icon (`assets.largeImage`, http(s) only), time and details. A game without an icon, or whose icon failed to load, gets a drawn placeholder so the names stay aligned; it is never cached or uploaded, and the lookup is tried again on the next launch (misses live in memory only).
- **Rename.** A detected game can be shown under another name, remembered by detected name (case-insensitive, at most 200, oldest dropped). Applies to `playing` activities only.

Order in `pushActivities`: detected → manual games → hidden-game removal → player ordering → five-game cap → icon lookup by detected name → renames → send. Hidden/reordered games match detected names, never renamed labels. Overrides stay in profile-local `backspace_game_overrides`, cleared on sign-in/out; the native server sees ordinary `playing` activities with no wire change.

### Game icons

The activity card shows an icon for the detected game. Icons never come from a third-party art service: the desktop extracts them from the player's own machine — Steam's `appcache/librarycache` (by app id), Flatpak's exported hicolor icons, GOG's `support/icon.png`, an AppImage mount's `.DirIcon` (the pushing process's `/proc/<pid>/exe` leads there), and `.desktop` entries resolved through the hicolor theme directories (`gameIcons.ts`). A game installed through Lutris or Bottles may have an icon its launcher keeps (`lutris_<slug>.png`, the bottle's `icons/<name>.png`). A game running under Wine (Sleepy Launcher, Bottles, Heroic, Proton without a Steam icon) has none of these, so the icon is read out of its own `.exe`: the detector passes the Windows program names and the process's working directory, `gameIcons.ts` finds the file there (exact name, then ignoring case) and `peIcon.ts` reads its `RT_GROUP_ICON` / `RT_ICON` resources (the largest image under the size limit; PNG frames as stored, DIB frames converted to PNG). The PE parser reads bounded ranges, never trusts offsets, and answers null on anything malformed. A game the dictionary matched, or one the player typed, is looked up in the Steam, Flatpak and GOG indexes too — by its running executable, then by a display name equal to the store's, ignoring case — so a dictionary entry for a Steam game still gets its library-cache icon. The icon is warmed in the background when a game is matched, and the renderer picks it up through the `get-game-icon` IPC, uploads it to the user's own instance (`POST /api/game-icons`, uploads.md §15) and caches the instance URL by game name, so every later activity for that game carries the URL without another upload. The protocol's Discord asset keys are dropped at normalization; only http(s) art a game pushes as a full URL passes through.

The extractor reads only regular files of at most 512 KiB (a `stat` first, then a read bounded to that size; the same limit as the server's `MAX_GAME_ICON_BYTES`) and never the game's own executable. A `.desktop` entry is matched when its `Exec=` runs the same program as the game's executable (`execProgramName`: `env` and its assignments skipped, directory dropped, compared whole) or its `Name=` equals the game's display name. A host program (java, wine, python, mono, sh, steam, ...) never matches by `Exec=`, since every game it hosts has that executable name: such a game matches by name only. The store clears the push in flight when sharing is switched off (`pushSeq`), so an icon upload that was running cannot send the activity afterwards.

### Summary of Detection Interface

| Component | Role |
|-----------|------|
| `activityDetector.ts:startActivityDetection(callback)` | Starts 15s polling loop; calls `callback` with the effective `Activity \| null` on change |
| `activityDetector.ts:applyIpcActivity(push \| null)` | Overlays an IPC push immediately; `null` falls back to the scan |
| `activityDetector.ts:nextScanActivity(matched, previous, now)` | The scan layer's activity per poll; returns `previous` while the same game runs, so `timestamps.start` (the elapsed clock) is stable |
| `activityDetector.ts:resolveIpcGameName(pid)` | Display name for an unnamed push, from the dictionary via the pushing pid |
| `activityDetector.ts:getCurrentActivity()` | Returns the effective `Activity \| null` (IPC push ?? scan, synchronous) |
| `richPresenceIpc.ts:startRichPresenceIpcServer({ onActivity })` | Binds the ten protocol sockets and feeds pushes to `applyIpcActivity` |
| `gameIcons.ts:warmGameIcon(target)` / `warmGameIconForIpc(name, pid)` | Extract the detected game's icon locally in the background (Steam cache, Flatpak, GOG, AppImage, .desktop) and cache it by game name |
| `gameIcons.ts:resolveGameIcon(name)` | The icon for a game name, served to the renderer over the `get-game-icon` IPC; waits for a lookup in flight and starts one for a name nothing warmed |
| `main.ts` → renderer → `POST /api/game-icons` | The renderer uploads the extracted bytes to the user's own instance and attaches the returned URL to the activity's `assets.largeImage` (cached per game name) |
| `main.ts` | Starts detection and the IPC server on app ready; forwards changes via IPC `activities-detected` (the full list) and `activity-detected` (the first activity, only when it changes, for web clients that predate the list); registers `get-current-activity` and `get-current-activities`; stops both in `before-quit` |
| `preload.ts` | Exposes `onActivitiesDetected` / `getCurrentActivities` and, for older web clients, `onActivityDetected` / `getCurrentActivity` to renderer |

### Bridge to Activity Store

`activityBridge.ts` is initialized once in `AppLayout` via `useEffect`:

1. Calls `initActivityBridge()` → subscribes to `window.backspace.onActivitiesDetected` when the desktop has it, otherwise to `onActivityDetected` (never both: a new desktop would push the same state twice)
2. On change: calls `pushActivities(list)`; an older desktop's single activity becomes a one-item list, null becomes `[]` (`toActivityList`)
3. On init: also queries `getCurrentActivities()` (or `getCurrentActivity()`) for immediate state; the reconnect re-push in `useWebSocket` uses the same `fetchCurrentActivities()`

Several games at once travel as several `playing` activities (the server accepts up to five). Wine programs no detected game owns are offered in settings (`get-unknown-wine-programs`, "Add to my games" adds that program to the manual list with one click). The member and friend lists show the first game and "+N" for the others, text only. The profile popout shows the first game with "+N", and the full profile (About tab, "Playing now") lists every game as a row with its own running time.
4. Cleanup: `teardownActivityBridge()` removes the IPC listener

---

## Client-Side State: `activityStore` (Zustand)

### State Shape

```typescript
interface ActivityState {
  userActivities: Map<string, Activity[]>;  // All users' activities, keyed by userKey (never a raw row id)
  activityWriters: Map<string, string>;     // userKey → origin whose delivery set that entry last
  originRows: Map<string, Map<string, PresenceSubject>>; // origin → (row id → subject), older servers' ready rows only
  showActivity: boolean;                     // Current user's visibility preference
  myActivities: Activity[] | null;           // Current user's own activities as sent: manual game and renames applied
  detectedActivities: Activity[];            // What the machine detected, before the player's own choices
  manualGames: ManualGame[];                 // Games the player added by hand; { name, process | null }
  hiddenGames: string[];                     // Name keys not to show
  gameOrder: string[];                       // Name keys in the player's priority order
  gameRenames: Record<string, string>;       // Detected name (lowercased) → name the player wants shown
}
```

### Key Methods

| Method | Behavior |
|--------|----------|
| `setUserActivities(subject, origin, activities)` | Updates the entry at `userKey(subject, origin)` and records `origin` as its writer; deletes both if empty array |
| `clearUserActivities(subject, origin)` | Removes that entry and its writer |
| `initActivities(entries, origin, coveredRows?)` | A `ready` is the origin's snapshot: removes the entries whose writer is `origin`, then sets the snapshot's entries (`readyActivityEntries`) with `origin` as writer. Entries another origin set last are left to that origin. A current server's snapshot covers everyone it reports on (space and DM members and friends), so all its entries are replaced (`coveredRows` null). An older server's covered only the space and DM members its `ready` lists (`readyRowIndex`, passed as `coveredRows`), so only those rows' entries are replaced; a friend it reports on only live keeps what it last reported |
| `setOriginRows(origin, rows)` | Keeps the rows an older server's `ready` listed (`readyRowIndex`), or drops them (`null`, a current server) |
| `setShowActivity(show)` | Sets flag; if `false`: cancels debounce, sends empty `activity_update` via `wsSendAll`, clears `myActivities` |
| `pushActivities(activities)` | Records `activities` as `detectedActivities`; guards on `showActivity`; sets `myActivities` (manual game and renames applied) immediately; starts/resets 5s debounce timer; on fire: sends `activity_update` via `wsSendAll` |
| `addManualGame(name, process?)` / `removeManualGame(name)` | Edit the manual list (sanitized, replaced by name), persist, resend the desktop bindings, republish |
| `setGameHidden(name, hidden)` / `setGameOrder(keys)` | Hide a game / set the priority order; persist, republish |
| `setGameRename(detectedName, chosen \| null)` | Remembers the name to show for a detected game (null restores it), persists, republishes |
| `republish()` | Pushes `detectedActivities` again when something is, or was, shown; used after a choice changes, when sharing is switched on and on connect (a manual game stands even with nothing detected) |
| `reset()` | Cancels timer, clears all state and the persisted choices (sign-in/sign-out) |

### Keying

Presence, activity and canonical user views are keyed by native account ID.
The current socket's `presence_update` and `ready.userActivities` update those
same keys in social/member/activity stores; readers use the same native ID.
No hostname comparison, projected identity, per-origin roster fallback or
old-server identity compatibility lookup remains. Session reset clears cached
views and invalidates old asynchronous activity work.

### Module-Level State

The 5s debounce timer is stored as a module-level `let pushTimer` variable (not in Zustand state), ensuring it survives React re-renders but is properly cleared on `reset()` or `setShowActivity(false)`.

---

## Activity Display Components

### ActivityCard (`ui/ActivityCard.tsx`)

Renders the primary activity for a user. Used inside both `ActivityPanel` and `MemberSidebar`.

**Props:** `{ activities: Activity[], fallbackCustomStatus?: string | null }`

**Rendering logic:**
1. Get primary activity via `getPrimaryActivity(activities)`
2. If no primary and `fallbackCustomStatus` exists → render custom status as plain text
3. If primary is `custom` → render `primary.name` as plain text
4. If primary is rich (non-custom) → render `primary.name` + elapsed time (if `timestamps.start` set)

**Art:** rendered by `ActivityArtwork`, which owns the load state of both images. An image that fails to load is dropped, a badge left without its large image is promoted to the full-size image, and with nothing left the frame is not rendered (no empty box). A failure is remembered per URL, so a new URL is tried.

**Elapsed time format** (`formatElapsed`): `"Xh Ym"` if hours > 0, otherwise `"Xm"`.

**Media rows.** A `listening` activity renders as a music card: artwork, title, artist, a progress bar from `timestamps.start/end` and, when `url` is set, an "Open" link. A shared `useNowTick` drives the clocks. The player name (`assets.smallText`) is shown through `formatPlayerName` (NetEase, QQ Music, KuGou, Kuwo, Spotify, Apple Music, Yandex Music, localized). The rich row of a member expands and collapses with the `activity-card-expand` grid-rows transition (`0fr` → `1fr`, `globals.css`; opacity only under `prefers-reduced-motion`) and keeps a constant border width so the row does not jump.

### ProfileActivities (`ui/ProfileActivities.tsx`)

The activity block at the top of the full profile's About tab and the profile popout, replacing the old "Playing now" list. It shows the custom status (unless the profile shows its own), then one card per non-custom activity ordered by `ACTIVITY_PRIORITY` (streaming, playing, watching, listening): music cards for `listening`, process cards headed "Playing a Game" / "Watching" / "Streaming" for the rest, each with its own timer, art and link. Art goes through `ActivityArtwork` (no empty box on a failed load) and `AppIcon` draws a placeholder per app type. Only `playing` activities get a game icon looked up and uploaded (`GAME_ICON_TYPES` in `activityStore`); media art comes from the player.

### MediaSetupHint (`ui/MediaSetupHint.tsx`)

A one-time Windows hint: NetEase Cloud Music is running with a track title in its window but has published no SMTC session, so nothing can be detected until its "Windows media controls" option is enabled. The desktop reports it over `get-media-setup-hint` / `media-setup-hint`; the hint is dismissible for the app run (`sessionStorage`) or permanently (`localStorage`, `backspace_netease_smtc_hint_dismissed`).

### Helper Functions (exported from `ActivityCard.tsx`)

| Function | Returns | Purpose |
|----------|---------|---------|
| `getActivityAccentClass(type)` | Tailwind border class | Left-border accent color for glass pill rows |
| `hasRichActivity(activities)` | boolean | True if primary activity is non-custom |

### Accent Colors by Activity Type

| Type | Border Class | Color |
|------|-------------|-------|
| `playing` | `border-l-accent-mint` | Mint |
| `listening` | `border-l-accent-sky` | Sky |
| `watching` | `border-l-accent-lavender` | Lavender |
| `streaming` | `border-l-accent-rose` | Rose |
| `custom` | (none) | No accent |

### Row Rendering Pattern

Both `ActivityPanel` and `MemberSidebar` use the same row rendering logic:
- **Rich activity** (non-custom primary): `glass-pill` container with `border-l-2` accent + rounded corners (10px)
- **No rich activity**: Standard flat row with hover state

---

## ActivityPanel (`layout/ActivityPanel.tsx`)

Displayed in the DM home view (right sidebar, 240px wide). Shows friends grouped by activity status.

### Friend Categorization

Friends are sorted into three groups using `useMemo`:

| Group | Criteria | Display |
|-------|----------|---------|
| `activeFriends` | Not offline AND primary activity is non-custom | Shown first, no header |
| `onlineFriends` | Not offline AND (no primary OR primary is custom) | Header: "ONLINE -- {count}" |
| `offlineFriends` | Status is `offline` | Header: "OFFLINE -- {count}" |

### User ID Resolution

Activities are read with `activitiesFor(userActivities, friend, friend._instanceOrigin)`; see "Keying" under `activityStore`.

### Empty State

When all three groups are empty, displays: "It's quiet for now..." with explanatory text.

---

## MemberSidebar (`layout/MemberSidebar.tsx`)

Displayed in space views (right sidebar, 240px wide). Shows space members grouped by role, with activity display.

### Activity Integration

Activities are read with `activitiesFor(userActivities, member.user, spaceOrigin)` (the space's `_instanceOrigin`); see "Keying". Each member row renders an `ActivityCard` with `fallbackCustomStatus` from `member.user.customStatus`. Offline members do not display activities.

### Role Grouping

Members are grouped by highest-positioned role (see `getMemberGroup`). The owner always sorts first. Activity display is orthogonal to role grouping.

---

## WebSocket Events (Cross-Reference)

See websocket.md for full wire format. Summary of activity-related events:

### Client to Server

| Event | Fields | Notes |
|-------|--------|-------|
| `presence_update` | `status: 'online' \| 'idle' \| 'dnd'` | Persisted as the chosen status (`applyChosenStatus`) |
| `activity_update` | `activities: Activity[]` | Rate-limited 3s server-side (an update that removes a published activity is exempt); rejected if `showActivity=false` |

### Server to Client

| Event | Fields | Scope |
|-------|--------|-------|
| `presence_update` | `userId, status, activities?` | Friends + DM co-members + space co-members + self |

Note: `activities` absent means unchanged; an empty array clears. Every emitter builds native account events with `presenceUpdateFor`/`presenceUpdateEvent` (`ws/presenceEvent.ts`). Both status and activity changes result in outbound `presence_update` events to authorized clients.

### Ready Payload

The `ready` event includes `userActivities: Record<userId, Activity[]>` for visible native users (space members + DM members + friends), with synthetic `custom` activities for users with a custom status but no ephemeral activities.
