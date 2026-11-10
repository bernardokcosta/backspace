# Spec: dependency-security

## Objective and status

Approved by the user on 2026-11-10. Provider module in the
[approved map](2026-11-10-pr-security-hygiene-map.md).
Integrate compatible dependency updates and remove the vulnerable dependency,
rather than hiding its warning. The user explicitly approved raising the Node
minimum to accommodate jsdom31.

## Evidence and assumptions

- PR18/19 CI fails before application tests because `veyvox-brand.test.mjs`
  hashes the entire third-party lockfile resolution graph from the rebrand.
  That historical snapshot rejects every legitimate dependency update.
- PR18 native tests also encounter minimatch11.0.5's intentional RangeError on
  preprocessing amplification, instead of the previous bounded result. This is
  a fail-closed security behavior, not reason to disable the limit.
- jsdom31 declares `^22.22.2 || ^24.15.0 || >=26.0.0`; root currently declares
  `>=22.12.0`. Align the root requirement with jsdom's supported ranges and
  contributor docs. CI, `.nvmrc` and Docker remain on Node24; no Node26 image
  migration or claim of separately tested Node22/26 CI is introduced.
- `pnpm -r why deepmerge` identifies @rollup/plugin-node-resolve16.0.3 through
  Workbox/vite-plugin-pwa as the remaining path. Its CJS and ESM bundles each use
  deepmerge once, only to clone the module-private `defaults` constant before
  deepFreeze. That constant contains arrays, strings and booleans, not functions
  or user configuration. Native structuredClone preserves this exact use case
  on every newly supported Node line; no replacement merge library is needed.
- Existing pnpm selective dependency removal and versioned patches are the
  established mechanism. Context7 is quota-blocked; installed package source,
  registry engines/dependencies and the upstream advisory were inspected.

## Required behavior and design note

1. Preserve PR16/24/19 commit histories and intended direct updates (Dependabot
   replaced and closed PR18 with PR24 during planning). Regenerate
   any conflicted lockfile with pnpm, not manual snapshot splicing.
2. Keep real workspace-name/importer/alias/build-order checks, replacing the
   obsolete whole-resolution fingerprint with structural assertions. Frozen
   install plus dedicated packaging/security tests continue validating third-
   party dependencies. Do not merely update the fingerprint after each PR.
3. Test the actual installed minimatch/glob amplification safeguard and benign
   packaging cases. Do not lower the safe dependency or catch arbitrary failures
   as success; verify the intended RangeError/bound and ordinary globs/asar.
4. Add a narrowly versioned pnpm patch for node-resolve16.0.3: remove the deepmerge
   import in both CJS/ESM and replace only cloning of the known defaults constant
   with structuredClone. Remove that exact parent→deepmerge dependency edge using
   the existing override pattern, and regenerate the lockfile. Patch installed
   dependency metadata if necessary for an accurate declared graph. No invented
   package version, alias to a vulnerable build or copied generic merge helper.
5. Verify the actual installed default export/DEFAULTS, deep freeze and resolver
   behavior in both module formats, including isolation between instances.
   The Workbox/PWA production build must still succeed.
6. Remove the CVE waiver from `osv-scanner.toml` only once the vulnerable package
   is absent from the resolved graph. Update security documentation with the
   exact patch rationale, bounds and exit condition (upstream removal/fix).
7. Update Node requirements and stale image-version comments truthfully. No app
   version bump, new registry dependency, database change or runtime feature.

Alternatives rejected: downgrade deepmerge into older vulnerable code; rename or
dismiss the advisory; add another merge dependency for a constant clone; remove
Workbox/offline support; weaken packaging/security checks to permit an update.

## Files, style and commands

Use existing root/package manifests, `pnpm-lock.yaml`, `patches/`, Dockerfile,
`AGENTS.md`, relevant setup docs, `scripts/veyvox-brand.test.mjs`, desktop
`packagingDependencies.test.ts` and focused tooling tests. Preserve strict TS;
Node tooling uses current `.mjs` and node:test patterns. Patch only the actual
installed distribution surfaces needed by build tooling.

```js
// Only the private, data-only defaults constant is cloned; no generic merge API.
const DEFAULTS = deepFreeze(structuredClone(defaults));
```

```bash
pnpm install --frozen-lockfile
pnpm -r why deepmerge
pnpm test:tooling
pnpm --filter @veyvox/desktop test
pnpm build
pnpm typecheck
pnpm --filter @veyvox/server typecheck:e2e
pnpm --filter @veyvox/desktop build:ts
pnpm lint
pnpm -r test
pnpm audit --audit-level=low
```

Corepack/local shims are acceptable if pnpm is not on PATH; no global install.
Focused Vitest runs use `pnpm --filter <workspace> exec vitest run <paths>`.

## Acceptance and boundaries

- Lockfile and installed graph contain no package named deepmerge; no CVE waiver
  or dismissal remains for it. Preserve every other required security test.
- Original relevant CI failures are reproduced before fixes; targeted and broad
  suites/build/lint pass afterwards. Native/packaging/image CI must pass on the
  combined candidate; unavailable local platforms are explicit, not inferred.
- Node versions below the new ranges are no longer advertised as supported.
- Never directly edit the pnpm store, remove stored data, install privileged
  tooling into production, broaden ignores, or publish a replacement image/tag.
- Ask before changing security rules, adding a dependency or extending a patch
  beyond this constant-cloning seam.
