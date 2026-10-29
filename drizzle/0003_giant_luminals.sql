ALTER TABLE `classes` ADD `sheet_sync_until` integer;--> statement-breakpoint
ALTER TABLE `classes` ADD `submissions_sync_until` integer;--> statement-breakpoint
ALTER TABLE `classes` ADD `submissions_sync_requested` integer DEFAULT 0 NOT NULL;