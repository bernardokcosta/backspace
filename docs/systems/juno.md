# Juno: native voice games

Juno is an original, self-hosted 2–4 player shedding-card game for **space voice
channels**. It works in client-federated spaces through the hosting instance's
existing authenticated connection. DMs, bots, ranking and persistence are not
supported. No external game, card pack, image service or new dependency is used.

## Ownership and files

- `packages/shared/src/juno.ts`: public cards, command/snapshot contracts and
  legal-card highlighting helper. It contains no hidden match state.
- `packages/server/src/games/juno.ts`: authoritative rules and ephemeral rooms.
- `packages/server/src/routes/juno.ts`: authenticated transport, limits, audience
  and one-second lifecycle sweep; disposed on Fastify close.
- `packages/web/src/stores/junoStore.ts`: account/origin/channel-scoped state,
  revision and request-generation guards, pending-action/error handling.
- `packages/web/src/components/games/`: session lifecycle, table, tile, Games
  button, original inline SVG artwork and container-responsive styling.

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

Before playing down to one card, check **Say Juno**. Forgetting automatically
draws two: there is no reaction-speed penalty/catching mechanic. First empty
hand wins. The draw pile recycles the discard except its top card. If a complete
cycle cannot draw or play anything, the round ends in a draw.

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
result and **only the viewer's hand**. Spectators receive `hand: []`. Neither the
draw order nor opponent hands are serialized. Cards use opaque random ids.

POST accepts `{type:'create'}` or a command with `gameId` and expected `revision`:
`join`, `leave`, `start`, `rematch`, `draw`, `pass`, or `play` (`cardId`, optional
wild `color`, optional `announce`). Schemas bound ids, revisions, colors and
payload size (2 KiB). All state changes are synchronous; stale commands get 409
`juno_stale`, never an automatic mutation retry. Only the host starts/rematches;
a new lobby keeps only that host, requiring everyone else to join explicitly.
Late joiners can spectate a running/finished round but cannot take a seat.

After changes, `juno_updated {channelId}` travels through existing
VIEW_CHANNEL-filtered `sendToChannel`. This is a non-secret invalidation, not a
private hand broadcast. Only clients in that voice session fetch their private
view; other channel viewers ignore it. Action replies update the actor directly.
The client rejects old request generations, old revisions and responses for
previous accounts/rooms. Five-second visible-page refresh and visibility resume
recover missed invalidations. `ready.supportsJuno` gates support per origin;
reconnect ready invalidates the previous snapshot, including after server restart.
Logout and voice room changes discard private client state. Nothing is persisted.

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
table; server restart loses all tables.

**Games** in the desktop/mobile call controls opens Juno. While a table exists,
the shared voice mosaic includes its native tile; focusing it shows the table
with the existing participant strip. Returning to the mosaic is not leaving the
game. Leaving a game asks for confirmation and never disconnects voice. Wild
color choice is explicit, keyboard reachable and canceled by Escape. Legal cards
are highlighted, colors have distinct shape marks and names, the hand scrolls
horizontally, and the table scrolls vertically when the call view is short.
Container queries adapt to the actual table width, including interface scaling.
Original coral/amber/mint/sky SVG cards use no UNO artwork or marks. Copy and
stable `juno_*` errors ship in all five languages under voice/errors catalogs.

## Validation

Engine tests include special cards, draw/pass, announcement, deck recycle,
conservation across randomized rounds, private projections, stale commands,
capacity, host succession and timeout/departure/idle cleanup. Route tests cover
auth, membership, permissions, live voice, bots and schema refusals. Store/UI
tests cover origin routing, response races, reset, concurrent submissions,
spectators, wild selection and minimizing without leaving.

`test/juno-e2e.test.ts` boots the actual server against unique temporary storage,
opens five authenticated WS voice sessions, and plays a complete four-player
round with a spectator while checking private-hand isolation. It tests real game
HTTP/WS and signaling, **not** LiveKit media or a four-device call. Browser visual
checks use the actual React table with controlled fixture state; they are not
evidence of a live media session. Acceptance details are in the Juno progress
ledger under `docs/superpowers/plans/`.
