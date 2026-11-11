# Spec: voice-controls-polish

## Objective and status

Independent, explicitly requested small UI module in the
[approved map](2026-11-10-standalone-security-map.md). Already implemented and
validated **locally**, not committed, published or deployed. No audio, call or
federation behavior changes are part of this module.

## Structure and required behavior

Existing React/Tailwind Aether Drift controls in
`packages/web/src/components/voice/VoiceControls.tsx` and its existing test.

The header action group uses `gap-2` (8px), not `gap-0.5` (2px), moving RNNoise
left while hang-up stays anchored. Both 28×28px buttons use `rounded-lg` (8px),
matching the adjacent connection control. Keep icons, state colors, focus ring,
localized labels/help, tab order, `aria-pressed` and click handlers unchanged.

```tsx
<div className="flex items-center gap-2 flex-shrink-0">
```

The RNNoise toggle must never unmute or disconnect; Games stays in the lower
row and retains its existing behavior. No new string, dependency, animation,
component, global design token or design-system change.

## Validation already completed

- Regression test failed on the old gap before the three-class source change.
- VoiceControls + VoiceControlBar tests 9/9, lint, web typecheck and sequential
  shared→server→web/PWA build passed; precache budget passed.
- Real component rendered in an ignored synthetic Vite fixture, without an API
  server/call, at 284/240px with long channel text. Browser-measured gap/radii 8px,
  button 28×28px, no horizontal overflow; final navigation had no console errors.
- Screenshot: ignored `.playwright-mcp/voice-controls-spacing.png`, inspected and
  shown to the user. Owned Vite process tree stopped successfully.
- External Sol review approved the UI/source tests and architecture-map phase,
  with no actionable findings. This does not review future federation removal.

```bash
corepack pnpm --filter @veyvox/web exec vitest run src/components/voice/VoiceControls.test.tsx src/components/voice/VoiceControlBar.test.tsx --maxWorkers=2
corepack pnpm --filter @veyvox/web typecheck
corepack pnpm lint
```

## Boundaries

Preserve this small patch while core/client change. Revalidate its controls in
the final local-only UI and include it in the whole-change review. No production
claim, microphone/media acquisition or release is authorized here. No open
question remains for its specified visual dimensions.
