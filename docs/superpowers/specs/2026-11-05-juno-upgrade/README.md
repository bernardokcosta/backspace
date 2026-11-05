# Juno: supplied artwork and per-space progression

Status: approved by the user in this conversation on 2026-11-05. Implementation
plans and their task lists are awaiting a separate execution approval.

## Objective and approved product decisions

Bring the supplied cosmic Juno interface into the existing native call game,
with persistent Juno XP and a ranking scoped to each **space**, not to the whole
instance or the user's home instance. All voice channels in that space contribute
to the same ranking; another space has independent totals even on the same host.

The user approved the following rules in this conversation:

- First/second/third/fourth place awards 120/80/40/20 XP respectively.
- The first empty hand still ends the round; the other places use remaining
  card counts. Ties share their place and its XP.
- Spectators, players who abandon the round, and rounds without a winner earn no XP.
- The space ranking uses cumulative XP and also shows wins and completed rounds.
- The server calculates and durably records each award once per round.
- Use the supplied card/background/UI artwork but real Backspace names/avatars.

## Capability map and build order

| Module id | Responsibility | Depends on |
|---|---|---|
| `juno-progression` | Authoritative final standings, atomic awards, persistence and membership-gated space ranking | Existing Juno engine, database, identity and auth |
| `juno-artwork` | Audited local assets and an exhaustive logical-card-to-art mapping | User-supplied ZIPs and existing card contract |
| `juno-interface` | Responsive start/lobby, table, result and space-ranking screens inside calls | `juno-progression`, `juno-artwork`, existing voice/profile UI |

Build order: `juno-progression` and `juno-artwork`, then `juno-interface`.
Their requirements are in the matching `SPEC-<module-id>.md` files here. This
follows the project's existing `docs/superpowers/specs/` convention rather than
introducing a second root-level specification system.

## Design note: problem, approach, alternatives

Today Juno is ephemeral, has no XP/ranking, renders inline SVG cards and uses
initials for player avatars. Its authoritative engine and permission/origin-aware
transport already exist; the voice game must not be replaced or embedded.

Chosen approach: extend the existing Juno settlement/projection flow, use a
small persistence/ranking module behind it, and replace presentation with the
supplied assets. The current call lifecycle, rules and shared Games picker stay.

Alternatives rejected:

- Browser-calculated XP/localStorage: forgeable, not shared, lost across devices.
- Global/home-instance XP or a new S2S replication protocol: wrong scope; a space
  already has a hosting authority and authenticated client-federation sessions.
- Elo, seasons, chat/voice-activity XP, levels and configurable rewards: different
  product rules, not requested. There is no currency, purchase or cash reward.
- Screenshot-as-interface or an embedded standalone game: loses real interaction,
  accessibility, localization, responsive behavior and existing authority.

## Assumptions and boundaries

- These are **Juno** XP, not a general Backspace activity score. Matches remain
  2–4 players; ranks/awards apply only to places present, with no absent-player XP.
- An active match remains ephemeral. Completed, committed awards survive restart;
  unfinished/unconfirmed rounds are not recovered or backfilled from old versions.
- A departed player cannot rejoin the running round. Existing reconnect grace is
  not abandonment. No automatic win or XP is added for a departure.
- No unapproved minimum-duration rule, daily cap, season/reset, extra menu stubs,
  public profile XP or cross-space ranking is introduced. This does not claim to
  prevent collusion or farming between multiple real accounts.
- Always: reuse identity, auth, avatar URLs, HTTP/WS, localization, call controls,
  backup and generated-migration flows; preserve existing uncommitted picker work.
- Ask first: new dependencies, other gameplay/reward rules, changes outside this
  capability map, commit/push/release/deployment, or runtime-data operations.
- Never: hand-edit generated SQL, change production DB/data during development,
  accept client-supplied XP/results, expose opponent hands, or ship demo identities.

## Stack, structure and code style

Existing strict TypeScript, React 19, Zustand 5, Fastify 5, Drizzle ORM and
better-sqlite3; no new dependency. Tests use Vitest/Testing Library and existing
HTTP/WS harnesses. Keep shared contracts in `packages/shared/src/juno.ts`, game
authority and progression in `packages/server/src/games/`, transport in
`packages/server/src/routes/juno.ts`, schema in `packages/server/src/db/schema.ts`,
client transport/stores in their existing locations, and UI in
`packages/web/src/components/games/`. Asset placement is specified separately.

Match surrounding named exports, closed unions, immutable public projections
and explicit return types; never introduce `any` or a second identity resolver:

```ts
type JunoPlacement = 1 | 2 | 3 | 4;
const XP_BY_PLACE: Record<JunoPlacement, number> = {
  1: 120, 2: 80, 3: 40, 4: 20,
};
```

## Commands and validation gates

Run in the existing repository, using its installed pnpm 10/Corepack. If needed
on this Windows machine, add the existing Corepack shims to the command's PATH;
do not change global configuration or install a second package manager.

```bash
pnpm --filter @backspace/server db:generate
pnpm --filter @backspace/server exec vitest run src/games/juno.test.ts src/routes/juno.test.ts
pnpm --filter @backspace/web exec vitest run src/components/games/JunoTable.test.tsx
pnpm --filter @backspace/web exec vitest run src/components/games/GamesPicker.test.tsx
pnpm --filter @backspace/server typecheck:e2e
pnpm --filter @backspace/desktop build:ts
pnpm typecheck
pnpm check:i18n
pnpm lint
pnpm build
pnpm dev:server
pnpm dev:web
```

Generate migrations only during implementation after schema approval. The root
build remains sequential shared → server → web. Run the broader affected suites,
real HTTP/WS acceptance, migration/identity lifecycle tests, desktop/mobile browser
checks with screenshots, and one required external final review. Report limits
explicitly, especially real multi-device LiveKit coverage.

Before running tests, follow the implementation plan's isolated DB/uploads/
backup environment preflight. Do not use `pnpm ... test -- <filter>` here: in
this installation that separator causes Vitest to ignore the intended filter.
Use `exec vitest run <explicit file paths>` and inspect `exec vitest list
<same paths> --filesOnly` before execution. Never run a broad suite against a
default DB/uploads path in the live checkout.

Update `docs/systems/{juno,database,api,voice,mobile-ui,localization,client-federation}.md`
with actual changes; update other subsystem specs only where behavior changes.
These documents alone do not change the runtime contracts described there.

## Open questions

No remaining product question blocks the approved scope. The user approved the
module specifications and edge-case semantics after the specification review.
See [the implementation plan](../../plans/2026-11-05-juno-upgrade.md) for the
ordered tasks and the remaining execution gate; no new runtime code or migration
has been written at this stage.
