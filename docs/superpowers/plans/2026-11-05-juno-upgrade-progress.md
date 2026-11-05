# SDD ledger — plan: docs/superpowers/plans/2026-11-05-juno-upgrade.md

## Execution authority and state

- User approved the whole plan/task lists and inline execution in this conversation.
- Work stays on dirty `feat/games-picker`; preserve all previously reviewed picker
  changes and specifications. No commit, push, release, deployment or runtime DB work.
- All test subprocesses receive unique temporary DB/uploads/backups, even mock-only
  tests. Explicit file inventory precedes execution; never `pnpm test -- filter`.
- Test tooling/evidence root: `C:/Users/berna/AppData/Local/Temp/opencode/juno-upgrade-20261105/`.
- The planning-stage local-DB incident is recorded in the parent plan. Its files
  are not inspected, restored or used by this implementation.

## Task status

- P1: complete — 7 standings tests RED (missing module) → GREEN.
- P2: complete — 6 real SQLite cases plus 23 pre-squash upgrade cases GREEN;
  generated `0048_nasty_kinsey_walden.sql`, its snapshot and journal, additive only.
- P3: complete — two lifecycle regressions RED → GREEN, including departed
  starter and pending outcome retained after the last person leaves.
- P4: complete — 3 ranking tests RED → GREEN (shared ranks before paging/self).
- P5: complete — 4 real-DB route tests RED → GREEN plus prior transport tests.
- P6: complete — tombstone + reattach tests RED → GREEN, 31 focused checks.
- P7: complete — actual four-player+spectator, second-channel, restart, new-space
  and two-instance federated identity acceptance: 3 tests passed, 2 files.
- A1: complete — 67 passive supplied assets, 54 fronts+back, 4,028,343 bytes,
  byte/hash inventory RED → GREEN. Source ZIPs unchanged; samples inspected.
- A2: complete — supplied image renderer and wire mapping RED → GREEN.
- I1: complete — five catalogs/plurals/real color labels, RED → GREEN.
- I2: complete — scoped ranking state and API RED → GREEN, 22 transport/store tests.
- I3: complete — stable seat layout and real platform profile badges RED → GREEN.
- I4: complete — authoritative result and paginated ranking screens RED → GREEN.
- I5/I6: complete — both lobby/match RED tests observed before extraction;
  complete cosmic CSS applied. Focused 12-file UI/integration run: 47 passed;
  final additional nine-file UI/store/API run: 49 passed.
- I7: complete — browser acceptance, subsystem docs, broad isolated validation
  and final complete-scope external review passed, with the limits below.
- Complete implementation external GPT review: approved by `review_final_gpt56`
  (session `ses_e52fc5175ffe381D4owfFc7pab`); no corrective findings.

## Rulings and evidence

- Ruling: use a temporary Node test launcher to inventory exact test files and
  spawn Vitest with unique fallback DB/uploads/backups per run — prevents the
  prior argument-forwarding/default-path incident — no product dependency/config
  change; isolated broad-suite audit still required before comprehensive runs.
- Ruling: put the shared SQLite fixture in `src/games/junoTestDb.ts`, not outside
  `src/` — server source tests are included by tsc and may not import outside its
  rootDir — a test-only helper reuses the real migrator, no runtime DB/defaults.
- P1–P5 focused aggregate: 46 tests across six files passed; server tsc passed.
  All test runs have inventoried exact files and isolated fallback paths.
- P7 assertion correction: compare durable counters/rank/identity after restart,
  not live profile presence (online correctly becomes offline on restart).
- A1 import tool/evidence: `juno-upgrade-20261105/import-assets.cjs` in the temp
  tooling root, no production importer/dependency. Manifest records originals.
- Ruling: local `JunoLobby.onRanking` opens its parent's scoped view only, rather
  than creating a second global UI flow — preserves selector/table ownership.
- Ruling: implement adjacent shell/match extraction after observing both missing-
  module RED suites, then validate the composed surface together — avoids two
  temporary authorities while preserving existing commands and accessible labels.
- Broad-suite isolation audit: source searches for DB_PATH/upload/backup overrides,
  direct SQLite opens, config mocks, env deletion/replacement and fixture harnesses.
  DB overrides are memory/temp or the protected two-instance harness. The only
  DB_PATH mutation (preSquashUpgrade) restores its inherited temporary fallback.
  No test clears that fallback or reads the checkout's `.env` under NODE_ENV=test.
  Existing mocked /tmp upload strings are not runtime DB paths. `run-all.cjs`
  inventories explicit 50-file batches through the same isolated launcher.
- Browser acceptance: `serve-ui.mjs` serves actual React components via a virtual
  fixture entry (no fixture files in production). `check-ui.mjs` completed 25
  scenarios: desktop/mobile initial/lobby/match/result/ranking/spectator/two-player/
  large hand/pending, 640×360 short tiles, 50%/200% scale, Portuguese keyboard and
  reduced-motion. No horizontal table overflow, distorted cards, broken images,
  page errors or HTTP asset failures. Screenshots and `ui-evidence.json` are in
  the external tooling root. Wild Escape restored focus, ranking/back retained
  the hand, and neither emitted a mutation. Backdrop reduction uses the glass
  fallback; actual multi-device LiveKit and native fullscreen Escape remain untested.
- Visual refinement: preserve original button aspect ratios and nine-slice the
  supplied ranking frame; initial stretching letterboxed/doubled SVG frames.
  Captures were inspected and the 25-case matrix reran successfully afterward.
- Additional regressions RED → GREEN: ranked finishers precede abandoned starters
  in stored scoreboards; leave confirmation takes focus and consumes Escape.
- Full web run: 369 inventoried files passed. Full server run: 299 files executed,
  one existing backup-assertion failure because the launcher disabled backups and
  overrode their default directory. Ruling: only that snapshot e2e gets backups
  enabled and BACKUP_DIR='' (derived from each protected temporary DB_PATH), with
  the offsite hook explicitly blank; all backup writes remain temporary. Focused
  rerun pending. No product behavior changed to satisfy this harness issue.
- Root build (shared→server→web), lint and desktop build:ts passed; remaining
  final typecheck/build-asset checks and external review are tracked below.
- Backup e2e rerun: 5/5 passed after the isolated launcher correction. Full
  server run covered 3,242 tests/299 files (the sole failure now resolved);
  full web run covered 3,410 tests/369 files. Subsequent added regression tests
  passed in focused runs. No broad run used the checkout DB or `.env`.
- Root `pnpm typecheck` (including i18n), explicit e2e TypeScript and desktop
  `build:ts` all passed. Precache size check passed: 115 entries, largest bundle
  1,578.7 KiB under the 2,764.8 KiB budget. `git diff --check` passed (CRLF notices).
- Both source API and Vite dev server started using isolated fixtures. API health
  passed and all 67 production asset responses matched the manifest SHA-256;
  no demo/preview/PNG file was imported. The initial startup probe was corrected
  to recognize privacy-sanitized logs rather than their intentionally absent text.
- Final repeat build/lint passed after CSS/profile/result test refinements.
- External final review examined all 147 dirty/new repository files and seven
  external scripts; independently passed 133 tests across 23 files (real SQLite,
  HTTP/WS, federation/restart included), verified 67 asset hashes/sizes and the
  additive migration snapshot. No additional findings, no edits by reviewer.
- Final acceptance additionally waits for image decode/paint before screenshots;
  25 cases passed again, including actual reduced-transparency emulation of the
  wild chooser (solid #090f29, no backdrop filter). No fixture is shipped.
- Delivery remains local/uncommitted: no push, version bump, release or deployment.
  Source ZIPs and checkout runtime state were not accessed by implementation tests.
  Preserve the planning incident disclosure: without its prior baseline, absence
  of database effects cannot be proved. Distribution rights of supplied artwork
  must be confirmed before a future public release. LiveKit multi-device/native
  fullscreen Escape remain outside this validation.
- Follow-on authorization to commit/push/publish 1.16.3, and the release review's
  pending-credit/reattachment correction, are recorded in
  `2026-11-05-juno-release-1.16.3.md`; the earlier local-only boundary above is
  historical, not the current publication authorization.
