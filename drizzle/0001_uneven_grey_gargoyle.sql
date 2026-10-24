CREATE TABLE `assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'ASSIGNMENT' NOT NULL,
	`instructions` text,
	`due_at` integer NOT NULL,
	`open` integer DEFAULT true NOT NULL,
	`drive_folder_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_class_title_uq` ON `assignments` (`class_id`,`title`);--> statement-breakpoint
CREATE TABLE `submission_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`original_name` text NOT NULL,
	`drive_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`drive_file_id` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submission_files_submission_idx` ON `submission_files` (`submission_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`status` text NOT NULL,
	`upload_token` text NOT NULL,
	`started_at` integer NOT NULL,
	`late` integer DEFAULT false NOT NULL,
	`submitted_at` integer,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_assignment_student_uq` ON `submissions` (`assignment_id`,`student_id`);--> statement-breakpoint
ALTER TABLE `classes` ADD `drive_folder_id` text;--> statement-breakpoint
ALTER TABLE `classes` ADD `submissions_sheet_error` text;