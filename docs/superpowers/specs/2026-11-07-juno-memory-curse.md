# Spec: Juno memory curse card

## Status, objective and authority

Approved design and defaults, followed by user authorization to implement and
prepare a playable preview on 2026-11-07. Implementation is uncommitted on
`feat/juno-memory-card`. After the accepted preview, the user separately
authorized commit/push/release and then VM deployment; see the plan's 1.16.8
publication phase. Earlier source-only constraints describe that initial phase.
Base: 1.16.7, commit
`184ebd885b9fc55fbc21ac06fc20fd47752fc950`.

Add one rare, original special card to Juno. It can be played over any face/color
and preserves the current active color. The next player, in the current direction,
must attempt a play without seeing their hand or the active color. A successful
attempt restores ordinary play. A failed attempt keeps the selected card in the
hand, draws two and passes the turn; the curse ends. The latter rule and one-copy
rarity were explicitly confirmed by the user.

## Approved defaults

- Exactly one copy is added to supported rounds: 109 cards rather than 108.
- The supplied audio plays once for the table when the special card is confirmed,
  not only for the affected person. Existing SFX volume/output/deafen controls win.
- During the curse, ordinary draw/pass cannot bypass the blind attempt. The
  existing 45-second deadline remains; expiry resolves as a failed attempt.
- A normal wild remains legal; +4 retains its existing restriction. For a blind
  wild, the engine retains the current color instead of introducing a second
  reveal/choice phase. Other successfully played special effects work normally.
- An affected player leaving clears the curse rather than transferring it. A
  finished/expired round never retains an active curse. Playing the rare card as
  the last card can win normally; the sound can play but no next turn is obscured.
- Unsupported clients/hosts use the classic deck rather than receiving a card or
  private-hand representation they cannot render safely.

## Design note: reuse and alternatives

Extend the existing authoritative engine, private snapshot projection, revision
checks, scoped store, Juno table and AudioManager. No second game service,
independent timer loop, database schema, global capability framework or dependency.

A CSS-only blur is simpler but insufficient: current card images, accessible
labels, active-color marker and legal-card highlights reveal the answer. Keeping
the ordinary rule that rejects an incompatible play would also fail to apply the
agreed penalty. The selected approach is therefore server-owned curse state plus
a redacted affected-player view, with a cosmetic veil over neutral placeholders.
This is an implementation recommendation, not a claim that the user selected an
internal protocol design.

## Authoritative rules

- Use the existing shuffle, deal, recycle, turn direction and room lifetime.
  The special card cannot be the initial numeric discard. It requires no chosen
  color and cannot change the inherited color, even if an actor submits one.
- Playing it normally discards it, then curses the actual next player. Other
  people, spectators and the author keep their normal views.
- A blind attempt names one opaque id currently owned by the affected player.
  The server, not the client, checks compatibility with the retained active
  color. A normal matching-color card or legal wild succeeds. Number matching
  against the card underneath the special card does not bypass this color test.
- Success discards the chosen card, clears the curse and applies ordinary
  skip/reverse/draw/victory/JUNO/report rules. Failure leaves that card private and
  in the hand, draws up to two using existing deck-scarcity rules, clears the
  curse and advances once. Never expose the failed card to other players.
- Expiry applies the same bounded draw-two/pass once. Invalid/unowned ids,
  out-of-turn actors, stale revisions and duplicate requests are still refused
  without an additional penalty. Never retry a mutation automatically.
- Announcing JUNO remains available when the affected hand has two cards. A
  separate valid missed-JUNO report can add cards without ending the curse or
  resetting its turn timer. Gaining cards still cancels its report opportunity.
- Computers obey the same rules. Their blind decision receives opaque slot ids,
  not hidden faces, the retained color, other hands or the draw pile. Reuse the
  existing bot pacing and engine, with a fair random slot choice while cursed.
- Preserve practice/unranked behavior, durable settlement, account/origin identity,
  permissions, voice grace and the 1.16.7 request-coalescing/cooldown protections.

## Private projection and compatibility

Extend only Juno's existing HTTP contract, keeping authentication and permission
checks before compatibility or room information is returned.

- Use a Juno-local optional request capability (`memory=1` query parameter on
  state/command requests), not a new header, endpoint or WS event. Current 1.16.7
  state/command handlers ignore this query on an older host; ranking requests are
  unchanged. Advertise support as an optional snapshot capability.
- Remember declarations only for seated humans in the existing ephemeral table;
  refresh lobby declarations from authorized requests. Freeze the deck choice at
  start: enable the special card only when every seated human declared support.
  Bots support it internally. A mixed/legacy lobby starts an unchanged 108-card
  round. A later update cannot insert/remove cards in an active round.
- A client without the capability cannot receive an active enhanced round's new
  shape or bypass redaction by omitting the query: return a coded update-required
  response with no private view. Leaving through the existing command remains
  possible. Joining as an unsupported spectator must not alter the frozen round.
  Downgrading mid-round requires updating again, not a fabricated legacy hand.
- For the affected viewer, `hand` is empty; a separate optional masked-hand list
  exposes only owned opaque slot ids in stable order. `color`, `topCard` and any
  drawn-card hint are hidden. No alternate field, error detail, image URL, title,
  accessible label or legal-card marker reveals a concealed face/color.
- Other viewers retain their existing projections and never receive another
  person's hand. Public curse/confirmed-move identifiers permit deduplicated
  feedback without exposing the inherited color to the victim.
- Preserve cached-state/race protections: an older unmasked response cannot
  replace a newer masked one; account/channel changes and access loss erase
  private state. A temporary failure retains the current masked view.

The effect does not erase information a player already saw or prevent remembering
positions, voice hints or deliberate collusion. Its guarantee is to stop sending
new hidden information and remove ordinary UI clues during the affected turn.

## Presentation and audio

Keep the actual voice mosaic, card/seat geometry, DM Sans and scoped Juno palette.
Use one brief violet/cyan nebula sweep, then a quiet static veil over the affected
hand and middle pile. Neutral card placeholders share identical appearance; all
owned slots are equally selectable during a permitted blind attempt. Keep focus,
keyboard activation and meaningful localized "hidden card N" names, without
revealing faces. Hide color/legality hints rather than merely blurring text.

Local effect tokens: deep fog `#171035`, violet `#a78bfa`, cyan `#67e8f9`, pearl
`#eee9ff`; existing brand/buttons and four game colors remain unchanged. Fade/blur
must not move controls or obscure unrelated players. Reduced motion keeps a
static masked state and outcome feedback without travel or repeated particles.

Reuse the single Juno session lifecycle for one-shot sound ownership, including
while the table is minimized. Use the existing AudioManager/output limiter and
SFX preference, not LiveKit publication, microphone capture or a new audio bus.
Mark confirmed ids as seen; initial mount, polling, focus, retry and reconnect do
not replay old audio. Stop a pending/playing clip on account/room exit and ignore
stale asynchronous loads. Audio/autoplay/decode failure must never block a move.

## Supplied assets and provenance

- `Carta cósmica da memória nebulosa.png`: 1060×1484, 2,064,112 bytes,
  SHA-256 `3c8c19c8ff6a0d4a234645993ce35aac5289d12b83eb06135e24a09b97be2f09`.
- `hf_20261107_042622_ad7a3a7a-cf99-44a5-a4f0-10ae662cee54.wav`: PCM 16-bit,
  stereo 24 kHz, approximately 2.79 seconds, 267,592 bytes, SHA-256
  `77980fab39415557371636d3bd81c27d6fc3ad7f3361d325bc42eac022584240`.

Use the supplied artwork, without generating a replacement. Crop only the outer
white canvas to fit the existing card geometry; record the source/crop/output
hashes in the artwork manifest/provenance. Convert the clip to the existing Ogg
SFX format, preserving its content; record provenance and hashes. No external
asset service or inferred copyright/license/authorship claim. Audio format and
duration have been inspected; its spoken content has not been independently
transcribed. A playable preview should precede any publication decision.

## Implementation boundaries, structure and commands

Expected existing files: `packages/shared/src/juno.ts` and error catalogs;
`packages/server/src/games/{juno,junoBot}.ts`, `src/routes/juno.ts` and colocated
tests; `packages/web/src/{api/client.ts,stores/junoStore.ts,components/games/*}`
and its single game-session owner; five voice/error localization catalogs;
`public/games/juno/`, `public/sounds/` and relevant subsystem documentation.

Match current strict TypeScript style, e.g. `{ type: 'play', cardId }` passed into
`rooms.command(...)`; use opaque authenticated host-instance identities, never
names or home ids for authorization. No `any`, placeholders or duplicate engine.

Build: `pnpm build` (shared → server → web, sequential).
Checks: `pnpm typecheck`, `pnpm lint`, `pnpm check:i18n`,
`pnpm --filter @backspace/server typecheck:e2e`,
`pnpm --filter @backspace/desktop build:ts`.
Tests: `pnpm --filter @backspace/server test -- src/games/junoMemory.test.ts`,
`pnpm --filter @backspace/server test -- src/routes/juno.test.ts`,
`pnpm --filter @backspace/web test -- src/stores/junoStore.test.ts`, and affected
game/session component tests. Use the established isolated runners/temp storage
for execution; never use runtime `data/` or production accounts in tests.

## Success criteria and validation

- Engine tests: 108/109-card cohorts, exactly one rare card, arbitrary legal play,
  retained color, both directions/two players, blind success/miss/wild/+4, timeout,
  duplicates, scarcity/recycling/conservation, report interaction, departures,
  last-card victory and unchanged XP/practice settlement.
- Projection/transport tests: victim-only masking, no face/color/hint leak, owned
  opaque ids, unchanged gates, legacy/mixed cohorts, unsupported spectator,
  attempted capability downgrade and unchanged rate budgets across query variants.
- Store/UI/audio tests: masked-state races, temporary errors and cooldown,
  no legal hints, correct blind command, disabled pending/stale controls, keyboard,
  once-only audio, late load/exit cleanup, muted/deafened output and reduced motion.
- Actual-container browser checks and inspected screenshots/recording cover desktop,
  short, mobile/scaled layouts, before/during/after curse and hit/miss recovery;
  source startup and audio playback need truthful evidence, not a simulated-media
  claim. Review the supplied asset crop and playable clip with the user.
- Update `docs/systems/{juno,api,client-federation,sounds,localization}.md` as
  applicable, with final external Sol review covering the complete implementation.

Always preserve existing authorization, origin routing and validated hotfixes.
Ask first before changing schema, adding dependencies, changing CI, publishing a
new release or updating the VM. Never alter/reuse immutable `v1.16.7`, commit
secrets, weaken masking for compatibility or change production during this phase.

## Next gate

Implementation and preview were approved after specification review. Complete
the implementation plan's validation and external review before delivery.
Release/version/deploy authorization remains separate from adding the feature
to source; no publication or production change is part of this phase.
