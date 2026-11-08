# Spec: locale-runtime

Parent: [25-language initiative](2026-11-07-i18n-25-languages.md).

## Objective and contract

Own language selection, canonical labels/codes, direction, system-language
resolution and runtime English fallback for the approved 25 entries. This module
does not author the translation corpus or redesign app layouts.

Keep `SupportedLanguage` for concrete supported codes. Introduce an explicit
preference type conceptually `LanguagePreference = 'auto' | SupportedLanguage`;
do not overload resolved language to mean a saved choice. Consumers can observe
both preference and effective language, with one owner for resolving/applying it.

### Automatic and persistence

- Backspace settings offers localized **Automatic (system)** plus the canonical
  native language labels. Selecting Automatic follows the first supported
  preferred system/browser language, with English as final fallback.
- New/no-valid-preference installs default to Automatic. Preserve existing
  explicit `backspace-language` strings; never overwrite them merely on startup.
  Store `auto` as the preference, not the currently resolved result. Storage
  denial/malformed values leaves safe usable in-memory behavior.
- Explicit selection wins over later OS/browser changes. Automatic re-evaluates
  at initialization, when selected, and when the platform exposes a changed
  preference. Web listens to `languagechange`; native re-reads on app resume/
  foreground without a polling loop. OS changes that require an OS/app restart
  cannot be promised to appear sooner than the platform reports them.
- Match BCP 47 tags against the released registry in preference order. Normalize
  casing/regions; map `no-*` to `nb`. Unsupported tags continue to the next
  preferred language, then English. Keep documented pt/zh compatibility behavior.
- Preserve development-only unreleased-language previews without persisting
  overrides or weakening production release eligibility.

### Real desktop language versus region

On current Electron, read `app.getPreferredSystemLanguages()` in the native
owner. `app.getLocale()` is the application locale and `getSystemLocale()` may
be the formatting region; neither reliably represents the user's UI-language
preference list. In a normal browser use `navigator.languages`/`language`, which
may differ from the OS because browser settings/privacy control what is exposed.

Add only a narrow read-only optional bridge operation, conceptually
`getSystemLanguages(): Promise<readonly string[]>`, if the existing bridge has
no equivalent. Validate the main-window/main-frame sender with existing guard
patterns; do not expose Node, arbitrary IPC, paths or extra machine information.
Keep sandbox/contextIsolation/nodeIntegration posture unchanged.

The existing set-language synchronization must convey the actual preference
(including `auto`) and keep native tray/menu/recovery/picker presentation aligned
with the effective language. Preserve existing `language.json` concrete values;
when Automatic is selected, native persistence must retain that mode and resolve
the OS again on the next launch. In-memory mode changes must work even if saving
fails. Out-of-order async loads/system replies cannot overwrite a newer explicit
choice, update a detached renderer or leave controls in a stale language.

Older desktop bridges must remain usable: feature-detect the optional operation,
use the existing browser-language fallback for the renderer, and never claim an
old binary implements new native Automatic persistence or 25 native catalogs.
Full native acceptance is for the updated desktop source/build.

### Names, Juno and fallback

- `Português (Brasil)` is the exact shared native label in app/Juno UI and the
  existing pt-BR media selector. Do not maintain competing translated labels
  for the same language edition. Preserve distinct locale/edition codes.
- App Automatic follows system; Juno Automatic follows the app; Juno explicit
  language affects only its existing scope. Neither setting alters audio or
  creates a dubbing/card-art translation.
- Preserve bundled English resources and on-demand target loading. Missing
  target key/namespace/chunk resolves to the English source without raw keys,
  empty labels, console-error spam or unbounded retries. English absence is a
  defect, not a reason to fabricate component literals.
- A completely missing target plural family falls back to English for every
  count. Partially supplied invalid plural families are rejected by validation,
  not quietly mixed into misleading half-translations. Native catalogs and
  recovery/picker lookups get the same safe English fallback policy.

## Project structure and style

Reuse `packages/web/src/i18n/{languages,index,loader,resources,formatters}.ts`,
`components/modals/settingsPanels/LanguageSection.tsx`, Juno's existing locale/
settings/preferences/assets seams, and `packages/desktop/src/{l10n,main,preload}.ts`
plus `packages/web/src/platform/electron.d.ts`. Keep native catalogs lightweight.

Use strict unions, validated persistence and existing owner/listener patterns:

```ts
type LanguagePreference = 'auto' | SupportedLanguage;
// Resolution and effective-language application stay in the existing i18n owner.
```

This is a contract sketch, not authorization to duplicate runtime state, add a
new store/framework or change user/account/server preference ownership.

## Tests and commands

Test Automatic/explicit transitions, ordered OS/browser tags, region/case/alias
matching, unavailable storage, existing values, invalid IPC, old bridge fallback,
late async completion, startup/resume cleanup, source/target fallback including
new namespace/plurals, and app-versus-Juno/native isolation. Use isolated native
profiles; do not change the user's real OS settings to test detection.

Run the parent build/types/lint/i18n commands, affected web i18n/language/Juno
tests and native l10n/bridge tests. Desktop TS and actual controlled Electron
startup are separate from the root build. Record platform acceptance truthfully.

## Boundaries and success

Always preserve existing explicit choices, canonical names, English availability
and preload security. Ask before a dependency/protocol/platform expansion. Never
read secrets, change OS language/volume, disable isolation or mutate production
profiles. Success means the current app and native shell follow the selected
mode correctly, without a second preference truth source or frozen Automatic.

Documentation grounding: [Electron app APIs](https://www.electronjs.org/docs/latest/api/app#appgetpreferredsystemlanguages)
and [Navigator.languages](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/languages),
checked 2026-11-07. Context7 quota was unavailable; official docs were read directly.
