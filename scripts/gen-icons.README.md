# Veyvox icon generator

Regenerate with `pnpm gen-icons`; verify with `node --test scripts/gen-icons.test.mjs`.
The existing Sharp, png-to-ico and png2icons dependencies are reused. No image
generation service, replacement logo, font tracing or vector reconstruction is used.

## Supplied masters

| File in `assets/brand/` | Source/use |
| --- | --- |
| `veyvox-app-icon.png` | Supplied 1254×1254 opaque boxed app composition |
| `veyvox-symbol.png` | Supplied 1254×1254 transparent, two-part V monogram |

The source PNGs remain byte-identical to the maintainer's supplied files. The
generator never writes to them. Its `generateIcons(root)` entry point supports
disposable repository roots for tests; importing the module does not generate files.

## Derived cleanup and flat variants

The maintainer approved a minimal alpha-only cleanup after comparing light/dark
previews. `cleanSymbol` retains every original RGBA pixel with alpha >=16, plus
one pixel of antialiased edge support. Only more distant near-transparent noise
is cleared. Both intentional components remain: 245,730 outer-V pixels and
66,918 inner-V pixels at that threshold. No component is discarded by size, no
chroma filtering is applied, and neither V is redrawn or eroded.

The cleaned symbol is cropped to its alpha bounds. UI/tray silhouettes reuse that
alpha with flat lavender `#7c6cf6`, white or black; colored standalone/maskable
outputs retain source RGB. These outputs are PNGs, not falsely labeled vectors.
Historical Backspace SVGs/design archives are not generator inputs.

The maintainer also requested removal of the app tile's black exterior corners.
`cleanAppIcon` clears alpha only for four-connected, edge-reachable pixels with
all RGB channels <=16 (65,993 pixels in the hash-verified master). Source RGB,
the purple outline, enclosed dark fill and both Vs are unchanged. This is a
transparent outer matte in derivatives, not a new shape or an edit to the master.
Apple-touch remains deliberately opaque after flattening to its platform ground;
the independently composed maskable icon remains opaque too.

## Output matrix

| Destination | Output |
| --- | --- |
| `assets/brand/app-icon-1024.png` | 1024px boxed reference export |
| `packages/desktop/build/icons/` | Boxed PNGs: 16/32/48/64/128/256/512/1024 |
| `packages/desktop/build/icon.ico` | Boxed frames: 16/24/32/48/64/128/256 |
| `packages/desktop/build/icon.png`, `icon.icns` | macOS: artwork at 824/1024 of the canvas; ICNS's ten representations inherit that margin |
| `packages/desktop/resources/tray-iconTemplate*.png` | Black templates: 22×22 and 44×44, inset marks |
| `packages/desktop/resources/tray-icon.ico`, `tray-icon.png` | Flat lavender Windows frames 16/20/24/32/40/48, Linux 22px; measured alpha-centroid centering |
| `packages/web/public/icons/favicon-16.png`, `favicon-32.png` | Flat lavender standalone V |
| `icon-192.png`, `icon-512.png`, `logo.png`, `apple-touch-icon.png` in the web icon directory | Boxed PWA/sidebar/touch composition; Apple-touch is opaque |
| `icon-maskable-512.png` in the web icon directory | Opaque plum gradient and colored mark fitted inside a central 60% square, within the maskable safe circle |
| `logo-mark.png`, `symbol.png` in the web icon directory | White UI silhouette at 256px; colored symbol at 512px |

Tests inspect the actual ICO/ICNS containers and embedded frames, source hashes,
dimensions, template RGB/alpha, opacity, framing and repeat-run hashes. Output is
byte-stable with the same pinned encoders; encoder upgrades require regeneration
and review, not a claim of cross-version byte stability. Inspect small/tray
variants on light and dark grounds before publishing. Stage explicit outputs,
never unrelated files with `git add -A`.
