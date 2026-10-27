# Spec: space-creation-toggle

Status: implemented
Date: 2026-10-27

## Intent and Why

Instance operators hosting Backspace on their own VM want to let users register and join existing spaces without allowing arbitrary users to create new spaces on the instance. Adding an admin toggle for space creation keeps control of what is hosted on the instance with the administrators.

## Goals, Non-Goals, Anti-Goals

- **Goals:**
  - Add a `spaceCreationOpen` boolean setting (default `true`) to `instance_settings`, managed in `RegistrationPanel` ("Cadastro").
  - Expose `spaceCreationOpen` on `GET /api/instance/info` and broadcast live updates via WebSocket (`instance_settings_updated`) so connected clients react immediately.
  - Block non-admin users from creating spaces on the server (`POST /api/spaces` returns `403 space_creation_disabled` when `spaceCreationOpen` is `false` and the caller is not an instance admin).
  - Hide/disable space creation UI (`SpaceSidebar`, `MobileSpacesScreen`, `CreateSpaceModal`) for non-admin users when `spaceCreationOpen` is `false`, leaving only the option to join a space.
  - Instance admins (`isAdmin`) remain able to create spaces at all times regardless of the toggle.
- **Non-Goals:**
  - Per-user or role-based space-creation permissions beyond the instance-admin check.
  - Restricting joining spaces by invite code or join request.
- **Anti-Goals:**
  - Blocking instance admins from creating spaces when the toggle is off.
  - Relying on client-only hiding without server enforcement on `POST /api/spaces`.

## Constraints

- DB schema changes in `packages/server/src/db/schema.ts` must generate a Drizzle migration via `pnpm --filter @backspace/server db:generate`.
- User-facing strings must be added across all locale catalogs (`en`, `pt`, `de`, `ru`, `zh`) and pass `pnpm check:i18n`.
- Server error refusal must use a typed `ErrorCode` (`space_creation_disabled`) in `@backspace/shared` and `sendError`.
- Subsystem docs (`docs/systems/admin.md`, `docs/systems/api.md`, `docs/systems/database.md`, `docs/systems/spaces.md`, `docs/systems/websocket.md`) must be updated in the same change.

## Approaches Considered

1. **`/api/instance/info` + `useHomeInstanceInfo` only:** Reuses the existing public instance-info hook and invalidates on admin save. Simpler wire contract, but other already-open user tabs only hide the `+` button on next reload.
2. **`/api/instance/info` + real-time WebSocket broadcast (Chosen):** Exposes `spaceCreationOpen` in `GET /api/instance/info` and broadcasts `instance_settings_updated` to all connected clients when `PATCH /api/settings/instance` updates public instance settings, triggering `invalidateHomeInstanceInfo()` (and closing `createSpace` modal if open for a non-admin). Chosen so the `+` button disappears immediately for all online non-admin users.

## Design Details

- **Database & API:**
  - `instance_settings.space_creation_open`: `integer('space_creation_open').notNull().default(1)`.
  - `InstanceAdminSettings` & `InstanceInfoResponse`: add `spaceCreationOpen: boolean`.
  - `GET /api/settings/instance` and `PATCH /api/settings/instance`: read and validate `spaceCreationOpen` (`boolean`, `400 field_not_boolean` otherwise). When `spaceCreationOpen` changes, broadcast `{ type: 'instance_settings_updated', spaceCreationOpen }` via `connectionManager.sendToAll(...)`.
  - `POST /api/spaces`: before creating a space, check `instance_settings.spaceCreationOpen`. If `0`, query caller's `users.isAdmin`; if not `1`, return `sendError(reply, 403, 'space_creation_disabled')`.
- **Frontend:**
  - `RegistrationPanel`: add a third toggle section for `spaceCreationOpen` below Federated Registration and include it in dirty/save/reset state.
  - `useWebSocket.ts`: handle `instance_settings_updated` on the home socket by calling `invalidateHomeInstanceInfo()`, and if `!event.spaceCreationOpen && !isAdmin` while `activeModal === 'createSpace'`, close the modal.
  - `SpaceSidebar`: compute `canCreateSpace = isAdmin || (homeInfo?.spaceCreationOpen ?? true)`. Render the `add-space` `SidebarItem` only when `canCreateSpace` is `true`; keep `join-space` always visible.
  - `MobileSpacesScreen`: in the `+` bottom sheet, render the "Create Space" button only when `canCreateSpace` is `true`, keeping "Join a Space" always visible.
  - `CreateSpaceModal`: guard submission and auto-close if opened while `!canCreateSpace`.
