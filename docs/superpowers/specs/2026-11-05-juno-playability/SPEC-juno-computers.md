# Spec: juno-computers

## Objective and architectural note

The table host adds/removes up to three built-in computer opponents from empty
lobby seats. One human may start with computers; total capacity remains four.
Existing platform bots are external account programs, not card-playing AI, so
creating accounts/tokens/voice connections would duplicate authority and expose
permissions unnecessarily. Use ephemeral game participants in the existing room,
marked `computer: 1|2|3`, with server-generated ids and no durable user records.

## Contracts

Extend the existing JunoAction with `addBot`, `removeBot {botId}`, `announce`.
Add optional JunoView `supportsBots`, `supportsAnnounce`, `practice`; optional
JunoMove `id` for idempotent presentation. Existing hosts omit capabilities: hide
bot management and retain the legacy play.announce path for the JUNO button.
No new REST route, WS/S2S event, database migration or dependency.

Only the current, authorized human host manages computers, only in the lobby.
Keep revision checks, four-seat cap and actor/voice/space/origin permissions.
Never allow commands as a computer, kicking humans through removeBot, or receiving
a computer's hand by guessing its id. A computer never inherits hosting. Remove
the table when the last human leaves, except existing ranked pending settlements.

Each computer action reuses actInRound and sees only its own hand, current discard,
active color and drawn-card restriction. Choose a legal colored card before a
wild, then a color from its remaining hand; draw/pass using the same rules. Pace
actions through the existing room sweep (900ms minimum; one action per sweep),
without synchronous whole-game loops or independent timers.

Freeze practice eligibility at round start. Any computer means no XP, wins,
completed-round counters or DB writes for anyone. Preserve final competition
places/card counts with zero XP, status unranked and explicit practice labeling.
Removing bots later cannot convert a practice round into ranked play.

## Announcement

With two cards on your own turn, pressing JUNO sends announce immediately. The
server marks it and confirms a public move, without resetting the turn timer.
The next play down to one honors that announcement; draw clears it. The existing
play.announce contract and automatic missed-announcement penalty remain valid.
Reject premature, repeated, stale and out-of-turn announcements.

## Validation and boundaries

Use existing isolated Vitest launcher with explicit files, temporary DB/uploads/
backups only. Test host/stale/capacity/phase, hand privacy, real human departure,
bot-only cleanup, legal draw/wild rules, bounded scheduling, complete practice
round and no settlement callback/SQLite writes. Extend real HTTP/WS acceptance.
Never touch production or the checkout's .env/data for tests. All changes require
final Sol review; no implementation delegation or automatic commit/push.
