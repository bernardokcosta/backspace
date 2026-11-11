ALTER TABLE `dm_members` DROP COLUMN `closed_changed_at`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `discovery_enabled`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `telemetry_enabled`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `telemetry_id`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `telemetry_last_day`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `telemetry_last_error`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `telemetry_declined_version`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `directory_enabled`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `directory_dirty`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `directory_last_ping_at`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `directory_last_error`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `directory_browse_enabled`;--> statement-breakpoint
ALTER TABLE `instance_settings` DROP COLUMN `support_card_enabled`;--> statement-breakpoint
ALTER TABLE `spaces` DROP COLUMN `directory_listed`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `last_active_day`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `last_client`;