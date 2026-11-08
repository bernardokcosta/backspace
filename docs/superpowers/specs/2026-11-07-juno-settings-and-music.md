# Spec: personal Juno settings and focused-view music

## Status and objective

Approved design, based on the supplied screenshot and
`Charting_the_Dark.mp3`. The user approved independent game settings, 100%
initial sliders, a 20% music base gain, device-local preferences, and music only
while Juno is the principal visible view. They explicitly rejected music in the
mosaic, chat or any other screen. Base: released/deployed 1.16.8, commit
`d86101dc08e5ab1409a3be889beeebbed0093f6f`.

Add a small gear beside the Juno logo opening its own settings modal. Let each
person choose Juno's UI language independently of Backspace, see the currently
available Brazilian Portuguese dubbing/card-text edition, and adjust Juno effects
and background music independently. Preserve the current game, voice session,
private-hand masking, permissions, per-origin identity and 1.16.7 recovery fixes.

This phase authorizes design/source implementation and a local interactive preview
after design approval, not another commit, push, release, version bump or deploy.
No application code or supplied asset is changed by this specification.

Implementation and local preview are complete on `feat/juno-settings`. The plan
records verification, the external Sol review and both corrected findings; all
changes remain uncommitted at version 1.16.8, with no publication or deployment.

## Approved behavior and personal defaults

- Header refinement after preview: leave the logo on the left and group all
  header actions on the right (rules, ranking when available, settings, leave
  when seated and mosaic). Use equal circular icon-only controls at every size,
  geometrically centered SVGs, accessible names/tooltips and clear contrast on
  both the dark field and bright artwork. Keep all existing action conditions,
  keyboard behavior and confirmation safeguards. Improve similarly low-contrast
  secondary/close controls within Juno only; no app-wide button redesign.
- The modal has two small groups: language and audio. Reuse the existing shared
  glass Modal, existing input/control styles and Juno typography/palette.
- UI language defaults to `auto`, following the live Backspace language. An
  explicit choice offers the existing five released languages (`en`, `pt`, `de`,
  `ru`, `zh`) and changes Juno only. Returning to Automatic immediately follows
  Backspace again, including later app-language changes.
- Dubbing/card-text edition defaults to `auto`, with an explicit `pt-BR` option.
  User refinement during preview: Automatic dubbing is also required. It
  matches a real edition for the effective game UI language, falling back to
  `pt-BR`. Today every UI language resolves to pt-BR because it is the only
  supplied edition; do not list other unavailable editions.
  Later visual refinement: label this option “Automatic (Backspace)” in each
  existing UI language to match the game-language selector. This copy change
  does not alter edition resolution or manufacture an unavailable edition.
  This controls supplied special-card artwork/text and voice clips independently
  of UI labels. Do not show unavailable editions or manufacture
  translations. An English Juno UI still uses the supplied Portuguese memory
  card and clip until another real edition exists.
- Effects and music sliders each range from 0% to 100%, default to 100%, display
  their current localized percentage and apply immediately. Zero silences only
  that Juno category. Changes never write Backspace's global volume preferences.
- Persist these four preferences on this device/browser, using the existing
  local Zustand persistence pattern, not server/account settings or a migration.
  No identity, hand, game snapshot, music position or voice state is persisted.
  Unknown language/edition and malformed/nonfinite/out-of-range stored volumes
  are normalized safely; unavailable storage leaves usable in-memory defaults.
- User refinement during preview: remove the three explanatory paragraphs about
  personal/device storage, dubbing independence/availability and music visibility/
  comfortable 100%. Keep the modal to headings, labels, selectors and volumes;
  retain exceptional autoplay/error retry feedback when needed. Behavior above
  is unchanged and remains documented here rather than repeated in the menu.

## Music eligibility and lifecycle

The music is local playback for the person viewing Juno, never published into
LiveKit, microphone capture or a stream. It is not synchronized across players.

Play the supplied track in a loop only when all of these hold:

1. The actual full Juno table is mounted as the main focused view, not just its
   tile, `open` flag or an ongoing Juno/voice session.
2. The corresponding authenticated voice/game target is still current and
   connected, including its account, origin, channel and host-issued identity.
3. The document is visible and its application/window has focus. On mobile the
   current top screen must really be `voice-full`, not an underlying retained or
   outgoing animated screen. A different global modal must not cover the game.
4. Self/space deafen is off and the effective music/output gain is nonzero.

The Juno settings modal, its rules and its ranking remain part of Juno's focused
view and do not pause the music. Lobby, playing, result and ranking screens may
play it. A stale retained snapshot alone does not stop music if the actual view
and connection still meet the above conditions; lost access/target does.

Pause immediately on returning to the mosaic, showing another participant or
stream, opening a text/DM view or the mobile chat screen, navigating elsewhere,
hiding the tab, minimizing/backgrounding the app, losing window focus, deafen,
zero volume, disconnect, logout or target change. A connected call, a small Juno
tile, hidden mobile screen or merely remembered `open: true` must never keep it
playing. The rules do not change which special-card effects are heard while
minimized; those keep their existing independent session ownership.

When the same voice/game target becomes eligible again, resume the music from
its in-memory paused position without overlapping sources or replaying special
clips. Account/origin/channel changes dispose that music session/position. Never
create multiple loops through remounts, Strict Mode, repeated settings opens,
resize/mobile transitions or delayed play/load promises. An abandoned asynchronous
start must stay silent even if it resolves after the view was hidden.

Attempt ordinary autoplay only where the browser allows it. A refusal must not
block the game, spam retries/toasts or bypass browser policy. Provide a localized
user-gesture retry/play affordance in Juno settings when necessary. Loading,
decode or output-device failures remain contained and must not send game moves.

## Audio levels and supplied media

The user-approved 100% music control is a normalized comfortable level, not full
system amplitude. Apply `0.20 * (musicPercent / 100) * (outputPercent / 100)`
before the existing master bus/limiter. Juno effects multiply the existing
`getSfxVolume()` by their own percentage. Music is separate from the global SFX
slider, while still obeying global output volume and deafen. Ordinary microphone
mute does not mute local music/effects. Never alter OS volume, device selection,
global SFX/output preferences, compressor or LiveKit tracks.

Slider changes must adjust currently playing audio without restarting the track
or replaying a confirmed card. Retain the memory cue's once-only id handling,
initial-read/reconnect suppression, scope cleanup and bounded freshness behavior.
Zero/deafen cancels pending effects as well as silencing active playback.

Original music asset (read and decoded successfully, not independently heard):

- `C:/Users/berna/Downloads/Charting_the_Dark.mp3`
- 4,363,065 bytes; MP3, stereo 44.1 kHz, approximately 192 kbit/s.
- Duration approximately 181.52 seconds (MP3 duration is bitrate-estimated).
- SHA-256 `5c1d9c0b04da244f5e55d91340b638bc05469352ce7a3d5cb79d5f115f1912bf`.
- Measured decoded mean -14.3 dB, maximum approximately 0 dB; these measurements
  support attenuation, not a claim about subjective comfort or spoken content.

Use the original compressed MP3, untouched, as a locally served game asset;
record source/output identity and provenance alongside existing Juno media.
No unnecessary re-encoding, inferred authorship/license claim or external audio
service. Preserve the original Downloads file and all existing artwork hashes.
Keep the music outside the short system-cue inventory and do not promise offline
music availability. It must not be eagerly downloaded before Juno is eligible.

## Design note: reuse, boundaries and alternatives

This is one cohesive personal-game-settings feature with three internal seams:
validated preferences; scoped presentation/edition selection; view-owned audio.
No separate games/settings service, protocol, database or global audio framework.

- Reuse the shared Modal and current focus/portal pattern (GamesPicker), with
  dialog naming, keyboard focus containment, Escape consumption and focus return
  to the gear. Closing it must never leave the game, close voice fullscreen or
  submit a game command. Current turn/deadline continues behind the dialog.
- Reuse existing catalogs, language definitions and translation loading, but
  scope the selected locale to Juno. Cover table, rules, lobby, match, result,
  ranking, settings and Juno-owned tile labels. Shared Backspace/voice chrome,
  generic Games picker, global dialogs, document language/direction, language
  storage key and desktop language notification must remain app-owned.
- `useFormatters()` currently subscribes to context but returns app-global
  formatters. Reuse `createFormatters` and make context-scoped formatting respect
  the chosen instance, preserving default app behavior. Pass that same scoped
  instance into the existing `describeError` parameter for game errors.
- Keep a minimal real edition-to-media mapping for `pt-BR`, reused by card URLs
  and special clips; future editions add actual assets to that boundary. Do not
  duplicate game faces, rules, engines or server fields for editions.
- Reuse AudioManager's `ensureContext`, `getMasterOutput`, output-device routing
  and limiter, as the existing soundboard already does. Short effects may reuse
  cached buffers with a Juno-owned gain. Keep one music owner in the existing
  Juno lifecycle, driven by actual view presence plus existing navigation state;
  do not create a second independent route/focus store.
- For the three-minute track, use managed media-element streaming connected to
  that existing output bus and a local gain. `playSound` is suitable for short
  cached cues, but fully decoding/caching this 44.1 kHz stereo track would retain
  roughly 64 MB of PCM and makes seeking/resume/live gain unnecessarily awkward.
  No second AudioContext, bypass of the limiter or AudioManager API redesign.
- DOM presence or `open` alone is insufficient: mobile screen transitions may
  retain views, and the table flag can survive navigation to chat. Use the
  actual rendering owner and existing mobile/global-overlay state, not a new
  server signal, interval poller or duplicated navigation mechanism.

## Expected structure, style and commands

Existing owners: `packages/web/src/components/games/{JunoTable,JunoSession,
JunoMemorySound,junoAssets}.tsx`/`.ts`, game CSS/tests; `stores/junoStore.ts` for
ephemeral game state; shared UI Modal; `i18n/{index,formatters,errors,languages}`;
AudioManager and voice/UI/navigation stores. Add only focused Juno preferences,
locale/edition and audio/settings components/helpers where those seams require
them. Do not persist personal preferences inside the resettable private snapshot
store. No server/shared wire-contract change is needed.

Match existing strict TypeScript, typed catalogs and controlled React inputs;
no `any`, placeholders or extra dependencies. For example, volume handling stays
numeric and bounded before reaching a gain, and ordinary game commands continue
as `command({ type: 'play', cardId })`, never as an effect of changing settings.

Full acceptance commands (use the established pnpm wrapper where PATH requires):

```sh
pnpm build
pnpm typecheck
pnpm check:i18n
pnpm lint
pnpm --filter @backspace/server typecheck:e2e
pnpm --filter @backspace/desktop build:ts
pnpm --filter @backspace/web test -- src/components/games/JunoTable.test.tsx
pnpm --filter @backspace/web test -- src/components/games/JunoMemorySound.test.tsx
pnpm --filter @backspace/web test -- src/i18n/formatters.test.ts
```

Add explicit paths for the new preferences/settings/music/locale suites to the
existing isolated test runner. Fixed build order remains shared → server → web.
Read/update `docs/systems/{juno,sounds,localization}.md` with implementation;
update design-system/mobile documentation only if their shared contracts change.

## Verification and success criteria

- Preference defaults/normalization, disabled storage, rehydration and changes
  never overwrite the app-language/SFX/output keys or persist private game data.
- Automatic follows later app changes; explicit language remains independent;
  errors, accessibility labels and number/percentage formatting agree. Switching
  language does not reset the game, open dialogs unexpectedly or alter focus.
- Dubbing offers Automatic and `pt-BR` only; both currently use original pt-BR
  media regardless of interface language.
  Unknown stored editions fall back safely; no unavailable-media request.
- Modal opens from the gear in all game phases; keyboard, focus return, Escape,
  safe-area/portal/fullscreen, reduced motion and short/mobile/scaled layout pass.
- Default gains are 100% controls with 20% music base; current sound/track gains
  change live. Music never changes voice volume/mic state and is never published.
- Music eligibility is tested through actual desktop and mobile view owners:
  main table versus mosaic, chat/DM, other participant/stream, covered or retained
  mobile screen, global modal, hidden tab and blurred/minimized window. Also test
  connection/account/origin changes, mute/deafen/output zero and restoration.
- Fake delayed play/load outcomes, rapid hide/show, remounts/Strict Mode and
  preference changes cannot start hidden music or create overlapping loops.
  Autoplay rejection has a working gesture retry and cannot block game commands.
- Resume position/looping and real streaming/output/gain are checked in a local
  preview with the actual supplied MP3. Inspect desktop/short/mobile/200% captures
  and verify no new external requests, live voice publication or production data.
- Preserve existing masked-hand, confirmed-effect/audio deduplication,
  federation/origin, request-coalescing, cooldown and game/session regressions.
- Run the mandatory complete external Sol implementation review after validation;
  a design-only review does not validate subsequent application changes.

## Boundaries and next gate

Always reuse the existing game/session, output bus, localization catalogs, portal
and preference patterns. Keep browser autoplay rules, current access checks and
data intact. Ask before schema/dependency/protocol changes, publication or deploy.
Never use production runtime data for tests, alter the supplied original files,
make global app-language changes to implement a game-only choice, publish audio
into calls, or claim perceptual listening/multidevice validation not performed.

The user approved this specification and source/preview implementation. Execute
the corresponding implementation plan; no extra product decision is open. The
20% base level remains adjustable through the approved slider. Publication and
deployment still require separate authorization for this feature.
