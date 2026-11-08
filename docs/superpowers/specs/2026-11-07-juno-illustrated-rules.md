# Spec: illustrated Juno rules guide

## Status and objective

The user approved the proposed **single scrollable guide with a contents menu**,
using Juno's own cards instead of the current wall of small paragraphs. This
document records that design, subsequently approved by the user for inline
implementation. No application
code, game rules or supplied artwork is changed by this specification.
External Sol design review `ses_e489191dfffeCU03p71WetR6bO` approved this
specification without actionable findings. The completed implementation follow-up
with the same reviewer
approved the complete guide without actionable findings. The local preview is
ready; all changes remain uncommitted at version 1.16.8, without deployment.

Replace the existing help content with a complete, readable, illustrated guide
for people learning or checking the actual game. Keep the existing right-hand
help icon, the refined header, personal settings and focused-view music intact.
The deliverable is the updated local preview, not a commit, release or deploy.

## Assumptions and boundaries

- This is the existing Juno help surface, not a separate app page, onboarding
  wizard, new game mode or interactive practice engine.
- Illustrations reuse `JunoCard`, `junoAssets` and supplied original artwork.
  Use deterministic example cards, never anyone's real/private hand or history.
- Copy follows the game's effective locale in all five released catalogs.
  Card artwork follows its existing real-edition/dubbing selection.
- Preserve the current details/help owner, Escape close and focus return. The
  guide remains part of Juno: opening it does not pause music or the live turn.
- No new dependencies, assets, global stores, API/WS contracts, server changes,
  permissions, persistence or audio changes. Preserve all previous local work.

## Visual design

A quiet cosmic-navy guide, using the existing Juno/Backspace palette and fonts:
navy `#060a27`/`#101a35`, pearl `#f5f8ff`, lavender `#7c6cf6`, muted blue
`#b9c8e7`, with the actual red/yellow/green/blue card art as the illustrations.
Keep DM Sans and the existing Russian/CJK font behavior. Do not introduce a
dashboard-style collection of decorative boxes, invented artwork or autoplay
animations.

```text
Como jogar                                      [close]
------------------------------------------------------
Contents             | Start with seven cards
  Getting started    | Objective and a small real-card fan
  Your turn          |
  Special cards      | Match a color / match a number
  JUNO and reports   | [top card]  [matching examples]
  Memory*            |
  Results and XP     | Special cards: real art + effect
  Table and sessions | ...remaining sections, one scroll...
```

- Desktop: compact contents column and a comfortable reading column, with
  illustrated examples embedded beside their explanations.
- Mobile/short/scaled layouts: one column, compact contents above the sections,
  bounded internal vertical scroll, no horizontal page overflow or clipped close
  control. All content remains reachable without changing app navigation.
- Clear headings, short paragraphs/lists and whitespace. Body copy normally
  14–16 CSS pixels, approximately 1.5–1.6 line height and no more than 70–75
  characters per line. Content reflows instead of shrinking text to fit.
- Special-card art is large enough to identify, with the localized card name
  and effect next to it. Colored examples also have textual labels; meaning
  must not depend on color alone. Examples are not playable controls.
- Use an orderly XP table rather than one long inline score sentence. Reuse the
  existing JUNO logo and still hammer artwork to explain announcement/reporting.
- Retain the new high-contrast circular help/close affordances. The contents
  menu moves within this guide only; no URL/hash/router or game-state mutation.
- User refinement: the contents highlights the section currently being read as
  the guide is scrolled manually, not only on hover/click. One item has semantic
  `aria-current="location"`; scrolling must not steal focus or move the guide.
  Update after layout/capability changes and when reopening. The final section
  is current at the bottom even when its heading cannot reach the top.
- User refinement: the rare-card category is called “Special cards” (Portuguese
  “Cartas especiais”), with Alzheimer as its first actual entry. Rename the
  ordinary skip/reverse/+2/wild group “Action cards” to avoid duplicate headings.
  Keep existing memory behavior/capability gates; do not invent future cards.

## Complete player-facing rule inventory

The server/shared code is authoritative. Explain the following, grouped for
reading rather than exposing implementation or federation/database internals.

### Getting started and the ordinary turn

- Two to four seats in a space voice channel; humans may practice with built-in
  bots. The host creates/starts the table; a running round can be watched but
  not joined as a new player. The host opens a fresh lobby for a rematch and
  other players join that new table explicitly.
- Seven cards each, four colors, numeric starting discard, clockwise initial
  direction. The objective is to be the first player with no cards.
- Match the active color or the top card's number/symbol, or play an allowed
  wild. Illustrate matching color versus matching number with original cards.
- A voluntary draw takes one card, not repeated draws until a playable card.
  Only that newly drawn card may then be played if legal, or the player may
  pass. If it is not legal, the turn passes automatically. Passing without
  first drawing a playable card is not an ordinary alternative.
- Forty-five seconds per turn, including the decision after a draw. Expiry
  draws one and passes; if already drawn, it only passes. Announcement does not
  reset the timer. Memory expiry has its separate penalty below.

### Each special card

- Skip: the next player loses the turn.
- Reverse: changes direction; with two players it skips the opponent.
- +2: the next player draws two and loses the turn.
- Wild: choose the next active color.
- Wild +4: choose a color; the next player draws four and loses the turn. It is
  legal only without any card of the current active color in the player's hand,
  even if a different-color number/symbol could otherwise match.
- Draw penalties do not stack, and there is no +4 challenge. If a final +2/+4
  wins the round, its draw penalty still applies before final standings.

### JUNO and reports

- With two cards, announce JUNO before playing down to one. Show the actual
  logo/control, not a promise of microphone/voice recognition. A late call does
  not undo a missed announcement; gaining cards clears the old announcement.
- For `supportsReports` tables: forgetting opens a ten-second opportunity for
  another seated human to use the hammer. No report means no automatic penalty.
  The first valid report makes the accused draw two without changing the current
  turn or resetting its timer; the reporter need not wait for their own turn.
- The accused cannot report themself, spectators cannot report, and bots do not
  report automatically. The opportunity expires at ten seconds and closes when
  the accused gains cards/leaves or the round ends. A completed win is not reopened.
- Older hosts without reporting retain their legacy automatic missed-JUNO
  penalty. Never teach a capability the actual host lacks. With no game/capability
  information yet, clearly distinguish the alternatives rather than asserting
  either modern reporting or the legacy penalty as unconditional.

### Rare memory card

- The enhanced deck adds exactly one supplied Alzheimer/memory card to the
  classic 108 cards. It can be played over any face/color, keeps the active
  color and makes the next player in the current direction play blind.
- Only that player's hand, middle face and active color are concealed. They
  select one of their hidden cards without previewing it.
- A legal match or allowed wild clears the curse and applies the card's normal
  effect. A blind wild retains the inherited color, without a color picker;
  the +4 restriction still applies.
- A wrong attempt keeps the attempted card private/in hand, draws two, **clears
  the curse** and passes once. Expiry also draws two, clears it and passes.
  Buying/passing cannot be used to avoid the blind attempt. Reports do not cure
  the curse, and a final-card win does not leave a curse on another player.
- Respect capability and round state: explain the rare card in capable lobbies;
  during a round label it inactive if that deck has `memoryEnabled: false`.
  Do not imply unsupported older hosts or mixed-version classic rounds contain it.

### Results, XP and practical table rules

- First empty hand wins; other finishers are ordered by remaining card count,
  including final-card penalties. Ties share place and its XP (competition ranks).
- Placements award 120 / 80 / 40 / 20 XP. Only completed human-only rounds with
  a winner count; only the winner gains a win. Leaving early earns no place/XP.
- A round started with a bot is practice throughout: no XP, wins or ranked
  round credit, even if that bot later leaves. XP/ranking belongs to this space,
  combined across its voice channels. Pending credit is not already-earned XP.
- The draw pile recycles discards except the top card. Draw penalties take only
  available cards if the deck cannot supply the full amount. If a full cycle has
  no available draw or legal play, the round ends in a draw without XP.
- Leaving releases the seat and returns the cards to the draw pile; below two
  remaining players the round ends without a winner. Leaving the game does not
  itself disconnect the person from voice. Closing to the mosaic is not leaving.
- Brief voice reconnection keeps the place only while the existing voice grace
  remains valid; do not invent a new guaranteed duration. A server restart loses
  live ephemeral tables; a round also expires after two hours, without winner/XP.

## Structure and style

Reuse `packages/web/src/components/games/JunoTable.tsx`, `JunoCard.tsx`,
`junoAssets.ts` and `juno.css`. Extract the cohesive illustrated help into
`JunoRules.tsx` with adjacent tests rather than growing the table or creating a
global guide framework. Use `voice:juno` catalogs in
`packages/web/src/locales/{en,pt,de,ru,zh}/voice.json` and existing formatters/
constants. Do not duplicate engines or create a second edition catalog.

Strict TypeScript, no `any`, typed section/card data and surrounding JSX style:

```tsx
<figure className="juno-rules-example">
  <JunoCard card={{ id: 'rules-example', color: 'sky', face: '5' }} />
  <figcaption>{t('juno.guide.matchColor')}</figcaption>
</figure>
```

Use stable instance-scoped section identifiers, semantic headings/lists/figures,
named contents navigation and visible keyboard focus. Static illustration images
may remain decorative when adjacent text fully explains them. Keep example
descriptions accessible without exposing any actual masked-card face.

## Validation and commands

- Vitest/Testing Library: full guide sections and deterministic examples;
  capabilities/legacy/unknown states; memory-enabled versus classic rounds;
  table open/close/Escape/focus; contents navigation without commands/routes;
  scoped language/media behavior. Preserve existing game/audio/privacy tests.
- Actual preview: inspect desktop, phone, short and 200% captures in the five
  languages. Verify internal scroll/contents reach every section, cards load
  locally, no clipping, keyboard exit, unchanged header/settings and music
  eligibility. Keep reduced-motion/transparency support and strong contrast.
- Verify factual copy against `packages/shared/src/juno.ts`,
  `packages/server/src/games/{juno,junoReports,junoMemory}.test.ts` and
  `docs/systems/juno.md`; correcting help copy must not change the engine.

```sh
pnpm build
pnpm typecheck
pnpm check:i18n
pnpm lint
pnpm --filter @backspace/web test -- src/components/games/JunoRules.test.tsx src/components/games/JunoTable.test.tsx
pnpm --filter @backspace/server test -- src/games/juno.test.ts src/games/junoReports.test.ts src/games/junoMemory.test.ts
```

Where PATH requires, reuse the established isolated pnpm/test wrappers. Test
storage must stay temporary; do not touch production/runtime data. Complete
the required external implementation review before delivery; a design-only
review does not validate later source changes.

## Success criteria and approval gate

All applicable implemented player rules are discoverable in one attractive,
illustrated, responsive guide; illustrations explain rather than decorate.
No rules, private data, navigation, settings, language ownership, audio lifecycle
or release state change as a side effect. Nothing is committed or deployed.

No remaining product-format question: the user selected the scrollable guide.
The user approved this written design in the next turn and authorized its
implementation. Proceed inline with the corresponding plan; no further product
decision is open. Publication/deployment still require separate authorization.
