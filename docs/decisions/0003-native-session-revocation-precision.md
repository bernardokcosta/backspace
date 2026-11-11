# Native session claim validation and revocation precision

## Problem and evidence

The standalone security audit reproduced five accepted malformed signed claim
sets (missing/invalid account name, missing issued-at, missing expiry). Signing-key
possession is required to mint those cases; they are defense-in-depth failures,
not evidence that an unsigned external token was accepted.

Separately, an ordinary user's real password-change request left an old session
valid when minted earlier in the same second. The existing verifier floored the
millisecond `password_changed_at` cutoff to whole seconds. REST and WS share that
rounding, and self-service password change did not disconnect authenticated sockets.

## Decision

Reuse `signJwt`/`verifyJwt`, the existing cutoff column and existing forced socket
disconnect. Require nonempty string account ID/name and positive finite `iat`/`exp`
with expiry later than issuance, while preserving HS256/signature/expiry validation.
Mint `iat` as seconds with millisecond precision and compare to
`password_changed_at / 1000` without flooring. JWT NumericDate permits fractional
seconds (RFC 7519 §2; Auth0 node-jsonwebtoken's documented NumericDate semantics).
Existing integer-issued sessions remain valid unless older than an actual cutoff.

The password-change response uses its committed cutoff as the issuance instant;
login issues at least that cutoff if the wall clock has moved backward. After the
password/hash update commits, disconnect that account's old sockets via the same
existing mechanism used for admin reset/token revocation. No new schema, registry,
token-version field, compatibility issuer, network authority or signing dependency.

## Alternatives and limits

Keeping whole-second `iat` but rounding the cutoff upward rejects a fresh token
issued in that second too, unless login/signing acquire special future-time rules.
A new session-version/jti table would introduce unnecessary persistence and a
second revocation mechanism. Fractional NumericDate preserves the current numeric
wire field and exact native cutoff instead.

This is millisecond clock precision, not an assertion of per-token uniqueness.
Password verification and new bcrypt hashing precede the cutoff write, so a real
pre-change session is earlier; no native issuer backdates replacement sessions.
Signing-key compromise remains outside these controls. A durable per-session
revocation product would need its own specification; this change does not add one.

## Verification

`utils/auth.test.ts` contains deterministic 100ms→200ms→300ms same-second refusal
and fresh-session cases. `test/standalone-security-e2e.test.ts` exercises the real
password route and REST/WS rejection plus retained fresh-session authority.

## Concurrent credential replacement

The final external review reproduced a login verifying an old hash while a reset
committed, then minting a newer valid JWT. Login now re-reads the native row after
bcrypt and requires the same hash/cutoff and a live account immediately before
issuance. The adjacent password-change path had the same token-issuance risk
across its asynchronous new-hash computation: its existing UPDATE now compares
the verified hash/cutoff/live flag atomically. A concurrent reset/deletion changes
zero rows and yields no replacement session. The cutoff advances monotonically.
No additional durable field, session registry or credential system is introduced.

Real bcrypt plus deterministic test barriers reproduce all four stale-login
states (new hash, changed cutoff, tombstone and removed account) and both stale
password-change states (replacement/deletion), checking unchanged rows and no
token/disconnect side effects on refusal. The real REST/WS/tus security matrix is
rerun alongside them. Administrative precedence between two legitimate concurrent
admin reset commands is not a new session product or part of this decision.
