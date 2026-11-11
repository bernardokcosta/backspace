# Juno: native voice games

Juno is an original, self-hosted 2–4 player shedding-card game for **space voice
channels**. It uses the selected native server's authenticated connection.
DMs and platform bot accounts are not supported.
The host can add built-in computer opponents for practice. Active tables
are ephemeral; completed-round XP is durable and belongs to its hosting space.
Supplied original artwork is served locally; no external game/image service or
new dependency is used.

## Ownership and files

- `packages/shared/src/juno.ts`: public cards, command/snapshot contracts and
  legal-card highlighting helper. It contains no hidden match state.
- `packages/server/src/games/juno.ts`: authoritative rules and ephemeral rooms.
- `junoStandings.ts` / `junoProgression.ts`: pure placements, atomic XP awards,
  ranking, current sanitized profiles and proof-authorized account merges.
- `packages/server/src/routes/juno.ts`: authenticated transport, limits, audience
  and one-second lifecycle sweep; disposed on Fastify close.
- `packages/web/src/stores/junoStore.ts`: account/origin/channel-scoped state,
  revision and request-generation guards, pending-action/error handling.
- `packages/web/src/components/games/`: session lifecycle, table, tile, Games
  button, focused lobby/match/result/ranking views and container-responsive styling.
- `stores/junoPreferences.ts`: validated device-local game-only UI/dubbing and
  volume preferences. `JunoLocale` scopes existing catalogs to Juno; `JunoSettings`
  reuses the shared modal. `JunoMusic` and `audio/junoMusic.ts` own focused-only
  streamed music on the existing output bus.
- `packages/web/public/games/juno/`: 55 distinct fronts, one back and separate
  cosmic UI assets; hashes/source entries in `manifest.json`, provenance in README.

## Rules

The 108-card deck has four colors, one zero and two of each 1–9, skip, reverse
and +2 per color, plus four wilds and four wild +4s. The server shuffles with
`crypto.randomInt`, deals seven, and starts on a numeric discard. Match the
active color or face; a wild chooses the next color. A +4 is legal only if the
hand has no card of the active color. No stacking or +4 challenges.

Skip skips the next turn. Reverse changes direction and skips the opponent in
a two-player game. +2/+4 immediately draw for the next player, who loses their
turn; final-card penalties still apply before recording victory. A voluntary
draw offers only that drawn card if legal, otherwise passes immediately. There
is no draw-until-playable. A player may pass after drawing a playable card.

With two cards on your turn, press the **JUNO** logo button before playing down to
one. The server confirms the call without extending the timer; drawing clears it.
Forgetting opens a **ten-second report window** starting with the play down to
one; it never draws automatically. Another seated human may report outside their
own turn: the first valid report draws two without moving the turn or resetting
its timer. At exactly ten seconds a report is late, even between sweep ticks.
Without a report there is no penalty. Computers never report automatically;
spectators and the accused cannot report. Gaining cards, leaving or ending the
round closes the opportunity; separate misses have different ids and multiple
players can have independent windows. Late JUNO calls do not repair a miss.
First empty hand still wins immediately, closing all windows; reports never
reopen a result or change frozen XP. The draw pile recycles the discard except
its top card. If a complete
cycle cannot draw or play anything, the round ends in a draw.

### Rare memory card

Capable cohorts use 109 cards: the classic 108 plus exactly one `memory` card
(supplied Alzheimer artwork). It plays over any face/color without choosing or
changing the active color and cannot be the numeric initial discard. The next
player in the current direction receives `memoryCurse: {id,targetUserId}`.
Only that player's hand, middle pile and active color are concealed.

The affected player selects an owned opaque slot blind. A matching color or
legal wild clears the curse and plays normally, including skip/reverse/draw/JUNO/
victory effects; a blind wild retains the active color. +4 still requires no
active-color card in hand. A wrong choice retains the attempted private card,
draws up to two, clears the curse and passes once. `lastMove.type: memory_miss`
contains only actor, actual amount and confirmed id, not the attempted card.
Ordinary draw/pass are refused during the curse. The same 45-second deadline
draws two/passes on expiry; no automatic mutation retry. Invalid/unowned ids,
stale revisions and out-of-turn requests never become extra penalties.

Two-card JUNO calls and independent valid reports remain available; reports do
not clear the curse or reset the turn timer. An affected player leaving clears
it without transferring it; ending/expiring the round also clears it. A last-card
memory play wins normally without cursing a finished round. Cursed computers
choose a fair random opaque slot; their selector cannot receive faces or color.
Practice/XP/settlement rules are unchanged.

## Space XP and ranking

At start, the room freezes its starter roster and round UUID. On `emptyHand`,
the winner is first and the other finishers rank by remaining count **after**
final-card draw penalties. Places 1–4 award 120/80/40/20 XP. Ties share place/XP
with competition ranks (`1,2,2,4`); abandoned starters have no place or XP, and do
not reserve a rank. Spectators never receive awards. Only eligible finishers
increment completed rounds; only the winner increments wins. `playersLeft`,
`stalemate` and `expired` never award or increment counters.

The room freezes the result before departure cleanup. One immediate SQLite
transaction inserts the unique round marker/participant awards and increments
space totals arithmetically. Repeated settlement returns stored awards, without
another increment. A failure retains the same pending proposal for one-second
retries, even after the last person leaves; rematch stays blocked until resolved.
Pending UI never claims earned XP. A crash can lose an unconfirmed ephemeral
result, but not a committed credit. No hands, draw order or profile snapshots are
persisted. Generated migration `0048_nasty_kinsey_walden` adds the three Juno tables.

XP combines all channels in one space, never other spaces/instances. Channel
deletion sets the history channel FK to null; space deletion cascades history and
totals. Leaving/kicking hides the member without deleting their progression;
rejoining the same account restores visibility. `tombstoneUser` explicitly erases
personal stats/participant rows, retaining the nonpersonal round key. Native
accounts keep their original IDs and progression through the standalone upgrade.
The retired identity-merge transaction, event listener and pending-award redirects
are removed. Each frozen starter receives only their own award; retries retain
the original winner and placements and never recreate erased accounts.

`GET /api/spaces/:spaceId/juno/ranking?limit=25&offset=0` requires a current human,
non-deleted, non-banned member, not voice presence. Limit is 1–50; offset is an
integer 0–1,000,000. The response is `JunoRankingPage`: `spaceId`, pagination,
`total`, current sanitized profile/nickname rows and an independent `me` summary
even off-page. Only members with credited completed rounds occupy rows. Equal
total XP shares SQL `rank()` before pagination; wins descending then user id
stabilize ties without changing rank. No-games self has rank null and zero totals.
Responses are no-store and expose no channel participation history.

Turns last 45 seconds. Expiry draws one and passes, or only passes if the player
already drew. Responses carry `remainingMs`; the client anchors it to its local
receipt time so client/server clock skew does not affect the countdown. The
server alone decides expiry and checks it before commands as well as in its tick.

## Transport and privacy

GET and POST `/api/channels/:channelId/juno` require a valid account, actual space
membership, VIEW_CHANNEL and CONNECT, the same current voice room and an open
voice-owning socket. Bots are refused. Self/moderator mute and deafen do not
block a silent card game. Actor identity is the authenticated row on the channel's
instance, never a client-supplied user or home id. Replies use `Cache-Control:
no-store`.

GET returns `{revision, game}`. A game view contains phase, host, public player
names/counts, top card, color, direction, turn, remaining time, last public move,
result and **only the viewer's hand**. Optional `scoreboard` has the round id,
`pending|credited|unranked` status and final standings (`place`, count, XP, outcome).
Human people include current sanitized profiles and space nicknames, not demo identities.
Spectators receive `hand: []`. Neither the
draw order nor opponent hands are serialized. Cards use opaque random ids.

State/command clients declare `?memory=1`; only this optional query is accepted,
with exact value `1` (duplicates/unknown keys are invalid). Snapshots advertise
root `supportsMemory: true`. Seated humans refresh their declaration in the lobby;
at start every human must support it to freeze `memoryEnabled: true`. Computers
support it internally. Mixed/legacy cohorts keep the unchanged 108-card deck;
later declarations cannot change an active deck. Rematch creates a fresh lobby.
Older hosts ignore the query; ranking URLs are unchanged. GET query variants
share the same existing 600/minute/address read budget.

Enhanced-round viewers without support receive 409 `juno_update_required` with
no view, even if omitting the query or spectating. Normal authentication/access
gates run before compatibility. Existing `leave` remains allowed. A masked
viewer receives `hand: []`, `maskedHand: {id}[]` in stable hand order and null
`topCard`, `color`, `drawnCardId`. Other viewers retain ordinary projections;
computer hands are never returned. Client update-required errors clear cached
private state, and old unmasked reads cannot replace a newer masked revision.
The rule does not erase previously seen cards or prevent memory/collusion.

POST accepts `{type:'create'}` or a command with `gameId` and expected `revision`:
`join`, `leave`, `start`, `rematch`, `draw`, `pass`, `announce`, `addBot`, `removeBot`
(`botId` required), or `play` (`cardId`, optional
wild `color`, optional `announce`), plus `report` (`targetUserId`, `opportunityId`
required). The reporter is the authenticated host-instance identity, never a
submitted id. Optional `supportsReports` gates this action; `reportOpportunities`
contain public `id`, `targetUserId` and server-derived `remainingMs` only. Expected
revision and the unique miss id reject stale/duplicate reports; no mutation is
retried automatically. Confirmed `lastMove.type: 'report'` names reporter `userId`,
accused `targetUserId` and actual drawn `amount` (existing deck scarcity rules
apply). Schemas bound ids, revisions, colors and
payload size (2 KiB). All state changes are synchronous; stale commands get 409
`juno_stale`, never an automatic mutation retry. Only the host starts/rematches;
a new lobby keeps only that host, requiring everyone else to join explicitly.
Late joiners can spectate a running/finished round but cannot take a seat.

### Built-in computer opponents

`supportsBots` and `supportsAnnounce` are optional per-view capability flags.
Computer seats are ephemeral `computer: 1|2|3` people with server-generated ids,
not platform accounts, voice seats or external AI. Only the human host may add/
remove them, only in the lobby; capacity remains four. An absent capability on an
old host hides bot management; the JUNO button uses legacy play.announce there.
Current human auth/voice/permissions and revision gates are unchanged.
On older hosts without `supportsReports`, clients hide reporting and show that
host's legacy automatic-penalty rule. Reports do not change computer decisions,
private-hand projection, practice eligibility or settlement.

The existing one-second room sweep paces computers (at least 900ms, at most one
action per sweep), reusing the ordinary engine. Their strategy receives only
their hand, public top/color and own drawn-card restriction, never other hands or
draw order. Computer ids can neither submit human commands nor read their hand.
Only humans can inherit hosting; the last human leaving removes the table.

Any computer starter freezes `practice: true`. Results keep placements/counts but
zero XP and unranked status for everybody, without invoking persistence or adding
wins/completed-round counters. Human-only progression is unchanged. The separate
settlement boundary also refuses to credit computer proposals defensively.

After changes, `juno_updated {channelId}` travels through existing
VIEW_CHANNEL-filtered `sendToChannel`. This is a non-secret invalidation, not a
private hand broadcast. Only clients in that voice session fetch their private
view; other channel viewers ignore it. Action replies update the actor directly.
The client rejects old request generations, old revisions and responses for
previous accounts/rooms. Five-second visible-page refresh and visibility resume
recover missed invalidations. `ready.supportsJuno` gates support per origin;
reconnect ready invalidates the previous snapshot, including after server restart.
Logout and voice room changes discard private client state. Ranking reads are
separately account/origin/space scoped, generation guarded and refreshed on entry
or confirmed settlement. Permission loss clears cached ranking. An old host's
404 means unavailable, not a fabricated empty ranking or earned XP.

State reads are single-flight per session. Invalidations received during a read
collapse into one trailing refresh; concurrent polls reuse the in-flight read.
A transient HTTP/network error retains the last confirmed table and hand, with
mutation controls disabled until a successful refresh. A current 401/403/404 still
clears inaccessible private state. A 429 respects the existing numeric Retry-After:
polls, invalidations, manual retries, ranking reads and commands pause until the
deadline, then one state refresh runs. Failed commands are never replayed. Account,
origin, channel changes and reconnect-ready invalidate reads and cancel recovery.

Per-account budgets: five creates/minute and 60 commands/minute, in addition to
the unchanged global HTTP address budget. State GETs instead use a separate bounded
600/minute/address route budget, so four players plus four spectators behind one
NAT can follow 60 moves/minute and their 12 fallback polls each (576 reads) without
spending the ordinary HTTP budget. Auth, voice and permission gates are unchanged;
ranking and POST command routes retain their existing limits. At most 1,000 tables. Lobby/result
idle expiry is 15 minutes; a running round has an absolute two-hour limit.

## Voice lifecycle and UI

The registry reuses current voice rooms and permission checks; it does not own
a second voice state. A short signaling disconnect retains the seat through the
existing 60-second grace. Leaving/moving/disconnection past grace or revoked
membership/VIEW_CHANNEL/CONNECT removes the player on the next sweep or read/action.
Their cards return to the shuffled draw pile, and turn order is preserved in
both directions. The first remaining player inherits hosting. Below two players
a running round finishes without a winner. The last player leaving removes the
table, except a pending settlement retained for retry; server restart loses active
tables, not committed XP.

**Games** in the voice sidebar, desktop mosaic controls and mobile call controls
opens the same glass game picker (currently Juno only), not the table directly.
Opening/canceling the picker never creates/joins/leaves a game or changes the
focused participant/table. Choosing Juno opens its existing lobby/table in the
connected voice channel, even when viewing another text channel or DM; on mobile
it uses the existing `voice-full` screen without duplicating the top stack entry.
The picker validates account, origin, channel, per-origin identity and connection
before selection and dismisses if that context changes. It contains keyboard
focus, returns focus to the launcher on close, and consumes Escape without exiting
the voice fullscreen view. It reuses the shared Modal fullscreen portal.
While a table exists,
the shared voice mosaic includes its native tile; focusing it shows the table
with the existing participant strip. Returning to the mosaic is not leaving the
game. Leaving a game asks for confirmation and never disconnects voice. Wild
color choice is explicit, keyboard reachable and canceled by Escape. Legal cards
are highlighted. Active color/direction have accessible names and tooltips.
The hand scrolls horizontally; lobby, game and result fit the actual call mosaic
without vertical scrolling. Size-container queries adapt to width AND height,
including interface scaling, the real MainContent/MobileVoiceFullScreen chrome
and participant strip. Very short focused games compact/hide the strip without
changing voice state; ranking/rules scroll only in their own bounded panels.
Avatar and aura share one center/geometry, overriding image max-width shrinkage.
Active-player halo, next-player marker and timer replace narrative turn hints;
screen-reader announcements remain. Empty seats use a plus action rather than
visible placeholder text. Host clicks add/remove computers directly in the lobby.
The supplied 720:1056 card art maps coral/amber/mint/sky to red/yellow/green/blue
without changing wire enums or card ids. Opponent fans show only backs (at most
10 images; the exact count stays visible). The single cosmic background keeps
all four colored corners on narrow screens. Localized real buttons retain rounded
green/cyan gradients, borders and focus/disabled states without depending on
background artwork loading. The game palette is scoped to Juno, not app chrome.
Stable optional lastMove.id keys drive short confirmed play/draw/special/JUNO
effects; polls and initial mounts do not replay them. The JUNO logo flies from
the actual announcing avatar center, using interface-scale-aware geometry.
Effects are pointer-transparent and expire; reduced motion removes travel/pulsing
while keeping static feedback. Confirmed JUNO announcements use the supplied
neon cue, never sound capture or synthesized voice (see sounds.md).
The memory curse uses identical neutral fog placeholders, not CSS-blurred fronts:
no face URLs, color labels or legality highlights remain in the affected hand.
All slots have localized “hidden card N” labels and equal selection behavior;
draw/pass are disabled/hidden. A brief violet/cyan arrival settles into static
fog, with no geometry changes; reduced motion skips arrival. Confirmed misses
show localized actual-amount feedback without exposing the selected card.
`JunoSounds`, owned once by `JunoSession` even while minimized, plays the supplied
16 neon effects and original `juno_memory.ogg` for confirmed moves (see sounds.md).
It reuses the existing effects slider/global SFX gain and output device; local
selection/button/error/turn cues never alter commands or notify opponents. Initial
reads, same-id polls and reconnect do not replay history; victory/defeat apply
only to a live finish for seated players. Source lanes and pending loads are
bounded and canceled on silence, scope/access loss or disconnect.
No LiveKit/microphone publication or additional audio bus is involved.
The settings gear beside the logo opens personal controls in every phase. UI
language defaults to Automatic (following Veyvox); an explicit choice affects
only Juno table/tile/rules/results/ranking/settings and their formatting/errors.
It does not change app chrome, HTML language, desktop language or app preference.
Dubbing/card text separately defaults to Automatic and resolves against real
editions for that UI language, falling back to pt-BR. Only pt-BR is supplied, so
both Automatic and explicit Portuguese use the original memory artwork/clip for
every interface language. `JUNO_DUBBINGS` is the single actual-edition boundary.

`backspace-juno-preferences` persists just language, dubbing choice and two
0–100 volumes; default controls are 100%. Invalid values normalize safely and
blocked storage leaves in-memory controls usable. These settings never mutate
game commands, voice preferences or private snapshots. The modal contains only
headings/labels/controls (the user removed explanatory paragraphs), with an
exceptional music retry when browser/output failure needs a gesture. It traps
keyboard focus, consumes Escape and returns focus to the gear without changing
the game/fullscreen state. Turns continue while it is open.

Music is the unchanged user-supplied `music/charting-the-dark.mp3`, streamed
through AudioManager's existing output/limiter, not the short-cue buffer cache.
It loops only while the actual full table is the main visible, focused view.
Intersection-observed, token-owned view leases live in the existing transient
Juno store, not a second navigation store; mobile additionally exposes the real
settled top-screen visibility from MobileScreenStack. Mosaic tiles, chat/DM,
other focused media, covered/animating mobile screens, global modals, hidden/
blurred/minimized windows, zero volume, deafen, disconnect/access loss and scope
changes pause it. The game's own settings, rules and ranking remain eligible.
The independently owned soundboard, screen-share setup and incoming-call overlays
also pause it, even when `ui.activeModal` is empty; their existing stores are
observed directly without introducing a shared overlay registry.
Returning to the same voice target resumes its in-memory position with one loop;
account/origin/channel exit disposes media and position. Ordinary microphone mute
does not suppress local playback. Nothing is published into voice or streams.

Music gain is `0.20 * musicPercent/100 * outputPercent/100` before the master
bus; music does not use the global SFX slider. Effects gain multiplies the
existing `getSfxVolume()` by the local effects percentage. Both change live
without replay/restart, and zero/deafen cancels pending effects. The music player
keeps delayed starts at zero gain until revalidated and contains output/autoplay
failure. A suspended pre-gesture context displays a retry rather than hanging
silently on resume. No forced autoplay, OS volume or global audio-setting change.
After a media-resource error, gesture retry invokes `load()` on the same routed
element before playing, invalidating pending starts so a transient HTTP failure
can recover without a second stream or hidden playback.
Eligible opponent seats add a separate accessible hammer report button, never
replace the real profile action. Its striking base aligns with the avatar center;
the target and remaining deadline remain accessible without a visible countdown.
Disconnected/pending/expired controls are disabled; the server remains the deadline
authority. Persistent seat anchors and fixed fan space keep cards, avatars, piles
and the own hand stationary across opportunities, confirmations and effect cleanup.
Cards are never temporarily hidden by a report effect; existing responsive hiding
in compact layouts remains. Confirmed positive-amount reports replay the supplied
transparent hammer and a short flash/ring/12 particles above the accused seat,
without a card flight or central +2 overlay. Only new confirmed ids animate; the
report effect expires after 1.05 seconds and is hidden with reduced motion. Exact
counts and the localized confirmation naming both players/actual amount remain.
Compact height-aware rows retain reachable controls without pausing the game.
Winner-only victory, neutral other-player results, pending credit and space
ranking compose inside the same table. Ranking/back/mosaic never send game moves.
Copy and
stable `juno_*` errors ship in all five languages under voice/errors catalogs.

## Validation

Engine tests include special cards, draw/pass, announcement, deck recycle,
conservation across randomized rounds, private projections, stale commands,
capacity, host succession and timeout/departure/idle cleanup. Route tests cover
auth, membership, permissions, live voice, bots and schema refusals. Store/UI
tests cover origin routing, response races, reset, concurrent submissions,
spectators, wild selection, minimizing without leaving and picker navigation,
session invalidation, focus/keyboard behavior and side-effect-free cancellation.
Reporting tests cover no automatic draw, 9,999/10,000ms boundaries without ticks,
out-of-turn/self/spectator/computer reports, concurrent/old ids, multiple windows,
conservation/recycling, unchanged turn/drawn restrictions, departure/immediate
victory/XP stability, receipt-anchored countdowns and older hosts.

`test/juno-e2e.test.ts` boots the actual server against unique temporary storage,
opens five authenticated WS voice sessions, and plays a complete four-player
round with a spectator while checking private-hand isolation, then a second voice
channel, restart durability and independent space. Native progression suites
verify authenticated identities and separate space totals. SQLite suites cover
rollback/retry, duplicate credits, paging/ties, erasure and upgrades.
It tests real game
HTTP/WS and signaling, **not** LiveKit media or a four-device call. Browser visual
checks use the actual React table with controlled fixture state; they are not
evidence of a live media session. Acceptance details are in the Juno progress
ledger under `docs/superpowers/plans/`.
## Temporary refusal

Action/create refusals retain `rate_limited` and report actual remaining
`retryAfter` seconds/`Retry-After`; quota values are unchanged. Ordinary read
quotas are verified-account scoped, separate from early address flood admission.
