# Project hub — retired in 1.15.2

The Veyvox project page and its desktop/mobile launchers, cards, version-seen
badges, exclusive helpers/store, translations and dev workbench have been removed.
`/backspace` is only an authenticated compatibility redirect to `/channels/@me`
using history replacement; signed-out visitors still reach login. No hub fetch
or component mounts for that bookmark.

The Support-card setting is no longer a public/admin wire field or a form
control. Legacy `supportCardEnabled` PATCH input is ignored like other unknown
fields. Generated migration `0050_standalone_cleanup` permanently removes the
inert `support_card_enabled` column and its ORM mapping, preserving native instance
settings. Historical SQL remains immutable; recovery uses the pre-migration
snapshot. Old seen-version localStorage is inert and is not cleaned up.

Retained functionality:
- `hooks/useHomeInstanceInfo.ts` and its invalidation/cache contract are shared
  by sticker upload/management and instance settings saves.
- `components/ui/SourceCodeLink.tsx`, source/version/commit attribution in
  authentication/settings, branding, desktop download, updates and recovery.
- Friends, DMs, spaces and instance-update/friend-request badge aggregation.

Historical designs and release notes describe the former module, not a live
feature. See [admin.md](admin.md), [mobile-ui.md](mobile-ui.md) and
[localization.md](localization.md) for current surfaces.
