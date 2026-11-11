# Standalone Security Hardening Implementation Plan

> **For agentic workers:** Use `executing-plans` for native execution, or the
> explicitly selected subagent-driven workflow. Track checkbox steps task by task.

**Goal:** Audit native retained surfaces, reproduce concrete weaknesses, harden
confirmed findings and document both evidence and limits.

**Architecture:** Reuse existing auth/permission/upload/browser/desktop seams and
the single `safeFetch` API. Replace its unchecked second DNS resolution with a
validated connection-time destination using Node transports; keep bounded bodies,
normal TLS verification and local authorization, not scanner-only sanitizers.

**Tech Stack:** Existing strict TypeScript/Vitest/node:test, Node HTTP(S)/DNS/TLS/
streams/zlib, Fastify, Electron. No new dependency or production bypass flag.

**Spec:** [Security hardening](../specs/2026-11-10-security-hardening.md);
[orchestration/global constraints](2026-11-10-standalone-security.md).

## Global Constraints

- Node `^22.22.2 || ^24.15.0 || >=26.0.0`, pnpm `10.34.3`; no `any`/new dependency.
- No production pentest/SSH/deploy, real secrets, personal-profile destruction or
  release/image publication. Use only owned loopback fixtures/synthetic identities.
- Preserve classifier/redirect checks, 512,000-byte metadata/32,768-byte image
  budgets, 5s metadata and 3s image deadlines, stricter upload CSP and rate limits.
- Maintain JWT/bot ownership/revocation, permission parity, CORS/CSP and desktop
  sender/frame/sandbox/update trust; no TLS bypass or broad allowlist.
- No unresolved critical/high finding without explicit human disposition; lower
  findings have reproducible evidence/fixed-or-deferred rationale and honest limits.

## Review Focus

1. All DNS fallback answers, literals/mapped IPv6 and redirects use checked addresses (S2).
2. DNS/header/body/decompression stalls honor one total deadline and caller abort (S2–S3).
3. Early returns/chunk overflow/cancellation release sockets/readers/listeners (S2–S3).
4. Native-ID simplification cannot make client-supplied actor IDs authoritative (S1).
5. A clean scanner/UI shell cannot substitute for auth/native/image acceptance (S4–S5).

---

## File map and evidence sources

- Audit ledger: create `docs/superpowers/reports/2026-11-10-security-audit.md`;
  validation record: `docs/superpowers/reports/2026-11-10-standalone-validation.md`.
- Auth/permission routes, `utils/{auth,botTokens,permissions}.ts`, WS handlers,
  file/tus routes, local bot/role helpers;
  existing tests plus new `test/standalone-security-e2e.test.ts`.
- Modify `packages/server/src/utils/{ssrf,metadataFetcher,embedResolver}.ts` and
  their tests; create `utils/safeFetchTransport.ts` for Node stream/Response
  adaptation and `utils/safeFetchTransport.test.ts` for real transport fixtures.
  This helper is private to `ssrf.ts`, not another public fetch path.
- Review `packages/web/src` message/Markdown/embed/link renderers, API/auth/
  transfer/session code; `packages/desktop/src/{main,preload,navigationPolicy}.ts`
  and existing security tests; manifests/lockfile/Docker/config/CI scanning policy.
- Read auth/permissions/bots/uploads/embeds/web-security/desktop-security/
  security-scanning/deployment subsystem docs before corresponding changes.

Current targets are **candidates**, not executed exploits: `ssrf.ts:75–85`
acknowledges validate-then-resolve-again; `metadataFetcher.ts:28` clears its timer
before body reading. Context7 was quota-blocked; installed Drizzle sources/types
and official Node HTTP docs were inspected. During implementation consult pinned
Node 22/24 HTTP `lookup`/`signal`, HTTPS/SNI/certificate, stream cancellation and
zlib docs too; do not use Node26-only APIs merely because @types/node exposes them.

### Task S1: Native authorization/session/upload audit and refusal regressions

**Interfaces:** Core/Client local IDs/contracts and existing error codes; no new
durable auth field/wire contract without a minimal owning spec/approval update.

- [ ] Record each retained surface in the audit ledger with paths/lines,
  reachable entrypoints, trust boundary, observed defense, test and remaining
  limit. Grade candidates separately; do not label source suspicion an exploit.
- [ ] Add synthetic real REST/WS tests: expired/wrong-algorithm/malformed/missing-
  claim token, deleted/password-revoked user, rotated/revoked bot token, stale
  socket after replacement/logout; admin/space/channel/DM/group/profile/upload/
  tus IDOR, role hierarchy, managed roles, SPEAK/STREAM/MANAGE_SPACE, private invite/
  approval. Denied mutations assert unchanged stored data and no leaked payload.
- [ ] Run `corepack pnpm --filter @veyvox/server exec vitest run test/standalone-security-e2e.test.ts --maxWorkers=2`;
  observe actual behavior. For a suspected bug, add the minimal failing regression
  and record RED before altering code; passing refusal tests are audit evidence,
  not a reason to manufacture a fix.
- [ ] Fix only reproduced root causes in existing owning seams and rerun affected
  tests. Inspect browser message/Markdown/embed/link sanitization and upload-
  specific response CSP; add payload regressions at actual renderer/HTTP surfaces
  for any confirmed XSS/path issue. Keep quotas/admission protections.
- [ ] Update audit entries with severity/preconditions/reproduction/fix/test and
  residual scope; update owning subsystem docs for changed contracts. Checkpoint S1.

### Task S2: Pin external fetch transport and preserve safe Response behavior

**Interfaces:** Preserve `safeFetch(url: string, init?: RequestInit): Promise<Response>`
and public validation/classifier seams. Internal transport receives an already
validated `URL`, pinned `{ address: string; family: 4 | 6 }`, allowed GET/HEAD
headers, signal and remaining deadline; it never resolves independently. Tests
inject resolver/connector at this internal seam via Vitest, no runtime allow-private
option/exported unsafe factory. `validateExternalUrl` alone is not connect authorization.

- [ ] Add `ssrf.test.ts`/transport cases for controlled public→private rebinding,
  A/AAAA fallback with mixed/private answers, IPv4/IPv6/mapped/link-local/literal/
  malformed/embedded-credential targets, redirect to each forbidden class,
  five redirects success/sixth refusal, cross-origin auth/cookie stripping,
  relative redirect, range/HEAD, unsupported method/body refusal, abort during
  resolution/headers/body, certificate failure and public target success.
  Assert sink/socket destination and cleanup, not only rejected return value.
- [ ] Run focused tests and demonstrate RED for unchecked resolution/released
  redirect body. Record resolver/transport evidence in the audit ledger.
- [ ] Implement the private Node HTTP(S) adapter with `agent: false` and a custom
  `lookup` returning only validated answers; keep logical host/port/Host/SNI and
  standard certificate verification. Classify every A/AAAA address eligible for
  fallback; reject mixed unsafe answers rather than letting an unchecked fallback
  win. IP literals use the classifier without a DNS escape hatch.
- [ ] Remove `toValidatedFetchUrl` code-unit taint reconstruction. Follow redirects
  manually (at most five), revalidate each destination, destroy prior responses,
  strip credentials/authorization/cookies across origins, refuse embedded URL
  credentials and unsupported RequestInit method/body/options explicitly.
- [ ] Bound overall lifetime to 5,000ms by default, including DNS/redirects/body;
  compose caller abort (image caller remains 3,000ms). Destroy request/source/
  decoder streams on abort/reject/cancel, detach listeners/timers only when done.
  Expose standards-compatible streaming `Response` without raw whole-body buffering;
  handle HEAD/204/304 null bodies correctly. Controlled loopback fixtures are
  reached only through a mocked connector for an otherwise validated public URL.
- [ ] Test gzip/deflate/Brotli valid metadata, malformed/compression-bomb streams,
  wire and decoded overflow, stalled decoder/body and `body.cancel()` cleanup.
  Enforce 512,000 wire/decoded bytes at the default preview transport boundary;
  consumer image limit remains 32,768 bytes. Normalize encoding/length headers
  for decoded Response bytes, preserve backpressure and range/content-type/status.
- [ ] Run SSRF/ip-class/transport/metadata/embed suites, typecheck and available
  CodeQL/security checks; expect GREEN behavior without sanitizer-only tricks.
  Record NodeAPI documentation links/versions and residual limits. Checkpoint S2.

### Task S3: Keep preview deadlines/byte budgets through every body path

**Files:** `metadataFetcher{,.test}.ts`, `embedResolver{,.test}.ts`; update actual
additional preview consumers remaining after Core, determined by P1.

**Interfaces:** Keep `fetchUrlMetadata(url: string): Promise<UrlMetadata | null>`
and `probeRemoteImageDimensions(url): Promise<{ width: number; height: number } | null>`.

- [ ] Add deterministic header-then-stall reproduction, exact-limit/limit+1
  chunked and compressed body tests, oversized Content-Length, non-OK/direct media/
  no-body/invalid-image early return. Assert timeout ≤ budget, canceled reader/
  destroyed socket, no unhandled rejection/open handle; existing valid OG/range
  and non-default public-port behavior still pass.
- [ ] Run metadata/embed tests; demonstrate RED for timer cleared after headers
  and oversized first image chunk retained in full. Do not infer small chunks
  from the Range request: fixtures deliberately ignore Range and send a big chunk.
- [ ] Keep controller active through complete consumption/cancellation; release
  response on every early return in `finally`. Enforce decoded metadata budget
  and image slicing before retention/Sharp so image input is at most 32,768 bytes,
  regardless of chunk boundary or Content-Length. Keep normal null-preview fallback
  and avoid unrelated media-probe/subprocess changes from the completed task.
- [ ] Rerun named and retained media-probe tests; expect GREEN. Update embeds/
  web-security docs and evidence ledger. Checkpoint S3.

### Task S4: Desktop/browser/configuration and supply-chain closure

**Interfaces:** Existing policy/IPC/updater/scanner contracts; no expanded trust.

- [ ] Verify web CORS/CORP/CSP allow only actual current instance/desktop/LiveKit/
  necessary media providers; test foreign credentials rejected without breaking
  configured voice. Verify stale session responses/tus URLs stay credential-free.
- [ ] Run desktop IPC sender/frame, navigation/window, sandbox/context-isolation/
  fuses, literal argv, updater publisher/signature/profile/encryption regressions.
  Record exactly what was executed versus inspected; native OS behavior is not
  proven by source snapshots. Any newly found bug follows S1 RED→fix→GREEN.
- [ ] Run `corepack pnpm audit --audit-level=low`, frozen dependency graph and
  available Gitleaks/OSV/Trivy/CodeQL checks. Build/scan a disposable image when
  Docker is available, no push; distinguish runtime/tooling/base-image/historical
  published issues, never dismiss alerts or mutate published releases.
- [ ] Preserve enforcing scanner contexts, workflow permissions/pinning and all
  installed/native/image gates. Record unavailable tools/platforms as pending
  protected CI. Checkpoint S4, not an "absolutely secure" claim.

### Task S5: Full disposable acceptance and independent final review

**Files:** Final audit/validation reports, exact inventory, all task changes.

- [ ] Record fresh command output for frozen install; `corepack pnpm build`;
  `typecheck`; server `typecheck:e2e`; desktop `build:ts`; `test:tooling`;
  `corepack pnpm --workspace-concurrency=1 -r test --maxWorkers=2`; `check:i18n`;
  `lint`; `node scripts/check-precache-size.mjs`; absence artifact check; audit.
  Run build sequentially and do not claim previous 8,003 tests validate this change.
- [ ] Start actual server/web dev processes with synthetic JWT/LiveKit and
  disposable DB/uploads/diagnostics; prevent workspace `.env` inheritance, bound
  readiness, exercise native REST/WS, inspect UI/network at desktop/mobile widths,
  then stop only owned process trees. Record screenshot/log paths and limitations.
- [ ] Complete a finding disposition table and preservation/removal checklist.
  No critical/high may be silently deferred; unresolved items go to the human.
  Report pending OS/image/scanner gates without running hosted-only acceptance
  scripts on this Windows user's profile or triggering unauthorized publication.
- [ ] Invoke **only** `review_final_gpt56` after planned implementation and main
  validation. Provide all changed/staged/new/ignored/out-of-repo paths, objective,
  diffs, fixture evidence, audit and actual checks. Await result, correct concrete
  findings and rerun affected gates. One further same-reviewer call only if fixes
  materially expand risk; never call the other final reviewer as a second opinion.
- [ ] Deliver concise local results/remaining gates. No deployment, commit/push/
  merge/release is implied; obtain authorization for any subsequent publication.
