CREATE TABLE `attendance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`student_id` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`check_in_at` integer,
	`device_id` text,
	`ip` text,
	`user_agent` text,
	`nonce` text,
	`flagged` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_session_student_uq` ON `attendance` (`session_id`,`student_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_session_device_uq` ON `attendance` (`session_id`,`device_id`) WHERE "attendance"."source" = 'QR';--> statement-breakpoint
CREATE TABLE `checkin_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text,
	`student_id_entered` text,
	`device_id` text,
	`ip` text,
	`user_agent` text,
	`nonce` text,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `checkin_attempts_session_idx` ON `checkin_attempts` (`session_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`sheet_tab` text NOT NULL,
	`module_name` text,
	`module_code` text,
	`start_date` text,
	`total_weeks` integer DEFAULT 15 NOT NULL,
	`last_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_code_unique` ON `classes` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_sheet_tab_unique` ON `classes` (`sheet_tab`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_class_student_uq` ON `enrollments` (`class_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `manual_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`student_id` integer NOT NULL,
	`previous_status` text,
	`new_status` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` integer NOT NULL,
	`week` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_class_week_uq` ON `sessions` (`class_id`,`week`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_one_active_per_class_uq` ON `sessions` (`class_id`) WHERE "sessions"."status" = 'ACTIVE';--> statement-breakpoint
CREATE TABLE `students` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_student_id_unique` ON `students` (`student_id`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`student_id` text NOT NULL,
	`week` integer NOT NULL,
	`value` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`done_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sync_jobs_status_idx` ON `sync_jobs` (`status`,`class_id`);