# Juno playability and computer opponents

User approved the described corrections and explicitly chose direct execution on
2026-11-05. Default accepted: computer games are practice, with no XP/ranking.

| Module | Responsibility | Depends on |
| --- | --- | --- |
| juno-computers | Host-managed computer seats; fair server turns; practice results | Existing Juno engine |
| juno-playability | Height-aware mosaic table, centered portraits, direct announcement, motion | juno-computers public projection |

Build order: computers/announcement authority → integrated table → acceptance.
Specs: [computers](SPEC-juno-computers.md), [playability](SPEC-juno-playability.md).
Reuse the existing game registry, engine, transport, voice gates, profile resolver,
assets, modal/navigation patterns and catalogs. No new dependency, DB schema,
external AI, global service or application-bot account. Feature development was
local-only. The user's subsequent 1.16.4 commit/push/release/deploy authorization
is tracked separately in `../../plans/2026-11-05-release-deploy-1.16.4.md`.
