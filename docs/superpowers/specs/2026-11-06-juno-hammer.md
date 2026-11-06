# Spec: approved Juno hammer and stable table

## Approval and objective

The user approved the interactive preview, including the correction that keeps
cards visible and the table stationary, and explicitly requested implementation,
a new release and an update of the existing VM. Ship as 1.16.6 only after tests,
external final review and exact-commit release gates. This extends the approved
`2026-11-05-juno-reporting.md` presentation, not its rules.

## Acceptance criteria

- Restore the approved green/cyan rounded primary/secondary buttons in the lobby
  and results. Keep real localized labels, focus, disabled states and actions.
- Replace the report flag, visible label and countdown with the supplied transparent
  hammer. Its striking base, not image center, aligns with the avatar horizontally.
  Preserve the approved normal-view sizes: 56×48 desktop and 45×40 narrow table.
- Keep the original GIF and a cropped static WebP; document their provenance/hashes.
  The supplied GIF SHA-256 is
  `782e92bc0e255568f8001b0af6eb6f542a7d849d4390ea117daeacd3e4f25db2`.
- A new confirmed positive-amount report plays the original hammer strike and a
  brief flash/ring/12 gold-cyan particles at the accused player's anchor. Do not
  also fly cards or animate a large +2 over the piles. No optimistic/replayed
  report effects on failures, mount, polling or reconnect. Expire effects and clean
  timers on unmount. Reduced motion hides the strike/particles; exact counts and
  accessible confirmation remain.
- Cards stay visible according to existing responsive layout rules, and their
  containers, avatars, piles and own hand do not jump when a report opportunity
  appears/disappears, a report is confirmed, or the effect finishes. Reserve stable
  report/fan space; do not temporarily hide cards or gate geometry on animation state.
  Fans must not be covered by piles, badges or hammer controls at common/short sizes.
- Preserve accessible target-specific report buttons, keyboard activation and
  pending/disconnected/expired guards. The ten-second receipt-anchored client guard,
  authoritative server deadline, +2/deck scarcity, identities, origin routing,
  privacy, concurrent opportunities and all other game rules remain unchanged.

## Implementation boundaries

React 19, strict TypeScript, existing JunoMatch/JunoEffects/juno.css and local
assets; no dependencies, schema, REST/WS, federation or permission changes.
Reuse confirmed lastMove ids and the existing effects layer with interface-scale
coordinate conversion. No preview transforms or fake users ship in the application.
Use existing five-catalog strings; no new visible text is needed.

Tests use explicit-file isolated Vitest runners (temporary DB/uploads, no runtime
data), real MainContent/MobileVoiceFullScreen browser fixtures and actual assets.
Run build (shared → server → web), typecheck/e2e/desktop, lint and affected tests.
Check desktop/narrow/short/scaled viewports, multiple targets, capability fallback,
keyboard, expiry, confirmation, motion preferences and before/during/after geometry.
Update `docs/systems/juno.md` and artwork provenance in the same release.

## Publication and deployment

Use the existing lockstep version script and release workflows; keep immutable
tags and require successful exact-commit main-branch CI and all 16 desktop assets
plus amd64/arm64 OCI publication. Before updating 10.84.22.89, verify the currently
healthy 1.16.5, make a consistent SQLite snapshot plus upload/config backups and
retain the previous immutable image. Pin the verified new image digest, restart
only Backspace, verify public health/version/commit/assets and database identity,
migrations/uploads, and leave LiveKit unchanged. Roll back image/config on failure;
never silently roll back user data. Do not claim live-media/native-device acceptance.
