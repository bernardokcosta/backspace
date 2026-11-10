# Operational resilience — local validation

Scope: the three approved specs/plans dated 2026-11-10. Implementation is local
on `fix/rate-limit-resilience`; no commit, push, publication, VM restart or
production configuration/data change is part of this work.

## Implemented

- Independent trusted-address HTTP admission families, post-auth verified-account
  reads/writes and retained restrictive route/resource budgets. Login successful
  reservations refund without creating an anonymous account-wide lockout.
- Shared channel/DM REST/WS message and reaction admission, bounded registries,
  gradual refill and independent ephemeral/control WS budgets.
- Actual remaining manual waits, exposed HTTP/tus headers, finite resumable
  upload backpressure and cancellable deduplicated one-shot GET recovery.
  Refused mutations/drafts/attachment references remain available for explicit
  retry; reconnect and temporary user lookup failure do not expire credentials.
- HMAC/nonce validation before peer quota; relay429 preserves queue ordering,
  attempts and peer health while excluding cooling peers before the batch limit.
- Component-owned, non-overlapping update checks with offline/stale-registration
  handling, cleanup and existing voice-safe activation unchanged.
- Single-flight optional media probes with cached success, 30s demand-driven
  failure cooldown, 5s timeout, 64KiB output bound and sanitized failure codes.

## Validation and environment

Commands use repository-pinned `corepack pnpm` (pnpm was absent from PATH).
Corepack-generated shims live only in ignored `node_modules/.bin`; no global
installation or dependency/lockfile change. Root scripts use that local PATH.
Vitest filters use `exec vitest run <paths>`: the documented `test -- pattern`
syntax runs the whole suite with this installed version.

- Sequential shared → server → web build passed (including i18n).
- Root typecheck, server `typecheck:e2e`, desktop `build:ts` and lint passed.
- Full web suite: 414 files / 4,029 tests passed. Subsequent focused lifecycle,
  API/auth/instance suites: 16 files / 195 tests passed after an additional
  localized-timeout regression (only explicit 401/403 expires a remote session).
- Initial full server run: 3,344 passing, one expected error-shape assertion
  requiring the additive optional scope field; corrected. A subsequent run
  concurrent with full web+build exhausted 5s test deadlines and caused secondary
  fixture races. No product change or increased test timeout was made for that;
  the final server run limits workers to two, separately from full web/build.
  Final result: **308 files / 3,350 tests passed**, including the two-instance
  federation suites; no test timeout/configuration change.
- Focused regressions were observed failing before fixes, then passing. Cover
  actual registration/auth order, 20 normal accounts behind one IP, IPv6 /64,
  real channel+DM REST/WS handler sharing, idempotent reactions, finite tus retry,
  stale session cancellation, S2S nonce/rotation and peer-isolated backpressure.
- Relative task-document links, final newlines, whitespace and diff checks pass.

## Runtime evidence and limitations

Both dev servers started against disposable Windows temporary DB/uploads;
Vite selected 5174 because another application already occupied 5173. That
other application was not modified. Limits remained enabled. Production was
never used for load or recovery tests.

Local browser exercise: injected one scoped429 into the real API client's user
read, then forwarded the next request to the disposable server: two fetches,
successful recovery, retained login. A refused POST made exactly one fetch.
A real local WebSocket saturated ephemeral traffic, still reached the call
permission check on an independent control event, and answered ping.

The built app registered an active service worker; an actual periodic update
was observed with zero unhandled rejections. Direct `registration.update()` also
succeeded. Fake registration tests exercise stale/sync/network/offline/overlap/
replacement/unmount behavior and existing cross-tab voice locks.
Screenshot: ignored `.playwright-mcp/resilience-recovery-ui.png` (synthetic local
account, authenticated application view). In-app capture required a visible
window; a separate local Playwright browser provided the screenshot instead.

Local `ffprobe` is absent (`ENOENT`); startup remained healthy and safe diagnostics
reported that fixed code without child output. Successful executable recovery
was verified with mocked processes and the existing metadata caller, not a real
Linux executable. Real LiveKit calls, microphone/hardware, packaged desktop,
Linux/container image and production rollout were not exercised here.

## Recorded implementation rulings

- Relay429 honors Retry-After seconds/HTTP-date (fallback30s, cap1h), cancels the
  error body instead of reading arbitrary JSON. JSON-only peers get safe fallback.
- Terminal `interaction_responses_exceeded` is an existing lifetime response
  ceiling, not a timed quota: no fictitious cooldown is attached.
- Diagnostic accepted-byte safeguarding remains enforced even with the explicit
  test rate-limit bypass, because it protects process/storage resources.
- Read recovery owns parsed payload consumption through timeout/cancellation and
  clones shared results, not Response bodies; this also bounds body consumption
  within the existing 30s request timeout.

Final external review passed; this document does not claim production
validation. Tests used Node24.21.0 on Windows; live Linux/tool/hardware limits
above remain explicit rather than inferred from mocked success.

## Initial external review corrections

Sol identified two P2 integration defects: bootstrap with a saved token and no
user re-triggered loads after temporary refusal, and generic DM throttling
incorrectly included call correlation, clearing an outgoing call on typing
saturation. Both were corrected before delivery.

- Dedicated non-persistent `userLoadError` settles bootstrap failure. Both
  protected and public-invite entrypoints stop automatically loading and reuse
  existing localized retry styling. Explicit retry starts one new episode;
  success/new session/logout clears the error. API one-shot retry stays bounded.
- Only throttled `dm_call_start`/`dm_call_accept` carry call correlation;
  typing/message/end/unknown events do not. Existing correlated start refusal
  still clears its outgoing call; an unrelated ephemeral refusal preserves it.
- RED tests reproduced six reads instead of one for both entrypoints under
  429/502. GREEN tests cover explicit retry and the API's scoped one-shot wait.
- Real browser with unloaded user: one simulated502, visible retry, retained
  token; pressing retry against the disposable server restored the user and
  cleared the failure. Screenshot inspected:
  `.playwright-mcp/resilience-bootstrap-retry.png`. Test servers were stopped.

The dedicated bootstrap state/retry view expanded the auth-entrypoint correction,
so one follow-up to the same Sol reviewer verified it after affected tests;
no second reviewer or open-ended review chain was used.

Post-correction validation: full web **415 files / 4,038 tests passed**; affected
server WS/admission suites **30 files / 294 tests passed**. Sequential root build
(including source typechecks and i18n), lint, server e2e typecheck and diff checks
passed again. The earlier full server3,350-test result covers the rest of the
unchanged implementation; it was not claimed as a full rerun after this fix.

## Final review outcome

The same Sol reviewer approved the second and final check: both P2 findings
resolved, no additional concrete blockers. Its own follow-up validation passed
124 web tests, 299 server tests and diff checks, without modifying files.
Container/hardware/real Linux media-probe limitations remain as described above.
Changes stay uncommitted in the isolated worktree; no production action occurred.
