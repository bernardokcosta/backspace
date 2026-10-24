-- No PRAGMA foreign_keys wrapper by design: no table references
-- soundboard_settings, so the rebuild is safe with enforcement on, and tests
-- (plus any caller) that disabled enforcement around migrate() keep their setting.
CREATE TABLE `__new_soundboard_settings` (
	`space_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`allow_member_uploads` integer DEFAULT true NOT NULL,
	`max_duration_seconds` real DEFAULT 30 NOT NULL,
	`max_sounds` integer DEFAULT 100 NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_soundboard_settings`("space_id", "enabled", "allow_member_uploads", "max_duration_seconds", "max_sounds") SELECT "space_id", "enabled", "allow_member_uploads", COALESCE("max_duration_seconds", 30), "max_sounds" FROM `soundboard_settings`;--> statement-breakpoint
DROP TABLE `soundboard_settings`;--> statement-breakpoint
ALTER TABLE `__new_soundboard_settings` RENAME TO `soundboard_settings`;