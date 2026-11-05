CREATE TABLE `juno_player_stats` (
	`space_id` text NOT NULL,
	`user_id` text NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`completed_rounds` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`space_id`, `user_id`),
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "juno_stats_nonnegative" CHECK("juno_player_stats"."total_xp" >= 0 AND "juno_player_stats"."wins" >= 0 AND "juno_player_stats"."completed_rounds" >= "juno_player_stats"."wins")
);
--> statement-breakpoint
CREATE INDEX `idx_juno_stats_ranking` ON `juno_player_stats` (`space_id`,`total_xp`,`wins`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_juno_stats_user` ON `juno_player_stats` (`user_id`);--> statement-breakpoint
CREATE TABLE `juno_round_participants` (
	`round_id` text NOT NULL,
	`user_id` text NOT NULL,
	`place` integer,
	`card_count` integer,
	`xp` integer NOT NULL,
	`outcome` text NOT NULL,
	PRIMARY KEY(`round_id`, `user_id`),
	FOREIGN KEY (`round_id`) REFERENCES `juno_round_results`(`round_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "juno_participant_nonnegative" CHECK("juno_round_participants"."xp" >= 0 AND ("juno_round_participants"."card_count" IS NULL OR "juno_round_participants"."card_count" >= 0))
);
--> statement-breakpoint
CREATE INDEX `idx_juno_participants_user` ON `juno_round_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `juno_round_results` (
	`round_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`channel_id` text,
	`finished_at` integer NOT NULL,
	`scoring_version` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_juno_results_space` ON `juno_round_results` (`space_id`);