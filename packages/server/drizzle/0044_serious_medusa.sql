CREATE TABLE `pinned_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`message_id` text NOT NULL,
	`pinned_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pinned_messages_channel` ON `pinned_messages` (`channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_pinned_messages_message` ON `pinned_messages` (`message_id`);