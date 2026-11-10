# Spec: readme-presentation

Parent: [repository hygiene](2026-11-09-repository-hygiene-design.md).
Depends on: none. Approved on 2026-11-09; inherits parent commands/style/boundaries.

## Objective and files

Present minigames as a category in `README.md` and `README.pt-BR.md`, with Juno
only as an example. Extend `scripts/veyvox-docs.test.mjs` rather than introducing
another documentation-test mechanism.

## Acceptance

- Use `minigames` in English and `minijogos` in Portuguese in the top feature line.
  Juno may appear as an example within the category, not as a top-level product,
  standalone headline or disproportionately prominent feature.
- Preserve equivalent onboarding, valid links, transparent icon, 25 languages,
  accurate capabilities and commands, AGPL notices, and attribution to Jannis
  Braun (TheZwiss) and contributors.
- Add regression assertions for placement/prominence, not only word presence,
  without forbidding legitimate mentions of the game's name.
- Do not change Juno gameplay, assets, music, voice acting or localization.

## Validation

Run `node --test scripts/veyvox-docs.test.mjs`, inspect both rendered READMEs and
their relative links, then include the test in the full parent validation.
No open product question.
