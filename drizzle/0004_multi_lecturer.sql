-- Multi-lecturer. Hand-edited: classes and students are rebuilt, because
-- SQLite cannot add a NOT NULL foreign key column to a table that has rows.
-- libsql's migrate() runs this batch with foreign keys switched off.
CREATE TABLE `allowed_emails` (
	`email` text PRIMARY KEY NOT NULL,
	`added_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cohorts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cohorts_name_unique` ON `cohorts` (`name`);--> statement-breakpoint
CREATE TABLE `lecturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text,
	`name` text DEFAULT '' NOT NULL,
	`google_sub` text,
	`refresh_token_enc` text,
	`sheet_id` text,
	`sheet_name` text,
	`drive_folder_id` text,
	`auth_error` text,
	`created_at` integer NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lecturers_email_unique` ON `lecturers` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `lecturers_google_sub_unique` ON `lecturers` (`google_sub`);--> statement-breakpoint
-- The single-lecturer version's data belongs to a lecturer with no email
-- yet. The first admin to sign in claims it (lib/lecturers.ts).
INSERT INTO `lecturers` (`id`, `name`, `created_at`)
	SELECT 1, '', CAST(strftime('%s', 'now') AS integer) * 1000
	WHERE EXISTS (SELECT 1 FROM `classes`) OR EXISTS (SELECT 1 FROM `students`);--> statement-breakpoint
CREATE TABLE `__new_classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lecturer_id` integer NOT NULL,
	`cohort_id` integer,
	`code` text NOT NULL,
	`sheet_tab` text NOT NULL,
	`module_name` text,
	`module_code` text,
	`start_date` text,
	`total_weeks` integer DEFAULT 15 NOT NULL,
	`last_synced_at` integer,
	`drive_folder_id` text,
	`submissions_sheet_error` text,
	`sheet_sync_until` integer,
	`submissions_sync_until` integer,
	`submissions_sync_requested` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`lecturer_id`) REFERENCES `lecturers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cohort_id`) REFERENCES `cohorts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_classes` (`id`, `lecturer_id`, `code`, `sheet_tab`, `module_name`, `module_code`, `start_date`, `total_weeks`, `last_synced_at`, `drive_folder_id`, `submissions_sheet_error`, `sheet_sync_until`, `submissions_sync_until`, `submissions_sync_requested`)
	SELECT `id`, 1, `code`, `sheet_tab`, `module_name`, `module_code`, `start_date`, `total_weeks`, `last_synced_at`, `drive_folder_id`, `submissions_sheet_error`, `sheet_sync_until`, `submissions_sync_until`, `submissions_sync_requested` FROM `classes`;--> statement-breakpoint
DROP TABLE `classes`;--> statement-breakpoint
ALTER TABLE `__new_classes` RENAME TO `classes`;--> statement-breakpoint
CREATE UNIQUE INDEX `classes_lecturer_code_uq` ON `classes` (`lecturer_id`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_lecturer_tab_uq` ON `classes` (`lecturer_id`,`sheet_tab`);--> statement-breakpoint
CREATE INDEX `classes_cohort_idx` ON `classes` (`cohort_id`);--> statement-breakpoint
CREATE TABLE `__new_students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lecturer_id` integer NOT NULL,
	`student_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`lecturer_id`) REFERENCES `lecturers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_students` (`id`, `lecturer_id`, `student_id`, `name`)
	SELECT `id`, 1, `student_id`, `name` FROM `students`;--> statement-breakpoint
DROP TABLE `students`;--> statement-breakpoint
ALTER TABLE `__new_students` RENAME TO `students`;--> statement-breakpoint
CREATE UNIQUE INDEX `students_lecturer_student_uq` ON `students` (`lecturer_id`,`student_id`);
