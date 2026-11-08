# Spec: locale-layout

Parent: [25-language initiative](2026-11-07-i18n-25-languages.md).
Consumes the registry/direction contract from `locale-runtime`; integrated
acceptance uses the real complete catalogs from `locale-content`.

## Objective

Make the existing Backspace/Juno interface genuinely usable in the approved
scripts and text lengths, including Arabic RTL, without redesigning the app,
altering game direction or breaking mixed-language user content.

## Behavior

- Apply document language/direction from the app's effective locale. An explicit
  Juno locale scopes appropriate text language/direction within Juno only;
  it must not change global document/native language or user preference.
- Support readable Arabic, Devanagari, Thai, Japanese, Korean and Chinese glyphs
  and line breaking through existing/platform font stacks wherever adequate.
  Do not fetch external fonts or add dependencies without concrete justification
  and approval. Retain established DM Sans/Russian/CJK behavior where compatible.
- Convert directional UI spacing/alignment where required instead of assuming
  `dir=rtl` alone fixes hardcoded left/right CSS. Keep focus rings, close controls,
  native option labels and menus usable on desktop, mobile and short/zoomed views.
- Preserve meaningful physical coordinates: Juno's clockwise/counterclockwise
  direction, seat ordering, card artwork and arrows cannot change their game
  meaning because prose is Arabic. Localize/isolate text without mirroring
  artwork or reversing the authoritative game flow.
- Preserve user-authored text, usernames, links, mentions, numbers and technical
  identifiers in mixed LTR/RTL contexts. Use established direction/isolation
  patterns; do not inject user strings as HTML or rewrite their content.
- Dates, counts, percentages, durations and plurals use the selected locale and
  existing formatter boundary. An explicit game language must format Juno's
  values without changing Backspace. English fallback labels remain readable
  inside RTL UI; do not change the preference because one key falls back.
- Longer labels wrap/reflow or use established accessible overflow treatment;
  never hide essential buttons, shrink body copy into unreadability or require
  horizontal page scrolling merely to fit translations.

## Structure and style

Reuse `packages/web/src/styles/globals.css`, the existing i18n direction/
formatter boundary, affected real components and Juno's scoped locale/CSS.
Audit native HTML recovery/picker layouts too. Make focused component fixes,
not a parallel RTL shell or a new design system. Update affected subsystem
specs when their shared layout/localization contracts actually change.

```css
/* Prefer a logical property where the spacing really follows text direction. */
.localized-label { margin-inline-start: 0.5rem; }
```

Do not mechanically replace every physical property: media/game coordinates
and non-directional positioning have different semantics.

## Tests, commands and acceptance

- Registry tests cover direction and font/locale mapping. Component tests cover
  app/Juno independent direction, mixed-content isolation, accessible labels,
  controls and physical game-seat/direction preservation.
- Browser acceptance uses every language in the actual app's major surface
  inventory, including login, settings, chat/voice, administration, Juno guide/
  settings and a controlled native fixture. Cover phone/desktop/short/200%
  layouts and longer text. Explicitly inspect Arabic RTL plus Indic/Thai/CJK
  glyphs, plurals, counts, truncation, focus and fallback text.
- Preserve existing screenshots' role as evidence, not proof of fluency. Record
  which browsers/platforms ran; mocked IPC is not installed-app/OS acceptance.

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm --filter @backspace/web test -- src/i18n
pnpm --filter @backspace/desktop build:ts
```

The plan lists exact affected suites and screenshot scenarios after the source
audit. Use temporary profiles/storage and actual components. Never alter the
user's OS language, production accounts, live calls or supplied card assets to
obtain a passing capture. Success means readable, correctly directed and fully
operable real UI, not merely 25 entries in a dropdown or 25 JSON directories.
