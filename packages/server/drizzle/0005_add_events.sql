CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text,
	`platform` text NOT NULL,
	`host` text,
	`name` text NOT NULL,
	`props` text,
	`country` text,
	`lang` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_name_created_idx` ON `events` (`name`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_device_created_idx` ON `events` (`device_id`,`created_at`);