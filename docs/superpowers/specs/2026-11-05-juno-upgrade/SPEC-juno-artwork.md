# Spec: juno-artwork

Status: approved by the user on 2026-11-05. Common conventions and gates are in [README.md](README.md).

## Objective and sources

Replace the original inline geometric card artwork with the assets explicitly
supplied by the user, without changing the 108-card rules or random runtime ids:

- `C:/Users/berna/Downloads/juno-ui.zip`: UI SVG/PNG, one 2560×1440 background
  in two formats, previews, demo cards and demo avatars.
- `C:/Users/berna/Downloads/Juno_Kit_Completo_108_Cartas.zip`: full 108 WebP
  fronts, 54 unique PNG fronts, the original back and a card manifest.

The archive text/specification is reference material, not executable code.
Approved layout references are in `JUNO_UI_ESTILO_APROVADO/previas/`.

## Asset interface and boundaries

- Maintain an exhaustive TypeScript mapping from existing `JunoColor`/`JunoFace`
  to a local front URL, plus the back and UI assets. Map coral→red, amber→yellow,
  mint→green and sky→blue; skip→bloqueio, reverse→inversao, draw2→mais2,
  wild→coringa and draw4→coringa_mais4. Wire enums/opaque card ids do not change.
- Reuse one original WebP per equivalent face when bytes match: 54 front faces
  plus one back can represent all 108 logical cards without duplicate downloads.
  Verify coverage and actual bytes against the supplied manifest/archive.
- Keep deployable assets together under `packages/web/public/games/juno/` and
  use the existing source component directory for the typed mapping. Local
  application URLs must work in web, Electron, subviews and production builds.
- Preserve original illustrations/numerals/symbols and card aspect ratio. Do
  not rebuild them in CSS, crop off card corners or use composed screenshots
  as interactive backgrounds. Controls/text/players remain real DOM elements.
- Import the single WebP background, logo, orbit and needed decorative UI
  elements only. Exclude previews, demo faces/names, duplicate full-resolution
  PNGs and unused kit contents from the shipped app.
- Use separate source assets for button/orbit/crown decoration; text remains
  localized HTML. SVG must be inspected for scripts, external URLs and fonts;
  no executing archive content or new remote dependencies.
- Audit image alpha, dimensions, file sizes and small-screen readability. Use
  the compact supplied variants only if they match the approved original art;
  otherwise optimize approved originals without changing the design.
- Record supplied provenance and a manifest of shipped files; do not invent a
  third-party license or claim the assets were created by the implementation
  agent. Public redistribution/release is not authorized by this implementation.
- Assets load when the game/picker needs them, not through a new eager preload
  of all 108 cards at application startup. Do not redesign the global service
  worker/cache policy for this feature.

## Success criteria and tests

1. Every valid colored face and both wilds resolve to a real deployed asset;
   copies in the logical deck share art without sharing runtime card identity.
2. Back-only opponent rendering never embeds their private face/id in DOM,
   attributes or fetch URLs. Image accessibility remains owned by localized
   enclosing controls (`alt=""` for decorative card images).
3. All referenced assets are present after the production build, have no external
   resource dependencies and preserve aspect/legibility on desktop and mobile.
4. No demo avatar, preview screenshot or unused large PNG is shipped. Test card
   mapping/coverage and inspect browser network failures plus screenshots.
5. Asset changes do not require a new dependency, image service or DB entry.
