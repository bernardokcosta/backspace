# Capability map and design: standalone Veyvox and security cleanup

## Request, decisions and status

The user requests complete removal of federation, not a hidden settings tab or
disabled feature flag; cleanup of genuinely unused code; a security review; and
a small voice-sidebar spacing/corner correction supplied in a screenshot.

The user explicitly authorizes deletion of federation-specific data without an
archive: they report federation was never used on their Veyvox instance. This
does not authorize deletion of local accounts/content, production access or a
database reset. Do not infer the screenshot's empty peer list proves the live
database has no remote rows.

**Status:** the user approved this architecture and module map on 2026-11-10
("SIM"). Federation-only data deletion and the visual adjustment are authorized.
The user subsequently approved the detailed module specifications ("sim").
The user then authorized continuous inline execution of the plans without
intermediate approval prompts. Implementation has started with the transactional
migration foundation; federation removal and the security audit remain in progress.
No production operation,
commit/push/merge or release is authorized by this document.

## Approved modules and dependency direction

| Module id | Responsibility | Depends on | Specification |
|---|---|---|---|
| `standalone-core` | Local-only identities, authentication, database transition, REST/WS, DMs/friends/calls/bots; remove S2S transport and workers | Existing local functionality | [Core](2026-11-10-standalone-core.md) |
| `standalone-client` | One instance/session at a time; remove connected-instance federation, cross-origin merging, settings and federation-only translations | `standalone-core` contracts | [Client](2026-11-10-standalone-client.md) |
| `dead-code-cleanup` | Remove unreferenced code/dependencies/configuration and confirmed retired persistence mappings | `standalone-core`, `standalone-client` | [Cleanup](2026-11-10-dead-code-cleanup.md) |
| `security-hardening` | Evidence-based audit, concrete fixes, negative tests and complete validation of retained surfaces | All three modules above | [Security](2026-11-10-security-hardening.md) |
| `voice-controls-polish` | Increase RNNoise/hang-up spacing and align corner radii; no audio/call behavior change | None; independent small UI request | [Voice polish](2026-11-10-voice-controls-polish.md) |

Build order: voice polish independently; standalone core → standalone client →
dead-code cleanup → final security hardening. Security findings discovered earlier
must be recorded and resolved in the responsible module, not deferred blindly.
The specifications above refine these approved boundaries. Implementation plans
follow approval of those specifications. Voice polish is already implemented
locally and validated independently; it is not evidence of federation removal.

### Implementation plans approved for continuous execution

The [execution overview](../plans/2026-11-10-standalone-security.md) links the
four ordered implementation plans, their exact migration/consumer boundaries,
test cycles and validation gates. The user authorized inline execution without
interruptions; the execution ledger records actual progress and remaining gates.
Creating these documents did not remove federation or complete the audit.

## Evidence and existing architecture

- `docs/systems/federation.md` describes S2S HMAC, peer lifecycle, queues,
  synchronization, remote identities, asset replication and background workers.
- `docs/systems/client-federation.md` describes credential provisioning, multiple
  sessions/sockets, origin routing and merged DM/space views. Removing only S2S
  would leave a second federation system; neither half is retained.
- Auth, bots, DM identity/deduplication, voice and deletion all currently import
  federation helpers. Local behavior must be extracted/reused before deleting
  the shared helpers; replacing imports with no-op stubs is not removal.
- `schema.ts` carries remote/detached identities and federation tables/settings.
  `db/index.ts` runs remote-account/outbox backfills, while `migrate.ts` uses a
  local-user predicate for installation metadata. The new boot path must not
  reference removed columns after migration.
- Directory and telemetry are already retired (`docs/systems/{directory,
  telemetry}.md`), but their documented inert columns still have ORM mappings.
  These are cleanup candidates, not evidence that diagnostics or invitations
  should be removed.
- The supplied voice screenshot maps to `VoiceControls.tsx`: the header action
  group uses `gap-0.5` (2px), and both 28px buttons use `rounded` (4px), while
  the neighboring connection control uses `rounded-lg` (8px).

## Chosen architectural direction

Complete local-only operation is the sole approach consistent with the request.
Hiding the panel, disabling relay or retaining client federation are rejected.
The existing local flows remain the implementation, rather than a parallel
standalone mode behind a switch.

### Local functionality and identity

Keep local accounts, profiles, friends, direct/group messages, spaces, private
invitations and join approvals, permissions, local bots, voice/video/share,
soundboard/games, uploads, search, diagnostics, backups and the desktop wrapper.
The desktop still accepts an instance address for self-hosting; that does not
create linked identities or simultaneous connections to other instances.

Use the authenticated local user id for comparisons and authorization. Preserve
per-account request generations, logout cancellation and permission checks: a
single instance is not permission to accept arbitrary ids or stale responses.
Keep one transactional local DM find-or-create rule and its uniqueness invariant;
remove home-identity reconciliation and cross-server conversation copies, not
local DM deduplication or existing local history.

Remove federation REST registrars, incoming/outgoing relay events, HMAC/peer
credentials, handshake/reset/attach flows, replication/download workers, peering
admin UI, background timers, related configuration, shared contracts/error codes
and client consumers. Removed APIs must return JSON404, never the SPA shell.
Old registration inputs cannot create remote identities or bypass local signup.
There must be no hidden fallback, disabled feature flag or compatibility shim
that still implements federation.

### Database and persisted-client transition

Generate new schema migrations through the existing Drizzle workflow; never
rewrite already-applied SQL/history or initialize a new empty database in place
of an existing installation. Preserve the ordinary pre-migration snapshot
mechanism that protects local data; no new federation archive/export is needed.

Delete dedicated peers, secrets/credentials, registry, relay/sync queues/logs,
remote-only accounts/stubs and data exclusively owned by federation. Remove the
corresponding schema columns, indexes, flags and active ORM mappings. Explicitly
distinguish remote rows from valid local/detached accounts before deletion:
do not classify a sovereign local account solely by an old display name.

Mixed ownership or foreign-key references must not silently erase native spaces,
memberships or local history. The provider specification must define dependency-
ordered deletion and transaction/foreign-key checks; stop without mutation on
an unclassified data shape instead of extending a broad delete to local rows.
Tests must cover empty/fresh, ordinary local upgrade and remote/mixed fixtures,
as well as repeat startup and failure rollback.

Clear obsolete federation session/credential caches without clearing local
sessions, instance selection, settings or unrelated storage. Update installed-
upgrade acceptance to expect that intentional cleanup rather than preserving
retired federation credentials as a supposed compatibility invariant.

### Meaning of complete removal

No active production feature, runtime contract, UI/catalog namespace, worker,
dependency or current schema mapping supports federation. A few explicit
references are necessary solely in historical migration records, the isolated
removal transition, negative absence tests and design/audit history. They must
not import the retired implementation or start network activity. Keep a narrow,
reviewed inventory of these exceptions, not broad search exclusions.

Historical Git history and release-paired artifacts are not executable feature
support and will not be rewritten. Likewise, retained Backspace storage/crypto,
application and package identities are not dead code: changing them can strand
existing sessions or break installed upgrades.

### Additional cleanup and security review

Prove absence of consumers before deleting another feature's code/dependency.
Review the retired directory/telemetry mappings specifically; retain operational
diagnostics, installation metadata, source/license attribution and supported
local functionality. Reuse existing services rather than invent replacements.

Review authentication/session revocation, bot tokens, authorization/IDOR, channel
and DM REST/WS parity, upload/tus ownership and path handling, remote previews/
SSRF, stored/rendered content/XSS, CORS/CSP, desktop IPC/navigation/updater trust,
secrets, dependency graph and container configuration. A green scanner is not
a guarantee of an absolutely secure environment. Findings need reproducible
evidence, severity, affected paths and regression tests; do not invent issues
or weaken scanners to claim success. No active production pentest is included.

### Voice-control detail

Change the existing action group from `gap-0.5` to `gap-2` (2→8px), moving the
filter left while leaving hang-up anchored on the right. Use `rounded-lg` (8px)
for the RNNoise and hang-up controls, matching the adjacent connection control.
Keep icon/button dimensions, colors, hover/focus states, translations, tab order,
`aria-pressed` and click handlers. No microphone capture, mute or call change.
Test layout classes plus existing RNNoise/game behavior; inspect the real
component at compact widths and with long/truncated connection text.

## Validation and delivery boundaries

- Inventory active routes/imports/types/catalogs/workers/schema and prove their
  removal; exercise legacy endpoints and record zero federation outbound calls.
- Preserve tests for local auth/admission, permission isolation, friendships,
  direct/group DMs, messages/reactions/read pointers, bots and calls after replacing
  federation-only fixtures. Do not delete a whole mixed suite to obtain green.
- Run generated migration tests, shared → server → web sequential build,
  typecheck/i18n, e2e/desktop TypeScript checks, tooling/workspace suites, lint,
  dependency audit and security scans. Verify disposable startup and real UI;
  use protected CI for unavailable native/container platforms.
- Run mandatory external Sol review of the complete implementation scope, not
  only the last deleted file. Preserve the completed PR/security hygiene fixes.
- No new dependencies, weakened suppressions, production SSH/DB edits/restart,
  deployment, release/tag/image publication or unrequested Git-history rewrite.
- The architecture, detailed specifications and inline implementation plans are
  approved. Complete implementation validation/external review precede delivery.
