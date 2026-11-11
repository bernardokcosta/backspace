# Native security audit — in progress

This is not a completed security certification. No production pentest, deployment,
personal profile, real credential or production database was used. All executable
evidence belongs to disposable/synthetic fixtures. Whole-branch validation and the
independent final Sol review follow-up remain pending.

## Confirmed findings corrected during retirement

| Boundary | Reproduction / correction | Evidence |
|---|---|---|
| Native social graph | Deleted users could receive requests; previously declined requests could be accepted. Require a live target and a pending recipient-owned request before mutation. | Native social route regressions, unchanged graph on refusals; execution ledger C3 |
| Public user updates | Self-only `developerMode` / `showActivity` escaped through observer broadcasts. Sanitize for the observer, retaining self-only projection for the same native account. | Native users/sanitization route regressions; execution ledger C3 |
| Raw resumable uploads | Foreign tus Location, old-server resume/cancel and alternate credential routing were reachable in the old transfer path. Pin current origin/account; validate exact tus URL before bearer; disallow redirecting raw DELETE. | `transferStore.instanceScope.test.ts`, `tusUrl.test.ts` with real tus client and a disposable HTTP stack |
| Transfer attempt lifecycle | A paused attempt could update a resumed attempt; delayed filesystem preflight could advance after session replacement. Invalidate attempts before abort; check each awaited boundary. | Same scope suite, delayed lookup/permission/file and stale progress/success/error/request cases |
| Persisted pending work | Equal channel/client IDs could show or send earlier account content, and late completion could remove a replacement draft. Capture native ownership, scope the existing composer map, settle only the exact original acknowledged bubble. | `pendingMessageScope.test.ts`, `composerStore.scope.test.ts`, native composer/tray rendering regressions |
| Desktop navigation trust | A renderer-reported peer origin expanded top-level navigation trust. Remove peer-origin IPC/state/preload setter; allow only actual current URL origin and exact picker. | `navigationPolicy.test.ts`, `preload.test.ts`; full desktop 615 passed / 18 existing skips at the recorded checkpoint |
| Native sidebar layout validation | Authenticated input could create arbitrary existing-style folder IDs, retain nonmember space IDs, and produce 500s for foreign-folder/null data. No cross-account row mutation was demonstrated: duplicate-folder insertion rolled back. Remove the remote folder-import branch; require owned folder IDs and native memberships, validate runtime shape/timestamps before writes. | `users.layoutSecurity.test.ts`: 10 RED / 2 PASS before correction, then 12 PASS; full logical DB snapshots on refusals |
| Native profile asset mutation | Any authenticated account could assign another account's upload and trigger in-place resize, claim a message attachment, or delete an old file still held by other profiles. Prefix comparison also deleted same-file avatar resaves. Normalize safe local paths; reuse the bot loose-upload owner check and janitor reference inventory; consume only newly claimed records and never resize unchanged/shared inputs. | `users.profileSecurity.test.ts`: 14 RED / 1 PASS, then focused profile/layout/bot/DM suites 6 files / 66 PASS before three additional preservation cases |
| Native space/DM/bot assets and cleanup (high, authenticated foreign-file mutation) | Space create/update accepted another account's known upload and resized it; group icons could consume message-held uploads; legacy shared old assets/thumbnails could be deleted by space/bot/DM mutations or janitor cleanup. Reuse existing profile ownership and move the existing janitor inventory to common fileCleanup, including all post-commit native deletion paths. Authorization, local image normalization and no-op semantics stay in their owning routes. | `assets.security.test.ts`: 19 RED / 2 PASS, then added janitor 2 RED / 22 PASS; focused asset/profile/DM/bot/janitor checkpoint 6 suites / 68 PASS; server typecheck passed |
| Outbound preview connection (high, reachable through user-supplied public URLs) | Pre-validation and global fetch used separate DNS resolutions; no wire/body lifetime covered DNS plus all redirects. Reproduce public→private second answer, then use validated Node lookup pins, all-answer refusal, real Host/SNI/default verification, static cross-origin header forwarding and total 5s lifetime. Remove the taint-only URL reconstruction. | `ssrf.pinned.test.ts`: 24 RED / 10 PASS first; `safeFetchTransport.test.ts` uses a real disposable HTTP sink behind a mocked connector, exercises gzip/deflate/Brotli, wire/decoded overflow, stalled headers/decoder/body, cancellation and actual socket closure. TLS certificate refusal is synthetic, not a live trust-store test |
| Preview body lifetime/memory (medium, public preview resource exhaustion) | Metadata cleared its timer at headers, early returns leaked bodies and the image probe retained an oversized first chunk. Keep 5s/3s controllers through body release; return null on metadata overflow and copy no more than 32,768 image bytes before Sharp. | `metadataFetcher.test.ts` / `embedResolver.probe.test.ts`: 8 RED / 3 PASS, then GREEN; combined SSRF/transport/preview/classifier checkpoint 6 suites / 112 PASS with no unhandled errors and server typecheck passed |
| Native session claims (defense in depth, valid signature required) | Signed incomplete name/iat/expiry claims were accepted; this is not acceptance of unsigned/attacker-signed JWTs. Validate their runtime shape in the existing HS256 seam, shared by REST/tus and WS. | `auth.test.ts`: 5 RED / 10 PASS; focused auth/routes/uploads 5 suites / 54 PASS, then real REST/WS matrix rejects all malformed/expired/wrong-algorithm cases |
| Password revocation (high, an existing session can survive credential replacement) | A real password change left an earlier same-second token valid; authenticated sockets stayed open even after REST token revocation. Keep existing millisecond cutoff without flooring, mint standard fractional NumericDate iat, and reuse forced disconnect after commit. No new schema/token registry. | Deterministic same-second unit RED; real matrix RED on old REST token, then separate RED on socket remaining OPEN. Corrected matrix + auth/route/bot/upload checkpoint **6 suites / 86 PASS**; server/e2e typecheck and whole lint passed. See ADR 0003 |
| Instance-selection privileged IPC (high, unauthorized local-file navigation) | The actual isolated original setter accepted a foreign sender/null frame, persisted a file URL and called loadURL. Reuse the language IPC live-window/main-frame boundary for all three preference channels, require the bundled picker to replace the server, and validate credential-free HTTP(S) before profile writes/navigation. Unsafe saved selections are ignored without erasure. | Mocked original callback reproduction, then instanceUrl tests 6 RED → 6 PASS; focused IPC/navigation 19 PASS, desktop TypeScript PASS, full desktop 621 PASS / 18 existing platform skips. Installed OS navigation remains unproven |
| Retired Juno account remapping (dead exclusive code) | No production merge emitter remained, but the listener, merge export and award/winner redirect paths survived. Removed them rather than preserving a dormant identity-changing path. Native settlements retain original accounts, winner, frozen awards and retries; erased accounts stay erased. | Native-recipient and absence tests observed RED; focused Juno/exact-handle checkpoint 5 suites / 146 PASS |
| In-flight credential verification (high, external finding 1) | Login could verify the old hash across a reset and mint a newer accepted session. Re-read hash/cutoff/live account immediately before issuance. The adjacent password-change race also reproduced an overwrite/new session after reset/deletion; an atomic verified-epoch predicate now refuses that write and advances cutoffs monotonically. | Login 4 RED (200 vs 401); password-change 2 RED (200 vs 401), then server/auth/assets/real REST-WS-tus checkpoint 8 suites / 125 PASS. No new schema/registry; ADR 0003 |
| Restored-transfer bootstrap (medium, external finding 2) | Hydration ran before native identity was loaded and never retried. Retain one boot-restoration pass, retrigger it from existing native auth confirmations and consume it before asynchronous probes. Empty boot maps consume the pass without early cyclic auth access; newly created live work is never normalized by later profile updates. Preserve account/origin/generation/attempt gates, no prompt before ownership or repeated/profile-driven auto-resume. | Three own-bootstrap REDs (paused vs completed), plus an empty-pass RED (later active work became paused). Expanded loadUser/ready/initSession, duplicate confirmation, foreign/unowned/no-token and retained lifecycle checkpoint 4 suites / 55 PASS, no unhandled errors |
| Janitor scan amplification (medium, external finding 3) | Per-file deletion rebuilt every attachment/profile reference inventory. Batch orphan/unlinked/dangling and old-media candidates, reading one fresh inventory after each phase's DB mutations; empty batches do not scan. Shared bytes and dry-run remain protected. | Real SQLite/files: 73 and 42 reference SELECTs RED against constant phase bounds; now passing with native shared-file preservation, within the 125-test server checkpoint |

Unowned legacy text-only work cannot safely be assigned to the account that
happens to log in next. It remains stored, not globally erased or silently sent.
Attachment-backed legacy work must prove the current account/server through every
retained transfer. This is a preservation/privacy tradeoff, not a new identity
registry or credential-routing mechanism.

The recorded instance-selection candidate is now reproduced and corrected above.
This does not assert that all privileged desktop IPC or native OS behavior has
completed the remaining acceptance matrix.

## Remaining acceptance

### Hosted PR CodeQL follow-up

PR26's first hosted analysis blocked on alert75, `js/request-forgery` (critical),
at the Node HTTP constructor. Existing tests already proved validated DNS pins;
the original user URL was nevertheless still supplied as constructor authority.
This is a scanner finding, not a reproduced private-network fetch exploit. It
was not dismissed, suppressed or bypassed. A bounded adapter correction makes
the validated IP the native `hostname`; the URL contributes only logical
Host/SNI/certificate identity, port and path/query. Public API, classifier,
timeouts, byte/decompression caps, redirect handling and default TLS checks stay.

Three RED assertions reproduced the original constructor contract; corrected
preview/classifier suite **6 / 114 PASS**. An isolated actual Node24 HTTPS fixture
with a temporary process-local test CA verified physical pin + logical Host/SNI,
path/query, wrong-name rejection and untrusted-CA rejection; no OS trust store
was changed and temporary key/certificate files were removed. Full affected
server **201 suites / 2,258 PASS** with two workers; tooling185, server TypeScript/
build and lint pass. An earlier default-worker run timed out one sticker-rate
case; isolated18 and full bounded rerun passed without changing its5s timeout.
Exact-SHA hosted reanalysis remains required before merge.
This narrow explicit-pinning correction was checked locally within the two-review
limit; no third review, custom sanitizer, taint-only encoding or scanner waiver.

- Real S1 matrix now covers signed-claim/algorithm/expiry/deleted/password-revoked
  sessions, native admin/space/channel/DM/message/bot IDOR, REST/WS actor spoofing,
  private voice-token denial and tus HEAD/GET/PATCH/DELETE ownership with unchanged
  rows/upload bytes. Retained role hierarchy/SPEAK/STREAM/managed-role/private
  invitation suites still require the final complete integrated acceptance.
- Complete integrated validation of S2/S3 and independently review the Node adapter;
  the selected pin deliberately has no unchecked fallback and no runtime bypass.
- Local desktop IPC/security regressions, frozen full/filtered production installs
  and dependency-consumer audit pass. Audit reports no known vulnerabilities;
  this is a registry result, not proof that all application/base-image code is safe.
- Real source/artifact absence is green, enforced in tooling/CI without broad
  test/docs exclusions. Fresh integrated 1.17.2 acceptance passed: **656 suites /
  6,990 tests**, with 18 existing desktop platform skips; build/TypeScript/i18n,
  tooling 183, lint and precache passed. Logs are named in the validation report.
- Disposable native UI and compact-control checks passed within their recorded
  rendering scope. HAR had no retired-route requests/errors but included
  Kaspersky-origin resources not present in raw application HTML. Attribution is
  not proven; no claim of all-local browser traffic or live-media coverage follows.
- Docker/Gitleaks/OSV/Trivy/actionlint were unavailable locally. Exact-SHA protected
  hosted scanner, native/installed and image gates remain pending.
- The sole selected whole-change Sol reviewer initially **did not approve**, with
  the three concrete findings above. Local fixes and regressions are implemented;
  fresh integrated gates passed: **656 suites / 7,006 tests**, 18 existing skips;
  build/types/i18n/tooling183/lint/artifact/precache passed and 887 hashed candidate
  files had no drift. The justified same-reviewer follow-up confirmed the original
  three fixes, independently measuring janitor scans 402→3 (~190ms vs ~4.4s).
  It found one additional P2 regression: preserved `is_deleted=NULL` accounts
  could log in/bootstrap but the new password UPDATE required exactly0. The
  minimal predicate correction accepts0orNULL and keeps every ID/hash/cutoff/live
  comparison atomic. A nullable-account regression observed401→expected200 RED;
  corrected auth/users/native/pre-squash upgrade/real security suites **6 / 104
  PASS**, with the flag preserved. This narrow restoration of the existing native
  contract was checked by the principal agent; no third external review was called.
  Final complete validation after that correction passed **656 suites / 7,007
  tests** (18 existing skips), plus build/types/i18n/lint/artifacts/precache and
  185 tooling tests after metadata closure. No concrete finding is silently
  deferred. No second reviewer or third review
  loop is authorized; hosted gates and the audit's explicit limits still apply.
