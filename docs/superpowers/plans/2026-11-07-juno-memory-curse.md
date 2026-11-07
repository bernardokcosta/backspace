# Juno memory curse implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` inline.
> User approved the spec and explicitly requested implementation plus preview.

**Goal:** Add the approved one-copy blind-turn card using the supplied art/audio.
**Architecture:** Extend Juno's existing engine and private projection, opt into
the enhanced deck per human seat, reuse scoped state/HTTP/SFX lifecycles and render
neutral masked cards. No parallel game, database, dependency, global capability
framework, publication or production changes.
**Tech stack:** Existing TypeScript, Fastify, React, Zustand, AudioManager, Sharp,
FFmpeg and isolated Vitest/browser tooling.
**Spec:** `../specs/2026-11-07-juno-memory-curse.md` (user approved all defaults).

## Global constraints and review focus

- Preserve 1.16.7 budgets, coalescing/cooldown, permissions and per-origin identity.
- Exactly one extra card only for capable cohorts; legacy rounds stay at 108.
- Victim payload/DOM/ARIA must expose no face/color/legal hints; omitting the
  capability cannot retrieve an unmasked enhanced view.
- Bad owned-color attempt retains its card and applies one draw-two/pass. Stale,
  unowned and duplicated attempts do not become penalties or reveal private cards.
- Audio is once per new confirmed special-card move, not mount/poll/reconnect;
  pending loads and playing sources must be canceled on scope exit.
- Bots select blind slots without receiving secret faces/color. Masking, audio,
  geometry, wild resolution and stale-read races are mandatory regression gates.

### Task 1: Contract, engine and private view

**Files:** shared `src/juno.ts`, `src/errors.ts`; server
`src/games/{juno,junoBot}.ts`, new `junoMemory.test.ts`, existing engine/bot tests.

**Interfaces:** Add face `memory`, optional `memoryEnabled`, `memoryCurse`
(`id`, `targetUserId`), `maskedHand` (`{id}[]`) and root `supportsMemory`.
Add confirmed move type `memory_miss`. Engine `createJunoDeck(memory=false)` and
`startRound(people, now, memory=false)` preserve existing default callers.
`JunoRooms.read/command` accept an optional support boolean (default false).

- [x] Add RED tests: 108/109 and unique card, color retention/both directions,
  success/miss, wild/+4, timeout, draw/pass refusal, report/departure/end cleanup,
  conservation, masked projection and capability downgrade.
- [x] Implement synchronous rules within `actInRound`, sweep and existing rooms.
  Freeze per-round capability, never serialize the retained color/hand to victim.
- [x] Make computer blind selection consume slot ids only; GREEN engine/bot tests.

### Task 2: Authenticated transport and scoped client

**Files:** server `src/routes/juno.ts`, `juno.test.ts`; web `src/api/client.ts`,
`src/stores/junoStore.test.ts` and affected API tests; shared/localized errors.

**Interfaces:** `?memory=1` on Juno state/command requests only; ranking unchanged.
New coded `juno_update_required` (409) for unsupported enhanced-round viewers;
existing leave remains available. No new WS event/header or mutation retry.

- [x] Add RED route tests for mixed/capable cohorts, auth-before-compatibility,
  unsupported observer/downgrade, malformed query and shared query-variant budget.
- [x] Add query negotiation, safe error translation, origin-aware client URLs.
- [x] Prove old unmasked GETs cannot replace current masked state, transient
  errors retain it and 429 still pauses reads/mutations. GREEN affected suites.

### Task 3: Assets, masked table and once-only sound

**Files:** existing game assets/manifest/provenance; `public/sounds/juno_memory.ogg`;
`components/games/{JunoMatch,JunoEffects,JunoSession,JunoTable,junoAssets,juno.css}`;
focused new `JunoMemorySound.tsx` + tests if needed for session-scoped audio;
five voice/error catalogs and game/session/asset tests.

- [x] Derive WebP from original PNG without outer white canvas, encode supplied
  PCM to Ogg using existing tools; retain source/crop/output hashes/provenance.
- [x] RED tests for hidden-card labels, no front URLs/color markers/legal classes,
  blind cardId-only commands, no color picker for memory/hidden wilds, two-card
  announcement, draw/pass guard and unchanged normal table.
- [x] Render neutral fog placeholders, stable geometry, violet/cyan sweep and
  reduced-motion state; restore ordinary views on success/miss. GREEN UI tests.
- [x] RED→GREEN sound tests for new confirmed id, no historical replay, same-id
  polls, mute/deafen/SFX preferences and pending-load/source cleanup. Use existing
  `AudioManager` output and `getSfxVolume`, without modifying capture/LiveKit.

### Task 4: Actual preview, documentation and final validation

**Files:** subsystem docs `juno`, `api`, `client-federation`, `sounds`,
`localization`; preview/test helpers and evidence in a new approved temp directory.

- [x] Run source UI with actual components and supplied media; exercise blind
  success/miss at desktop/short/mobile/scaled layouts, keyboard, reduced motion,
  audio playback and before/during/after bounds. Inspect captures and show preview.
- [x] Update subsystem docs and spec status; preserve existing asset hashes.
- [x] Fixed-order build; typecheck/i18n; e2e/desktop TS; lint; isolated affected
  engine/route/store/UI/audio suites, then broader suites where practical.
- [x] Final complete Sol review of implementation + docs + generated assets and
  external helpers, followed by concrete fixes and affected validation. The prior
  spec-only review does not validate the newly implemented security/logic/media.
- [x] Deliver truthful source/preview outcome; no commit/tag/release/deploy unless
  separately requested. Never modify published 1.16.7 or production runtime data.

## Ledger

- Base clean except this task's approved spec. Branch `feat/juno-memory-card`.
- Spec-only external Sol review: `ses_e4badc218ffeF7Hx9mdijJ5Olz`, no findings;
  user subsequently approved implementation and all proposed defaults.
- Implementation, tests and preview are now authorized inline; publication/VM
  operations are not. Follow this ledger rather than repeating completed phases.
- Task 1: complete. Observed RED before implementing memory, then 63 original/
  new engine/bot/report tests passed. Extended to seeded 2/3/4-player enhanced
  complete rounds (36 samples, 109-id conservation), two-player hit/miss,
  capability refresh/downgrade/rematch and expiry/departure cleanup.
- Task 2: complete. Observed transport RED before negotiation and UI/store RED
  before masking/error handling. Query variants retain the 600/minute read
  budget; normal permission gates precede update-required replies. Existing
  revision/generation/coalescing/cooldown behavior is reused, not duplicated.
- Task 3: complete. Supplied PNG/WAV originals untouched; derived assets/hashes
  recorded. UI/sound suites went RED→GREEN; final affected runs: 79 server tests
  (five files), 85 web tests (seven files). Pending audio cleanup covers exit,
  scope/deafen/zero SFX, delayed loads and same-id/reconnect suppression.
- Ruling: memory cue freshness uses the server-relative 45s turn remainder
  (at least 42s) and a 3s pending-load limit — avoids stale replay without a new
  timestamp contract — very delayed/terminal snapshots may omit the cue.
- Ruling: this plan's preview/evidence live in the approved temp directory
  `C:/Users/berna/AppData/Local/Temp/opencode/juno-memory-20261107/`, rather than
  another plan's scratch workspace. Reused only the existing pnpm wrapper;
  no old evidence was overwritten. Preview is loopback-only on port 5193,
  imports the actual engine/components/media, uses isolated in-memory rooms and
  blocks `/api`; controlled fixture actions are not a real voice/federation test.
- Ruling: preview controls overlay existing chrome instead of stealing table
  height. Short/narrow instructions are compact localized text; a 6px reserve in
  tall narrow tables is present both before/during/after masking, so entering
  the curse never moves controls. Browser checks caught and drove these fixes.
- Broad web suite: all 371 files, 3,471 tests passed. Broad server inventory:
  302 files; all but one migration-snapshot assertion initially passed. The
  external runner had disabled/redirected backups; corrected it to enable
  snapshots beside each isolated DB, with the previously failing five-test
  federation suite now green. Full affected 50-file batch rerun: 421/421 tests
  passed, including real Juno HTTP/WS and federation e2e. Combined server
  inventory after that correction: 302 files, 3,303 tests passed. The original
  failing batch log is retained; its rerun is shell `sh_1b47797f400158u3XwhNYvsYQW`.
- Validation: fixed-order production build passed; root typecheck/i18n, separate
  e2e TS and desktop TS passed; lint exits 0. Source server and web start clean
  against temp storage (`dev-smoke-evidence.json`), version remains 1.16.7.
- Browser validation: keyboard hit/miss/blind wild, masked payload/DOM, stable
  geometry, reduced motion and real Ogg decode/nonzero PCM/source-start through
  AudioManager. Desktop/mobile/short captures inspected. Full five-language/
  eight-size run: 120 scenarios passed, no console/network errors or external/API
  traffic. Evidence: `ui-evidence-pt-en-de-ru-zh.json` and `screenshots/` in this
  feature's temp directory. Final fixed-order build also passed after UI tuning.
  Final complete implementation review passed without actionable findings.
- Task 4: complete. External Sol review `ses_e4b83ba49ffe1vcRD9Zpb93Fmu`
  approved the complete scope (37 modified and seven new repo files, plus
  external helpers/media/evidence), and independently reran affected tests,
  sequential build, typechecks/i18n, lint and diff checks successfully. No
  application changes were required after review. This closure entry only
  records the result. After the harness restart, restored the same loopback
  preview without repeating completed validations.
- Remaining limits: preview uses controlled real-engine rooms, not a live
  multi-device voice call. Audio decode/playback was verified, but spoken
  content was not independently heard/transcribed. Release/deploy is separate.
- No commit, push, tag, release, version bump or VM/data operation performed.

## Authorized publication phase — 1.16.8

The user subsequently requested commit, push and release, then explicitly added
deployment. That supersedes the earlier source-only boundary for this phase.
Use the existing fork workflows and VM update/backup procedures, not a new
publisher. Target: `bernardokcosta/backspace`, `master`, immutable `v1.16.8`,
`root@10.84.22.89:/opt/backspace`. Never alter `v1.16.7` or restart LiveKit.

I'm using the writing-plans skill to record this publication plan; execution
remains inline with the existing executing-plans workflow.

### Task 5: Version and verified publication

**Files:** lockstep manifests discovered by `scripts/bump-version.mjs`, new
`.github/release-notes/v1.16.8.md`, this plan/spec; release/deploy helpers and
evidence under the approved temp `juno-release-1.16.8-20261107/` directory.

- [x] Fetch origin and verify master/base and absence of existing tag/release.
- [x] Run supported version bump to 1.16.8; write accurate release notes.
  No dependency/lockfile/workflow changes, migration or new game logic.
- [x] Validate version consistency, affected tests, sequential build, i18n,
  types, desktop/e2e TS, lint and diff; reuse completed feature acceptance.
- [x] One justified follow-up with the same Sol reviewer: publication adds a
  material operational scope (version, notes and VM scripts) after initial review.
  Cover all task changes/helpers; no other reviewer and no further review cycle.
- [ ] Commit reviewed inventory, fast-forward master only, push without force;
  wait for exact-commit CI/security gates before creating/pushing immutable tag.
- [ ] Let existing tag workflows build/verify/publish installers and OCI image;
  verify public release inventory/hashes/update manifests and OCI revision.

### Task 6: Guarded VM update

- [ ] Read-only preflight: confirm healthy 1.16.7, expected clean checkout/image,
  disk space and live-call occupancy. Unknown/nonzero occupancy needs a new
  decision before restarting; do not inherit an older release's exception.
- [ ] Preserve root-private environment/config/SQLite/upload backups and exact
  old image. Verify target OCI commit/version/digest and fetched tag before update.
- [ ] Change only the reviewed image pin, reuse `update.sh` to restart Backspace
  alone, and restore the prior pin/image if health gates fail. Never roll back
  database/uploads automatically, expose secrets or delete production state.
- [ ] Verify public health/version/commit/frontend/media hashes, DB integrity/
  identity/migrations, preserved original uploads and unchanged LiveKit/other
  container ids/start times. Record private rollback evidence and report outcome.

### Publication preflight ledger

- User explicitly authorized commit/push/release, then deployment, in this chat.
  No exception for interrupting an occupied/unknown call is assumed.
- Origin/master is still the reviewed 1.16.7 base; `v1.16.8` and its release do
  not exist. Existing fork publisher/OCI workflows are unchanged.
- Supported bump changed exactly five manifests to 1.16.8, without dependencies
  or lockfile drift. Release notes describe redaction, compatibility and restart
  impact; broad feature acceptance remains the completed 120 browser scenarios.
- Revalidated at 1.16.8: 83 server tests (including version consistency), 85 web
  tests, sequential production build, root typecheck/i18n, e2e/desktop TS, lint
  and isolated server/web startup passed. VM scripts pass `bash -n`.
- Read-only VM preflight confirms clean master at the 1.16.7 base, healthy app,
  expected pinned amd64 digest and 16GB free. LiveKit remains the original
  container. Its public tunnel endpoint could not establish occupancy; the
  verified direct host-network endpoint returned zero rooms/participants.
  Repeat that count immediately before any restart; unknown/nonzero must stop.
- New release helpers adapt the previously used 1.16.7 scripts by exact guarded
  replacements only, keeping all backups/rollback/identity/upload/other-container
  checks. Public verification additionally hashes the supplied memory sound.
  Helpers/evidence stay outside Git under `juno-release-1.16.8-20261107/`.
- Same-Sol second/final review `ses_e4b83ba49ffe1vcRD9Zpb93Fmu` approved
  publication/deploy scope without actionable findings; independently verified
  unchanged feature patches, five version-only bumps, 83 server/85 web/13
  publication tests, lint, diff and helper syntax. No further code change needed.
  Operational completion after this commit will be recorded in that external
  release directory, not by moving/replacing an immutable tag to edit this ledger.
