# Juno rate-limit recovery implementation plan

> **For agentic workers:** Execute inline with `executing-plans`; final review by
> `review_final_gpt56` only. Preserve production calls and existing runtime data.

**Goal:** Stop ordinary Juno play from exhausting a proxy-wide HTTP bucket and
keep a recoverable transport failure from removing the table from the screen.

**Architecture:** Reuse Nginx's real-IP module on this VM's loopback-only
Cloudflare Tunnel listener. Forward one verified client address to the existing
one-hop application trust policy; do not increase trust globally or disable any
limits. Keep the existing Juno HTTP/WS contracts, scoped store and revision
guards; coalesce state reads and respect `RateLimitError.retryAfter`.

**Tech stack:** Existing Nginx, Cloudflare Tunnel, Fastify 5, React 19, Zustand 5,
TypeScript and Vitest; no new dependencies or database changes.

**Spec / confirmed incident:** On 2026-11-07 02:23–02:27 UTC the VM returned 199
Juno GET and two Juno POST refusals. At 02:23, ordinary gameplay generated 37
commands and 280 state reads. Nginx sees cloudflared at 127.0.0.1 and appends that
address to X-Forwarded-For; the application's default one-hop policy therefore
puts all players into one 200/minute bucket. The current Juno store erases its
snapshot on any failed current GET, including 429. No server restart, OOM or WS
closure was recorded during that incident. Runtime errors/rejected TypeErrors
without frames do not identify a separate fixable source and must not be guessed.

## Constraints and review focus

- Keep authentication, per-origin identity, membership, voice and permission gates.
- A 401/403/404 must still erase inaccessible private state; transient failures
  retain the last confirmed view and must not authorize speculative mutations.
- Concurrent invalidations must not cause concurrent state GETs or lose the last
  update; a response from a previous account/room/reconnect cannot install state.
- A 429 pauses reads and commands until Retry-After, including manual retry,
  polling and WS invalidations. Never replay a failed mutation automatically.
- The VM change trusts CF-Connecting-IP only from 127.0.0.1 on its loopback
  listener and overwrites forwarded client chains. Spoofed XFF must not change
  the bucket. Preserve the application image, DB, uploads, env and LiveKit.
- The user explicitly authorized **Publicar e atualizar** after being warned of
  a brief application interruption and loss of ephemeral tables. Publish 1.16.7
  using existing exact-commit CI, desktop and OCI workflows, then update only
  Backspace with the existing backup/update/immutable-image procedure. Do not
  restart LiveKit, bypass gates, move tags, force-push or restore runtime data.

## Tasks

- [x] Back up and atomically correct only `/etc/nginx/sites-available/backspace`;
  run `nginx -t`, graceful reload and a three-request bucket-isolation/spoof test.
  On a failed check restore the original configuration and reload safely. Record
  unchanged Backspace/LiveKit container identities and start times.
- [x] Add failing Juno store tests for transient-state retention, 401/403/404
  clearing, coalescing/trailing invalidation, cooldown and epoch/race isolation.
- [x] Implement the bounded, session-scoped read/cooldown behavior in
  `packages/web/src/stores/junoStore.ts` using the existing RateLimitError.
- [x] Add the existing per-route limiter to state GETs (600/minute/IP) and prove
  four players/four spectators sharing an address do not exhaust ordinary HTTP
  while the 601st state read is still refused. Keep command/auth/voice gates.
- [x] Ensure mutation controls cannot submit from an unconfirmed/stale view;
  add a table-level regression test for retaining the match on transient errors.
- [x] Update `docs/systems/juno.md` and `docs/systems/deployment.md` with actual
  recovery and custom Cloudflare Tunnel + Nginx configuration behavior.
- [x] Run isolated affected tests, build in shared → server → web order,
  typecheck/i18n and lint, and actual UI/startup checks with temporary storage.
- [x] Review the whole source/operational change externally once with Sol,
  including this plan, temporary helper and actual VM configuration/backup.
- [ ] Publish reviewed source/version/notes, require exact-commit CI/Security/
  CodeQL before the immutable v1.16.7 tag; await desktop/OCI publication and verify
  public installer hashes/manifests and amd64/arm64 image revision/digests.
- [ ] Recheck occupancy, make consistent private DB/uploads/config backups, retain
  the old immutable image, and use backup.sh/update.sh to recreate only Backspace.
  Verify public health/version/assets, unchanged identity/migrations/uploads,
  healthy non-root process, original LiveKit identity/start and the Nginx fix.
- [ ] Report actual production version and any untraceable-error limitations.

## Progress and rulings

- Work is on `fix/juno-rate-limit-recovery`, preserving the initially clean
  `4ad5f384` checkout and avoiding changes on master. No commits/pushes yet.
- Nginx mitigation live at 2026-11-07 02:35:48 UTC. Private backup:
  `/root/backspace-juno-realip-20261107T023548Z`. Before SHA-256 `090ee07b8a31cb921ddf67fdb1d3c8b8f58d36b2bed3e511619183b8d8f980d2`;
  after `d0b5ad6399260e6fdfe6971d86a2519a10e12f66bfe6d486653504b04c28518f`.
  Same client/different spoofed XFF/different client returned remaining budgets
  199/198/199. Backspace and LiveKit ids/start times/restart counts unchanged.
- First application attempt rolled back automatically: graceful reload is
  asynchronous and probes briefly reached old workers. Added a bounded 0.5s
  worker-start settling interval; second attempt passed. Original config restored
  before retry. The failed-attempt backup remains preserved.
- After mitigation, 464 requests from eight addresses included 326 successful
  Juno GETs and 21 successful POSTs, with zero 429 or 5xx. Two voice-required
  403s and one stale-revision 409 are actual authorization/concurrency refusals,
  not evidence of a second crash; do not weaken those guards.
- Ruling: also isolate high-frequency Juno reads with the existing route override
  at 600/minute/IP. Correct proxy identity alone does not help a household/NAT
  with several players. This is a local budget adjustment, not a new global
  limiter or account/auth mechanism. Regression observed failing at read 201.
- Client regression gate observed eight failures before implementation; after
  implementation all 30 affected store/table tests passed (including stale-view,
  cooldown, no mutation replay and old-GET/new-command races).
- A further reproducible privacy race let an old command restore a hand after a
  current 403. Added a failing regression, then invalidated that read/command
  epoch when access is refused. All 61 affected client tests now pass; 56 server
  engine/report/bot/route/live-transport tests also pass.
- Version 1.16.7: fixed-order production build, workspace typecheck/i18n, desktop
  TS, server e2e TS, lint, precache budget and 18 release-tooling tests passed.
  Both dev servers started clean against isolated temporary storage. Headless
  browser checks of actual call containers at desktop/short/mobile sizes passed
  transient retention, disabled moves, blocked retry bursts, automatic recovery
  and private-state clearing. Nine screenshots retained and representative images
  visually inspected. No live-media, native-device or multi-device claim is made.
- Initial full isolated server/web suite attempts were supplemental gates; initial
  attempts were interrupted by an explicit 120s harness timeout, not assertion
  failures. Restarted with no harness timeout. Exact-commit hosted CI remains a
  mandatory publication/deployment gate regardless of local results.
- Full isolated suites completed successfully: 3,277 server tests/301 files and
  3,451 web tests/370 files. The single external Sol review found one concrete P2:
  an old GET returning 429 after a successful command skipped the cooldown.
  Added its failing regression and moved rate-limit processing outside the
  snapshot-identity guard, retaining protection against erasing the newer view.
  This is a narrow correction within the reviewed behavior, not new scope.
- Post-review regression was observed failing, then all 62 affected web tests
  passed. Fixed-order build and lint passed again, and browser recovery checks
  passed again after restarting the isolated fixture server to discard HMR module
  identities. The single reviewer found no other concrete issue in code, proxy
  configuration or the release/deployment procedure. Publication/deployment remain
  pending the hosted gates below; subsequent execution evidence is retained in
  the incident's private temporary directory and VM rollback directory.
- Operational helpers reuse the existing 1.16.6 backup/update/rollback procedure,
  now pinned to the verified running 1.16.6 image `sha256:2a4cccc...`. Bash syntax,
  eight embedded Python ASTs and six Node helper syntax checks passed. The real
  pin replacement preserved LF/CRLF and rejected mismatched manifests in memory.
- Last live read-only check: 1,229 requests after mitigation, eight source
  addresses, zero 429 and zero 5xx; Nginx hash unchanged. Untraceable historical
  runtime errors remain a stated diagnostic limit, not invented fixes.
