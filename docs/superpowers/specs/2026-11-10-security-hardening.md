# Spec: security-hardening

## Objective and status

Approved final consumer in the [approved map](2026-11-10-standalone-security-map.md).
Audit the retained standalone application, fix demonstrable vulnerabilities and
prove its important refusal paths. This is not a guarantee of absolute security,
a scanner-only sign-off or authorization for active production testing.

## Scope and evidence ledger

Cover server auth/JWT and bot credentials, session/socket lifetime, authorization
and IDOR, REST/WS parity, local DM/group/space ownership, upload/tus ownership and
file paths, external previews/SSRF, rendered content/XSS, CORS/CSP, desktop IPC/
navigation/updates, diagnostics/secrets, dependencies and container configuration.

For each finding record path/lines, preconditions, actual reachability, severity,
reproduction, fix, regression test and residual limits. Separate confirmed
findings from candidates and operational/deployment issues. Do not log secrets,
private bodies or attack a live instance. Existing passing scanners do not prove
these flows safe; neither does removal of federation alone.

## Initial concrete inspection targets

These are observed code properties, not claims of an executed exploit:

1. `utils/ssrf.ts` validates DNS before calling global fetch, which resolves again;
   its comment explicitly acknowledges a rebinding/TOCTOU window. Reproduce the
   connection-time address change with a controlled resolver/transport test and
   close it for retained URL preview/image consumers.
2. `utils/metadataFetcher.ts` clears its 5s timeout immediately after headers,
   before its bounded body read. A peer can send headers then stall the body.
   Reproduce that with a disposable local transport, retain cancellation through
   body consumption and release responses on every early-exit path.

Do not downgrade the existing private-address classifier, redirect validation,
512,000-byte metadata cap, 32,768-byte image probe or stricter upload CSP.

## External fetch interface

Reuse `ssrf.ts` and its current public `safeFetch(url, init)` seam; do not add a
second unsafe fetch helper or inherit the deleted federation "approved peer"
private-network bypass. The retained consumers use GET/HEAD with static headers,
range and AbortSignal. Any other method/body unsupported by the narrowed helper
must be refused explicitly, not silently mis-sent.

Use the actual validated destination at socket connection time with existing
Node transports, without a new registry dependency. Validate every A/AAAA answer
used for fallback, reject non-public/link-local/loopback/mapped-private targets,
and retain the logical hostname for Host, TLS SNI and normal certificate checks.
Do not disable certificate verification, substitute a taint-only string encoding
for real validation or let a second DNS lookup pick an unchecked address.

For each of at most five redirects, validate scheme/URL/address again; never
forward authorization/cookies or secrets across origins. Bound total lifetime,
cancel rejected redirect bodies/sockets, honor caller abort during headers/body,
and retain ordinary public IPv4/IPv6, redirects and range-image behavior. Keep
streaming limits; a Content-Length header is not a sufficient byte limit.
Reject URL-embedded credentials and preserve bounded gzip/deflate/Brotli response
handling where supported by the existing fetch consumers. Limits apply to decoded
bytes as well as wire input; add compressed/stalled-body regression cases rather
than replacing fetch with an unbounded raw response buffer.

Tests use controlled DNS and loopback fixtures through an injected test-only
transport seam, not a production `ALLOW_PRIVATE_URLS` flag. Public safe targets
must still work, malformed/protected addresses must never reach the sink, and
failure must release resources rather than merely return a null preview.

## Auth and permission tests

- Malformed/expired/wrong-algorithm tokens, missing/invalid claims, deleted users,
  token/password revocation, revoked bot token and socket replacement/reconnect.
- An ordinary user cannot perform admin operations or read/edit/delete another
  user's channel/DM/upload/profile/settings. Verify both REST and WS handlers.
- Role hierarchy, managed bot roles, SPEAK/STREAM/MANAGE_SPACE checks, private
  invitations and join approvals survive native-id simplification.
- Old federation bodies/events never bypass local registration/ownership. A local
  id supplied by a caller is not authority to act for that user.
- Stale responses after logout/account/instance switch cannot populate the next
  session or leak an old bearer token. Keep bounded rate-limit recovery and
  admission protections; disabling quotas is not cleanup.

Reproduce any suspected revocation-time or claim-validation problem before
changing it. If a fix needs a new durable auth field/wire contract, specify its
minimal data transition in the owning module; do not invent a second auth stack.

## Browser, desktop and supply chain

Retain message/Markdown sanitization, safe links/media URL handling, CSP script/
frame/clickjacking protections and upload-specific sandboxing. Reevaluate only
federation-driven CORS/CORP/connection allowances against the current instance,
desktop web origin, LiveKit and legitimate media/providers. Do not replace them
with a blanket rule that breaks configured voice/media or allows all credentials.

Retain IPC sender/frame guards, literal argv installer/process boundaries,
navigation/window restrictions, context isolation, sandbox/fuses, update publisher
trust and matching signatures. Do not rename installed crypto/profile identifiers
or silently change cookie protection. Confirm all six installed upgrade legs
expect removal of old remote state while retaining local state.

Preserve enforcing Gitleaks/OSV/Trivy/CodeQL and repository protections. Audit the
current dependency graph and newly built disposable image, distinguishing runtime
from tooling and historical published artifacts. Do not republish images, mutate
old releases/tags, dismiss findings or infer that previous image OS CVEs vanished.

## Testing, style and commands

Tests assert behavior at real interfaces with synthetic identities/content; use
existing Vitest/node:test/e2e patterns and no `any` or production bypass flag.
For instance, a denied mutation asserts unchanged stored data as well as 403.

```bash
corepack pnpm build
corepack pnpm typecheck
corepack pnpm --filter @veyvox/server typecheck:e2e
corepack pnpm --filter @veyvox/desktop build:ts
corepack pnpm test:tooling
corepack pnpm --workspace-concurrency=1 -r test --maxWorkers=2
corepack pnpm lint
corepack pnpm audit --audit-level=low
```

Run shared→server→web sequentially. Start actual dev servers using synthetic
credentials and disposable DB/uploads/diagnostics, with dotenv isolation and
owned-process cleanup. Record unavailable Docker/native checks honestly; protected
CI must execute image/native/installed acceptance before any future authorized
merge. No successful pentest or full security guarantee may be inferred from a
passive unauthenticated DAST shell scan.

## Acceptance and boundaries

No unresolved critical/high finding without explicit human disposition; smaller
findings have evidence and a fixed/deferred rationale, never hidden suppression.
Complete an independent final Sol review of **all** implementation paths and the
final validation/audit record, including changes already made for voice polish.

Always preserve local data/permissions and record limits. Ask before new
dependencies, broader trust/wire changes, production access or deployment.
Never run destructive tests on personal profiles/production, weaken scanners,
store real credentials in fixtures or call the environment absolutely secure.
No product question remains; additional findings are discovered and graded by
the audit, not presumed from these inspection targets.
