# Veyvox Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the supplied Veyvox artwork and public name without changing stored identity or Juno's identity.

**Architecture:** Adapt the existing raster/vector icon pipeline and product-copy owners. Mechanical package renames remain separate from persistence/wire identifiers, with packaged identity pins owned by C1/C5. No new branding framework or UI redesign.

**Tech Stack:** Existing Sharp ^0.35.5, png-to-ico ^3.0.2, png2icons ^2.0.1; TypeScript/React/native HTML/i18n catalogs; pnpm workspace.

**Spec:** [veyvox-brand](../specs/2026-11-08-veyvox-brand.md); [integrated plan and constraints](2026-11-08-veyvox-1.17.0.md).

## Global Constraints

- Public product name: `Veyvox`; canonical project/package slug: `veyvox`; workspaces `@veyvox/*`.
- No new dependencies; preserve all 25 released languages and Juno media/rules/dubbing.
- Preserve supplied masters; cleanup/framing is deterministic derived output, not a master edit.
- Keep Aether Drift layout/palette, primary `#7c6cf6`; no generated/redesigned replacement artwork.
- Inherit all integrated constraints, especially compatibility exceptions and deferred commits.

## Review Focus

Execution checkpoint:
- [x] B1 implementation, approved minimal cleanup, generator/container/determinism tests and native-size light/dark icon inspection.
- [x] B2 implementation, frozen install, builds/types and unchanged external resolution graph.
- [x] B3 catalog/native/product implementation, 25-language strict checks and complete web/desktop suites.
- [ ] B3 full visual/native/OS screen matrix; initial real login/sidebar/320px/200%/RTL captures are in the validation ledger.

Unchecked detailed steps below remain subject to integrated acceptance, not a claim that no implementation exists.

- Stray white edge pixels become a tray halo, or cleanup removes the inner V: B1 preserves both intentional components and checks light/dark grounds.
- A PNG is disguised as vector artwork: B1 changes raster consumers/output extensions honestly.
- Tiny icons become blank or clipped: B1 inspects real 16/20/22/32px outputs and container frames.
- Proper-name replacement erases a translated sentence: B3 preserves keys/placeholders/plurals and checks all native surfaces.
- A package rename alters runtime identity: B2 requires C1 pins and C5 measured comparison before desktop boot.

---

## Task B1: Import masters and regenerate every active icon family

**Files:**
- Move: `C:/Users/berna/Downloads/Nova pasta/Ícone Veyvox em V Luminoso.png` → `assets/brand/veyvox-app-icon.png`.
- Move: `C:/Users/berna/Downloads/Nova pasta/Monograma Veyvox em V Roxo Luminoso.png` → `assets/brand/veyvox-symbol.png`.
- Modify: `scripts/gen-icons.mjs`, `scripts/gen-icons.README.md`, `docs/systems/design-system.md` (Brand), `packages/web/src/components/layout/SpaceSidebar.tsx`.
- Regenerate: `assets/brand/app-icon-1024.png`, `packages/desktop/build/{icon.png,icon.ico,icon.icns,icons/*.png}`, `packages/desktop/resources/tray-icon*`, `packages/web/public/icons/*.png`.
- Create: `packages/web/public/icons/logo-mark.png`, `scripts/gen-icons.test.mjs`; retire active `packages/web/public/icons/logo-mark.svg` after updating every consumer. Inspect master SVG references before removing obsolete app-owned masters; preserve archives/legal provenance.

**Interfaces:** Keep `pnpm gen-icons`. Export `generateIcons(root: string): Promise<void>` and `cleanSymbol(input: Buffer): Promise<Buffer>` from the existing generator and guard CLI execution; `root` owns both source/output paths so tests write only inside fixture roots. `cleanSymbol` preserves the original canvas and the outer/inner V foreground pixels; it does not resize or redesign the master. Keep existing generated filenames except the explicitly changed raster mark.

- [ ] **Step 1 — RED assertions:** Add Node tests using a new temporary repository-shaped directory and copied input bytes. Assert masters are exactly the recorded SHA-256 values, generated PNG dimensions match the current output matrix, templates have black RGB plus nonempty alpha, Apple-touch/maskable are opaque, macOS artwork has the `824/1024` margin, and maskable foreground lies in the central safe area. Parse ICO/ICNS frame directories from the actual container bytes, not only pre-encoding buffers. Assert a second generation has identical hashes and missing input fails before any output write.

  Add `preserves both original V components while removing only confirmed disconnected residue`:
  before resizing, compare every source RGBA pixel in the two intentional components against
  `cleanSymbol` output. For the supplied 1254×1254 symbol, alpha >=16/eight-connectivity
  identifies an outer V of 245,730 pixels and a legitimate inner V of 66,918 pixels.
  Both must survive, including their separation; assert `preservedOuterPixels === 245_730`
  and `preservedInnerPixels === 66_918`. Do not accept a nonempty mask/hash test as
  proof of shape preservation. Bind these counts to the recorded source hash and
  inspect both V components again at tray sizes after resampling.

  Read-only planning verification confirmed the symbol SHA-256 as
  `3db91352925569d1c193b5c96cedc8029cafa06004f39b8a6223de63dfd3fb77`
  and both component counts using the already installed Sharp, without writing any
  image. At this threshold those are the only two components: visible contamination
  attached to them is **not** safe to remove with component-size filtering. Its
  cleanup remains subject to Step 3's explicit visual-approval gate.

  Test name: `generates Veyvox raster icons deterministically and refuses missing masters`.
  Representative assertions (fixture variables are local to this test):
  ```js
  await generateIcons(fixtureRoot);
  assert.equal((await sharp(path.join(fixtureRoot, 'packages/web/public/icons/icon-512.png')).metadata()).width, 512);
  assert.deepEqual(secondPassHashes, firstPassHashes);
  await assert.rejects(generateIcons(missingMasterRoot), /Missing source/);
  ```

- [ ] **Step 2:** Run `node --test scripts/gen-icons.test.mjs`; expect failure for absent canonical masters/export, not a missing dependency. Use installed encoders, no package upgrades.
- [ ] **Step 3:** Copy each authorized source exclusively to its destination, compare SHA-256, then remove only that verified original file to complete the move. Retain provenance/hashes in the ledger. Route boxed app icons from `veyvox-app-icon.png`; derive standalone/UI/tray variants from `veyvox-symbol.png`. Preserve **both** intentional eight-connected alpha components (outer and inner V), not just the largest. In `cleanSymbol`, remove only disconnected residual components visually confirmed not to belong to the mark; retain source RGBA for both V components and unclassified antialiased edge pixels. Record deterministic component/mask decisions against the source hash. Derive flat white/lavender/black silhouettes from the preserved two-part mask; preserve RGB for colored standalone derivatives. If attached residue needs additional cleanup or either V becomes illegible at small sizes, pause B1 for explicit visual approval of that derived cleanup/simplification instead of altering the artwork silently. Reuse resize, centering, ICO/ICNS packing, macOS margin and maskable background helpers. Do not embed a PNG in a file described as vector. Update sidebar to `/icons/logo-mark.png`.
- [ ] **Step 4:** Run the Node test and `pnpm gen-icons` twice. Inspect a contact sheet of app, favicon, tray, maskable and templates at native sizes on white/dark grounds, including all ICO frames. Assert the generated mark isn't the old glyph and sources remain hash-identical. Register this Node test in the CI test step (R1 owns the workflow edit).
- [ ] **Step 5:** Update generator/design-system documentation to match raster provenance and actual derivation; record the queued `feat: adopt supplied Veyvox brand artwork` checkpoint without committing yet.

## Task B2: Rename build/workspace and code-only identifiers atomically

**Files:** `package.json`, `packages/{shared,server,web,desktop}/package.json`, `pnpm-lock.yaml`, `Dockerfile`, `.github/workflows/{ci,release,native-sdr-capture,dast}.yml`, `flatpak/build.sh`; all tracked TypeScript/config/test import specifiers and active build filters containing `@backspace/`. Modify code-only `BackspaceApiClient` in `packages/web/src/api/client.ts` and its consumers. Bridge types/consumers belong to C2; release repository/artifact strings belong to R1.

**Interfaces:** Root package `veyvox`; workspace names `@veyvox/shared`, `@veyvox/server`, `@veyvox/web`, `@veyvox/desktop`; existing export subpaths and script names unchanged. Root sequential build still builds shared → server → web. C1 defines deliberately retained packaged desktop metadata.

- [ ] **Step 1 — RED assertions:** In new `scripts/veyvox-brand.test.mjs`, assert the five manifest names above and that tracked executable import/filter specifiers have no `@backspace/` except the exact documented packaged/historical profile identities. Assert all `workspace:*` dependencies point to the new local package and no external dependency/version/integrity or pnpm override/patch has changed.

  Test name: `uses Veyvox workspace names without changing dependency resolutions`.
  ```js
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).name, 'veyvox');
  for (const name of ['shared', 'server', 'web', 'desktop']) {
    assert.equal(JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8')).name, `@veyvox/${name}`);
  }
  ```

- [ ] **Step 2:** Run `node --test scripts/veyvox-brand.test.mjs`; expect manifest/import assertions to fail on the baseline. Run existing C1/C4 guards before editing; they should already pass for preservation behavior.
- [ ] **Step 3:** Rename only package/import/filter and code-symbol references, including tests, build tooling, Docker filters and Flatpak's offline filters. Regenerate the lockfile with the pinned pnpm (`pnpm install --lockfile-only --ignore-scripts`); review that it has no dependency resolution upgrades. Apply C1's packaged identity pins in the same working-tree transition before running Electron. Do not replace storage keys, HTTP headers, environment names or test-authored user data.
- [ ] **Step 4:** Run `pnpm install --frozen-lockfile`, `pnpm build`, desktop `build:ts`, server `typecheck:e2e`, the new Node test and `node --test flatpak/*.test.mjs`. Expected: all imports/filters resolve locally, Docker's existing paths still cover build inputs, lockfile install succeeds without rewriting it.
- [ ] **Step 5:** Record the exact mechanical file set and queued `refactor: rename workspace packages to Veyvox` checkpoint. Never include unrelated generated/node_modules files.

## Task B3: Replace current public copy and rendered product marks

**Files:** `packages/web/index.html`, `packages/web/src/build/localizedManifests.ts` and test, `packages/web/src/locales/{en,ru,de,pt,zh,es,fr,it,uk,pl,nl,sv,da,nb,fi,cs,ro,tr,ar,hi,id,vi,th,ja,ko}/*.json`, affected component/content tests, `scripts/i18n-allowlist.json`; `packages/desktop/src/{main,recovery,l10n,mediaDetector,activityDetector}.ts`, `packages/desktop/resources/{instance-picker,recovery}.html`, `packages/server/src/index.ts`. Inspect other active old-name matches from P0 for app-owned copy; do not alter keyboard events or foreign-instance names.

**Interfaces:** `common:appName = Veyvox` in all 25 catalogs; translated surrounding text remains translated. Native menu/window/tray/About and bundled HTML say Veyvox while C1's internal runtime name remains stable. PWA descriptive name changes, identity URL/start_url/scope does not. Juno Automatic labels reference Veyvox; media edition remains Portuguese (Brasil).

- [ ] **Step 1 — RED assertions:** Extend the brand Node test to assert 25 ×15 catalogs, `common.appName === 'Veyvox'`, no current-brand Backspace copy (including native catalogs via existing `readDesktopCatalogs`), unchanged key/interpolation/plural sets, and released flags. Extend `localizedManifests.test.ts` with `name/short_name === 'Veyvox'` and baseline-equivalent install identity. Update exact component/i18n content expectations rather than weakening them. Add media self-exclusion assertions for both historical `Backspace Fork` and Veyvox process names so the app does not report its own playback/activity.

  Test name: `changes descriptive branding without changing PWA install identity`.
  ```ts
  expect(BASE_MANIFEST).toMatchObject({ name: 'Veyvox', short_name: 'Veyvox', start_url: '/' });
  expect(BASE_MANIFEST.id).toBeUndefined(); // Baseline uses the start_url-derived identity.
  expect(localizedManifest('ar', 'وصف')).toMatchObject({ name: 'Veyvox', dir: 'rtl' });
  ```

- [ ] **Step 2:** Run the new test and affected web/desktop Vitest files; new product-name assertions must fail before copy changes. Preserve passing keyboard/Juno-media regression tests.
- [ ] **Step 3:** Replace app-owned names in all actual catalogs/native/static metadata and old inline marks with generated PNGs; retain i18n ownership and existing palette/layout. Update the checker's real brand-name allowlist without relaxing identical-translation/coverage rules. Do not replace operator instance titles named Backspace. Package/publisher descriptions are Veyvox; original author credit remains explicit, not misrepresented as Veyvox authorship.
- [ ] **Step 4:** Run strict/native and ordinary i18n checks, web/desktop suites, production web build and the brand Node test. Capture landing/login, sidebar, settings/downloads, Juno Automatic labels, native picker/recovery and About/tray; cover English/pt-BR, 320px, interface scale 200%, and Arabic RTL. Verify icon requests return the intended images, not stale caches/old SVGs.
- [ ] **Step 5:** Record captures, remaining classified legacy references and queued `feat: apply Veyvox product naming across clients` checkpoint. Defer full exception/documentation reconciliation to D2/P1.
