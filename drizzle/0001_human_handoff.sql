ALTER TABLE `tickets` ADD `handoff_state` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `handoff_requested_at` text;