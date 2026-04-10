CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`player_a_id` text,
	`player_b_id` text,
	`character_a` text NOT NULL,
	`character_b` text NOT NULL,
	`winner` text,
	`rounds` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`player_a_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_b_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `replays` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`char_a` text NOT NULL,
	`char_b` text NOT NULL,
	`winner` text,
	`frames` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`avatar` text,
	`created_at` integer NOT NULL
);
