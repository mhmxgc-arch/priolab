CREATE TABLE `ip_allowlist` (
	`address` text PRIMARY KEY NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`tax_year` integer NOT NULL,
	`from_month` integer NOT NULL,
	`to_month` integer NOT NULL,
	`filename` text NOT NULL,
	`rows_json` text NOT NULL,
	`created_by` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_period_description` ON `reports` (`tax_year`,`from_month`,`to_month`,`description`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`totp_secret` text NOT NULL,
	`last_totp_step` integer DEFAULT -1 NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);