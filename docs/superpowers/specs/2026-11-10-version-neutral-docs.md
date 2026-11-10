# Spec: version-neutral-docs

## Objective and status

Approved by the user on 2026-11-10; independent module in the
[approved map](2026-11-10-pr-security-hygiene-map.md).
Finish the intent of PR21/22: bilingual onboarding that does not become false
when the app version advances. These PRs do not change release metadata.

## Required behavior

- Preserve both original PR histories and their useful version-neutral intent.
- Repair incomplete phrases such as "source tree targets;" / "prepara a versão;".
  Point source-version readers to the real package manifest and installer users
  to published Releases. Do not imply an unpublished release exists.
- Use one clearly identified `<version>` placeholder in installer filename
  patterns across all three platforms and both languages. Preserve actual
  architecture suffixes, installer formats, signing/notarization caveats and
  updater/sidecar exclusions. Do not turn the placeholder into a download link.
- Keep the existing product name, original attribution, license, Compose/service/
  data identities, secure setup commands, image channel, ports and language links.
- Update README contract tests to assert those substantive invariants rather than
  require the stale string1.17.0. Keep local-link/heading/image checks and add
  assertions for equivalent placeholders/manifest guidance in both languages.

## Structure, style and commands

Files: `README.md`, `README.pt-BR.md`, `scripts/veyvox-docs.test.mjs`; related
tooling tests only if necessary. Follow the existing Markdown table and node:test
style. No new dependency, application string/catalog or visual redesign.

```md
| Windows | `Veyvox-<version>-win-x64.exe` / `-win-arm64.exe` | ... |
```

```bash
node --test scripts/veyvox-docs.test.mjs scripts/veyvox-brand.test.mjs
pnpm test:tooling
git diff --check
```

## Acceptance and boundaries

- Existing PR21/22 README failure is reproduced, then both documents/tests pass
  without forcing old release strings back into onboarding.
- Source app/package version remains1.17.1; no release/tag/artifact is created.
- Relative links, attribution, image checks and deployment warnings stay valid.
- Never drop attribution or a failing safety assertion merely to obtain green CI.
- Ask before changing release naming, signing policy or the public distribution
  contract rather than just documenting its version placeholder.
