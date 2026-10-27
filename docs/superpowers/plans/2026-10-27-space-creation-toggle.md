# Space Creation Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an instance-level admin toggle (`spaceCreationOpen`) in the Registration settings tab to allow or block non-admin users from creating new spaces, with real-time WebSocket propagation and full server/client enforcement.

**Architecture:** Persist `space_creation_open` (`INTEGER NOT NULL DEFAULT 1`) on `instance_settings`, expose it in `GET/PATCH /api/settings/instance` and `GET /api/instance/info`, and broadcast `{ type: 'instance_settings_updated', spaceCreationOpen }` to all connected clients when changed. Enforce the policy in `POST /api/spaces` (`403 space_creation_disabled` for non-admins when `false`) and gate the space creation UI (`SpaceSidebar`, `MobileSpacesScreen`, `CreateSpaceModal`) using `isAdmin || (homeInfo?.spaceCreationOpen ?? true)`.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM (SQLite), React 19, Zustand 5, react-i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-space-creation-toggle-design.md`

## Global Constraints

- Build order is fixed: `shared → server → web`.
- DB schema changes in `packages/server/src/db/schema.ts` must generate a migration via `pnpm --filter @backspace/server db:generate` (never hand-edit generated SQL unless required for SQLite constraints).
- User-facing strings must be added across all 5 locale catalogs (`en`, `pt`, `de`, `ru`, `zh`) and pass `pnpm check:i18n`.
- Server error refusal must use the `space_creation_disabled` `ErrorCode` in `@backspace/shared` and `sendError`.
- Subsystem docs (`docs/systems/admin.md`, `docs/systems/api.md`, `docs/systems/database.md`, `docs/systems/spaces.md`, `docs/systems/websocket.md`) must be updated in the same PR.

## Review Focus

1. Non-boolean `spaceCreationOpen` on `PATCH /api/settings/instance` (e.g. `"no"` or `123`) must be rejected with `400 field_not_boolean` and `{ field: 'spaceCreationOpen' }` without mutating stored settings.
2. Partial `PATCH /api/settings/instance` omitting `spaceCreationOpen` must preserve a stored `0` (`false`) value and must not emit a spurious `instance_settings_updated` broadcast.
3. Instance admin (`isAdmin === 1`) calling `POST /api/spaces` while `spaceCreationOpen === false` must succeed with `201`, whereas a non-admin (`isAdmin === 0`) receives `403 space_creation_disabled`.
4. Missing `instance_settings` singleton row in isolated route unit tests must default `spaceCreationOpen` to `true` (`settingsRow?.spaceCreationOpen !== 0`) so existing space creation tests do not break.
5. A non-admin user who already has `CreateSpaceModal` open when `instance_settings_updated` arrives with `spaceCreationOpen: false` must have the modal closed automatically and only see the Join Space option on desktop and mobile.

---

### Task 1: Shared Contract, Database Migration, and Server Enforcement

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/server/src/utils/httpErrors.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: `packages/server/drizzle/<generated_migration>.sql` (via `db:generate`)
- Modify: `packages/server/src/routes/instance.ts`
- Modify: `packages/server/src/routes/settings.ts`
- Modify: `packages/server/src/routes/spaces.ts`
- Test: `packages/server/src/routes/settings.test.ts`
- Test: `packages/server/src/routes/instance.test.ts`
- Test: `packages/server/src/routes/spaces.errors.test.ts`

**Interfaces:**
- Produces:
  - `ErrorCode`: `'space_creation_disabled'`
  - `InstanceAdminSettings.spaceCreationOpen: boolean`
  - `InstanceInfoResponse.spaceCreationOpen: boolean`
  - `ServerEvent`: `| { type: 'instance_settings_updated'; spaceCreationOpen: boolean }`

- [ ] **Step 1: Add `'space_creation_disabled'` and `spaceCreationOpen` types in `@backspace/shared` and `httpErrors.ts`**

In `packages/shared/src/errors.ts`, add `'space_creation_disabled'` under `// spaces`.
In `packages/shared/src/types.ts`:
- Add `| { type: 'instance_settings_updated'; spaceCreationOpen: boolean }` to `ServerEvent`.
- Add `spaceCreationOpen: boolean;` to `InstanceAdminSettings` and `InstanceInfoResponse`.
In `packages/server/src/utils/httpErrors.ts`, add:
`space_creation_disabled: 'Creating new spaces is disabled on this instance',`

- [ ] **Step 2: Add `spaceCreationOpen` column to `instance_settings` and generate migration**

In `packages/server/src/db/schema.ts`, add to `instanceSettings`:
`spaceCreationOpen: integer('space_creation_open').notNull().default(1),`
Run: `pnpm --filter @backspace/server db:generate`

- [ ] **Step 3: Write failing server tests in `settings.test.ts`, `instance.test.ts`, and `spaces.errors.test.ts`**

In `packages/server/src/routes/settings.test.ts`:
- Assert `GET /api/settings/instance` returns `spaceCreationOpen: true` by default and `false` when stored as `0`.
- Assert `PATCH /api/settings/instance` persists `spaceCreationOpen: false` / `true`, preserves `false` on partial PATCH, broadcasts `{ type: 'instance_settings_updated', spaceCreationOpen }` via `connectionManager.sendToAll` when changed, and rejects `{ spaceCreationOpen: 'no' }` with `400 field_not_boolean` (`{ field: 'spaceCreationOpen' }`).

In `packages/server/src/routes/instance.test.ts`:
- Assert `GET /api/instance/info` returns `spaceCreationOpen: true` by default and `false` when `spaceCreationOpen: 0`.

In `packages/server/src/routes/spaces.errors.test.ts`:
- Assert `POST /api/spaces` returns `403` with `code: 'space_creation_disabled'` for a non-admin when `instance_settings.spaceCreationOpen = 0`, and `201` when the caller has `isAdmin = 1`.

- [ ] **Step 4: Run server tests to verify they fail**

Run: `pnpm --filter @backspace/server test -- src/routes/settings.test.ts src/routes/instance.test.ts src/routes/spaces.errors.test.ts`
Expected: FAIL on missing `spaceCreationOpen` handling and unblocked `POST /api/spaces`.

- [ ] **Step 5: Implement server routes in `instance.ts`, `settings.ts`, and `spaces.ts`**

- `packages/server/src/routes/instance.ts`: include `spaceCreationOpen: settings?.spaceCreationOpen !== 0` in `InstanceInfoResponse`.
- `packages/server/src/routes/settings.ts`:
  - Map `spaceCreationOpen: row.spaceCreationOpen !== 0` in `rowToAdminSettings`.
  - Validate `body.spaceCreationOpen` with `typeof body.spaceCreationOpen !== 'boolean'` → `sendError(reply, 400, 'field_not_boolean', { field: 'spaceCreationOpen' })`.
  - After updating `instanceSettings`, if `body.spaceCreationOpen !== undefined && currentRow.spaceCreationOpen !== updatedRow.spaceCreationOpen`, call `connectionManager.sendToAll({ type: 'instance_settings_updated', spaceCreationOpen: updatedRow.spaceCreationOpen === 1 })`.
- `packages/server/src/routes/spaces.ts`:
  - At the top of `POST /api/spaces`, check `const settingsRow = db.select({ spaceCreationOpen: schema.instanceSettings.spaceCreationOpen }).from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();`.
  - When `settingsRow?.spaceCreationOpen === 0`, query `const caller = db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, request.userId)).get();` and if `!caller || caller.isAdmin !== 1`, return `sendError(reply, 403, 'space_creation_disabled')`.

- [ ] **Step 6: Run server tests to verify they pass**

Run: `pnpm --filter @backspace/server test -- src/routes/settings.test.ts src/routes/instance.test.ts src/routes/spaces.errors.test.ts`
Expected: PASS

---

### Task 2: Localization, WebSocket Sync, Admin Toggle, and Space Creation UI Gate

**Files:**
- Modify: `packages/web/src/locales/en/errors.json`, `pt/errors.json`, `de/errors.json`, `ru/errors.json`, `zh/errors.json`
- Modify: `packages/web/src/locales/en/admin.json`, `pt/admin.json`, `de/admin.json`, `ru/admin.json`, `zh/admin.json`
- Modify: `packages/web/src/hooks/useWebSocket.ts`
- Modify: `packages/web/src/components/modals/instanceSettingsPanels/RegistrationPanel.tsx`
- Modify: `packages/web/src/components/layout/SpaceSidebar.tsx`
- Modify: `packages/web/src/components/layout/MobileSpacesScreen.tsx`
- Modify: `packages/web/src/components/modals/CreateSpace.tsx`
- Create: `packages/web/src/components/modals/instanceSettingsPanels/RegistrationPanel.spaceCreation.test.tsx`
- Modify: `packages/web/src/components/layout/SpaceSidebar.spaceMenu.test.tsx`
- Modify: `packages/web/src/components/layout/MobileSpacesScreen.spaceMenu.test.tsx`

**Interfaces:**
- Consumes: `InstanceAdminSettings.spaceCreationOpen`, `InstanceInfoResponse.spaceCreationOpen`, `ServerEvent` (`instance_settings_updated`), `useHomeInstanceInfo()`, `invalidateHomeInstanceInfo()`.
- Produces:
  - `RegistrationPanel` toggle bound to `draft.spaceCreationOpen`
  - UI gate `canCreateSpace = isAdmin || (homeInfo?.spaceCreationOpen ?? true)` in `SpaceSidebar`, `MobileSpacesScreen`, and `CreateSpaceModal`.

- [ ] **Step 1: Add locale keys across all 5 languages (`en`, `pt`, `de`, `ru`, `zh`)**

In `locales/<lng>/errors.json`:
- `space_creation_disabled`:
  - `en`: `"Creating new spaces is disabled on this instance."`
  - `pt`: `"A criação de novos espaços está desativada nesta instância."`
  - `de`: `"Das Erstellen neuer Spaces ist auf dieser Instanz deaktiviert."`
  - `ru`: `"Создание новых пространств на этом сервере отключено."`
  - `zh`: `"此实例已禁用创建新空间。"`

In `locales/<lng>/admin.json` under `registration`:
- `spaceCreation`: `{ label, toggleLabel, toggleDescription }`:
  - `en`: `label: "Space Creation"`, `toggleLabel: "Allow creating new spaces"`, `toggleDescription: "Regular users can create new spaces on this instance. When off, only instance admins can create spaces and other users can only join existing spaces."`
  - `pt`: `label: "Criação de espaços"`, `toggleLabel: "Permitir criação de novos espaços"`, `toggleDescription: "Usuários comuns podem criar novos espaços nesta instância. Quando desativado, apenas administradores podem criar espaços e os demais usuários só podem juntar-se a espaços existentes."`
  - `de`: `label: "Space-Erstellung"`, `toggleLabel: "Erstellen neuer Spaces erlauben"`, `toggleDescription: "Normale Benutzer können auf dieser Instanz neue Spaces erstellen. Wenn deaktiviert, können nur Instanz-Admins neue Spaces erstellen und andere Benutzer nur bestehenden Spaces beitreten."`
  - `ru`: `label: "Создание пространств"`, `toggleLabel: "Разрешить создание новых пространств"`, `toggleDescription: "Обычные пользователи могут создавать новые пространства на этом сервере. Когда отключено, создавать пространства могут только администраторы, а остальные пользователи могут только присоединяться к существующим."`
  - `zh`: `label: "空间创建"`, `toggleLabel: "允许创建新空间"`, `toggleDescription: "普通用户可以在此实例上创建新空间。关闭后，仅实例管理员可以创建空间，其他用户只能加入现有空间。"`

- [ ] **Step 2: Write failing frontend tests for `RegistrationPanel`, `SpaceSidebar`, and `MobileSpacesScreen`**

- `RegistrationPanel.spaceCreation.test.tsx`: renders the `spaceCreationOpen` toggle, tracks dirty state when toggled, and sends `{ registrationOpen, federatedRegistrationOpen, spaceCreationOpen }` to `updateInstanceSettings`.
- `SpaceSidebar.spaceMenu.test.tsx`: when `spaceCreationOpen` is `false` and user is not admin, the `add-space` button is absent while `join-space` remains rendered; when user is admin (`isAdmin: true`), `add-space` remains rendered even when `spaceCreationOpen` is `false`.
- `MobileSpacesScreen.spaceMenu.test.tsx`: when `spaceCreationOpen` is `false` and user is not admin, opening the `+` sheet shows `joinSpace` and omits `createSpace`; when user is admin, both options appear.

- [ ] **Step 3: Run web tests to verify they fail**

Run: `pnpm --filter @backspace/web test -- RegistrationPanel.spaceCreation SpaceSidebar.spaceMenu MobileSpacesScreen.spaceMenu`
Expected: FAIL

- [ ] **Step 4: Implement `RegistrationPanel`, `useWebSocket`, `SpaceSidebar`, `MobileSpacesScreen`, and `CreateSpaceModal`**

- `packages/web/src/components/modals/instanceSettingsPanels/RegistrationPanel.tsx`:
  - Add `spaceCreationOpen: boolean` to `RegistrationDraft`, seed from `instanceSettings.spaceCreationOpen`, include in `hasChanges`, `handleSave`, `handleReset`, and render the toggle block using `admin:registration.spaceCreation.*` keys below Federated Registration.
- `packages/web/src/hooks/useWebSocket.ts`:
  - On `user_updated` when `event.user.id === myId && isHome`: also call `useSettingsStore.getState().setIsAdmin(event.user.isAdmin ?? false)`.
  - Handle `case 'instance_settings_updated':` (when `isHome`): call `invalidateHomeInstanceInfo()`, update `useSettingsStore` if `instanceSettings` is loaded, and if `!event.spaceCreationOpen && !useAuthStore.getState().user?.isAdmin && !useSettingsStore.getState().isAdmin && useUIStore.getState().activeModal === 'createSpace'`, call `useUIStore.getState().closeModal()`.
- `packages/web/src/components/layout/SpaceSidebar.tsx`:
  - Read `homeInfo = useHomeInstanceInfo()`, `isAdmin = useAuthStore((s) => s.user?.isAdmin) || useSettingsStore((s) => s.isAdmin)`.
  - Compute `canCreateSpace = Boolean(isAdmin || (homeInfo?.spaceCreationOpen ?? true))`.
  - Render `<SidebarItem id="add-space" ... />` only when `canCreateSpace` is `true`.
- `packages/web/src/components/layout/MobileSpacesScreen.tsx`:
  - Compute `canCreateSpace = Boolean(user?.isAdmin || isAdmin || (homeInfo?.spaceCreationOpen ?? true))`.
  - In the Add Space bottom sheet, render the `createSpace` button only when `canCreateSpace` is `true`.
- `packages/web/src/components/modals/CreateSpace.tsx`:
  - Compute `canCreateSpace = Boolean(isAdmin || (homeInfo?.spaceCreationOpen ?? true))`.
  - Add a `useEffect` that calls `handleClose()` if `isOpen && !canCreateSpace`, and guard `handleSubmit` if `!canCreateSpace`.

- [ ] **Step 5: Run web tests and i18n check to verify they pass**

Run: `pnpm check:i18n && pnpm --filter @backspace/web test -- RegistrationPanel.spaceCreation SpaceSidebar.spaceMenu MobileSpacesScreen.spaceMenu`
Expected: PASS

---

### Task 3: Subsystem Documentation & Full Verification

**Files:**
- Modify: `docs/systems/admin.md`
- Modify: `docs/systems/api.md`
- Modify: `docs/systems/database.md`
- Modify: `docs/systems/spaces.md`
- Modify: `docs/systems/websocket.md`
- Modify: `docs/superpowers/specs/2026-10-27-space-creation-toggle-design.md`

- [ ] **Step 1: Update subsystem specifications**

- `docs/systems/admin.md`: document `spaceCreationOpen` in `InstanceAdminSettings`, `GET /api/instance/info`, and `RegistrationPanel` (3 toggles).
- `docs/systems/api.md`: document `spaceCreationOpen` on `/api/instance/info`, `/api/settings/instance`, and `403 space_creation_disabled` on `POST /api/spaces`.
- `docs/systems/database.md`: add `space_creation_open` to `instance_settings` table documentation.
- `docs/systems/spaces.md`: document that `POST /api/spaces` requires `spaceCreationOpen` or instance admin status, and desktop/mobile UI hides space creation for non-admins when disabled.
- `docs/systems/websocket.md`: document `instance_settings_updated` event.

- [ ] **Step 2: Run full build, typecheck, lint, and tests**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: Exit code 0 across all checks.
