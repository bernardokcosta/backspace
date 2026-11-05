# Juno Reporting 1.16.5 Release and Deployment Plan

> **For agentic workers:** Execute inline. Reuse the already selected Sol for the
> final complete implementation/release/procedure review; no alternate reviewer.

**Goal:** Publish the user-approved reporting change as 1.16.5 on master and deploy
the exact verified image to the existing Backspace VM after all gates pass.
**Architecture:** Existing version script, exact-commit main-branch CI/security,
immutable annotated tag, single desktop publisher and multiarch GHCR workflow.
Existing backup.sh/update.sh/Compose with one immutable tag@amd64-digest image pin.
**Tech Stack:** Existing Node/pnpm/Git/GitHub Actions/SSH/Docker/SQLite tooling.
**Spec:** `../specs/2026-11-05-juno-reporting.md`, feature plan and
`docs/systems/deployment.md`; explicit user authorization in this session.

## Constraints

- Base is 1.16.4/master `bd6a76b418535ceee2ef359ce915f995c84ab79a`. Target VM is
  the same `root@10.84.22.89`, serving `https://backspace.costakoch.cloud`.
- Scope: the approved report rule/UI/tests/docs, five manifest versions, release
  notes, these ledgers and reviewed operational helpers. No migration, dependency,
  workflow, updater implementation or unrelated product change is planned.
- Develop/test only with isolated storage, never checkout .env/data or production
  accounts. Inventory every file; preserve unrelated work and all prior evidence.
- No force push, moved tag, replacement release assets, disabled gates, Docker
  pruning, compose down/remove-orphans or automatic database/uploads restoration.
- Read-only occupancy check before deployment. Consent to interrupt the prior
  1.16.4 release is not authorization to interrupt active calls for 1.16.5.
- Preserve private DB/uploads/config backups and the previous immutable image.
  Only BACKSPACE_IMAGE_TAG may change; preserve all other bytes/mode/ownership.
  Only Backspace is recreated; LiveKit/other containers must retain identity/start.
- Review all completed changes and the deployment procedure before publication.
  Actual deployment must use the reviewed helper hashes and expected scope.
  Main agent validates actual results; stop rather than silently broaden the
  procedure if new risks or deviations appear. At most the already-used initial
  spec review and this final whole-task Sol review, per global review limits.

## Gates and execution

- [x] Complete approved feature plan: engine/UI/HTTP/WS tests, whole isolated
  suites, real call-container controlled browser checks, docs and source startup.
- [x] Bump all five manifests via `node scripts/bump-version.mjs 1.16.5`; add
  `.github/release-notes/v1.16.5.md` with exact rules and eight installer links.
- [x] Sequential pnpm build; typecheck/i18n; lint; server e2e/desktop TS; version,
  affected and desktop/tooling suites; precache budget and 67 source asset hashes.
- [x] Extend existing read-only verifiers with explicit 1.16.5 support/output path;
  prepare separate version-specific VM helpers based on verified 1.16.4 procedure.
  Keep digest pin fix and bounded/sequential public 429 Retry-After handling.
- [ ] Bash/Node/embedded Python syntax and in-memory pin-substitution/mismatch
  checks; full hash inventory and final same-Sol review. Fix concrete findings.
- [ ] Check absent tag/release and remote master base, stage only inventory,
  commit and push master/feature without force; preserve concurrent remote work.
- [ ] Await CI/Security/CodeQL for the full exact SHA, then create/push annotated
  v1.16.5 once. Await desktop/native/container success before deployment.
- [ ] Anonymously verify 16 published files, SHA256/size/updater SHA512, exact
  notes/revision/latest; verify OCI version/revision for amd64 and arm64.
- [ ] VM preflight: healthy baseline/clean checkout/disk/config hashes/calls.
  Ask for current interruption approval if participants remain.
- [ ] Private rollback directory: enabled backup.sh; validate SQLite integrity/FKs;
  archive and validate uploads/config, retain old image and prior rollback dirs.
- [ ] Pull target tag@verified-amd64-digest, validate config/layers/index membership
  with Docker 29 id semantics. Fetch immutable release and fast-forward exactly.
- [ ] Recheck calls, atomically change only the immutable image pin, temporarily
  detach at release and use enabled update.sh --yes. Return master clean. On
  failure restore original environment/immutable image, never data automatically.
- [ ] Verify exact API/commit/digest, health/non-root/restarts/log bounds, unchanged
  migrations/identity/DB integrity/original uploads/config and unrelated containers.
  Verify public HTTPS frontend hash/entry assets and all 67 Juno asset hashes.
- [ ] Retain sanitized evidence and truthful limits; report actual release/deploy/
  rollback results. No authenticated production gameplay/media test is implied.

## Ledger

- User authorized release 1.16.5, master commit/push, new tag/release and same-VM
  deployment only when implementation/testing is ready. No 1.16.5 publication or
  production write has occurred at plan creation.
- Remote preflight still has master/feature at the 1.16.4 base and no v1.16.5 tag.
  Feature tests and controlled browser validation are in progress; prior release
  data/config/rollback evidence must remain untouched until gated deployment.
- Full suites passed 3,276 server/301 files and 3,433 web/370 files. Controlled
  actual call containers passed 280 UI states across five languages/eight view/
  scale combinations, keyboard/confirmed reporting/reduced motion; screenshots
  inspected. No actual media/fullscreen-native/Safari/Firefox claim is made.
- Version-1.16.5 build/typecheck/i18n/lint, e2e/desktop TS, 55 server/61 web affected
  tests, 565 desktop tests (18 platform skips), 28 tooling tests, precache and
  isolated source startup/67 asset hashes passed. Eight installer links validated.
- Operational helpers preserve the approved immutable digest binding. Eight Python
  blocks were AST-checked without executing deployment; Bash/Node syntax passed.
  In-memory tests of the real pin code preserved LF/CRLF and refused mismatched
  digest before writing. Rollback now reuses the existing prior immutable ref/
  image directly, without attempting to retag a digest or restoring database data.
- Read-only VM preflight: clean master at the 1.16.4 base, healthy immutable amd64
  image 790fd4e6…, approximately 17.9 GB free, config hashes recorded. LiveKit check
  at 23:33:34Z found one room/three participants. The user explicitly selected
  **Pode reiniciar para a 1.16.5** after the brief-interruption/game-loss warning;
  this is release-specific consent, and occupancy will be rechecked before apply.
