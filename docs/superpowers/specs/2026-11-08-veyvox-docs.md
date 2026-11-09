# Spec: veyvox-docs

Parent: [Veyvox 1.17.0](2026-11-08-veyvox-1.17.0.md). Depends on brand and
compatibility; inherits parent commands/style/boundaries.

## Objective and files

Rewrite `README.md` in English and add `README.pt-BR.md` in Brazilian Portuguese.
Both are welcoming, practical and equivalent in capability/setup information,
with language links at the top and the supplied Veyvox artwork.

## Contents

1. What Veyvox is, who runs it, useful quick links and current release/version.
2. Actual features: chat/spaces/DMs, optional LiveKit voice/video/sharing,
   federation, Juno, soundboard, 25 languages, desktop and mobile PWA.
3. A clear getting-started path: download/connect as a user versus self-host as
   an operator; correct prerequisites, commands, ports and optional voice limits.
4. Safe upgrading from the fork, backup advice and any retained internal names.
5. Development/build/testing with current installed framework versions and new
   workspace package names; link detailed subsystem guides instead of a huge wall
   of proxy/config examples on the landing page.
6. Security reporting, privacy limits and known platform/update/signing limits.
   Do not claim E2EE, universal hardware/OS support or native mobile apps.
7. License, origin/credits, independence disclaimer and acknowledgements.

## Attribution contract

- Credit **Jannis Braun (TheZwiss)** as the original Backspace creator and link
  `https://github.com/TheZwiss/backspace`; thank its contributors explicitly.
- Clearly identify Veyvox as an independently maintained derivative/community
  fork, not an official rename or upstream-endorsed release.
- Preserve GNU AGPL-3.0-only, original copyright and third-party notices. Explain
  that fork changes/new visual identity are maintained independently; do not grant
  upstream commercial-license or trademark rights on the maintainer's behalf.
- Update `NOTICE` accurately for newly supplied artwork without attributing it to
  Jannis, deleting original code credits or silently relicensing dependencies.
- The user-provided Portuguese “Origem e créditos” reference establishes the
  meaning; the English text expresses the same credit and non-affiliation.

## Acceptance

Both READMEs have functioning relative language/docs/image links, accurate commands
and mutually consistent product claims. Current subsystem docs and examples adopt
Veyvox; archived history/legal attribution is preserved and classified. No release
badge/download table points at nonexistent new artifacts before publication.
