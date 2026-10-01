CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`registration` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO companies (id, name, registration, created_at) VALUES ('company-xpress', 'אקספרס', '', 1790869800000);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_companies_name` ON `companies` (`name`);--> statement-breakpoint
CREATE TABLE `company_members` (
	`company_id` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_company_members_company_user` ON `company_members` (`company_id`,`user_id`);--> statement-breakpoint
-- Existing reports are test data: deletion explicitly authorized on 2026-10-01.
DELETE FROM reports;
--> statement-breakpoint
DROP INDEX `idx_reports_period_description`;--> statement-breakpoint
ALTER TABLE `reports` ADD `company_id` text NOT NULL REFERENCES companies(id);--> statement-breakpoint
ALTER TABLE `reports` ADD `module_key` text DEFAULT 'pnl' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reports_company_module_period_description` ON `reports` (`company_id`,`module_key`,`tax_year`,`from_month`,`to_month`,`description`);