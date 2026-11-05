# Spec: juno-playability

## Objective

The supplied screenshots are failure cases: shifted portrait/aura centers, tall
lobby and vertically scrolling play in the real focused voice mosaic. Correct
the table as a bounded game surface, not a standalone landing page.

## Visual direction

Retain original supplied cosmic art, DM Sans and Juno palette: deep blue #060a27,
paper #f5f8ff, muted #b9c8e7, gold #ffce29, cyan #11b4ff, green #27ef7d. No new
images/fonts. Center the table composition; align identity text left inside its
plate. Spend the visual emphasis on actual actions and the JUNO burst.

Header: compact logo and existing rules/ranking/leave/mosaic controls.
Board: opponent seats around central piles, active-player halo/timer and next-turn
marker; empty in-game positions are quiet shapes, not text. Bottom: own cards and
JUNO action, reachable without vertical scrolling. Lobby: compact logo, 2×2 seats
and paired actions; no explanatory paragraph/empty-seat text. Results retain four
readable rows and actions. Rank lists/rules may scroll in their own bounded panels;
the actual lobby/game/results must not scroll or merely hide inaccessible content.

Use actual container width AND height, including the participant strip, top call
header and bottom controls. Reflow/shrink decoration before controls/text. Own
large hands scroll horizontally. Do not scale the whole UI into unreadable text.
Center the real Avatar and supplied aura using one shared geometry; test both
photo and fallback, small/large/zoomed, and assert subpixel center alignment.

Visible turn is an outlined glowing player, directional/next marker and timer,
not narrative instructions; retain screen-reader announcements/tooltips. Replace
checkbox with real JUNO button. Show a brief logo burst anchored to the confirmed
announcing player; animate play/draw/+2/+4/reverse/skip and result entry. Motion
must not expose hands, replay on refresh or block controls. Respect reduced motion
and reduced transparency. Keep explicit accessible wild selection and Escape.

## Acceptance

Exercise the real VoiceGrid focus/participant strip with actual JunoTable, not only
a viewport-sized standalone table. Cover lobby/match/result, 2–4 seats, photos and
initials, mobile/short/desktop, 50/100/200% scale and large hands; assert table
scrollHeight/clientHeight and bounds of essential controls, not just screenshots.
Inspect screenshots/animation evidence. Controlled fixtures are not real LiveKit
acceptance. Run affected store/UI tests, browser checks, build, i18n/typecheck,
lint, e2e TypeScript and final external review. Keep all five catalogs consistent.
