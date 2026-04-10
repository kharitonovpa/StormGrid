PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user_stats` (
	`user_id` text PRIMARY KEY NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`draws` integer DEFAULT 0 NOT NULL,
	`watcher_score` integer DEFAULT 0 NOT NULL,
	`games_played` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_user_stats`("user_id", "wins", "losses", "draws", "watcher_score", "games_played", "updated_at") SELECT "user_id", "wins", "losses", "draws", "watcher_score", "games_played", "updated_at" FROM `user_stats`;--> statement-breakpoint
DROP TABLE `user_stats`;--> statement-breakpoint
ALTER TABLE `__new_user_stats` RENAME TO `user_stats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `user_stats_wins_idx` ON `user_stats` (`wins`);--> statement-breakpoint
CREATE INDEX `user_stats_watcher_score_idx` ON `user_stats` (`watcher_score`);