# Sticker store review corrections

Scope: correct the thirteen reproducible findings from the review of upstream
#471, preserving #477/#478 and existing fork features. No release/deploy here.

## Invariants

- Authenticate uploads before parsing; enforce the configured base64 JSON byte
  budget on the received stream, including chunked bodies. Restore the existing
  single-line, visible-name rule on upload, collect and rename.
- Published pack metadata and items belong to the approved version. A candidate
  version's draft/review/rejection never removes or changes that published copy.
  Recheck ownership, draft status and the 100-item limit after async work, within
  the final synchronous transaction. Reordering may only affect the candidate.
- Validate and normalize remote metadata before downloads, bound metadata and
  asset response bytes, cancel abandoned bodies, and replace replica contents
  transactionally. Malformed peers must not damage a previous replica.
- Migration recovery must execute the missing parts of generated migration 0045
  and record its actual timestamp/hash atomically; never mark tables migrated
  merely because the size column exists. Divergent schemas fail closed.
- Optional authentication accepts the fork's Bearer and Bot schemes.
- Editors save candidate metadata before submitting, resume existing drafts,
  and consume Escape without closing the store underneath.

## Approach

Reuse the existing schema: pack status/currentVersion describe publication;
version status describes the candidate. Add an explicit PATCH for candidate
metadata and optional editingVersion/editingStatus fields to creator summaries.
Do not migrate schema or add dependencies. Use route-local stream enforcement,
SQLite synchronous transactions and the existing modal Escape mechanism.

## Validation

Regression tests for all findings, including raw chunked HTTP, concurrent upload
and review, failed sync rollback and partial migration recovery. Run full unit
suites, typechecks, lint, i18n and sequential build. Run real UI/dev-server smoke
checks where possible and report any environment limitations. One follow-up to
the same final reviewer, covering the complete integration and corrections.
