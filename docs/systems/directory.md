# Space directory — retired in 1.15.2

Explore (including local space discovery and Outer Space) and the external
global space directory are removed, not merely hidden. Their exclusive UI,
stores, resources, translations, server pinger/state/document/proxy/cache,
startup/shutdown hooks, configuration and shared contracts no longer exist.

## Compatibility

- `/explore` and `/backspace` are authenticated history-replacing redirects to
  Friends (`/channels/@me`); they mount no retired component or network consumer.
- `GET /api/directory`, `GET /api/directory/spaces`,
  `GET /api/spaces/explore` and `POST /api/spaces/:id/public-join` are unknown
  APIs. They return JSON 404 even when the production SPA fallback is active.
- `DIRECTORY_ENDPOINT` is no longer parsed or used. Old enabled database flags
  and an old endpoint cannot start timers, send pings or proxy a feed.
- Active responses omit `directoryListed`, instance discovery/directory status
  and the former Support-card setting. Legacy settings PATCH keys are ignored
  like other unknown keys. A space PATCH containing only unknown/retired fields
  returns the existing `no_fields_to_update`; with retained edits they are
  ignored and the retained edits proceed normally.

## Persistence

Generated migration `0050_standalone_cleanup` permanently removes:
`spaces.directory_listed`, `instance_settings.discovery_enabled`,
`directory_enabled`, `directory_browse_enabled`, `directory_dirty`,
`directory_last_ping_at`, `directory_last_error` and `support_card_enabled`.
The ORM mappings are gone. Historical migrations stay immutable for old upgrades;
new and upgraded databases finish without these columns. Native spaces, members,
visibility and invitation/request access are preserved; rollback uses the
pre-migration snapshot rather than obsolete production persistence.

No delisting request is sent to a third party. Removal from this application
does not prove deletion from any external cache or independently operated hub.

## Retained access

- Join Space accepts supplied invitation codes/URLs. Private and public spaces
  use invite admission; request spaces still require a manager's approval.
- Space Overview retains visibility, description and pending approval under
  `MANAGE_SPACE`. Invitations and manager decisions use native IDs on the selected
  server. Foreign invitation URLs are refused instead of reusing colliding codes.
- Initial server selection remains, but federation connections, remote memberships
  and peer credentials are removed by the standalone transition. Native accounts
  and content are preserved; no blanket local-storage reset occurs.
- Social **Discover People**, instance updates and AGPL source offer
  are separate features and remain.

See [spaces.md](spaces.md), [api.md](api.md), [database.md](database.md) and
the standalone upgrade notes. The actual-server regression suite
`packages/server/test/discovery-retirement-e2e.test.ts` uses isolated migrated
data and a loopback hub recorder to cover JSON 404, zero traffic, preserved
native values, permanent column absence, private invitation and request approval.
