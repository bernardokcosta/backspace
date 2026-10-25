# Remove Project Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Backspace project hub and its exclusive runtime/resources without removing shared information, branding or update functionality.

**Architecture:** Remove its navigation/routes and exclusive module together, preserve the shared instance-info reader, and retire the hub-only admin/wire support switch while keeping its legacy DB column inert.

**Tech Stack:** Existing React/router/Zustand/i18n client, Fastify/shared TypeScript and Vitest.

**Spec:** [remove-project-hub](../specs/2026-10-25-remove-project-hub.md).

## Global Constraints

Apply all [initiative constraints](2026-10-25-desktop-1.15.2.md#global-constraints).
Do not rename the product, remove AGPL source/version/commit information,
disable desktop updates or delete historical migrations/local user storage.

## Review Focus

Test direct bookmarks, mobile/aggregate badges, independent sticker/settings
readers, updater/source links and legacy support settings in H1.

## Task H1: Remove the hub across navigation, resources and active contracts

**Files:**
- Modify: `packages/web/src/App.tsx`, `components/layout/{ChannelSidebar,SpaceSidebar,MainContent,MobileShell,MobileYouScreen,MobileBottomNav}.tsx`, `hooks/useMobileRouteSync.ts`, `stores/uiStore.ts`, `utils/homeNav.ts` and their route/navigation tests.
- Delete exclusive implementation and feature-only tests: `packages/web/src/components/projectHub/`, `stores/projectHubStore*`, `hooks/useHubUpdateState*`, `utils/{hubSeenVersion,projectLinks,describeEnvironment}*` after checking their consumers.
- Delete: `packages/web/dev-project-hub.html`, `src/dev/project-hub-preview.tsx`, `src/locales/*/project.json`; update `src/i18n/{resources.ts,loader.ts}` only where they register these catalogs.
- Preserve: `packages/web/src/hooks/useHomeInstanceInfo*`, `components/ui/SourceCodeLink.tsx`, desktop download/update/recovery code and branding assets used elsewhere.
- Modify: `packages/web/src/components/modals/instanceSettingsPanels/GeneralPanel.tsx`, settings types/store/tests and support-only catalog keys.
- Modify: `packages/shared/src/types.ts`, `packages/server/src/routes/{settings.ts,instance.ts}`; rework `settings.supportCard.test.ts` into retirement coverage rather than silently dropping data-preservation assertions.
- Update: `docs/systems/{project-hub,admin,mobile-ui,localization}.md` and relevant current design-system examples if they reference the removed live module.

**Interfaces:**
- `/backspace` becomes a compatibility redirect to the existing Friends/home route (`/channels/@me`, `replace`), retaining signed-out authentication behavior.
- Remove `'backspace'` from mobile stack types/map and `HomeNavItem`; preserve Friends/Explore until E2 removes Explore.
- `useHomeInstanceInfo`, its invalidation functions and `SourceCodeLink` keep their existing interfaces and non-hub consumers.
- `supportCardEnabled` disappears from active public/admin/shared documents and the admin form. A legacy PATCH field is ignored using the existing unknown-field behavior, never written; its old DB value is preserved for rollback.

- [ ] **Step 1: Add failing removal and shared-consumer tests.** Extend `App.routes.test.tsx`, `MainContent.routes.test.tsx`, layout/mobile tests and `hooks/useHomeInstanceInfo.test.tsx`. Assert no hub launcher/dot, old bookmarks redirect with no hub mount, sticker limits still update after admin invalidation, and the source/download/update recovery links remain. Seed the old support column with both values and assert no active response field or PATCH mutation.
- [ ] **Step 2: Observe RED.** Run `pnpm --filter @backspace/web exec vitest run src/App.routes.test.tsx src/components/layout src/hooks/useHomeInstanceInfo.test.tsx` and `pnpm --filter @backspace/server exec vitest run src/routes/settings.supportCard.test.ts`. The current hub launchers/field must fail the new absence assertions.
- [ ] **Step 3: Remove navigation and exclusive implementation.** Rehome none of the hub-only badge/version-seen/card logic. Keep aggregate friend-request/instance-update dots functional. Delete only the proven exclusive helpers, resource registrations and workbench; remove their imports from previews/tests too. Preserve related shared reader/source-link tests rather than deleting whole mixed suites.
- [ ] **Step 4: Retire the support-only setting.** Remove its current shared/wire/form handling and localized copy while leaving schema/migration history untouched. Verify every remaining settings serializer retains its unrelated fields and permission checks.
- [ ] **Step 5: Verify GREEN and the UI.** Re-run Step 2, sticker upload/manage tests, desktop compatibility/download/update tests, `pnpm check:i18n`, `pnpm --filter @backspace/web typecheck` and lint. Run actual desktop/mobile views and old bookmarks. Check source imports/catalog registration/dev entrypoints for no remaining live projectHub/useHubUpdateState references; historical specs remain history.
- [ ] **Step 6: Commit.** Stage only H1 files and commit `refactor(web): remove the Backspace project hub`.
