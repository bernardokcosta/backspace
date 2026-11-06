# Juno: native voice games

Juno is an original, self-hosted 2–4 player shedding-card game for **space voice
channels**. It works in client-federated spaces through the hosting instance's
existing authenticated connection. DMs and platform bot accounts are not supported.
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
- `packages/web/public/games/juno/`: 54 distinct fronts, one back and separate
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
personal stats/participant rows, retaining the nonpersonal round key. Authorized
reattachment merges existing awards once per round (higher award if both rows
participated), rebuilds totals, then deletes the source stub in the same existing
transaction. Detachment retains the host user id and therefore its progression.

If credit is still pending during an authorized reattachment, the committed merge
emits `juno:account-merged` **only on the application's HTTP-server emitter**, not
on WebSocket or S2S. The existing Juno route redirects that round's private award
recipients after commit; original places/counts remain frozen. Retries consolidate
two merged starters into their higher award with one counter increment, while
still excluding an erased target. Rolled-back merges redirect nothing. This never
transfers a live seat/private hand; the listener is removed with the room owner.

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

Per-account budgets: five creates/minute and 60 commands/minute, in addition to
the unchanged global HTTP address budget. At most 1,000 tables. Lobby/result
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
while keeping static feedback. No sound capture, synthesized voice or new audio
asset is used for a call of JUNO.
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
channel, restart durability and independent space. The progression federation
suite verifies host-issued identities and separate instance totals. SQLite suites
cover rollback/retry, duplicate credits, paging/ties, erasure, merges and upgrades.
It tests real game
HTTP/WS and signaling, **not** LiveKit media or a four-device call. Browser visual
checks use the actual React table with controlled fixture state; they are not
evidence of a live media session. Acceptance details are in the Juno progress
ledger under `docs/superpowers/plans/`.
