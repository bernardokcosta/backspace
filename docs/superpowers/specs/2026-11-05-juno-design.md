# Juno and native voice games

## Intent and scope

Build an original, self-hosted shedding-card game for 2–4 people in a space
voice channel. The user delegated remaining product decisions ("siga direto").
This first release supports space channels, including client-federated spaces,
on web, Electron and mobile. DM calls, bots, rankings, saved games, third-party
games and configurable house rules are not part of this release.

## Approaches and decision

1. Native React table + authoritative Fastify game rooms (chosen): reuse the
   voice mosaic, identity, REST, WS audience, permissions and design system.
2. Embedded external game: rejected; the game must be original and self-hosted.
3. Peer-to-peer game over LiveKit: rejected; a player would hold other hands
   and rule authority, complicating reconnects and fairness.

No dependencies, DB schema or federation relay changes. The channel's host
owns the ephemeral game. Every actor id is that host's authenticated row id;
all client requests route through the channel origin. Runtime data is untouched.

## Experience

The bottom Games button opens the native game surface. A Juno tile appears in
the existing mosaic while a table exists; clicking focuses the interactive
table with participant thumbnails below. Returning to the mosaic does not leave
the match. Lobby shows seats, join/leave, host start, rules and room capacity.
An in-progress game admits spectators but not new players until the next lobby.
After a result the host opens a fresh lobby; no automatic rematch enrollment.

The table emphasizes large original cards, a clear active color/direction,
whose turn it is, draw pile, discard pile, legal-card highlights and an
unobscured scrollable hand. Wild-card color choice is explicit. Leaving a
match is separate from leaving voice. Mobile uses the same table and controls.
All controls work by keyboard/touch, all colors have labels/symbols, animations
respect reduced motion, and feedback/errors are localized in all five languages.

### Visual decisions

Reuse DM Sans and Aether Drift matte panels/glass controls. The memorable
element is a fan of original cards: coral #ec796e, amber #e9bd61, mint #73c8aa,
sky #7daee2, dark ink #20212c, with Backspace primary #7c6cf6 for app actions.
Card artwork is local inline SVG, geometric corner marks and bold numerals,
not UNO branding, downloaded art, decorative gradients or an image-generation
dependency. Table is centered, labels/controls left aligned where applicable.

```
    Juno                     Rules / Mosaic / Leave
           Opponents and hand counts
       [ Draw ]  [ Discard ]     Active color
                 Turn status
       Your hand (horizontal scroll when needed)
    [ Draw / Pass ]             [ Say Juno ]
             Voice participant strip
```

## Rules

108 cards: four colors; one 0, two each 1–9, skip, reverse and +2 per color;
four wilds and four wild +4. Deal seven; first discard is numeric. Match color
or face, or play a wild. +4 is legal only without a card of the active color.
Skip skips the next player; reverse with two players acts as skip. Draw cards
apply immediately and skip the penalized turn; no stacking or +4 challenges.
Draw one voluntarily, then play only the drawn card if legal or pass. No
draw-until-playable. Discard is recycled except its top card.

Say Juno before playing down to one card (an explicit toggle attached to that
play); otherwise automatically draw two. No reaction-speed catching mechanic.
First empty hand wins, including an action-card finish (penalty is applied).
Turns are 45 seconds; expiry draws one if not already drawn and passes. The
client displays remaining time using server-provided remaining duration, not
the difference between the two devices' wall clocks. No possible draw passes
the turn; a full cycle without a possible play/draw ends in a draw.

## State, lifecycle and security contracts

One room per voice channel, at most 1,000 simultaneous rooms. Lobby/result idle
expiry: 15 minutes. Running games have a 2-hour absolute lifetime. Last player
leaving destroys the table; a running game below two players ends without a
winner. Host succession is the first remaining player. Departure during a
round returns that player's cards to the shuffled draw pile and preserves the
correct next turn. The existing 60-second voice reconnect grace preserves the
seat; a completed leave, move, removal or revoked membership/access removes it.
A bounded one-second lifecycle sweep uses existing voice/permission APIs; no
parallel voice ownership or new ConnectionManager hooks.

REST GET/POST `/api/channels/:channelId/juno` require authenticated human space
membership, VIEW_CHANNEL + CONNECT and an open voice-owning socket in that room.
Mute/deafen do not block a silent card game. POST uses a closed command union;
non-create commands require the table id and expected revision. State changes
are synchronous and stale commands are rejected, never replayed. Creation is
limited to 5/minute/user; actions to 60/minute/user. The existing global HTTP
limiter also applies. Each response includes only the viewer's hand, opponent
counts and public table state. Draw order and opponent hands never cross the
wire. `juno_updated {channelId}` is a non-secret invalidation through existing
VIEW_CHANNEL-filtered `sendToChannel`; clients refetch their private projection.
`ready.supportsJuno` gates the entry point per origin on mixed-version peers.

Client state is account/origin/channel scoped, never persisted. Request
generations discard stale fetches after events, room changes, reconnects or
logout. A low-frequency fallback refresh recovers missed events. Minimizing or
navigating away does not mutate game membership. Restarting the host ends games.

## Implementation conventions and acceptance

Use strict TypeScript, existing Fastify JSON schemas, shared wire types and
error codes, Zustand, React and local inline SVG. Shared rules are small pure
functions; authority and randomness stay on the server (`crypto.randomInt`).
Tests live next to game, route and UI/store modules, using existing Vitest and
Testing Library. Never edit migrations, runtime data, suppression baselines or
dependencies to make this work. Any expansion to DMs or persisted state needs
a follow-up design.

Verify deck conservation, every action/special card, wild legality, hand privacy,
stale commands, spectator rules, timeout/recycle/departure/reconnect cleanup,
authentication/membership/permission/origin gates, client request races and
keyboard/mobile interactions. Exercise a real four-client match and capture
desktop/mobile screenshots. Run `pnpm build`, `pnpm lint`, `pnpm check:i18n`,
affected server/web tests, server `typecheck:e2e`, and start both dev servers.
External final review is mandatory; report any blocked validation explicitly.
