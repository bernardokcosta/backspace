# Spec: locale-content

Parent: [25-language initiative](2026-11-07-i18n-25-languages.md).
Consumes the registry/preference/fallback contract from `locale-runtime`.

## Objective

Deliver complete current-feature translations in all 25 approved languages,
audit the existing five for naturalness/accuracy, and ensure every app-owned UI
text can be translated. Separately enforce the user's future policy: English
mandatory, other translations optional with English fallback.

## Current-baseline audit and translation contract

- Inventory every current product surface in the parent spec, including native
  tray/menus/notifications, HTML recovery/instance selection, mobile, admin,
  Juno/rules/settings, errors, tooltips, accessible labels and dynamic UI copy.
- Inspect both rendered UI and source paths. Review current literal allowances,
  enum-to-label maps, native dialog construction, user-visible notifications,
  error fallbacks and function-produced copy; an empty pending list or passing
  regex/AST check is not proof that all visible strings were extracted.
- App-owned copy lives in English source catalogs and existing translation seams.
  User content/OS-owned strings and justified invariant names are exceptions,
  not an excuse to exempt whole files or whole product surfaces.
- Translate every current semantic key family into each target language. Supply
  the target language's CLDR plural forms, interpolation variables and required
  meaning, not just the same raw number of English keys. Additional forms for
  Arabic/Slavic languages are expected. Empty/whitespace values and source-key
  echo are never complete translations.
- Review all existing English, Portuguese, Russian, German and Chinese copy too;
  do not merely add 20 directories. Maintain a per-language glossary/style guide
  for product vocabulary, common app terms, formality and natural phrasing.
- Preserve the normal community word “bot” in Brazilian Portuguese; avoid
  mechanical “robô” for software bots. Keep a real robot/emoji meaning intact.
  Use contextual decisions for server/instance, space, channel, mute/deafen,
  screen sharing, reports and Juno terms rather than global search/replace.
- Source corrections propagate by meaning to targets, preserving actual game,
  security and permission behavior. Do not change business logic or wire errors
  to make translation easier. Preserve placeholders, markup semantics, named
  keys, privacy-safe card labels and accessibility text.
- Actual supplied card art, printed card words and spoken media remain untouched;
  translating a face name or settings label does not create a media edition.

## Delivery coverage versus future-feature rules

**Strict completion gate for this delivery:** a complete snapshot/report of the
final English baseline with zero missing semantic families, required forms or
untranslated app prose in any approved locale/native surface. English fallback
and copied source values cannot satisfy it. Retain intentional invariant terms
only with a narrow, reviewed reason. Existing release eligibility prevents new
unfinished languages reaching users during translation batches.

**Ongoing mandatory validation after this delivery:** English source/key/error
coverage, translatable call sites, JSON/schema/value validity, placeholders,
valid locale codes, safe fallbacks and proper forms for any supplied translation
family. Completely missing non-English keys or namespaces are coverage debt,
not build failures, for a new English-only feature.

Keep strict completeness as a distinct explicit mode/report in the existing
checker tooling. Default build/typecheck/check:i18n must not silently require
all 25 translations for every future new feature. Existing checks such as
literal-string detection and provided-translation integrity must remain active;
do not implement this by disabling the checker or expanding blanket suppressions.

The report distinguishes missing translations (expected English fallback) from
malformed/empty/placeholder-broken supplied translations (defects). A partial
plural family is invalid: either provide its required target forms or omit the
family and use tested English fallback. Missing English copy is always fatal,
including new error codes and newly introduced namespaces.

The current release's “100%” claim is tied to its recorded feature/source
baseline. A future English-only feature legitimately lowers target coverage;
do not keep asserting perpetual 100% or hide the missing coverage as translated.
Do not delete old baseline translations to manufacture passing checks.

## Structure and style

Reuse the 15 catalog namespaces under `packages/web/src/locales/<code>/`,
the native `packages/desktop/src/l10n.ts` and existing resources HTML ownership,
and `scripts/{check-i18n.mjs,i18n/check.mjs}` plus their tests/allowlist/pending
mechanisms; checker tests live in `packages/web/src/i18n/check.test.ts`.
Keep English key typing in the current resources contract. New
coverage/glossary artifacts must be bounded, useful and owned by this initiative,
not a new localization service or unrelated top-level framework.

```json
{ "members_one": "{{count}} member", "members_other": "{{count}} members" }
```

Targets use their actual grammar/categories, not copied English suffixes.

## Validation and commands

- Test an English-only new key and new namespace: normal checks pass, another
  locale displays English, and strict coverage reports the gap. Test a missing
  English key/error: normal checks fail. Test whole-family fallback over zero,
  singular, plural and language-specific counts.
- Test missing target namespaces/files, malformed/empty entries, missing target
  plural forms, mismatched interpolation and intentional invariant terms. No
  weakened validation is accepted merely to make an incomplete corpus pass.
- Test current full coverage in all 25 languages and native surfaces; inspect
  contextual language samples on all product areas, with no concealed fallback.
  Track review provenance honestly; automated checks do not establish fluency
  or professional/native-speaker approval.

```sh
pnpm check:i18n
pnpm typecheck
pnpm build
pnpm lint
pnpm --filter @backspace/web test -- src/i18n/check.test.ts
```

The implementation plan defines and runs the new explicit strict-coverage mode
without misrepresenting it as an already existing command. Add relevant web/
native tests and inventory screenshots; test data stays isolated.

## Boundaries and success

Always review source and actual rendering as well as coverage. Ask before using
a paid/external translation service, adding dependencies or changing scope.
Never send credentials/private project data to translation providers, invent
human-review provenance, copy English to fake coverage, translate user content
or suppress genuine broken translations. Success is complete current coverage
plus natural/contextual review and a demonstrably working future English-first
fallback workflow, without advertising unfinished language batches.
