DROP TABLE `blocked_bots`;--> statement-breakpoint
DROP TABLE `bot_revocations`;--> statement-breakpoint
DROP TABLE `federation_applied_events`;--> statement-breakpoint
DROP TABLE `federation_attach_proofs`;--> statement-breakpoint
DROP TABLE `federation_file_queue`;--> statement-breakpoint
DROP TABLE `federation_mutation_log`;--> statement-breakpoint
DROP TABLE `federation_outbox`;--> statement-breakpoint
DROP TABLE `federation_peers`;--> statement-breakpoint
DROP TABLE `federation_reset_events`;--> statement-breakpoint
DROP TABLE `federation_subject_clocks`;--> statement-breakpoint
DROP TABLE `federation_sync_cursors`;--> statement-breakpoint
DROP TABLE `federation_sync_retry`;--> statement-breakpoint
DROP TABLE `peer_approval_notifications`;--> statement-breakpoint
DROP TABLE `peer_approval_requests`;--> statement-breakpoint
DROP TABLE `peer_approval_subscribers`;--> statement-breakpoint
DROP TABLE `sticker_peer_policies`;--> statement-breakpoint
DROP TABLE `user_federation_credentials`;--> statement-breakpoint
DROP TABLE `user_federation_registry`;--> statement-breakpoint
DROP INDEX `idx_dm_federated`;--> statement-breakpoint
ALTER TABLE `dm_channels` ADD `pair_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dm_pair_key` ON `dm_channels` (`pair_key`) WHERE pair_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE `dm_channels` DROP COLUMN `federated_id`;--> statement-breakpoint
ALTER TABLE `dm_channels` DROP COLUMN `owner_home_user_id`;--> statement-breakpoint
ALTER TABLE `dm_channels` DROP COLUMN `owner_home_instance`;--> statement-breakpoint
DROP INDEX `idx_dm_messages_source_unique`;--> statement-breakpoint
ALTER TABLE `dm_messages` DROP COLUMN `source_instance`;--> statement-breakpoint
ALTER TABLE `dm_messages` DROP COLUMN `source_message_id`;--> statement-breakpoint
ALTER TABLE `dm_messages` DROP COLUMN `encryption_version`;--> statement-breakpoint
DROP INDEX `idx_friend_requests_relay_message_id`;--> statement-breakpoint
ALTER TABLE `friend_requests` DROP COLUMN `relay_message_id`;--> statement-breakpoint
DROP INDEX `idx_sticker_packs_source`;--> statement-breakpoint
ALTER TABLE `sticker_packs` DROP COLUMN `origin_type`;--> statement-breakpoint
ALTER TABLE `sticker_packs` DROP COLUMN `source_instance`;--> statement-breakpoint
ALTER TABLE `sticker_packs` DROP COLUMN `source_pack_id`;--> statement-breakpoint
ALTER TABLE `sticker_packs` DROP COLUMN `synced_at`;--> statement-breakpoint
DROP INDEX `idx_users_home_user_id`;--> statement-breakpoint
DROP INDEX `idx_users_detached_home_user_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `home_instance`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `home_user_id`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `replicated_instances`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `federation_registry_updated_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `federation_heal_pending`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `federation_home_orphaned`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `detached_home_instance`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `detached_home_user_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_instance_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`instance_name` text DEFAULT 'Backspace',
	`worker_id` integer,
	`discovery_enabled` integer DEFAULT 1 NOT NULL,
	`max_bitrate_kbps` integer DEFAULT 20000 NOT NULL,
	`min_bitrate_kbps` integer DEFAULT 500 NOT NULL,
	`bitrate_step_kbps` integer DEFAULT 500 NOT NULL,
	`allowed_resolutions` text DEFAULT '540,720,1080' NOT NULL,
	`allowed_framerates` text DEFAULT '30,45,60' NOT NULL,
	`max_resolution` integer DEFAULT 1080 NOT NULL,
	`max_framerate` integer DEFAULT 60 NOT NULL,
	`registration_open` integer,
	`space_creation_open` integer DEFAULT 1 NOT NULL,
	`gif_api_key` text,
	`bitrate_matrix_overrides` text,
	`allow_custom_bitrate` integer DEFAULT 1 NOT NULL,
	`max_upload_size_bytes` integer,
	`max_sticker_size_bytes` integer,
	`telemetry_enabled` integer,
	`telemetry_id` text,
	`telemetry_last_day` text,
	`telemetry_last_error` text,
	`telemetry_declined_version` text,
	`directory_enabled` integer DEFAULT 0 NOT NULL,
	`directory_dirty` integer DEFAULT 0 NOT NULL,
	`directory_last_ping_at` integer,
	`directory_last_error` text,
	`directory_browse_enabled` integer DEFAULT 1 NOT NULL,
	`support_card_enabled` integer DEFAULT true NOT NULL,
	`installed_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK("__new_instance_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_instance_settings`("id", "instance_name", "worker_id", "discovery_enabled", "max_bitrate_kbps", "min_bitrate_kbps", "bitrate_step_kbps", "allowed_resolutions", "allowed_framerates", "max_resolution", "max_framerate", "registration_open", "space_creation_open", "gif_api_key", "bitrate_matrix_overrides", "allow_custom_bitrate", "max_upload_size_bytes", "max_sticker_size_bytes", "telemetry_enabled", "telemetry_id", "telemetry_last_day", "telemetry_last_error", "telemetry_declined_version", "directory_enabled", "directory_dirty", "directory_last_ping_at", "directory_last_error", "directory_browse_enabled", "support_card_enabled", "installed_at", "updated_at") SELECT "id", "instance_name", "worker_id", "discovery_enabled", "max_bitrate_kbps", "min_bitrate_kbps", "bitrate_step_kbps", "allowed_resolutions", "allowed_framerates", "max_resolution", "max_framerate", "registration_open", "space_creation_open", "gif_api_key", "bitrate_matrix_overrides", "allow_custom_bitrate", "max_upload_size_bytes", "max_sticker_size_bytes", "telemetry_enabled", "telemetry_id", "telemetry_last_day", "telemetry_last_error", "telemetry_declined_version", "directory_enabled", "directory_dirty", "directory_last_ping_at", "directory_last_error", "directory_browse_enabled", "support_card_enabled", "installed_at", "updated_at" FROM `instance_settings`;--> statement-breakpoint
DROP TABLE `instance_settings`;--> statement-breakpoint
ALTER TABLE `__new_instance_settings` RENAME TO `instance_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `attachments` DROP COLUMN `source_url`;--> statement-breakpoint
ALTER TABLE `attachments` DROP COLUMN `federation_status`;--> statement-breakpoint
ALTER TABLE `attachments` DROP COLUMN `federation_meta`;