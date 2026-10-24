CREATE TABLE `submission_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`assignment_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submission_members_assignment_student_idx` ON `submission_members` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `submission_members_submission_idx` ON `submission_members` (`submission_id`);--> statement-breakpoint
ALTER TABLE `assignments` ADD `group_work` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assignments` ADD `max_group_size` integer;--> statement-breakpoint
-- Submissions made before group work covered just the student who made them.
INSERT INTO `submission_members` (`submission_id`, `assignment_id`, `student_id`) SELECT `id`, `assignment_id`, `student_id` FROM `submissions`;
