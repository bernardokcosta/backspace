# 25-language readiness follow-up — 2026-11-08

Parent: [initiative ledger](2026-11-07-i18n-25-languages.md).
This records the newly authorized readiness/commit/push task after the earlier
local delivery. Earlier partial evidence and non-approval verdicts remain
historical facts, not approval of this follow-up.

## Authorization and boundaries

- Commit/push only after the 25-language gates pass. No version bump, tag,
  release, deployment, updater installation or production interaction.
- The user explicitly approved parallel **read-only** contextual reviewers.
  Corrections remain centralized in the main agent. These are model reviews,
  not native-speaker/professional certification.
- Preserve prior uncommitted Juno settings/music/guide work and original media.
  Exclude unrelated `skills-lock.json` and `.agents/skills/rust-best-practices/`
  from the planned commit. No stash/reset or broad staging of unknown work.
- A final read-only Sol review will cover the full planned commit, including
  prior implementation dependencies, this follow-up and external evidence.
  The previous task's two reviews are not being presented as an approval.

## Integral contextual review

Each row covers **all 15 web namespaces** (`admin auth chat common desktop dm
errors federation mobile search settings social spaces uploads voice`) and
**all three native tables** (main/recovery/instance-picker), compared against
English. The AST reader confirms 43+38+15=96 native values per locale; some
reviewer regex counts were corrected to these canonical counts. Programmatic
coverage alone did not close this gate: initial focused sv/fi reports were
returned for the remaining phrase-by-phrase reading before acceptance.

| Locale | Web leaves read | Contextual result and concrete corrections |
| --- | ---: | --- |
| nl | 2883 | Correct invented mute word, probing verb; keep ranking scoped to players who finish. |
| sv | 2883 | Complete integral second pass; correct home-instance compounds, credential meaning, corrupted words, notification suppression, turn-name grammar, incomplete clauses and confirmed control references. |
| da | 2883 | Correct domain gender, sentence capitalization and bitrate-editor instruction. Valid `Afsend`/`Stands` synonyms retained. |
| nb | 2883 | Correct credential/build/mention terms, native Joker names throughout relevant rules, incomplete notification/nickname clauses and system-audio control reference. |
| fi | 2883 | Complete remaining seven namespaces and native pass; fix corrupted words, sorting, sticker-size label and arbitrary-name grammar. Negative impersonal `kuvaa` confirmed correct and retained. |
| ar | 3139 | Correct reversed Mark Unread action, percentage order, mixed-script federation/reset remnants and duplicated voice-audio noun. All Arabic plural forms read. |
| hi | 2883 | Correct relative-time grammar and missing connection meaning; clarify local mute. |
| id | 2883 | Correct native shortcut actions and corresponding web labels with Indonesian on/off verbs, not English `Toggle`; complete instance-switch instruction. |
| vi | 2883 | Native color-changing card name instead of literal feral/wild; disambiguate blue examples; preserve passive no-E2EE warning; software file references, not physical handles; clarify local mute. |
| th | 2819 | Correct truncated save-failure word and missing tone mark in two XP explanations. Other-only plurals retained. |
| ja | 2819 | Remove raw `own`/`voice` prose; correct interface/identity terms, secret-rotation labels/grace-period wording and required-value predicates; clarify local mute. |
| ko | 2819 | Correct spacebar name and joined GIF instructions; prior contamination, persisted-name and SDR-particle corrections rechecked. |

Read-only review session provenance (continuations for sv/fi/id/vi/nb use the
same session, not a second independent approval): nl `ses_e439b2999ffdN5yqVXG7dCLZDI`,
sv `ses_e439b2992ffdnO7WlWyPmkfX4E`, da `ses_e439b298affeijP4zh5g6QbHz1`,
nb `ses_e439b2987ffeUs4HLTCKw1doRO`, fi `ses_e439b2986ffewuY4ZHuON7uWrl`,
ar `ses_e439b2986ffdYnG74S0gkv532o`, hi `ses_e439a709bffejLNaBinW1WFyFH`,
id `ses_e439a708bffeqWDXlY7dXZacoy`, vi `ses_e439a7075ffdH3M6bKHYb6YH4b`,
th `ses_e439a7073ffeA5ewVcumcez5nr`, ja `ses_e439a7070ffe1bsvgviix8PlcA`,
ko `ses_e439a706fffe9EzDCksVtDuk4k`.

Findings were independently triaged, not applied wholesale. In particular:

- nb's reset-recovery text correctly names the **banner** action
  `resetCleanup.repeer`, not the different revoked-peer-card action
  `peer.reinitiate`; no source/translation change was made to that instruction.
- No proposed English `Wild`/`Toggle` replacement was used to fake completeness.
  vi/nb card names and id shortcut verbs were resolved in the target language.
- Finnish negative impersonal grammar was retained rather than introducing an
  incorrect nominative. Name/username placeholders are preserved verbatim by
  paraphrasing instead of guessing a case/genitive suffix.
- Legitimate camera/people synonyms, Swedish inverted conditionals and optional
  register/infinitive/compound preferences were not treated as functional defects.
  No global robot/instance/voice terminology replacement was performed.
- Original card artwork, printed words, pt-BR dubbing and all game/voice rules
  remain untouched. Source English meaning did not move in this follow-up.

`*Content.test.ts` regressions were observed RED before the corresponding
corrections, then GREEN. `controlCopy.test.ts` additionally covers all 24 target
locales' SDR instructions (including missed C5 cs/pl/uk), and
`runtimeCatalogs.test.ts` loads the actual backend for every shipped language
and compares supplied bundles without treating English substitution as success.
It deliberately permits a future wholly absent target namespace; strict
completeness remains a separate gate.

Latest focused result: **33 i18n files / 452 tests PASS**, web typecheck PASS,
strict all-25 including native PASS. All 15 English files and all three English
native tables still match the reviewed C3 source freeze byte/value fingerprints;
no source meaning changed while completing later batches.

## Final corpus fingerprints

`final-catalog-fingerprints.json` records every path, full SHA-256, leaf count,
canonical native-table digest and comparison with `source-contextual-c3/report.json`.
There are **375 web files / 72,908 supplied strings** and **2,400 native strings**
(25×96). Locale-dependent plural counts are intentional, not missing translations.
The table gives the first 16 digits of each locale's deterministic file-manifest
digest; the machine record retains all 64 digits.

| Locale | Web leaves | File-manifest SHA-256 prefix |
| --- | ---: | --- |
| en | 2883 | ce4ab9878e43d0d8 |
| pt | 2947 | 133abbcf9d6835f9 |
| es | 2947 | a445eaaa5fb55b8c |
| fr | 2947 | 301ee6e842df8aa1 |
| de | 2883 | 0cd31b0156824bab |
| it | 2947 | 816d5d37153f182e |
| ru | 3011 | 87bac205274404e6 |
| uk | 3011 | 84b72569a1bbcf48 |
| pl | 3011 | 4ed0d6c41909a208 |
| nl | 2883 | 61067b4f85517dbd |
| sv | 2883 | f8dc52a6b223636a |
| da | 2883 | 61c862237fb3ca52 |
| nb | 2883 | 13528e3db2ff8a4c |
| fi | 2883 | 3c335e39cffb6ea2 |
| cs | 3011 | 8ed8d16df7c4af6c |
| ro | 2947 | 5d80b83a491fe218 |
| tr | 2883 | 0c60486992fccd54 |
| ar | 3139 | 601a591949294f0a |
| hi | 2883 | f4a6ffd7ea82e1f9 |
| id | 2883 | 1b89d5c819d71667 |
| vi | 2883 | c6301c173ac55212 |
| th | 2819 | ff32a01242e3bc59 |
| ja | 2819 | 7bb46354b6fc4ad6 |
| ko | 2819 | 4c22ca380f10a618 |
| zh | 2820 | 01942da90d1e61f8 |

Full web-manifest digest:
`082bbf095394b4bb2a3f2340491e6973de3a6aa9e2ef4878af06480741b40210`.
Full native-corpus digest:
`729ee25b717b19ff96bfd844fc2a40ad588f75c838a6a05d22e065ad0d79089e`.

## Rendered checks and fixes

Evidence root (external, not production state):
`%LOCALAPPDATA%/Temp/opencode/i18n-25-languages-20261107/acceptance-20261108/`.

- Actual Juno header Arabic failure reproduced before pinning physical header
  geometry LTR; guide/practice prose retains RTL. Ukrainian guide 320px failure
  reproduced before allowing long card captions to wrap without shrinking text.
- Actual account/settings screenshot exposed `@a` reordered as `a@` in RTL.
  `<bdi dir="ltr">` now isolates the unchanged full handle in account/settings
  cards; adjacent tests were RED then GREEN (25/25 affected tests).
- Expanded Arabic role-list screenshot exposed `@everyone` reordered as
  `everyone@`. The focused owner is `spaceSettingsPanels/RoleOrderList.tsx`:
  isolate the unchanged identifier/role name with `bdi dir="auto"`, preserving
  Arabic names as well as Latin identifiers. No permission, ordering or action
  code changes; adjacent reorder tests and actual RTL capture are the regression.
- `layout.test.tsx` reads the actual stylesheet instead of relying on Vitest's
  disabled CSS transform (11/11 PASS). Native textarea and mirror use matching
  per-paragraph `unicode-bidi: plaintext`.
- First main app matrix: **2850/2850** actual-component cases, 25 languages ×
  six viewport/scale cases × 19 surfaces. An expanded final 32-surface matrix
  adds administration, federation, group DMs, member/role/ban settings and the
  transfers popover, with lazy-panel settling and reachable-control checks:
  **4800/4800 PASS**, split into 1728/1536/1536-case shards. A missing synthetic
  `MemberWithUser.user` field initially crashed the newly opened member/role
  fixture; correcting that test data (not production) and waiting for actual
  lazy headings prevents the earlier skeleton-only false positive.
  Supplemental bots/desktop/role-list checks: **450/450 PASS** (25×6×3), after
  the final role-name isolation fix; the Arabic capture now shows `@everyone`
  unchanged and in the correct visual order.
- Juno main/settings/guide matrix: **150/150 PASS**. Actual MP3 streaming,
  independent volumes/language, mute/deafen/foreground policy and no game
  command effects: **200/200 PASS**. Prior guide scroll/focus/capability/music
  regression: **40/40 PASS**. Final post-copy captures include the additional
  lobby/result/ranking public-view scenarios: **450/450 PASS** (25×6×3).
  `en-ar-geometry-comparison.json` additionally confirms identical seat centers
  between English and Arabic at all six sizes/scales and the same header order.
  The existing compact layout may place all three seats on one row; a derived
  assertion assuming the top seat was always above the others was rejected in
  favor of comparing the actual same-viewport English/Arabic geometry.
- Native HTML matrix: **300/300 PASS** (25×6×2), including Automatic refocus,
  retained URL input, localized labels and reachable controls. Final captures
  are refreshed after native copy corrections.
- Real Windows Electron + rebuilt production l10n/IPC/preload: **53 checks plus
  one separate restart PASS**. Sandbox and context isolation stay enabled.
  All-25 native menu/HTML, preference IPC persistence, real OS-language getter,
  simulated no-NO→nb refocus and secondary-window denial were exercised.
  Temporary userData and in-memory session only; no updater or actual actions.
  Software rendering was used for capture after a hidden GPU capture error.

`final-secondary-results.json` confirms the final-source repeat: Juno layout
150, native HTML 300, rebuilt desktop, Electron 53 + restart 1, guide 40 and
actual MP3/music 200 all exit 0. The expected unauthorized-secondary-window
IPC error is the deliberate rejection test, not an unhandled launch failure.

The original Juno preview was not edited. Its copied acceptance fixture exposes
the already-imported store reference: a legacy dynamic import otherwise resolved
a second Vite/HMR module instance and returned an empty store. Test servers now
use separate cache directories and HMR is disabled for stable acceptance;
production code was not changed to satisfy that harness issue.

All browser traffic is confined to loopback or intercepted test APIs. The
security-software-injected external script request was blocked, not allowed as
a test exception. Backend reads are synthetic/error fixtures, not production
accounts or proof of live federation/call/hardware behavior.

### C2 inventory reconciliation

Every C2 row's catalogs have the integral C3–C8 read and real-backend catalog
integrity check. Rendering below is **representative surface coverage**, not a
claim that every possible modal, transient state or supplied string was visible
in 4,800 screenshots. The complete existing suites additionally cover mapped
actions/errors, permission refusals, localized feedback and request routing.

| C2 surface family | Actual rendered case / additional acceptance |
| --- | --- |
| Auth, registration, invite/join | `login`, `register`, `invite`, `join-space`, `create-space`; isolated source startup. Invite-parser/JoinPage suites cover parsing/remote states without real accounts. |
| Account/deletion, appearance, privacy | `settings-account/appearance/privacy/connections/developer`; deletion refusal/feedback through adjacent suites, no actual account deleted. |
| Keybind/device/activity, bots | `settings-keybinds/voice`, supplemental `settings-bots/desktop`, `admin-users`; real hardware names and OS permission dialogs excluded. |
| Chat/composer, embeds/attachments, pickers | `chat` with hostile-looking name and mixed paragraphs; existing Message/InputPopover/imageActions/sticker suites cover attachment/picker/error variants. External GIF/creator/embed results are not contacted or translated. |
| DM/system/call feedback | `dm-overview/members`, chat and native notifications; call-phase/system-message suites cover transient copy, no live call initiated. |
| Spaces/roles/notifications | `space-settings/members/roles/bans`, create/join/invite; existing permission/notification suites cover action states without moderation writes. |
| Friends/profiles/search | `social`, account profile card, `search`; canonical/federated profile and activity fixtures in existing suites. |
| Administration/federation | Seven `admin-*` cases, `settings-instance/connections`; synthetic reads/errors only, no peering or admin update action. |
| Transfers/uploads/crop | `uploads` popover plus transfer/waitForTransfer/ImageCropModal suites; no upload, filesystem picker or download overwrite performed. |
| Voice/video/share/soundboard | `settings-voice`, `share`, `soundboard`; full voice/LiveKit/soundboard suites cover errors and a11y names. Real microphone/camera/capture/TURN/hardware excluded. |
| Mobile shell | Phone/narrow and responsive settings/DM/space cases; existing MobileShell/ScreenStack/VoiceFullScreen suites cover navigation and visibility. |
| Juno | Main/settings/guide 150, lobby/result/ranking 450, MP3/music 200 and guide/capability/focus 40 cases. Original artwork/dubbing and engine semantics are preserved by assets/game suites. |
| Toasts/tooltips/a11y, bootstrap/install | Actual controls/headings and source startup, existing localized feedback/checker/notification/precache/manifest suites. OS toast delivery, PWA install UI, desktop installer and updater writes excluded. |
| Native tray/menu/update/About | Actual Electron edit-menu construction and both pages in all 25; complete native menu/role/update suites. Linux portal dialogs and macOS-native app menu are platform exclusions, not claimed Windows execution. |

Representative settled captures directly inspected include Arabic source login,
200% account/roles, Ukrainian 320px guide, Hindi 320px voice controls, Thai 320px
appearance, Japanese 320px members, Korean phone keybinds, Vietnamese 320px
share, Finnish 200% appearance, German short admin streaming and Chinese mixed
chat. No missing glyphs, text injection, horizontal page overflow or unreachable
essential action was found in these captures. Script assertions cover the rest
of the matrix; uninspected captures are not called human-reviewed.
Additional direct inspection: Arabic narrow native picker, Hindi native recovery
at 200%, Japanese phone Juno settings and Bokmål narrow round results. Native
URL-field horizontal scrolling and short-window vertical scrolling retain the
full input/actions; these are not body-level overflow. The role bidi regression
was observed RED, then all four role suites passed (36 tests).

## Full checks — current checkpoint

- `pnpm build`: PASS, actual shared → server → web sequence.
- `pnpm typecheck`: PASS.
- desktop `build:ts` and server `typecheck:e2e`: PASS.
- `pnpm lint`: PASS.
- After the final role-label markup change: sequential `pnpm build`,
  `pnpm typecheck`, `pnpm lint`, strict all-25/native and `git diff --check` all
  PASS again. Full web rerun: **408 files / 3917 tests PASS** with four workers
  (`checks/final-results.json`). No server code or timeouts changed.
- Initial `pnpm -r test`: desktop 33 files PASS; server 15 failures across
  12 files, mostly 5s timeouts with cascaded state/cleanup errors, plus two
  federation activity assertions and one 60s peering test. No server file has
  been changed. Full rerun with the original test timeouts: **server 302 files /
  3303 tests PASS with two workers; web 408 files / 3916 tests PASS with four
  workers** (`checks/bounded-workers-results.json`). Desktop: **33 files /
  577 tests PASS, 18 platform-dependent skips**. The initial concurrent failure
  remains recorded; it is not represented as a clean default recursive run.
- Isolated startup smoke: actual source API `/api/health` 200, version 1.16.8,
  source Vite SPA renders Automatic Arabic with RTL and no page errors. Fresh
  temporary database/uploads/backups, clean child environment, updater disabled,
  checkout `.env` not read; no account registered. Both owned servers stopped.
  `startup-results.json` and `startup-real-source-ar.png` record this execution.

## Final external gate

Content/source reconciliation, bounded-worker/full code checks, rendered/native
captures and isolated source startup are complete. One full-scope read-only Sol
review ran in `ses_e42b4650cffe4xOXcqkcqNqCnb`: 509 planned files and 16 external
helpers were fingerprint-verified; no files were changed by the reviewer.

The reviewer returned **one P2, not approval**: a supplied `{}` at a translated
string leaf was lost during flattening, so the normal checker accepted it even
though real i18next returned an object-error message instead of English. The
current corpus had no such value. The focused correction validates supplied
object paths against English string/plural families before discarding empty
nodes. Empty target namespaces/grouping branches and omitted keys still pass;
empty nested English copy, extra target plural categories with object values
and objects hiding empty descendants are rejected.

This finding's regression was observed RED (three failures), then an additional
empty-descendant RED; all are GREEN after the same scoped fix. Real i18next
distinguishes omitted-key fallback from supplied-object behavior in the test.
Post-fix i18n: **33 files / 458 tests PASS**. Sequential root build, root
typecheck, root lint and full web **408 files / 3923 tests PASS** again; strict
all-25/native and diff checks also pass. `checks/*-post-review.log` and
`post-review-resolution.json` retain the correction evidence. No catalog, runtime,
native security, wire, dependency or gameplay contract was changed by this fix.
It resolves the existing finding without materially expanding scope or adding
risk, so no second external opinion is solicited or claimed.

The main agent verified that the post-review delta is confined to the checker,
its adjacent regression and the localization/acceptance documentation. All
other reviewed file hashes and corpus/source fingerprints remain unchanged.
The sole concrete finding is resolved; the conditional commit/push gate is
satisfied. The review's initial non-approval is retained above, not rewritten
as an unperformed second approval.

No native/professional linguistic certification, release or deployment is
authorized or claimed. Unrelated skills work stays outside the commit.
