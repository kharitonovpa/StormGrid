CREATE TABLE `device_streaks` (
	`device_id` text PRIMARY KEY NOT NULL,
	`streak` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
