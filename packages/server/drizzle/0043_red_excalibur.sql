ALTER TABLE `spaces` ADD `afk_channel_id` text;--> statement-breakpoint
ALTER TABLE `spaces` ADD `afk_timeout_seconds` integer DEFAULT 300 NOT NULL;