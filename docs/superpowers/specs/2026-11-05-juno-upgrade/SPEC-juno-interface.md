# Spec: juno-interface

Status: approved by the user on 2026-11-05. Common conventions and gates are in [README.md](README.md).
Depends on [progression](SPEC-juno-progression.md) and [artwork](SPEC-juno-artwork.md).

## Objective and visual direction

Adapt the provided initial/match/victory compositions to the existing Juno call
surface on desktop, Electron and mobile, with real platform identities and a
functional space-ranking view. Preserve the shared Games picker from the previous
task; all changes remain inside the Juno experience, not the general app theme.

Use the supplied cosmic navy `#060a27`, panel `#090f29`, red `#ff315e`, yellow
`#ffce29`, green `#31e43c`, blue `#1297ff` and cyan `#21c9ff`. These bright game
colors stay scoped to Juno. General app chrome retains Aether Drift and primary
`#7c6cf6`. Use the platform's existing locale-aware typography for functional
text; use the supplied logo rather than a new downloaded display font.

The memorable element is the original cosmic card table, not extra gradients or
ornament invented around it. Keep one approved background throughout; preserve
its four colored edge regions through responsive framing rather than separate
unapproved mobile artwork. Floating dialogs/popovers retain the app glass tiers.

## Screens and behavior

### Initial screen and lobby

Show the supplied logo, local-player identity, brief localized introduction,
contextual create/join/host-start action, rules and the current **space ranking**
entry. Use the supplied button artwork with real localized labels. Do not add
nonfunctional Play Now/Create Room/Join Room duplicates: the current voice
channel is already the room. No matchmaking, new room-code system or settings
placeholders. A real lobby shows all seats and retains explicit join/start.

### Match

Four fixed seat positions: viewer below, opponents above/left/right. Empty seats
are visibly empty for 2–3-player rounds, not fictional people. Use current
Backspace profiles/space display names, canonical identity resolution, existing
Avatar and origin-aware upload handling; never the supplied demo faces/names.
Spectators have no fictional player seat or hand and retain a clear spectator
state. Stable seating must not rotate whenever the active turn changes.

Show opponent back-only fans with authoritative counts, viewer's face-up hand,
central orbit and separate discard/draw pile, active color/direction, turn
indicator/countdown and last public action. Cap decorative back fan density
while keeping exact counts readable for very large hands. Legal cards remain
highlighted and keyboard/touch actionable; keep draw/pass, explicit wild-color
choice and Say Juno behavior. No game-rule or automatic-enrollment changes.

Desktop uses a horizontal table within the actual mosaic/focused tile width;
mobile uses the vertical composition, larger touch controls and a scrollable
hand. Respond to container size and interface zoom, not just window aspect ratio.
Short/narrow call panels must remain usable with contained scrolling: hands,
turn status and actions cannot be hidden behind call controls or player plaques.

### Result

Use the supplied crown/medal elements and an authoritative final score list:
actual names/avatars, shared places, remaining counts where applicable and XP
earned in that round. A normal winner sees victory; others/spectators see a
neutral result, never a false personal victory. No-winner rounds show their real
reason, no podium winner and zero XP. Abandoned starters have no ranked place.
Credit pending/failure is explicit; totals/awards are not optimistically invented.

Keep existing host-only rematch behavior (new lobby, explicit rejoin). Non-hosts
see the waiting state, not an enabled rematch that the server will refuse.
Offer Ranking and Return to mosaic/menu without silently leaving the game or
voice; leaving a match remains a separate confirmed action.

### Space ranking

Show which space owns the ranking, paginated XP standings with real avatars/
names, wins, completed rounds, viewer totals and position. Include a useful zero-
games state plus loading, retry and permission-loss states. Equal XP shares the
server's returned rank. There is no ranking assembled from the current four
players, no local calculation of a missing page and no cross-space aggregation.
Re-read on entry/confirmed settlement; stale responses from a previous account,
space or origin cannot overwrite the current screen. Retain the current table
and hand while navigating inside Juno.

## Accessibility, lifecycle and localization

- Use real buttons, appropriate status/live regions, localized accessible card
  descriptions and visible keyboard focus; art is decorative, not the only cue.
- Distinguish active color by name/symbol as well as color. Maintain contrast
  over the background; support reduced motion/transparency and narrow screens.
- Keep Escape behavior scoped to the nearest picker/dialog so it does not also
  leave call fullscreen or perform a game action. Restore focus appropriately.
- All new text/errors/plurals use the existing five catalogs, with no baked-in
  Portuguese-only labels from the artwork or unconverted UI literals.
- Preserve JunoSession as lifecycle owner and existing origin/capability gates.
  An older host without progression must still support its current game UI,
  with ranking unavailable rather than a fake zero leaderboard or XP claims.
- No new LiveKit room/capture/audio owner. Names, avatar changes, reconnect,
  logout, room changes, removed membership and mobile minimizing use existing
  state/cleanup flows. Never keep another account's hand/ranking on screen.

## Success criteria and tests

Use colocated Vitest/Testing Library tests plus real browser checks. Keep the
existing gameplay/store/picker tests and add cases for every screen and failure.

1. Create/join/start/play/draw/pass/wild/Juno/leave/rematch remain authorized and
   functional; opening Ranking, menu or mosaic never emits an unintended command.
2. Real names/avatars work for local/federated/self/spectator identities and
   missing avatars; a same-id user on another origin is not substituted.
3. Public result awards and cumulative ranking are distinguished, respect ties,
   pending/failure/no-winner/departure and do not leak opponent faces.
4. Loading/errors/empty ranking, pagination/off-page self, stale request races,
   mixed-version hosts and permission/account/origin changes are covered.
5. Browser screenshots cover initial, lobby, four-player match, normal result,
   ranking, spectator and 2-player states at desktop and mobile widths, a short
   mosaic and interface scaling. Confirm hand/button access, no unintended
   horizontal page overflow, readable labels, keyboard flow and asset loading.
6. Production build, localization, lint, affected tests and external final review
   pass; disclose untested native fullscreen or actual multi-device LiveKit.
