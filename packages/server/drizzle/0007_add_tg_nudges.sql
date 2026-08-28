CREATE TABLE `tg_nudges` (
	`user_id` text PRIMARY KEY NOT NULL,
	`last_sent_at` integer NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`unreachable` integer DEFAULT false NOT NULL
);
