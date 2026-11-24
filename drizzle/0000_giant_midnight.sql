CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_request` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`actor` text NOT NULL,
	`details` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_ticket` ON `events` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`ticket_id` text,
	`owner` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`internal` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_ticket` ON `messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`fingerprint` text NOT NULL,
	`response` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requests_owner_date` ON `requests` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`owner` text NOT NULL,
	`subject` text NOT NULL,
	`description` text NOT NULL,
	`area` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`severity` integer DEFAULT 3 NOT NULL,
	`severity_reason` text NOT NULL,
	`factors` text NOT NULL,
	`diagnosis` text NOT NULL,
	`assignee` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`last_update` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_conversation` ON `tickets` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `tickets_owner` ON `tickets` (`owner`);--> statement-breakpoint
CREATE INDEX `tickets_queue` ON `tickets` (`status`,`severity`,`updated_at`);