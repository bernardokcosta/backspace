# Spec: veyvox-compat

Parent: [Veyvox 1.17.0](2026-11-08-veyvox-1.17.0.md). Depends on `veyvox-brand` and
inherits parent commands/style/boundaries. Persistence/installation safety takes
priority over removing a legacy internal string.

## Objective

Veyvox replaces the existing community fork, not the unrelated official Backspace
installation. Preserve login, connected instances, preferences and operational
storage without requiring users to re-register or reconfigure.

## Existing owners

- Desktop `main.ts`, `userDataMigration.ts`, instance URL, startup/auto-launch,
  updater cache/state, recovery/deep-link handlers and platform build config.
- Web auth/instance/preferences stores, i18n preference owner, IndexedDB/cache/
  service-worker/manifest identity and the current typed preload bridge.
- Server config, install/update/backup/restore scripts and existing Compose/data
  mounts. No database schema, credential, federation identity or permission change.

## Contracts

1. Inventory old profile paths (current `Backspace Fork` and historical scoped
   path) before choosing the new startup identity. Never import the official
   upstream app's profile. Reuse current migration/startup ownership.
2. Preserve Chromium credential/keychain/safeStorage context, PWA identity,
   single-instance locking and installer upgrade identity. A display-name change
   alone is not evidence that cookies, secrets or replacement installers survive.
   Keep a legacy internal identifier/path when required rather than guessing a
   platform-specific encrypted-profile conversion.
3. Migration/reuse is idempotent and happens before any profile consumer opens it.
   An existing populated destination wins; never merge two accounts/profiles by
   overwriting files. Refusals/copy failures leave the source usable, no partial
   destination is mistaken for success, and no new empty profile silently replaces
   an unreadable existing one.
4. Preserve current web storage and IndexedDB data, pending messages, device/Juno
   preferences and automatic language selection. Renamed keys, if needed, have an
   explicit tested legacy read/migration policy; absence differs from empty/denied.
5. Keep existing bridge operations and sender/frame/focus/security gates. A new
   `window.veyvox` bridge and any old-name alias share one typed implementation;
   older hosted clients and older shells must degrade safely.
6. New Veyvox deep links remain strictly parsed; retain supported legacy links
   where needed. No new arbitrary URL, file, IPC or navigation access is permitted.
7. Veyvox-named environment options may accept legacy equivalents with documented
   precedence; never regenerate JWT/LiveKit/peering secrets or reset storage.
   Existing database filenames, data mounts, Compose project/volume/service IDs,
   registry paths and protocol fields are compatibility identities, not copy.
8. Rebranding/repository rename must not break old desktop update feeds or source
   offers. Test real old/new feed resolution and renamed artifact references.
   Do not recreate the old repository slug, which would destroy GitHub redirects.

## Testing and success

- Synthetic old/fresh/partial/populated/denied/cross-device migration fixtures;
  repeat launch and unchanged source-on-failure assertions.
- Old client/new shell and new client/old shell bridge/deep-link scenarios, with
  the same unauthorized sender/subframe/navigation refusal tests.
- Actual isolated Electron with temporary profiles and production preload/IPC;
  no updater install, real-user profile access, OS changes or live calls.
- Platform packaging runners verify identity/replacement assumptions. Limits of
  local Windows versus macOS/Linux/installed-client verification stay explicit.
- Server fixtures keep existing DB/uploads/backups/secrets and do not open a new
  database due solely to changing the product name. No production `.env` edits.
