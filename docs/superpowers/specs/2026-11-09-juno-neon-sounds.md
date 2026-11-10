# Juno neon sound effects

## Goal and decision

Integrate the 16 user-supplied `JUNO_Efeitos_Sonoros_Neon` cues and release
Veyvox 1.17.1. The user authorized autonomous implementation after accepting
reuse of Juno's existing audio/volume controls. No new dependency, audio context,
voice publication, game rule, REST/WS contract or persisted preference is needed.

Extend the existing session-owned memory sound controller to own all Juno short
cues. Reuse AudioManager's buffer cache, output device and master limiter. The
existing transient Juno store exposes the owner's bounded local feedback callback
to the table; do not create an event bus or a second player for UI effects.

## Behavior

- New confirmed move ids select normal play, draw, +2, +4, reverse, skip, wild,
  announcement and successful report cues for everyone following the voice table.
- Start/rematch shuffles; a fresh transition to the local player's turn chimes.
- A newly finished round plays victory/defeat only for participating players with
  a winner, never spectators or a historical result. Terminal snapshots have zero
  remaining turn time: use the observed playing-to-finished transition instead.
- Buttons/summary controls and card selection give local interaction feedback.
  Disabled controls and hover/focus are silent. Server `juno_invalid_move` and a
  local confirmed memory miss use invalid-move feedback; network errors do not.
- A prior explicit announcement is not sounded again when the announced card is
  played. Special-card sounds replace the ordinary play cue. Keep the original
  memory dubbing and music unchanged.
- Gain is `getSfxVolume() * effectsPercent/100 * cueGain`: pack gains are 0.65
  ordinary, 0.70 special, 0.35 interface; memory retains gain 1. Changes apply
  live without replay. Self/space deafen or zero effects cancels pending/playing
  audio. Ordinary microphone mute does not suppress local output.
- Initial reads, polling, reconnect and account/origin/channel/round changes do
  not replay history. Turn-resetting moves require at least 42,000ms remaining;
  this includes every memory miss and draws whose actor is no longer current.
  Playable draws/announce/report use new confirmed ids because those actions do
  not reset the deadline and can legitimately occur late in the same turn.
  loads completing more than 3,000ms after request are discarded. Scope exit,
  loss of snapshot/access or disconnect cancels all sources and pending work.
- Bound simultaneous lanes (move, announcement, turn, result, interface) so rapid
  clicks and overlapping loads cannot accumulate unbounded sources. Audio failure
  never affects game updates.

## Assets and delivery

Copy the original Ogg files unchanged into `public/sounds/juno/`, compatible with
AudioManager's existing `/sounds/${name}.ogg` resolver. Keep supplied provenance,
duration, byte counts and SHA-256 in a pack manifest; quote the supplied license
statement without inventing an SPDX grant. Do not ship duplicate WAV/MP3/previews
or delete the user's Downloads originals.

Document the trigger map and update Juno/sounds specs. Use the repository version
bump script and release-note convention. Validate affected/full tests, build,
lint, clean dev startup and real browser audio/settings. Mandatory final external
Sol review precedes commit/push/tag. Use the existing tag-driven release workflow;
do not bypass its CI/build/installed-acceptance gates.
