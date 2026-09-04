ALTER TABLE `user_stats` ADD `points` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `user_stats_points_idx` ON `user_stats` (`points`);--> statement-breakpoint
CREATE TABLE `device_points` (
	`device_id` text PRIMARY KEY NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`matches` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
