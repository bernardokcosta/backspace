# Spec: veyvox-brand

Parent: [Veyvox 1.17.0](2026-11-08-veyvox-1.17.0.md). Inherits its commands, style,
boundaries, source baseline and testing strategy.

## Objective and inputs

Replace Backspace/Backspace Fork product identity with Veyvox, using the exact
artworks supplied by the maintainer rather than generating a redesigned logo.

User-authorized source files under `Downloads/Nova pasta`:

| Input | Canonical destination | Use |
| --- | --- | --- |
| `Ícone Veyvox em V Luminoso.png` | `assets/brand/veyvox-app-icon.png` | Boxed app icon |
| `Monograma Veyvox em V Roxo Luminoso.png` | `assets/brand/veyvox-symbol.png` | Standalone V mark |

Rename/move only those two files, after recording hashes and verifying destination
bytes. Do not delete the source folder or unrelated downloads. Preserve supplied
masters; cleanup, resizing, monochrome silhouettes and platform framing are
reproducible derived outputs, not silent changes to the masters.

The maintainer subsequently requested removal of the black exterior corners
visible around the rounded app tile. In app derivatives only, make that
edge-connected near-black matte transparent; preserve the rounded purple outline,
enclosed fill, both Vs and all source RGB. Do not replace the shape or recolor it.
The master stays byte-identical, and touch/maskable outputs retain their required
opaque platform grounds. PhotoCraft was offered as an optional editing tool; its
configured MCP session has neither GUI bridge mode nor filesystem read authority,
so the existing reproducible generator performs this bounded correction.

## Owners and behavior

- Reuse `scripts/gen-icons.mjs` and existing target paths, adapting its vector-only
  assumptions to supplied raster masters without adding a dependency.
- Replace every active old-mark variant, including inline/SVG, favicon, PWA,
  maskable/touch icon, Windows ICO, Linux PNG, macOS ICNS and tray/template outputs.
  Do not wrap an old glyph in a new filename or claim raster inputs are vectors.
- Ensure tiny monochrome/tray variants remain recognizable and macOS framing and
  Android maskable safe area are preserved. Inspect alpha/edges on light and dark.
- Update real current UI/catalog/native/build owners across all 25 languages;
  proper-name replacement must not erase translations or count fallback as coverage.
- Use current package/workspace/build owners for canonical `@veyvox/*` names and
  mechanical import/filter changes. Do not conflate these with storage/wire identity.

## Interfaces

Produces canonical name/asset/build conventions consumed by compatibility, docs
and release. No new branding framework, global registry, service or UI redesign.
Keep the Aether Drift palette/layout and Juno-specific identity intact.

## Acceptance

- PNG/ICO/ICNS dimensions/alpha and all expected generated files are verified.
- Actual web/PWA/desktop captures show Veyvox and the supplied V at representative
  sizes, including 320px, 200% and Arabic RTL; tray/monochrome outputs are inspected.
- Normal and strict i18n, relevant component/native/assets tests and package builds
  pass; old-name scans have explicit legal/history/keyboard/compatibility exceptions.
