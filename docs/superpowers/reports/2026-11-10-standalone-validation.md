# Standalone retirement — validation in progress

This is an execution record, **not a completed federation removal or security
audit**. All database/filesystem tests use synthetic, disposable fixtures. No
production state, remote branch/tag, release or deployed application was modified.

## Implemented so far

- Existing voice control patch: 8px action gap/radii, 28×28px buttons; no behavior
  change. Earlier nine tests and compact-width browser evidence remain recorded
  in the voice specification; the source patch is unchanged.
- C1: one generated-history migration runner with snapshot callback, validated
  hashes/order, supported missing-prefix histories, immediate transaction, ordered
  partial-sticker repair, rollback, FK integrity and restoration.
- C2 implementation: generated 0049 schema retirement with read-only old-data
  classification, protected-reference refusal, native-row preservation hashes,
  private DM pair reconciliation and commit-witnessed targeted file cleanup.
  Boot integration refuses incomplete file cleanup before defaults/backfills.
- C3: native account/social/bot/admin/sticker/DM routes and serialization; local
  target IDs only, private pair keys never exposed, no DM relay/network resolver.
  Foreign-host invitations are refused rather than joined under a local code.
- C4 runtime: native WebSocket presence/messages/calls/read state; no S2S route,
  worker, replica registry or relay hook remains registered. Native hourly storage
  cleanup is extracted, without an unrelated boot orphan sweep. Call acceptance
  names the authenticated local answerer; bearer voice tokens stay in REST.
- Native real-process harness replaces two-instance fixtures. Retained desktop,
  CORS, security-header, discovery-retirement and Juno suites run on it. Native
  integration covers admission, friendships, private/group DMs, bots and calls.
  An absence matrix checks 47 retired routes anonymously and as admin, hostile WS
  input, schema absence and observed outgoing DNS/TCP attempts after startup.
- W1/W2: exact-key storage retirement, native auth/social/activity/
  spaces/messages and a single current-page socket. Session generations reject
  old responses, optimistic confirmations require the native author, and call
  slots no longer hold remote credentials/keys. Native settings, transfers,
  pending work and composer ownership are converted and regression-tested.

## Observed evidence

| Check | Result and scope |
|---|---|
| C1 initial full server suite | 309 files / 3,361 tests passed before final snapshot-callback/embedded-COMMIT refinements |
| Preparatory DB + DM metadata suites | 26 files / 195 tests passed before generated schema/native contract integration |
| Current complete DB suites | 26 files / 185 tests passed after generated retirement/boot integration and native-fixture adaptation |
| Native DM helpers + new contracts | 7 suites / 46 tests passed; metadata 13, transfer 9 and kick 7 cases also passed in focused runs |
| Shared build | Passed after native runtime/DM/call/user wire changes; exclusive shared-contract cleanup remains |
| Server build and TypeScript | Both passed after native runtime conversion; expanded e2e typecheck also passed |
| Lint | Fresh whole-worktree run passed after supported lint:prune removed fixed stale suppressions; no new suppression added |
| Historical full DM checkpoint | 70 passed / 40 failed before coordinated conversion; superseded by complete server pass below |
| Native WS checkpoint | 25 suites / 213 tests passed |
| Client auth/API/activity checkpoint | 10 suites / 110 tests passed after native conversion |
| Client message/history/pins/reactions checkpoint | 10 suites / 84 tests passed after native fixtures and own-author confirmation |
| Client native socket/voice/DM-placement/auth/spaces checkpoint | 5 suites / 39 tests passed; remaining mixed suites and UI not yet converted |
| Client media/current-policy/H.265/SDR/system-audio checkpoint | 8 suites / 145 tests passed |
| Client notification/unread/call/socket checkpoint | 4 suites / 41 tests passed |
| Client native profile/cache/assets/status/Juno checkpoint | 4 suites / 42 tests passed |
| Client soundboard/playback/poke/Juno/socket checkpoint | 5 suites / 56 tests passed |
| Client complete games UI + soundboard UI + AFK/speaking checkpoint | 23 suites / 193 tests passed; old-session encoding upload reproduced and prevented |
| Client voice components + role hierarchy checkpoint | 16 suites / 116 tests passed; includes RNNoise spacing/radii regression |
| Client notification UI/badges checkpoint | 4 suites / 65 tests passed |
| Client exact handles/reactions/mentions/DM formatter checkpoint | 6 suites / 102 tests passed |
| Client message author/reply/menu checkpoint | 4 suites / 42 tests passed |
| Client composer/native attachments checkpoint | 7 suites / 55 tests passed |
| Client DM rows/group settings/headers checkpoint | 9 suites / 79 tests passed |
| Client native profile/social presentation checkpoint | 12 suites / 92 tests passed; native getMutuals and activity ID contracts checked by compiler |
| Client native roster/menu/social/DM entrypoint checkpoint | 18 suites / 173 tests passed; four equal-ID replacement-session mutation regressions included |
| Client member-role/bot/settings/module absence checkpoint | 11 suites / 81 tests passed; exclusive copy/presence implementations physically removed |
| Client native overrides/channel/category/role settings checkpoint | 8 suites / 73 tests passed; native privacy/conflict and late deletion/rename regressions retained |
| Client native invitation/approval checkpoint | 9 suites / 95 tests passed; foreign-host colliding-code rejection and no alternate-client lookup |
| Client native account/deletion checkpoint | 2 suites / 7 tests passed; full handles, native password rotation, owned-space loading and replacement-session guards |
| Client native space/channel rails and URL checkpoint | 9 suites / 46 tests passed; layout/navigation/menus/status and late invite-copy guards |
| Latest combined native settings/invitation checkpoint | 28 suites / 193 tests passed; full web typecheck/build/test remains pending, not an application acceptance pass |
| Native transfer/composer/pending session checkpoint | 21 suites / 190 tests passed; real tus transport fixture, zero foreign bearer, attempt/session/handle/privacy regressions |
| Desktop current-URL trust retirement | 36 suites / 615 tests passed, 18 existing skips; desktop build:ts passed; packaged acceptance remains hosted-CI pending |
| Completed full web diagnostic checkpoint | 421 files: 34 failed; 219 failed / 3,667 passed tests. Obsolete socket/identity fixtures migrated afterward; this is not an integrated pass |
| Native registry/settings/history/sticker/Range checkpoint | 18 suites / 152 tests passed |
| Native mixed stores after helper/preview conversion | 8 suites / 41 tests passed; web TypeScript and i18n checker also passed, but obsolete catalogs remain pending retirement |
| Native socket fixture migration | 11 suites / 76 tests passed across the three focused runs; sole mounted socket, native IDs, real handlers, no compatibility connector wrappers |
| Fresh complete web native checkpoint | **419 suites / 3,798 tests passed**, 366.47s; web typecheck passed. Predates catalog retirement and does not close security/build/native acceptance |
| Native layout/profile security checkpoint | 6 suites / 66 tests passed, server typecheck passed; includes real disposable DB/file refusals and native bot/DM metadata regressions |
| Catalog retirement and native settings checkpoint | 38 suites / 856 tests passed; retired namespace files physically removed in 25 languages, 3,563 retired leaves removed, 46,698 retained translation leaves checked unchanged; check:i18n and web typecheck passed |
| Additional asset preservation checkpoint | 6 suites / 56 tests passed, including native filesystem/message/shared-profile retention and storage-janitor tests; server typecheck passed |
| Complete server after profile fixes | **193 suites / 2,133 tests passed**, 193.37s; predates generated 0050 cleanup |
| Complete web after catalog cleanup | 416 suites passed / 2 failed, 4,120 tests passed / 2 failed, 412.93s; only two obsolete invite-error fixtures failed; migrated to native forbidden assertions and focused rerun passed (2 suites / 16 tests). Fresh integrated pass still required |
| Generated inert cleanup | 7 RED / 16 PASS first; 2 suites / 23 tests passed after 0050/native closed-flag helpers; broad DB/settings/DM checkpoint **33 suites / 243 tests passed**, server and e2e TypeScript passed |
| Real discovery upgrade after 0050 | 1 suite / 5 tests passed, 16.42s; no third-party traffic, native settings/invitation/request behavior retained |
| Other native asset mutators | 6 suites / 68 tests passed, server TypeScript passed; real JWT/DB/filesystem and retained DM/bot/janitor assertions |
| Complete server after asset fixes | **195 suites / 2,141 tests passed**, 216.97s; predates S2/S3 preview changes |
| Pinned preview transport and byte/deadline guards | **6 suites / 112 tests passed**, no unhandled errors; server typecheck passed. Exact initial SSRF 24 RED / 10 PASS and preview 8 RED / 3 PASS; additional malformed HEAD status reproduced and fixed. TLS certificate-error injection is not native trust-store acceptance |
| Complete server after pinned previews | **199 suites / 2,205 tests passed**, 259.30s; predates session-claim/precision fixes and the new security matrix |
| Complete web after final native invite fixtures | **418 suites / 4,122 tests passed**, 401.98s; catalog retirement and both corrected invite fixtures included |
| Native auth/security matrix checkpoint | **6 suites / 86 tests passed**, including 31 real REST/WS/tus cases; server/e2e typecheck and whole lint passed. Includes reproduced same-second token and open-socket revocation fixes; final whole-server rerun required |
| Runtime/GC/native e2e checkpoint | 32 suites / 296 tests passed |
| Current full server suite | **190 suites / 2,072 tests passed**, 171.51s, after native conversion; initial 2,069-pass run had Juno setup failure, fixed and fully rerun |
| Tooling | 159 tests passed during C1 validation |
| Sequential shared → server → web/PWA build | Passed during C1 validation; existing Vite chunk/native-loader/dynamic-import warnings recorded, not hidden |
| Server e2e / desktop TypeScript | Passed during C1 validation |
| Precache | 441 files; largest 1620.3KiB, within budget |
| Earlier global workspace run | Cancelled by the OpenCode server restart; **not** a pass or test failure |
| Replacement global workspace run | Passed: desktop 614 + server 3,442 + web 4,038 = **8,094 passing**, with 18 existing desktop skips; validates the preparatory kernel, not future removal |
| Final integrated 1.17.2 workspace | **656 suites / 6,990 tests passed**: desktop 37/621 (18 existing skips), server 201/2,247, web 418/4,122. Sequential workspace run with two workers; includes native/upgrade/absence/security real-process tests |
| Final 1.17.2 build and checks | Sequential shared → server → web build; root TypeScript/i18n; server-e2e and desktop TypeScript; tooling 183 tests; lint; source/artifact absence: all passed. Precache 410 files, largest 2,339.1KiB below 2,764.8KiB budget |

RED → GREEN was observed for history detection, embedded transaction control,
missing retirement helpers, shared replica assets, inconsistent provenance,
structured/native references, unsafe paths, unknown native schema changes,
legacy logical FKs, audit ambiguity and dependent-first ordering. Additional
passing regression cases cover old valid shapes, atomic progress/rollback retry,
actual junction refusal, identity reuse and concurrent-connection write locking.

## Latest local acceptance (November 11)

- Source and rebuilt-artifact absence checks now pass with **zero findings**.
  The original blanket exclusions were rejected and replaced with the existing
  TypeScript compiler loader plus exact inventory records. Actual import/mock/
  registration checks cannot inherit negative-data exceptions. All 49 immutable
  old SQL files and 49 snapshots are explicitly inventoried. No current guide was
  excluded to hide findings. A real-tree tooling assertion and an unconditional
  CI gate after root/desktop builds are installed: missing CI gate reproduced
  **26 PASS / 1 RED**, then **27 PASS**. Inventory now has **1,515** records after
  identifying/removing the Juno-only reattachment listener/merge/award redirects.
- Fresh web: **418 files / 4,122 tests passed**. Fresh server with two workers:
  **200 files / 2,246 tests passed**, including the auth fixes. The preceding
  concurrent/default-worker server run had one filesystem rate-limit-test timeout;
  the isolated suite passed, and no timeout or production behavior was weakened.
- The original instance setter’s unsafe sender/file-URL behavior was reproduced
  using its actual transpiled callback with mocked I/O. The repaired existing IPC
  seam requires the live main frame, restricts replacement to the bundled picker,
  validates HTTP(S) without credentials/control characters and ignores unsafe
  saved preferences without erasing them. First-run, cancel and Change Instance
  regressions pass. Focused **19 tests**, desktop TypeScript and full desktop
  **621 tests** pass; **18 preexisting platform skips** remain. This is not native
  installed acceptance.
- Latest whole lint passed; tooling now passes **183 tests**, including the
  exact 14 native namespaces, real-tree/CI absence and installed-phase contracts.
- A fresh sequential shared → server → web build passed (410 PWA precache
  entries); desktop and server-e2e TypeScript passed. All 49 old generated SQL
  files and 49 snapshots now have literal history inventory entries. The latest
  checker fixture run also verifies directory exceptions return a refusal rather
  than an unclassified read error.
- Installed acceptance keeps baseline **1.17.0**, eight pinned hashes, six hosted
  OS/architecture legs, encryption/startup guards and synthetic-profile isolation.
  Seed phases alone retain the old keys; candidate phases import compiler-produced
  actual production retirement and require their absence. Opaque native work bytes
  and native session/preferences are compared, never reseeded. **9 tooling tests
  pass** after two observed REDs. This is not installed OS acceptance or proof of
  real queued sending; native-store ownership is separately tested in web suites.
- Full frozen install passed with unchanged lockfile and successful native rebuild.
  A separate disposable filtered production frozen install passed (159 packages),
  again without lockfile mutation. Auditing imports from 84 retired source files
  identified nine packages, all still consumed by native code; every corresponding
  `pnpm -r why` passed. No dependencies/patches were removed speculatively.
  `pnpm audit --audit-level=low`: **No known vulnerabilities found**.
- Actual built **1.17.1** browser acceptance used synthetic admin/space/session and
  disposable DB/uploads: desktop six native admin tabs; mobile 390px registration
  controls; no Federation/Connections entries or page overflow. Four old storage
  keys disappeared while the native token remained. No page errors; console only
  AudioManager logs. HAR: **126 requests, zero retired-route requests and zero HTTP
  errors**. It also records Kaspersky-origin script/XHR resources absent from raw
  app HTML/built entrypoint. Their source is not conclusively attributed; the
  environment-contaminated capture does **not** prove all traffic was local.
- Real VoiceControls, controlled fixture/no real call: **284px and 240px** widths,
  gap **8px**, both radii **8px**, action buttons **28×28px**, no overflow. Inspected
  screenshots `standalone-{admin-native,mobile-registration-native,voice-284,voice-240}.png`
  and HAR are in the approved OpenCode temp directory. Owned browser/Vite/server
  stopped. No personal profile or security software configuration was changed.
- Generic consumer sweep found exclusive Juno reattachment remnants with no
  production emitter. Removed listener, merge and award/winner remapping; native
  credits/retries/erasure remain. Corrected two remaining legacy-@ name truncations
  after observed REDs. Focused **5 suites / 146 tests pass**; documentation and
  exact negative absence contracts updated without deleting native assertions.
- Logs: `standalone-web-d2-fixtures-full.txt`,
  `standalone-server-auth-d2-bounded-full.txt`,
  `standalone-desktop-instance-ipc-full.txt`, `standalone-d2-ipc-lint.txt` and
  `standalone-d2-tooling.txt` under the approved OpenCode temporary directory.

Fresh 1.17.2 sequential build, root/e2e/desktop TypeScript and complete workspace
acceptance passed after the final Juno/name changes. The initial integrated run
found one obsolete channel-poke expectation that truncated a retained @ handle;
the corrected native assertion is included in the full green rerun, not skipped.
Final logs: `standalone-final-{build,typecheck,e2e-typecheck,desktop-ts,artifact-gate,workspace-rerun,tooling-complete,lint-complete,i18n}.txt`.
The mandatory whole-change Sol review initially **did not approve**: one high
credential-verification race, one medium transfer-bootstrap regression and one
medium janitor scan-amplification finding. Corrections are recorded in the audit.
New observed REDs cover four stale-login states, two concurrent password-change
states, three delayed-own-transfer bootstrap paths and constant scan bounds.
Focused corrected checkpoints: server **8 suites / 125 PASS**, web **4 / 54 PASS**,
no unhandled errors; lint passed after supported pruning of a fixed suppression.
Expanded web checkpoint is now **4 suites / 55 PASS**, including empty-boot-pass
isolation from later live transfers. Fresh build/types/tooling/lint/artifact and
precache checks passed; largest chunk 2,339.3KiB (410 precached files).
The first full post-review run passed server 2,255 and desktop 621, but one
StickerPicker focus assertion ran before the asynchronous focus effect. Isolated
12-test rerun passed. The test now awaits the exact focus condition with its
existing timeout/assertion, and three obsolete native-pack fixture fields were
removed without losing coverage. The new complete frozen-code run passed:
**656 suites / 7,006 tests**, desktop 621 (+18 existing skips), server 2,255,
web 4,130. All 887 hashed non-Markdown candidate files remained unchanged during
the run. Tooling 183 and lint passed again. Logs:
`standalone-reviewed-final-{build,typecheck,e2e-ts,desktop-ts,tooling-confirm,lint-confirm,artifacts,precache,workspace}.txt`.
The same Sol reviewer rechecked and confirmed all three original fixes. The
follow-up found a single P2: legacy active `is_deleted=NULL` was excluded by the
new password UPDATE. After observed401→expected200 RED, the exact predicate now
accepts0orNULL while retaining atomic hash/cutoff/ID checks. Principal-agent
verification: **6 suites / 104 PASS**, including native/pre-squash upgrades and
real REST/WS/tus security. The legacy flag remains unchanged. This is a narrow
restoration of an existing contract, not a new auth mechanism; no third external
review was called. The final complete validation passed **656 suites / 7,007
tests**: desktop 621 (+18 existing skips), server 2,256, web 4,130. Build, root/
e2e/desktop types, i18n, lint, artifact absence and precache passed. Logs use
`standalone-release-final-*.txt`; the earlier partly-green run is not final proof.
Final metadata closure also removed stale feature prose from both READMEs, the
unused commented peer flag from `.env.example`, two installer/DAST comments, the
old container-description wording and eleven exemptions for deleted localization
leaves. These are point documentation/data removals, not operational changes or
new runtime behavior; retained native exceptions/catalog leaves are unchanged.
Two exact regressions observed RED, then **185 tooling tests** plus i18n/lint/
artifact absence/diff checks passed; a fresh sequential build/precache passed.
The principal agent checked this bounded cleanup without another external loop.
Docker, Gitleaks, OSV-Scanner, Trivy and actionlint
were unavailable locally; protected hosted native/installed/image/scanner checks
remain required, not inferred from local unit tests or the advisory browser run.

## Conditional publication

First reviewed commit `b5361dae` was pushed and PR26 opened against protected
master. Hosted secrets/OSV/IaC/license/lint checks passed, but CodeQL blocked on
critical SSRF alert75 at the preview constructor. A point adapter correction
now uses the validated IP as physical native-client hostname instead of passing
the logical URL as socket authority. Local preview/classifier114 and real
loopback HTTPS pin/Host/SNI/certificate-refusal checks pass. No alert was dismissed
and no protection was bypassed. Publication still awaits the corrected commit's
complete exact-SHA hosted gates; the previous commit's results cannot authorize it.
The complete affected server rerun passed **201 suites / 2,258 tests** (two
workers), alongside tooling185, lint and server build/types. The old commit's
read-only desktop workflow completed successfully, including all six installed
OS/architecture legs; that result is not substituted for the corrected commit.

The user authorized the complete reviewed change to GitHub master/main and
release **1.17.2**, clarifying that “Shinogit” meant GitHub. Use existing origin
`bernardokcosta/veyvox` and protected PR/check/merge flow, never force-push or
bypass the sole gated publisher. All five manifests are prepared at **1.17.2**
using the existing bump script, with upgrade/security notes. At the initial
precommit checkpoint HEAD/origin master were `c286abdb` and no PR/tag existed;
subsequent commit/PR progress is recorded above. No tag/release/deployment has
occurred. Release still awaits the corrected exact-SHA hosted security/native/
installed/image gates and protected merge.
A production deployment remains outside the authorization.
