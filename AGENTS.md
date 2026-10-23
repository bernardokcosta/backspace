# AGENTS.md — Backspace

Self-hosted Discord alternative (AGPL-3.0, dual-licensed). TypeScript strict monorepo: pnpm workspaces, Node ≥22.12 + pnpm 10 (`.nvmrc` selects Node 24, which Docker runs; CI tests 22 and 24).

## Commands

```bash
pnpm install
cp .env.example .env          # then set JWT_SECRET (openssl rand -hex 32, min 32 chars)
pnpm dev                      # server :3005 + web :5173 (dev ignores PORT; prod uses 3000)
pnpm dev:server               # API + WebSocket only
pnpm dev:web                  # Vite dev server only

pnpm build                    # shared → server → web; order matters, do not parallelize
pnpm typecheck                # shared build + pnpm -r typecheck + i18n check
pnpm check:i18n               # same check web build runs first; fails on literal UI strings / missing keys
pnpm --filter @backspace/server typecheck:e2e  # e2e suites NOT covered by server tsc (src-only tsconfig)
pnpm --filter @backspace/desktop build:ts      # desktop is NOT part of pnpm build; CI typechecks it separately

pnpm lint                     # eslint flat config, --max-warnings 0
pnpm lint:prune               # run after FIXING a suppressed violation (see below)

pnpm -r test                                          # all suites (includes 2-instance federation e2e, ~+1 min, no Docker needed)
pnpm --filter @backspace/server test -- <file|pattern>  # single server test
pnpm --filter @backspace/server test:federation-e2e     # federation e2e only
pnpm --filter @backspace/web test -- <file|pattern>     # single web test
```

CI (`ci.yml`) gates PRs on: build+test matrix (22/24), lint job, and an amd64 container-image build.

## Gotchas (read before touching code)

- **Build order is fixed: shared → server → web.** The root `pnpm build` sequences them (`&&`); keep that order and don't parallelize. (Shared `exports` resolve to `src/*.ts` directly, so downstream `tsc` reads shared source — no stale-dist failure mode.)
- **Web build fails on i18n before tsc.** Any user-facing string must go through the catalogs (`docs/systems/localization.md`); server errors use the `ErrorCode` wire contract (`sendError`/`describeError`). Pending unconverted files live in `scripts/i18n-pending.txt` (`--write-pending` regenerates it).
- **Server `tsc` ignores tests.** `packages/server/tsconfig` covers `src/**/*` only; e2e suites need the separate `typecheck:e2e` step.
- **`pnpm lint` failure about stale suppressions is the point.** Pre-existing violations are counted in `eslint-suppressions.json`. If you fixed one, the run errors — run `pnpm lint:prune` and commit the smaller file. Never hand-edit suppressions to silence a new violation.
- **Dockerfile copies paths one by one.** A build script that reads a new top-level path passes lint/typecheck/tests and still breaks the image. Add the `COPY` line; CI's `build-image` job catches misses.
- **Desktop native module warns and continues.** `pnpm install` rebuilding `uiohook-napi` needs a C++ toolchain (`make`, `g++`, `python3`); without it install warns and skips — server/web/Docker are unaffected. Only install the toolchain for desktop work.
- **`data/` (backspace.db + uploads/ + backups/) is runtime state**, mounted at `/app/data` in the container. Never commit it, never delete it to "reset" someone else's instance.
- **DB migrations run automatically at boot with a pre-migration snapshot.** Workflow: edit `packages/server/src/db/schema.ts` → `pnpm --filter @backspace/server db:generate` → commit both. Never hand-edit `packages/server/drizzle/*.sql`.

## Layout

```
packages/shared/  — types, permissions, constants, activities, errors (compiled first)
packages/server/  — Fastify 4 API + WS; entry src/index.ts, env src/config.ts,
                    schema src/db/schema.ts, migrations drizzle/, routes src/routes/, realtime src/ws/
packages/web/     — React 18 + Vite + Tailwind 3 + Zustand 5 SPA (served by server in prod)
packages/desktop/ — Electron 43 wrapper (main, preload, keybinds); packaged by release.yml (electron-builder matrix, all OSes)
scripts/metrics, scripts/telemetry-receiver, scripts/pr-triage, scripts/directory-hub
                    — separate workspace packages, NOT covered by root pnpm build
site/             — landing page + insights dashboard (vendored uPlot, do not lint)
```

## Rules

- **Federation-aware, always.** Never assume a single global user ID. Resolve the per-instance identity (`homeUserId`+`homeInstance`, `resolveLocalUser`/`resolveOrCreateReplicatedUser`) for ID comparisons, permission checks, and remote calls. Client side: route via origin (`getChannelOrigin`/`getApiForOrigin`), never hardcode one API base. See `federation.md` + `client-federation.md`.
- **TypeScript strict, no `any`. Complete implementations only** — no placeholders, TODO stubs, or partial components. Match surrounding patterns; don't introduce new ones.
- **No new dependencies without justification.** Must be permissive (MIT/ISC/Apache-2.0/BSD) or weak-copyleft only at arm's length. Never strong copyleft (GPL/AGPL) or SSPL/BUSL/non-commercial — they can't ship in the commercial edition.
- **Architectural changes need an approved design first** (issue with "Design proposal" template, wait for "approved to implement"): new global mechanisms, framework deps/platforms, DB schema, REST/WS contracts, federation protocol, permission model, preload bridge, or anything spanning >2 subsystems. See `CONTRIBUTING.md`.
- **Update `docs/systems/*.md` in the same PR when you change** schema, API routes, WS events, federation, permissions, voice, design system, or localization. Never for plain UI/logic fixes.
- **Design system "Aether Drift"** (`docs/systems/design-system.md`): floating elements use glass (`.glass*`), never `bg-surface-elevated`; form inputs use `.input-standard` / `.input-search` / `.input-embedded` / `.input-danger` (no resting borders); brand primary `#7c6cf6`.
- **PR-ready means**: `pnpm build` + both dev servers start clean + affected tests pass + `pnpm lint` exits 0 + spec updated + you ran the thing (screenshot/recording for packaging or UI changes).

## Subsystem specs

One file per subsystem under `docs/systems/` — **read the one you touch before changing it**: `database`, `api`, `websocket`, `federation`, `client-federation`, `permissions`, `voice`, `auth`, `bots`, `dm-system`, `spaces`, `social`, `sounds`, `admin`, `uploads`, `embeds`, `search`, `desktop`, `desktop-security`, `mobile-ui`, `message-list`, `design-system`, `localization`, `telemetry`, `telemetry-opt-in-rate`, `directory`, `project-hub`, `metrics`, `deployment`, `security-scanning`, `web-security` (all `.md`).
