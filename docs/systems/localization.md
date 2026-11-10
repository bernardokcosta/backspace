# Localization

Veyvox 1.17.0 replaces the product proper name in all 25 web/native catalogs,
including Juno's Automatic labels, without changing keys, plurals, placeholders,
language selection or Juno's actual media edition. Finnish/Turkish name inflections
follow the new name. The actual Backspace keyboard key in sound-shortcut help and
legacy storage names remain unchanged. PWA descriptive names change to Veyvox;
install identity URLs/start_url/scope and language preference persistence do not.

Native Juno UI/rules/card names live under `voice:juno`; `juno_*` error codes
have entries in all 25 error catalogs. The invariant game name "Juno" follows
the existing brand-name allowlist convention; its surrounding copy is translated.
Juno result/XP/ranking/loading/unavailable text and win/round plurals use the same
25 catalogs. Wire colors stay coral/amber/mint/sky, but their translated labels
are red/yellow/green/blue to match the supplied original art. Button/score labels
are real localized DOM text, not baked-in Portuguese preview text.
Missed-JUNO reports use the same catalogs for action/target, relative remaining
seconds and confirmed reporter/target/actual draw. Rules select reporting versus
legacy automatic-penalty text from the hosting game's optional supportsReports
capability; translations must not claim a rule that the remote host lacks.
Memory-curse card names, neutral hidden-slot labels/instructions, affected-player
and actual-draw miss feedback, plus enhanced-only rules use `voice:juno.memory`
and `juno.faces.memory` in all 25 catalogs. Hidden slots never name color/face;
`errors:juno_update_required` explains incompatible enhanced rounds without
retaining the old private view. The supplied card artwork/clip is not translated
or regenerated; its provenance is recorded in the Juno asset manifest.

Juno now has a game-local locale boundary (`JunoLocale`), sharing the existing
catalog loader/resources but not the app's selected language. Device preference
`language: auto` follows current/later Veyvox language; an explicit existing
released language scopes table/tile, rules, settings, result/ranking, formatted
counts/percentages and coded game errors only. It does not change app storage,
document lang/dir, generic Games/voice chrome or desktop language notification.
`useFormatters()` honors its contextual i18n instance through `createFormatters`;
the default exported/app formatters remain tied to app language. Existing
`describeError(error, instance)` is reused, not a separate error translator.

Game roots carry their own `lang`/`dir` from `useJunoLanguage()` (game
preference, else app language): the table section, the tile button and the
portalled settings dialog root. React context crosses the settings portal but
DOM inheritance does not, so the dialog sets them explicitly. Physical game
geometry stays LTR (`.juno-arena { direction: ltr }` with direction reapplied
only inside prose roots): named seats, orbit art and direction arrows encode
positions, not reading order. Header logo/actions also keep their physical LTR
order, while Arabic guide/practice prose remains RTL. Long card-example captions
wrap within their grid cells without shrinking the text. User-authored names and message text use
`dir="auto"` isolation (PersonName, message content, composer mirror and
textarea, edit textarea) so Arabic usernames/URLs keep readable order without
rewriting content or escaping HTML by string injection. The composer mirror uses
`unicode-bidi: plaintext` to match the native textarea's per-paragraph layout.
Full account handles in account/settings cards use `<bdi dir="ltr">`, preserving
the leading `@` and federated handle rather than letting surrounding RTL reorder it.
Role-list names and the unchanged `@everyone` identifier use `bdi dir="auto"`,
so each role keeps its own reading direction independently of the settings UI.

Font stacks are per script, not per brand: DM Sans stays only where the bundled
subset covers the script (Latin and Vietnamese); Russian and Ukrainian use the
bundled Inter Cyrillic range (U+0400-052F); Simplified Chinese, Arabic, Hindi,
Thai, Japanese and Korean use platform stacks on the app root, the scoped
game/settings roots and the emoji-picker variable. No webfont is downloaded
for those scripts.

Structural coverage and rendered acceptance are separate gates; catalog checks
cannot establish layout. The initiative validation ledger records the actual
browser matrix, native HTML captures and isolated Windows Electron/production-
preload checks, including controlled IPC/network limits. Simulated language
changes do not establish a real OS-settings change, installed updater action,
other operating systems or live multi-device calls.

The gear/modal copy is `voice:juno.settings` in all 25 catalogs; language
options retain each language's native name. Per user refinement the modal omits
the personal-storage, dubbing and comfortable-volume explanatory paragraphs.
Dubbing/card text is a separate Automatic-or-pt-BR preference. Automatic matches
an actually supplied edition for the effective game UI language, falling back to
pt-BR (currently the result for every UI language). `JUNO_DUBBINGS` supplies the
edition's canonical registry language code and actual memory artwork/clip. Its
label reuses `Português (Brasil)` from the registry in every UI language, not a
second translated name. No nonexistent language/media is
advertised, translated or requested. The settings changes are local and never
change a server snapshot/round's language or game commands.

Soundboard playback refusals distinguish missing/reconnecting voice ownership,
moderation/permission mute and deafen with three stable error codes and text in
all 25 catalogs. Ordinary self microphone mute remains allowed.

The retired desktop minimum-version policy's mandatory-screen copy and error
code have been removed from all 25 catalogs. Optional desktop update prompts
and settings remain localized.

How Veyvox is translated, and the rules every string, count, date and
error message follows so that the translations stay correct as the product
moves. This spec is the contract; the foundation PR implements it and each
surface sweep PR extends it.

Shipped languages: all 25 registry entries are released — English (`en`, the
source language and the fallback), Russian (`ru`), German (`de`), Brazilian
Portuguese (`pt`), Simplified Chinese (`zh`), Spanish (`es`), French (`fr`),
Italian (`it`), Ukrainian (`uk`), Polish (`pl`), Dutch (`nl`), Swedish (`sv`),
Danish (`da`), Norwegian Bokmål (`nb`), Finnish (`fi`), Czech (`cs`), Romanian
(`ro`), Turkish (`tr`), Arabic (`ar`, RTL), Hindi (`hi`), Indonesian (`id`),
Vietnamese (`vi`), Thai (`th`), Japanese (`ja`) and Korean (`ko`). The
`released` flag mechanism stays in place for future languages; registration
alone was never delivered language support.

The project-hub `project` namespace and Support-card-only admin copy were
retired in 1.15.2 across all 25 languages; they are not registered or loaded.
Space discovery/Explore/directory-only copy is also removed. Invitation request
actions live under `spaces:join.request`, and retained space access/description
controls under `spaces:settings.access`. Social Discover People is independent
and retains its own localization.

`zh` is the Simplified catalog and detection maps every `zh-*` tag onto it,
Traditional included: a `zh-TW` browser gets a script its user can read
rather than English, and the picker says 简体中文 so they know which variant
they have. A Traditional catalog would be `zh-Hant`, and adding it means
teaching `resolveSupportedLanguage` to look at the script subtag, which it
does not today.

`pt` is the Brazilian Portuguese catalog, and it follows the same rule.
Portuguese has two written standards, Brazilian (`pt-BR`) and European
(`pt-PT`), which differ in spelling, vocabulary and forms of address but are
mutually readable. Detection maps every `pt-*` tag onto the one catalog: a
`pt-PT` browser gets Portuguese its user can read rather than English, and the
picker says Português (Brasil) so they know which variant they have.

Source files:
- Runtime setup: `packages/web/src/i18n/index.ts` (`initI18n`, `setLanguage`,
  `getLanguage`; detection, persistence, `<html lang>`/`dir` sync, desktop IPC)
- Language list: `packages/web/src/i18n/languages.ts` (`supportedLanguages`,
  `SupportedLanguage`, `LanguagePreference`, `resolveSupportedLanguage`, `pickLanguage`)
- Preference subscription: `packages/web/src/i18n/useLanguagePreference.ts`; the
  existing i18n owner exposes get/subscribe/setLanguagePreference. No second store.
- Lazy catalog loader: `packages/web/src/i18n/loader.ts` (`LazyCatalogBackend`)
- Typed keys: `packages/web/src/i18n/resources.ts` and
  `packages/web/src/i18n/i18next.d.ts` (`CustomTypeOptions`)
- Formatters: `packages/web/src/i18n/formatters.ts` (`createFormatters`,
  `formatters`, `useFormatters`)
- Error mapping: `packages/web/src/i18n/errors.ts` (`describeError`)
- Language picker: `packages/web/src/components/modals/settingsPanels/LanguageSection.tsx`
- Catalogs: `packages/web/src/locales/<lng>/<namespace>.json`
- The shared Games picker prompt uses `voice:juno.chooseGame`; the voice
  sidebar's RNNoise description uses `voice:controls.audioTreatmentHint` and
  explicitly distinguishes processing from muting in all 25 catalogs.
- Screen-share Force SDR controls/failures use `voice:streamSettings.forceSdr*`
  in all 25 catalogs; capability/unavailable and restart-share copy describe
  effective behavior without changing the saved device preference.
- Screen-share HEVC capability/fallback help uses `voice:streamSettings.h265*`
  in all 25 catalogs. `codecOption.h265` is the invariant codec name
  "H265 (HEVC)", allowlisted like VP9/H264; the explanatory text is translated.
- Shared error codes: `packages/shared/src/errors.ts` (`ERROR_CODES`,
  `ErrorCode`, `ApiErrorBody`, `isErrorCode`)
- Server error helper: `packages/server/src/utils/httpErrors.ts` (`sendError`,
  `ERROR_MESSAGES`)
- Desktop main-process catalog: `packages/desktop/src/l10n.ts`; the recovery
  and instance-picker pages under `packages/desktop/resources/` carry their
  own inline catalogs
- Consistency check: `scripts/check-i18n.mjs` with its rules in
  `scripts/i18n/check.mjs` (runs in `pnpm typecheck` and in the web build)
- Test bootstrap: `packages/web/src/test/setup.ts` starts i18next in English
  before any component test renders

---

## Library

`i18next` with `react-i18next`. Chosen because the catalogs are plain JSON
that Weblate, Crowdin and every other translation tool can read, and because
its plural handling uses the CLDR categories (`one`, `few`, `many`, `other`)
that Russian needs. No ICU message-format plugin: interpolation plus CLDR
plurals cover everything the UI says, and ICU syntax in catalogs is a
translator hazard.

No other dependency. Dates, numbers and relative times come from the
platform `Intl` APIs.

---

## Keys

Keys name what a string means in the product, never what it says in English
and never where it lives in the source tree.

Shape: `<namespace>:<element>.<meaning>`, for example
`chat:composer.placeholder`, `settings:desktop.autoLaunch.label`,
`voice:controls.mute`, `errors:auth.invalidCredentials`.

Rules:
- The namespace is a product surface (table below), not a component or file
  name. Renaming a component never touches a catalog.
- Segments are camelCase, no spaces, no sentence text. A key like
  `yourPasswordIsVerifiedLocally` is wrong; `passwordLocalVerificationNote`
  is right.
- One key per distinct meaning. Two places that happen to say "Save" but
  mean different actions (save a draft, save profile changes) get two keys;
  translators may need different words.
- Never build a key at runtime from a variable (`t(\`status.${x}\`)`) unless
  the variable is a closed union and every member is listed in the catalog.
  The check script cannot see through it, so the call site names the keys it
  covers in a comment for the check script (see Consistency check).
- Keys are typed. `t('chat:composer.placeholde')` is a compile error and
  keys autocomplete in the editor. A component that mixes namespaces declares
  them both: `useTranslation(['settings', 'common'])`, then
  `t('common:actions.save')`. With only `useTranslation('settings')` the
  `common:` prefix is a type error, which is i18next 26 doing its job.

### Namespaces

| Namespace | Covers |
|-----------|--------|
| `common` | Shared strings used across surfaces, grouped as `actions` (Save, Cancel, Accept, Leave, Log In…), `states` (Loading, Enabled, the four presence labels, Settings saved…), `labels` (Username, Password, Members, Friends, Danger Zone…), `time` (Today at, Yesterday at, Never, Just now), `units` (ms, %, kbps, Mbps) and `colors` (the avatar and folder colour names); the language selector. `src/i18n/presence.ts` maps a presence status to its `states` key so every surface shows the same words |
| `auth` | Login, register, join-by-invite, password fields, federated account creation |
| `chat` | Message list, composer, attachments, embeds, reactions, replies, typing, jump-to-message |
| `dm` | DM list, group DM management, DM calls, DM system messages |
| `voice` | Voice channel controls, screen share, stream tiles, device pickers |
| `spaces` | Space, category and channel CRUD, invites/requests, access/description, membership, bans and roles; per-space and per-channel notification settings (`notifications.*`; level/mute-duration labels are closed unions mapped by `switch` in `NotificationSettingsControls.tsx`) |
| `settings` | User settings modal and its panels (account, voice, privacy, connections, keybinds, desktop) |
| `admin` | Instance settings panels (general, registration, users, storage, streaming, updates, federation); the space-discovery ladder and the directory status line (`general.discovery.*`, `general.directory.*`) |
| `federation` | Connected instances UI, peering requests, identity attach and detach |
| `social` | Friends page, friend requests, user profiles, mutuals, user search |
| `search` | Search popover and filter help |
| `uploads` | Transfer indicator, upload errors, crop dialog |
| `desktop` | Renderer-side desktop strings: update banner, recovery notices, keybind setup |
| `mobile` | Mobile shell, bottom navigation, screen titles |
| `errors` | Localized messages for every `ErrorCode` in `packages/shared` |

One JSON file per namespace per language. `common` is the default
namespace; everything else is referenced with the `ns:` prefix.

---

## Plurals

Every string that contains a count goes through an i18next plural key. No
`${n} file${n === 1 ? '' : 's'}`, no `_one`/`_other` suffix tricks that leave
the noun outside the catalog.

Each language supplies the CLDR categories it needs. The check script takes
them from `Intl.PluralRules(lng).resolvedOptions().pluralCategories`, the
same data i18next selects a form with at runtime, so there is no table to
keep in step; for the shipped languages that is:

| Language | Categories |
|----------|-----------|
| en | `_one`, `_other` |
| de | `_one`, `_other` |
| ru | `_one`, `_few`, `_many`, `_other` |
| pt | `_one`, `_many`, `_other` |
| zh | `_other` |

Portuguese `_many` is CLDR's category for exact millions (`1000000`,
`2000000`), the counts a spelled-out form would write as "1 milhão de
membros". i18next selects it for those counts, so every Portuguese plural key
carries it; with the count rendered as digits it reads the same as `_other`.

A catalog directory whose code `Intl` does not know is a finding of its own,
because the runtime could not pluralize it either.

Example (`admin.json`):

```json
{
  "storage": {
    "deletedFiles_one": "Deleted {{count}} file",
    "deletedFiles_other": "Deleted {{count}} files"
  }
}
```

Russian:

```json
{
  "storage": {
    "deletedFiles_one": "Удалён {{count}} файл",
    "deletedFiles_few": "Удалено {{count}} файла",
    "deletedFiles_many": "Удалено {{count}} файлов",
    "deletedFiles_other": "Удалено {{count}} файла"
  }
}
```

The check script fails a catalog whose plural key is missing a category for
its language, and fails any `t()` call that interpolates `count` into a key
without plural forms.

Zero is a normal `_other` (or `_many` in Russian) unless the UI wants a
distinct phrase, in which case the key gets a `_zero` form and the call site
passes `count: 0` as usual.

---

## Dates, times and numbers

All formatting goes through `packages/web/src/i18n/formatters.ts`. Nothing
else in the web package calls `toLocaleDateString`, `toLocaleTimeString`,
`toLocaleString` or constructs an `Intl.*` formatter directly; the check
script enforces this.

The formatters take the locale from the selected language, not from the
browser default, so a German user on an English OS sees German dates. Each
formatter reads requested `i18n.language` at call time (English text fallback does
not erase the chosen script/number locale); components use the
`useFormatters()` hook, which subscribes to language changes and re-renders.

| Function | Use | Backing API |
|----------|-----|-------------|
| `formatTime(ts)` | Message timestamps, "today" DM previews | `Intl.DateTimeFormat` `{ hour: 'numeric', minute: '2-digit' }` |
| `formatShortDate(ts)` | DM previews, day separators | `{ month: 'short', day: 'numeric' }`, year added when not the current year |
| `formatMediumDate(ts)` | Lists that always want the year: users, bans, peers, profile "member since" | `{ month: 'short', day: 'numeric', year: 'numeric' }` |
| `formatLongDate(ts)` | Update panel | `{ day: 'numeric', month: 'long', year: 'numeric' }` |
| `formatFullDate(ts)` | Message list day separators | weekday plus long date |
| `formatNumericDate(ts)` | Compact tables | `{ dateStyle: 'short' }` |
| `formatDateTime(ts)` | Message hover, search results, redemption log | `{ dateStyle: 'medium', timeStyle: 'short' }` |
| `formatRelativeTime(ts)` | "Last checked 5 minutes ago": elapsed time in the largest whole unit | `Intl.RelativeTimeFormat` with `numeric: 'auto'` |
| `formatRelativeDay(ts)` | "yesterday" in DM previews: the calendar day, so 23:00 and 01:00 are a day apart | `Intl.RelativeTimeFormat`, `day` unit |
| `formatNumber(n)` | Counts shown as bare numbers | `Intl.NumberFormat` |
| `formatPercent(p)` | Sliders that show `150%` | `Intl.NumberFormat` `style: 'percent'` |
| `formatBytes(n)` | Storage panel, transfer indicator | `Intl.NumberFormat` with `style: 'unit'` and the right byte unit |
| `formatList(items)` | Reaction tooltip ("You, Mira, and 3 others"): an "and" list with the language's separators | `Intl.ListFormat` `{ style: 'long', type: 'conjunction' }` |

`formatDmTimestamp` in `dmFormatters.ts` keeps its today/yesterday/this-year
branching but delegates every branch to these formatters, and the "Yesterday"
branch is `formatRelativeDay` rather than a literal.

The elapsed and calendar variants exist because they answer different
questions: a message sent at 14:05 yesterday is "20 hours ago" as elapsed time
and "yesterday" as a calendar day, and each UI wants one of the two.

Tests set the language explicitly through `i18n.changeLanguage` before
asserting on formatted output. Asserting `Mar 15` without setting the
language is the bug the previous `dmFormatters.test.ts` had.

---

## Loading

English is bundled with the app as the fallback and is always present.
Every other language is loaded on demand, one namespace at a time, through
a small i18next backend in `loader.ts` built on `import.meta.glob` with lazy
imports. Vite splits each `<lng>/<namespace>.json` into its own chunk, so a
Russian user downloads Russian and nothing else, and an English user
downloads no catalogs beyond the bundled ones.

Missing keys in a non-English catalog fall back to English at runtime
(i18next `fallbackLng`), so a partially translated surface degrades to
English rather than showing a key.

The store shape for `CustomTypeOptions.resources` is derived from the
English catalogs (`resources.ts` imports every `en/*.json`), which is what
makes keys typed without maintaining a parallel type by hand.

---

## Language selection and persistence

Detection order on startup:

1. Stored released explicit choice under `localStorage['backspace-language']`.
2. Automatic (also the missing/invalid default): on updated Electron use the ordered
   OS UI languages from the optional `getSystemLanguages()` bridge; in browsers or
   disconnected/older bridges use `navigator.languages`/`language`.
3. `en`.

Persist `auto` as a mode, never its current resolved language. Explicit selections
ignore later system changes. Automatic refreshes on `languagechange`, foreground
focus and visible-document changes without polling. Normalize Norwegian `no-*` to
the Bokmål `nb` entry; unsupported/unreleased tags continue to the next preference.
Browser language preferences may differ from the OS and are the only browser data
available. Platform changes may require restart before Electron reports them.

Each entry in `supportedLanguages` carries a `released` flag. Only released
languages appear in the picker (`availableLanguages`) or can be chosen by
detection; a stored choice for an unreleased language is ignored. All 25
registry entries are released. The flag exists for the next language: it lands
surface by surface with
`released: false`, so a release cut in between stays free of that language
rather than shipping it half translated, and the PR that finishes it flips the
flag. Tests reach a
hypothetically unreleased language with `setLanguage` or `initI18n({ releasedLanguages })`;
people reached unreleased ones with `?lang=<code>` on the URL, which works in development
builds only and is never persisted.

Detection alone never writes the stored choice. A user who has not picked a
language keeps following their browser; only the picker persists.
`initI18n` resolves after the detected language's catalogs are loaded, and
`main.tsx` awaits it before the first render, so there is no English flash.

The selector lives in the user settings modal, Account panel, section
"Language". It offers localized Automatic (system) plus released entries, showing each by its
`nativeName` (English, Русский, Deutsch, Português (Brasil), 简体中文, Español,
Français, Italiano, Українська, Polski, Nederlands, Svenska, Dansk,
Norsk (bokmål), Suomi, Čeština, Română, Türkçe, العربية, हिन्दी,
Bahasa Indonesia, Tiếng Việt, ไทย, 日本語, 한국어); the
list is not translated, because a user who cannot read the current language needs to find their own.

Changing the language:
- Persists the choice.
- Notifies preference subscribers even if Automatic and explicit resolve to the
  same language; React's selector is not driven only by languageChanged.
- Sets `document.documentElement.lang` and `dir` (from the language's `dir`
  field; Arabic is `rtl`, while the other shipped languages are `ltr`).
- In the desktop app, sends `set-language` over IPC so the main process
  relabels the tray and application menus. New shells receive the mode; old
  bridges receive the effective concrete language, with old native limitations.

Language loads are preloaded and commits serialized/generation-guarded; older
OS/catalog replies cannot overwrite a newer choice. Development URL previews are
neither persisted nor sent to native and ignore Automatic refresh until the user
makes a real selection. An absent target namespace is an empty bundle so English
fallback works without repeated backend errors; real failed imports stay bounded.

The choice is per device, not per account. It is not synced to the server;
a user's language is a property of the machine in front of them.

---

## Server errors

The soundboard uses the `voice:soundboard.*` surface and five error codes:
`soundboard_disabled`, `soundboard_invalid_audio`, `soundboard_duration_limit`,
`soundboard_full` and `soundboard_not_found`, translated in every shipped locale.

The server never localizes. It sends a stable machine-readable code, and the
client owns the words.

Wire contract (`packages/shared/src/errors.ts`):

```ts
interface ApiErrorBody {
  error: string;       // English text, kept for older clients and logs
  code?: ErrorCode;    // stable identifier, e.g. 'current_password_incorrect'
  statusCode: number;
  details?: Record<string, string | number>; // interpolation values, e.g. { max: 32 }
}
```

`ErrorCode` is a snake_case string union in `packages/shared`. The shape
follows the codes that already existed before this system (`recipient_deleted`
in the DM routes, the friend-request codes in `social.ts`,
`PEER_EXISTS_RESET_REQUIRED` in peering), all of which are members. A code
never changes meaning once shipped.

Routes send errors through `sendError(reply, status, code, details?)` in
`packages/server/src/utils/httpErrors.ts`, which looks up the English text
for the code and fills the body. `ERROR_MESSAGES` is typed
`Record<ErrorCode, string>`, so adding a code without English text does not
compile. Routes that have not been converted keep sending `{ error,
statusCode }`; the contract is backward compatible in both directions because
a desktop app and an instance version independently, and because the web
client talks directly to federated peers that may run any version.

The client's `HttpError` carries `code` and `details`, parsed by
`HttpError.fromBody`. It accepts a `code` field, and, for the older routes
that put the code in `error` itself, an `error` value that is a known code.
Unknown codes are dropped, so a peer cannot inject arbitrary catalog keys.
Components render an error with `describeError(err)` from `i18n/errors.ts`,
which returns the localized `errors:` string for the code, interpolating
`details`, and falls back to the server's English `error` text when there is
no code or the catalog has no entry. A `code` that is missing from the
`errors` English namespace is a check-script failure. Missing target translations
use bundled English; explicit strict coverage reports them as debt, not translated.

A surface whose own failure text says more than an uncoded failure would (a
browser exception from a clipboard write, a server's bare English `error`)
uses `describeCodedError(err, fallback)` from the same file: the code's text
when the error is an `HttpError` with a code, else `fallback`. The space
menu's Invite People toasts and the notification settings save use it.

Federation: error bodies relayed from a peer instance follow the same
contract, so a code from a newer peer is localized and a bare `error` from
an older peer is shown as is.

Directory-only errors and `space_not_public` were removed with their exclusive
endpoints/consumers in 1.15.2. Retained invitation errors remain localized.

Two codes are no longer sent by a current server but stay in the list, because an older instance still sends them and a code never changes meaning: `space_uses_join_requests` (an invite link refused for a space joined by request) and `space_requires_approval` (a DM invite to one refused). Both stopped after 1.9.0, when a request space got an invite link that leads to a join request; `join_request_required` now carries `details.spaceId` for that request ([spaces.md](spaces.md), "Join by Invite Code").

Personal stickers ([uploads.md](uploads.md#14-personal-stickers)) added
four codes: `sticker_invalid_image` (`details.max`, in MB), `sticker_not_local`,
`sticker_not_found` and `sticker_collection_full` (`details.max`). The
sticker upload limit answers with the shared `rate_limited`.

Concurrent permission edits ([permissions.md](permissions.md), "Concurrent
edits") added two `409` codes: `overrides_conflict` (a channel or category
override changed since the editor loaded it) and `role_permissions_conflict`
(a role's permissions did). Their catalog text tells the user to review and
save again; the editors reload before showing it.

One code is minted by the client and never by a route:
`federation_different_password`, carried by `RemoteLoginRequiredError` when a
remote instance refuses the credential the user's home issued for it (the same
class carries the route code `federated_registration_closed` when the instance
is closed instead; see [client-federation.md](client-federation.md), step 7 of
the connect flow). It sits in `ERROR_CODES` and in `ERROR_MESSAGES` like any
other, because
`ERROR_MESSAGES` is exhaustive and the English text is still the fallback, but
no route sends it. The pattern for a client-minted code is the one
`RateLimitError` established: subclass `HttpError`, pass a registered code, and
let `describeError` find the catalog entry.

Client state that is not an error follows the same split without joining
`ErrorCode`. The federation registry's `errorMessage` holds one of four
reason codes (`unreachable`, `session_expired`, `reauthenticate`,
`authenticate_home`) written by `instanceStore` and turned into words by
`describeRegistryError` in `i18n/registryErrors.ts`, against
`federation:connections.row.reason.*`. They are not `ErrorCode`s because
nothing throws or sends them and `ERROR_MESSAGES` is exhaustive over that
union, which would put English text in the server package for a string only
the web client writes and reads. A value the switch does not recognise is
rendered as it stands: registry rows sync between clients, and one written
before this change carries an English sentence that is still the row's only
explanation. See
[client-federation.md](client-federation.md#the-reason-field-errormessage).

For a store that reports a failure, words should be chosen at the surface in
the language the reader has now, rather than stored as an English sentence.

The check reads `ERROR_CODES` by scanning the array for quoted words, so it
strips comments from the file first (`readErrorCodes` in
`scripts/i18n/check.mjs`). Without that step a single apostrophe in a comment
inside the array desynchronises every quote pair after it and the run reports
a hundred-odd findings naming fragments of the file rather than the comment
that caused them. Prose in that array is ordinary English; the stripping is
what keeps it safe.

The post-auth HTTP limiter (`utils/httpRateLimit.ts`, see api.md for policies,
and every per-route override of it) answers in the same shape through its
`errorResponseBuilder`, built with `errorBody` from `httpErrors.ts` so the
code is typed there too: `{ error, code: 'rate_limited', statusCode: 429,
retryAfter, rateLimitScope? }`, with `retryAfter` in seconds next to `Retry-After`.
Manual/action quotas use that contract too. Scoped safe reads can recover once
within a bounded cancellable wait; an exhausted/legacy refusal throws `RateLimitError`, an
`HttpError` with `status 429`, the body's own code when the route sends
one and `rate_limited` otherwise, plus `retryAfter`, so `describeError`
localizes it like any other server error and the auth pages keep their
countdown. The federated lookup's `lookup_rate_limited` is a different code
because it reports a peer's limit, not this instance's; it reaches the
client through the same class and shows its own catalog text.

Every route file is converted: auth, users, spaces, channels, messages, DMs
(including the space-invite endpoint), social, explore, admin, settings,
search, LiveKit, uploads, GIF and URL metadata. The `authenticate`,
`requireAdmin` and `requireLocalUser` hooks in `utils/auth.ts` send codes
too (`unauthorized`, `account_deleted`, `forbidden`) while keeping their
English text. Two responses carry extra fields next to the shared shape: the
username availability check (`available`, `reason`) and the owned-spaces
rejection (`ownedSpaces`). The only sites left without codes are the
test-only peer seeding route and most of the WebSocket handler's error
messages, which are a separate protocol. A WebSocket `error` carries
`details` next to `code` where the code's text has placeholders, and the
client passes them to `describeErrorCode`. The WebSocket refusals that carry a
code are `role_hierarchy` (voice moderation), every refusal of
`dm_message_create`, `dm_message_edit` and `dm_message_delete` (the REST
routes' codes, from `utils/dmMessageRules.ts`; see
[websocket.md](websocket.md#dm-messages)), `dm_call_in_progress`,
`not_dm_member` and `validation_failed` (`dm_call_start`), and
`dm_call_not_found`, `not_dm_member` and `validation_failed`
(`dm_call_accept`; see [voice.md](voice.md#dm-call-state-machine)), every
refusal of `channel_poke` (`validation_failed`, `channel_not_found`,
`missing_permission`, `member_not_found`, `poke_target_no_access`,
`rate_limited`; see [websocket.md](websocket.md#channel-pokes)), and
`system_message_immutable` for a `message_edit` of a channel system message.

The web client no longer matches on English error text. The places that
used to (the join page, the space invite card, the invite modal, the roles
panel, the federated account registration in `instanceStore`) check
`err.code`; the join helper in `utils/joinErrors.ts` keeps a text fallback
for a federated peer on a version that predates the codes.

---

## System messages

DM system messages (member added, removed, left, ownership transferred, call
events, space invites) are stored and relayed as structured JSON with a
`type` discriminator and identity fields, never as English text. The client
renders them through `dmFormatters.ts`, which now reads the `dm:system.*`
keys. It is federation safe because peers relay the structure, not a
rendering.

Space channel system messages (a poke) follow the same rule: structured JSON
(`channelSystemEvents.ts`) with ids and a name snapshot, rendered by
`ChannelSystemMessage` from `chat:poke.received`. Content a client does not
know renders `dm:system.generic` in both places.

If a future feature stores a human sentence on the server, that is a bug in
the feature, not a localization task.

---

## Desktop main process

The main process shows a handful of strings outside the renderer: tray menu
items, the application menu (macOS, and the accelerator-only Edit menu on
Windows and Linux), the update items, the recovery page and the instance
picker. The menu strings live in `packages/desktop/src/l10n.ts` as a small
typed catalog with all 25 languages;
`translateDesktop(language, key, values?)` reads it. The recovery and instance-picker pages carry their
own inline `STRINGS` tables, because they are shown precisely when the
renderer is unavailable.

Native preference is the last validated `set-language` mode, persisted as
`{ language: 'auto' | code }` in `language.json` next to `instance-url.json`.
Existing concrete JSON values remain explicit. Missing/invalid values mean auto;
the live cache updates before saving so a disk failure cannot freeze the old mode.
Automatic resolves `app.getPreferredSystemLanguages()` in order, then English.
`app.getLocale()` is the application locale, not necessarily the OS UI preference.
On focus/resume main refreshes its existing menus without changing update state.

`getDesktopLanguageQuery()` supplies `lang`, `preference` and the released code
list to every recovery/picker load. HTML keeps inline catalogs, relabels in place
on Automatic focus via the same named getter, and preserves typed URL, disabled
controls, state/errors/diagnostic values and actions. Titles and diagnostic labels
are localizable too; technical error data remains external content. Query language
lookup checks own catalog properties, not inherited object names. No external
font request is needed by the picker. The native CommonJS package still imports
neither renderer/shared TypeScript nor i18next.

`buildTrayMenuTemplate` and `buildAppMenuTemplate` take the language as a
trailing parameter that defaults to English, so the pure template builders
stay testable without Electron.

Ordinary message notification titles are composed by the renderer and passed to
`showNotification`. App-owned update notifications, updater failures, About source
attribution and native menu role labels use the native catalog explicitly; role
behavior/accelerators remain unchanged. Windows/Linux Edit and the macOS Edit
submenu reuse the same pure menu builder instead of maintaining parallel labels.
Linux global-shortcut dialog descriptions are app-owned native catalog entries
too; the portal/OS owns the actual assigned-key labels. Descriptions use the mode
at session binding and appear in that language on the next registration/session;
switching the language does not re-request OS permissions or reset shortcuts.

### Install and bootstrap copy

`common:app.description` supplies the HTML description and localized install
description. `src/build/localizedManifests.ts` owns one existing install template
reused by VitePWA plus one static `manifest-<released-code>.webmanifest` per released
locale. Name, start URL, icons, colors, standalone display and effective app identity
stay identical; only description/lang/dir vary. The current i18n document owner
selects the manifest link and description meta after a locale commit. URL
construction takes the matched code from the internal released-language catalog,
never the original DOM/preference string; its filename set stays closed. Future
missing descriptions fall back honestly to English metadata. Development serves
the same generated content, and the existing Workbox precache extension/budget
includes `.webmanifest` so metadata remains offline-capable. No extra service
worker, translation framework, remote font or server route is introduced.

The static native-catalog inspector recognizes script end tags with whitespace
or browser-tolerated trailing attributes and handles case insensitively. It still
parses only literal TypeScript/JavaScript bindings; it never evaluates extracted
code and is not an HTML sanitizer for user content.

Existing renderer-owned bootstrap/crash/offline prompts already use their catalog
keys. OS install prompt chrome, browser-generated network/permission errors,
external technical diagnostic values and user/external content are not translated.

---

## Consistency check

`scripts/check-i18n.mjs` runs in `pnpm typecheck` and before the web build.
It fails on:

1. A target key/namespace without English source. Missing target keys/namespaces
   are permitted for future English-only features; `--strict` reports coverage debt.
2. Broken `{{placeholder}}` values in any supplied form, not merely a family union.
   Arabic one/two and implicit-number source singulars may omit `count`, not names
   or other interpolation values. Every other provided variable remains checked.
3. A plural key missing a CLDR category for its language.
4. A `t()` call that passes `count` to a key without plural forms.
5. A non-English value byte-identical to the English one, outside the
   allowlist in `scripts/i18n-allowlist.json` (brand names, "OK", URLs, and
   legitimate shared terms). Exact `{ language, namespace, key, value, reason }`
   allowances scope context-sensitive matches; blanket prose exemptions are audited.
6. A direct `toLocale*` or `Intl.*` call in the web package outside
   `formatters.ts`.
7. An `ErrorCode` with no entry in `errors.json`.
8. A literal user-facing string in JSX or in an `addToast(...)` call (bare or
   through a store, `useUIStore.getState().addToast(...)`), in any
   production `.ts`/`.tsx` file not listed in `scripts/i18n-pending.txt`, including
   hooks and helpers rather than only JSX-bearing modules. Tooltip `content`
   literals are checked alongside title/placeholder/aria/alt. The rule reads each
   component's TypeScript syntax tree (the compiler is resolved from the web
   package), so it sees text wherever JSX puts it: JSX text inside
   conditionals and maps, literal JSX children (`{open ? 'Open' : t('x')}`),
   and the `placeholder`, `title`, `aria-label` and `alt` attributes whether
   quoted or computed (`title={name ?? 'Embed'}`, `` aria-label={`Load ${x}`} ``).
   It follows a value through `?:` branches, `||`, `??`, the right side of
   `&&`, `+` and template literals, and never into a condition or a call's
   arguments, so `t('key')` and `kind === 'approve'` are not text. An earlier
   regex version treated every `{...}` block as opaque and missed all of
   these (#328). The pending file listed the source files not yet swept
   while the sweeps ran; it stays as the mechanism for a surface that has to
   land untranslated for a while, and a `#` line above an entry says why it
   is there. `node scripts/check-i18n.mjs --write-pending` regenerates it
   from the current tree. A line that is a false positive carries
   `// i18n-check: allow-literal` (or `{/* i18n-check: allow-literal */}` in
   JSX) on the line itself or the line above. Files under
   `packages/web/src/dev/` are exempt from this rule alone: each is the entry
   of a design workbench page that the app never imports, and their copy
   addresses whoever is building the component rather than a user.
9. Translation markup that differs from English in any supplied form, or a paired HTML void tag
   (such as `<link>...</link>`) used as a `Trans` component wrapper. Void tags
   are parsed as empty HTML elements, so wrapper components use distinctive
   names such as `<actionLink>...</actionLink>` instead.

The check reports every finding at once, with file and line, so a sweep PR
can be fixed in one pass.

Namespace roots/values must be valid JSON objects/nonempty strings; malformed
catalogs produce findings rather than a parser stack trace. Omitted target keys,
empty namespaces and empty target grouping branches may use English, but a
supplied object at a source string/plural leaf is invalid: i18next treats it as
an object, not as missing copy. Structural validation retains those paths before
flattening can discard empty objects or their empty descendants. Strict coverage reads
the registry too, so a missing whole locale directory cannot disappear from the
denominator. `--locales=en,pt,...` limits completeness reporting only; it never
hides invalid supplied data elsewhere. Unknown flags/codes are errors.

`node scripts/check-i18n.mjs --strict --include-desktop` also inspects native main
and inline recovery/picker tables without executing Electron/HTML code. The static
reader rejects executable values, checks native call-site English, placeholders,
shared-term allowances and registry/release mirrors. It is opt-in so normal
web-only Docker builds need no desktop source. English native catalogs remain
exhaustive, target tables may be partial with tested per-key English fallback.

---

## Sweep order and translation workflow

Surfaces are converted one PR at a time, in the order users meet them: auth,
settings (done in the foundation PR as the reference), chat, dm, voice,
spaces, social, search, uploads, mobile, federation, admin, desktop. Each
feature requires English copy; translations may follow later while valid supplied
entries and English fallback remain mandatory. This 25-language initiative is
stricter at delivery: every current surface must have actual reviewed translations.
New languages stay unreleased until the explicit complete-baseline gate passes;
passing the normal build does not prove translation completeness or naturalness.

The Russian translation comes from the community. st7105 translated the
whole app in PR #45, and that PR also established the detection order, the
`backspace-language` storage key and the idea of a parity check, all of
which are kept here. The Russian values are carried over matched by English
text, with `Co-authored-by` credit on every commit that carries them, and
st7105 is asked to review the result. German is written by the maintainers;
the release PR that flips its flag is merged only after a native read.

**One name per concept, per language.** A concept the product names once in
English is named once in each catalog, and that name is not reused for
anything else. Directory-only terminology/tests were retired in 1.15.2 along
with that module. The retained Russian Overview tabs keep «Основное», an
editing panel for name, icon and banner, pinned by
`src/i18n/ruOverviewTabName.test.ts`.

Catalogs are Weblate compatible. No hosted translation platform is
configured yet; when one is, it points at `packages/web/src/locales` and
`en` is the source language.

---

## The landing page

`site/` is outside i18next entirely, and deliberately. It is a static marketing
page served by GitHub Pages with no bundler and no runtime: a translation there
is a second HTML file, not a catalog. `site/index.html` is English,
`site/ru/index.html` is Russian, and the two are an `hreflang` pair that each
declare both plus an `x-default` pointing at the root. Both appear in
`sitemap.xml` (`docs/systems/metrics.md` §3).

What the two pages share is in `site/assets/`: `site.css` and `site.js`, linked
by both, because neither says anything about language. The five strings the
script would otherwise hardcode travel on `data-` attributes of the elements
they belong to, and number formatting reads `document.documentElement.lang`
rather than branching on a locale, so the Russian page groups thousands with a
space without the script knowing which page it is on.

Terminology on the Russian page follows `packages/web/src/locales/ru/` rather
than being invented for the marketing copy: пространство, канал, демонстрация
экрана, пиринг, личные сообщения. A reader who installs from that page and then
opens the app should meet the same words twice. When a product noun changes in
the app catalogs, the landing page is the second place to change it.

**The default design font covers Latin only.** Google Fonts publishes DM Sans
with exactly two subsets, `latin` and `latin-ext`; there is no Cyrillic or CJK
cut to vendor. Left alone, a Russian or Chinese page would set its Latin words
and all its digits in DM Sans and everything else in the OS fallback, which is
two typefaces inside one sentence. Every non-Latin language therefore gets its
own `font-family` under `:root:lang(xx)` in `globals.css`, on `body` and `#root`
(the base rule targets `html, body, #root`, so overriding the two descendants is
what wins the cascade) and again on the emoji picker's `--font-family`, since
emoji-mart sets its own. `documentElement.lang` is set at init and on every
runtime switch, so the rule follows the language without a rerender. The
treatment differs by script:

- **Russian** uses bundled Inter (`packages/web/public/fonts/InterVariable*.woff2`,
  OFL, subset to Latin plus Cyrillic with a matching `unicode-range`) for the
  entire UI, Latin names and digits included. The faces are declared globally
  and applied only under `:lang(ru)`, so other languages never fetch them.
- **Chinese** takes the platform stack outright, naming each OS Latin face
  directly ahead of the CJK companion it ships with (SF and PingFang SC, Segoe
  UI and Microsoft YaHei, then the Noto CJK family). A Han webfont is several
  megabytes, and the OS pairs are designed to sit together, so vendoring buys
  nothing there.
- **English, German and Brazilian Portuguese** stay on DM Sans, whose `latin`
  subset covers the Portuguese diacritics.

Each surface is internally consistent, although the landing page keeps a
platform stack for Russian while the app uses Inter, so the same Russian words
are set in different typefaces in the two places. A future language in a script
DM Sans lacks needs its own `:lang()` pair of rules before release; the `zh`
block is the template for a script without a vendorable face, the `ru` block for
one with.

Two things the page does not inherit from this document. It has no plural
machinery, so a label under a stat tile is a bare nominative plural read as a
column heading, not as a phrase agreeing with the number above it. And English
house style forbids the em dash; Russian grammar requires тире where the copula
is omitted, so the Russian page uses it and the English page does not.

## Adding a language

1. Create `packages/web/src/locales/<lng>/` with every namespace file.
2. Add `{ code, nativeName, dir }` to `supportedLanguages`.
3. Add the entry to the desktop catalog in `l10n.ts` and to the inline
   catalogs of the recovery window and the instance picker.
4. Run `pnpm typecheck`, then explicit `node scripts/check-i18n.mjs --strict --include-desktop`
   and contextual/script/layout acceptance before marking the language released.

Nothing else. If a fifth step turns out to be needed, the fix is to remove
the need, not to document the step.

The landing page is **not** part of this list. Shipping the app in a language
does not oblige anyone to translate `site/`, and a `site/<lng>/` page can be
added or dropped without touching a catalog. If a third one is ever added, that
is the point to weigh generating the pages from a template against copying the
markup a second time.
