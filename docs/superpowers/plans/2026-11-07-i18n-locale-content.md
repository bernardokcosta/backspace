# Locale Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` for inline
> implementation, task by task. This plan does not authorize implementer agents.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver complete, contextually reviewed current copy in all 25 languages
and enforce safe English-first behavior for future incomplete translations.

**Architecture:** Reuse current semantic namespaces and checker. Normal validation
rejects broken English/provided translations; an explicit strict mode measures
completion, including native catalogs through a static reader, never Electron eval.

**Tech Stack:** Existing JSON catalogs, Node ESM checker, web TypeScript compiler
AST utilities and Vitest fixtures; no translation API or new dependencies.

**Spec:** [Content](../specs/2026-11-07-i18n-locale-content.md).
**Parent:** [Initiative plan](2026-11-07-i18n-25-languages.md).

## Global Constraints

- Inherit the parent constraints and all 25 canonical codes/names.
- Translate meanings and target CLDR categories, not copied English suffixes.
- Portuguese software bots remain `bot`/`bots`; actual robots retain their meaning.
- No blank values, key echoes or copied English prose to manufacture completeness.
- No professional/native-speaker approval claims without actual review provenance.
- Complete current coverage is mandatory before activation. Missing future target
  keys/namespaces are debt, not default build failures; malformed supplied data is fatal.

## Review Focus

1. A registered language with its entire directory absent must not escape strict
   checks merely because directory enumeration cannot see it (C1).
2. Partial plurals, empty/non-string leaves, per-form broken placeholders/markup
   must fail, even if the union of a family's placeholders looks correct (C1).
3. Identical legitimate short terms need narrow contextual allowances, not global
   exemptions accidentally permitting untranslated prose (C1/C3–C8).
4. Native tables/dynamic dialog copy and accessible text must not be missed by the
   existing web-only JSX detector (C1/C2).
5. Corrected English meaning must reach every finished locale, with no stale
   terminology in rules/errors or app/media selector labels (C3–C8/L4).

## Task C1: validity versus strict completeness tooling

**Files:** modify `scripts/{check-i18n.mjs,i18n/check.mjs,i18n-allowlist.json}`,
`packages/web/src/i18n/{check,loader}.test.ts`, `docs/systems/localization.md`;
create `scripts/i18n/desktop.mjs` and `packages/web/src/i18n/desktopCatalogs.test.ts`.
**Interfaces:** extend `runAllChecks(root, options)` with
`strict?: boolean`, `locales?: readonly string[]`, `includeDesktop?: boolean`;
return findings in the existing `{rule,file,line?,message}` form. Keep direct
rule exports used by tests. `checkParity(root, { strict?: boolean, locales?: readonly string[] } = {})`
reports target-only semantic families always, missing targets only in strict mode.
`readDesktopCatalogs(root)` in the new static reader returns an object with
`catalogs: { surface: 'main' | 'recovery' | 'instancePicker', language: string, file: string, values: Record<string,string> }[]`
and `findings` in the existing finding shape. Invalid AST/value shapes are
findings, not evaluated source or silently skipped entries.

- [x] Add failing fixture assertions: English-only new key/namespace passes normal
  checks and fails strict; target-only keys/namespaces or missing English errors
  fail both. Strict catches a registered locale whose directory is wholly absent.
  Default checks still reject literals/direct Intl/markup/plural errors.

  Use the existing `makeRoot` fixture helper for an English-only feature:

  ```ts
  const root = makeRoot({
    [locale('en', 'common')]: { added: 'A new feature' },
    [locale('en', 'errors')]: { generic: 'Something went wrong' },
    [locale('de', 'common')]: {},
  });
  expect(runAllChecks(root)).toEqual([]);
  expect(runAllChecks(root, { strict: true })).toEqual(
    expect.arrayContaining([expect.objectContaining({ rule: 'parity' })]),
  );
  ```
- [x] Add invalid-data tests for malformed JSON, arrays/numbers/null/whitespace
  values, mixed plain/plural family shapes, missing required English forms,
  partial Arabic forms, and an interpolation/markup defect in one plural form
  concealed by a correct union across others. Required `count` may be grammatically
  omitted in a category whose text inherently states the number; document only
  that narrow rule and preserve all non-count variables/semantic agreement.
- [x] Add static native-reader fixtures with `const en`, typed target variables,
  catalog object references and inline `STRINGS`. Reject executable expressions,
  template interpolation and unknown values instead of executing source. Assert
  native/web registry code consistency and required native English keys.
- [x] Add CLI tests for `--strict`, `--locales=en,pt`, `--include-desktop`, unknown
  flags/codes and nonzero error exits. Normal validation works with a temporary
  web-only tree like Docker; include-desktop explicitly fails on absent native inputs.
- [x] Run `pnpm --filter @backspace/web test -- src/i18n/check.test.ts src/i18n/desktopCatalogs.test.ts`;
  expect FAIL on new policy/reader before implementation.
- [x] Implement the split in existing checker/CLI. Use registry AST (existing
  web TypeScript compiler resolver) to know all declared codes, including
  unreleased. Preserve fixtures lacking a registry by using their explicit locale
  set/directory inputs; production strict uses the real registry as authority.
  `--locales` scopes completion reporting only, never hides invalid provided data
  in another locale. Include English automatically and validate requested codes.
- [x] Add structural/source validity and native static inspection. Web targets
  use `{{name}}`, native `{name}`; compare each supplied value to its semantic
  source family, with intentional count-grammar exceptions tested, not blanket
  union-only checks. English remains fully typed/exhaustive. Native target
  `Partial` types and fallback must permit future English-only keys at compile time.
- [x] Keep copied-source detection active for supplied values. Extend existing
  allowlist compatibly to support scoped `{ language, namespace, key, value, reason }`
  entries in addition to existing invariant strings; keys identify exact values,
  not wildcards or whole files. Record why legitimate shared terms are identical.
- [x] Implement strict completeness for the selected locale set and all three
  native surfaces when requested, including placeholder/forms/markup consistency.
  Do not require desktop inputs in default builds. Reader lives under the already
  copied `scripts/i18n/`; no Docker change is needed for this design.
- [x] Rerun suites and `node scripts/check-i18n.mjs`; expect PASS. Run strict against
  current newly registered locales; expect reported missing coverage, not fake success.
  Update localization docs to distinguish these outcomes and new CLI flags.

## Task C2: complete surface inventory and extraction audit

**Files:** create `docs/superpowers/validation/2026-11-07-i18n-25-languages.md`;
modify only audited app-owned copy call sites under `packages/web/src/`, native
`packages/desktop/src/{main,recovery,l10n}.ts` and resource HTML, relevant English
catalogs and adjacent tests; `scripts/i18n-pending.txt` only if removing real debt.
**Interfaces:** use current `t`, `Trans`, `describeError`/`describeCodedError`,
`ErrorCode` and structured-message rendering. No new wire/error matching contract.
The ledger's inventory rows contain `surface`, `owner path`, `namespace/native key`,
`text origin`, `extraction status`, `context review` and `evidence`.

- [x] Inventory auth/invites; settings/account/appearance/privacy/accessibility;
  chat/composer/messages/DM/system events/embeds; spaces/social/search/admin/
  federation/uploads; voice/video/screen sharing/soundboard; mobile navigation;
  Juno lobby/game/results/ranking/rules/settings; notifications/toasts/tooltips/
  aria/alt; native tray/menu/dialog/update/recovery/picker. Record each owner path,
  including dynamic label builders, literal allowances and enum maps, not only JSX.
  Include app-owned bootstrap/offline/install metadata in `packages/web/index.html`,
  `packages/web/vite.config.ts` and any relevant public HTML, distinguishing real
  OS-owned install prompts from description/title copy supplied by this project.
- [x] Run `node scripts/check-i18n.mjs` and inspect `i18n-check: allow-literal`,
  `addToast`, `new Error`, notification/dialog `title/message/detail/buttons`,
  `textContent`, placeholders and accessible-label paths. Read current component
  rendering for candidates; passing regex/AST results are not a completed audit.
  Ledger records justified exclusions: user/external/OS-owned text, protocol
  identifiers, original printed card/media text and intentional brand terms.
- [x] For each app-owned gap, add an adjacent regression that changes language
  and asserts the visible/accessible value comes from a key, not the literal.
  Run that exact suite RED; extract to existing semantic namespace/native owner;
  run GREEN. Record exact edited file/test paths before proceeding to the next gap.
  Do not preemptively rewrite clean components or create one generic UI copy layer.
- [x] Preserve stable server/federation codes and details. Reuse coded translation
  or appropriate existing action fallback for uncoded failures; do not expose
  app-owned English prose as if translated or silently drop essential failure
  information. If complete localization requires a new wire contract, record the
  concrete gap and ask before changing protocol; do not declare coverage complete.
- [x] Run normal checks plus affected component/native tests; expect PASS with
  pending list still empty. Record final English/native baseline hashes/counts
  after R3 Automatic copy and extraction, before translating by meaning.

## Translation batch contract (applies to C3–C8)

Every locale task owns all these exact namespace files under its locale directory:
`admin.json`, `auth.json`, `chat.json`, `common.json`, `desktop.json`, `dm.json`,
`errors.json`, `federation.json`, `mobile.json`, `search.json`, `settings.json`,
`social.json`, `spaces.json`, `uploads.json`, `voice.json`.
Also owns that locale's entries in `packages/desktop/src/l10n.ts` and
`packages/desktop/resources/{recovery,instance-picker}.html`, scoped allowance
entries only when justified, and its glossary/review rows in the shared ledger.
No new namespace is needed just because the language is new.

For each locale, use one complete language pass, followed by a separate contextual
read of **every value**, not just the samples used for screenshots. Record product
glossary for bot, instance/server, space/channel, mute/deafen, screen sharing,
moderation/report, recovery, and Juno action/special cards/Alzheimer; formality,
sentence style and plural rules. Preserve community-approved distinct concepts.
Natural translations may restructure sentences; preserve non-count interpolation,
links/markup meaning, permissions/security warnings and capability-aware rules.

Tests prove structure/fallback, not fluency. For each batch record reviewed leaf/
family counts, namespace/native scope, intentional invariants and review provenance.
Correct unclear source meaning before translating, and propagate any later source
change to all already-completed languages. Never globally replace `robot`/`robô`.

## Task C3: audit existing five and establish corrected English baseline

**Files:** batch contract for `en,pt,de,ru,zh`; existing
`packages/web/src/i18n/ruOverviewTabName.test.ts`; create
`packages/web/src/i18n/terminology.test.ts`.
**Interfaces:** authoritative source meaning/key inventory is English; existing
Russian Overview remains pinned to `Основное`. Test semantic PT bot keys identified
in C2, not a blanket ban on the word robot in the whole catalog.

- [x] Add failing contextual regressions for any verified source/target mistakes,
  exact canonical Portuguese naming and bot terminology at actual affected keys.
  Run `pnpm --filter @backspace/web test -- src/i18n/terminology.test.ts src/i18n/ruOverviewTabName.test.ts`;
  expect FAIL only for concrete uncovered mistakes; preserve intentional existing terms.
- [x] Review all five full catalogs/native tables by meaning, correct errors and
  write the first five glossaries/review records. English is reviewed too; do not
  mark existing translations approved merely because parity already passes.
- [x] Run those suites, normal checker and
  `node scripts/check-i18n.mjs --strict --locales=en,pt,de,ru,zh --include-desktop`;
  expect PASS with no copied prose, placeholder loss or unjustified terminology change.
  Freeze the corrected source baseline; subsequent extraction/copy changes reopen
  affected rows for every completed locale.

## Task C4: Romance and Turkish languages

**Files:** batch contract for `es,fr,it,ro,tr` (five complete directories and
matching native entries, not five selected namespaces).
**Interfaces:** consume corrected C3 source/glossary and C1 strict validation.

- [x] Run `node scripts/check-i18n.mjs --strict --locales=en,es,fr,it,ro,tr --include-desktop`;
  record initial missing families/forms as RED, not a runtime defect in English fallback.
- [x] Translate all five languages and native surfaces, one locale at a time;
  review all values in context. Check formality, accents, Turkish casing and
  French/Romanian language-specific plural categories, not English's two forms.
- [x] Rerun the exact strict command and normal checker; expect PASS. Record
  reviewed counts/terms and rendered locale samples for L3, without activating yet.

## Task C5: remaining Slavic and Central European languages

**Files:** batch contract for `uk,pl,cs`.
**Interfaces:** same batch contract, with complete CLDR forms for each locale.

- [x] Run `node scripts/check-i18n.mjs --strict --locales=en,uk,pl,cs --include-desktop`;
  record RED coverage gaps.
- [x] Translate full catalogs/native surfaces and review every value. Inspect
  zero/one/few/many/other as actually required by Intl for each language and
  ensure UI terms are not copied mechanically from Russian.
- [x] Rerun strict and normal checks; expect PASS and completed review ledger rows.

## Task C6: Dutch and Nordic languages

**Files:** batch contract for `nl,sv,da,nb,fi`.
**Interfaces:** one Bokmål catalog `nb`; `no-*` is detection alias, not a duplicate.

- [x] Run `node scripts/check-i18n.mjs --strict --locales=en,nl,sv,da,nb,fi --include-desktop`;
  record RED coverage gaps.
- [x] Full-value contextual read of every value (completed in the 2026-11-08
  follow-up with user-authorized read-only per-language reviewers; initial
  sv/fi focused reports were explicitly sent back for the missing integral read);
  check compounding/long labels, Finnish case-sensitive constructions and Bokmål
  consistency rather than treating distinct Nordic languages as interchangeable.
- [x] Rerun strict and normal checks; expect PASS. Full review provenance and
  triaged corrections are recorded in the 2026-11-08 acceptance ledger section.

## Task C7: Arabic and Hindi

**Files:** batch contract for `ar,hi`.
**Interfaces:** Arabic RTL is presentation metadata, not server/game direction.

- [x] Run `node scripts/check-i18n.mjs --strict --locales=en,ar,hi --include-desktop`;
  record RED coverage gaps.
- [x] Full-value contextual read of every value (completed for ar/hi in the
  2026-11-08 user-authorized read-only review, with verified corrections); supply all
  six Arabic categories where required and correct Hindi agreement. Keep names,
  interpolation/links and technical tokens intact; do not insert ad hoc bidi
  control characters into prose to compensate for broken markup. Coordinate
  concrete rendered defects with L1/L2, not translation-shortening hacks.
- [x] Rerun strict/normal checks and runtime fallback count matrix; expect PASS.
  Integral contextual review is complete; final rendered acceptance is tracked in L3.

## Task C8: Southeast and East Asian additions

**Files:** batch contract for `id,vi,th,ja,ko`; existing `zh` already reviewed in C3.
**Interfaces:** use actual language plural categories and natural terminology;
no fabricated Chinese/Portuguese variants or dubbing editions.

- [x] Run `node scripts/check-i18n.mjs --strict --locales=en,id,vi,th,ja,ko --include-desktop`;
  record RED coverage gaps.
- [x] Full-value contextual read of every value (completed for id/vi/th/ja/ko
  in the 2026-11-08 user-authorized read-only review; concrete findings triaged
  and corrected without introducing English as a fake translation). Check Vietnamese diacritics, Thai sentence/line-break
  behavior, Japanese terminology and Korean politeness consistently; do not force
  English singular/plural shapes.
- [x] Rerun strict/normal checks and
  `pnpm --filter @backspace/web test -- src/i18n`;
  expect PASS. Final all-25 strict report and provenance audit belong to L4,
  not a conclusion inferred from separate partial batch reports.
