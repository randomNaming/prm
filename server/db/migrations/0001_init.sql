-- deals.amount 只保留在数据库层。界面不展示、不录入该字段。
CREATE TABLE `companies` (
	`id` VARCHAR(36) PRIMARY KEY,
	`name` VARCHAR(191) NOT NULL,
	`domain` VARCHAR(191),
	`industry` VARCHAR(191),
	`description` TEXT,
	`source` VARCHAR(64),
	`archived_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	INDEX `companies_name` (`name`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` VARCHAR(36) PRIMARY KEY,
	`company_id` VARCHAR(36),
	`first_name` VARCHAR(191) NOT NULL,
	`last_name` VARCHAR(191),
	`title` VARCHAR(191),
	`email` VARCHAR(191),
	`phone` VARCHAR(64),
	`wechat_id` VARCHAR(191),
	`linkedin` VARCHAR(191),
	`github` VARCHAR(191),
	`notes` TEXT,
	`archived_at` BIGINT,
	`last_researched_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	CONSTRAINT `fk_contacts_company` FOREIGN KEY (`company_id`)
		REFERENCES `companies`(`id`) ON DELETE SET NULL,
	INDEX `contacts_company` (`company_id`),
	INDEX `contacts_email` (`email`),
	INDEX `contacts_wechat` (`wechat_id`)
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` VARCHAR(36) PRIMARY KEY,
	`name` VARCHAR(191) NOT NULL,
	`company_id` VARCHAR(36),
	`contact_id` VARCHAR(36),
	`stage` VARCHAR(32) NOT NULL DEFAULT '初步接触',
	`amount` BIGINT,
	`expected_close_date` CHAR(10),
	`status` VARCHAR(16) NOT NULL DEFAULT 'open',
	`stage_changed_at` BIGINT,
	`archived_at` BIGINT,
	`created_at` BIGINT,
	`updated_at` BIGINT,
	CONSTRAINT `fk_deals_company` FOREIGN KEY (`company_id`)
		REFERENCES `companies`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_deals_contact` FOREIGN KEY (`contact_id`)
		REFERENCES `contacts`(`id`) ON DELETE SET NULL,
	INDEX `deals_status_stage` (`status`, `stage`)
);
--> statement-breakpoint
CREATE TABLE `activities` (
	`id` VARCHAR(36) PRIMARY KEY,
	`kind` VARCHAR(32) NOT NULL,
	`contact_id` VARCHAR(36),
	`company_id` VARCHAR(36),
	`deal_id` VARCHAR(36),
	`title` VARCHAR(191) NOT NULL,
	`body` TEXT,
	`due_at` BIGINT,
	`completed_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	INDEX `activities_due` (`due_at`),
	INDEX `activities_contact` (`contact_id`, `created_at`)
);
--> statement-breakpoint
CREATE TABLE `contact_facts` (
	`id` VARCHAR(36) PRIMARY KEY,
	`contact_id` VARCHAR(36) NOT NULL,
	`field` VARCHAR(32) NOT NULL,
	`value` TEXT NOT NULL,
	`status` VARCHAR(16) NOT NULL,
	`evidence` JSON NOT NULL,
	`source` VARCHAR(16) NOT NULL,
	`decided_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	CONSTRAINT `fk_facts_contact` FOREIGN KEY (`contact_id`)
		REFERENCES `contacts`(`id`) ON DELETE CASCADE,
	INDEX `facts_contact_field` (`contact_id`, `field`, `status`)
);
--> statement-breakpoint
CREATE TABLE `agent_tasks` (
	`id` VARCHAR(36) PRIMARY KEY,
	`kind` VARCHAR(32) NOT NULL,
	`target_type` VARCHAR(32),
	`target_id` VARCHAR(36),
	`payload` JSON,
	`status` VARCHAR(16) NOT NULL DEFAULT 'pending',
	`priority` INT NOT NULL DEFAULT 100,
	`attempts` INT NOT NULL DEFAULT 0,
	`max_attempts` INT NOT NULL DEFAULT 3,
	`lease_until` BIGINT,
	`run_at` BIGINT NOT NULL,
	`finished_at` BIGINT,
	`error` TEXT,
	`created_at` BIGINT NOT NULL,
	INDEX `tasks_due` (`status`, `run_at`, `priority`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` VARCHAR(36) PRIMARY KEY,
	`contact_id` VARCHAR(36),
	`company_id` VARCHAR(36),
	`deal_id` VARCHAR(36),
	`title` VARCHAR(191),
	`created_at` BIGINT,
	`last_message_at` BIGINT,
	INDEX `conversations_contact` (`contact_id`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` VARCHAR(36) PRIMARY KEY,
	`conversation_id` VARCHAR(36) NOT NULL,
	`role` VARCHAR(16) NOT NULL,
	`content` MEDIUMTEXT,
	`reasoning` MEDIUMTEXT,
	`tool_calls` JSON,
	`created_at` BIGINT NOT NULL,
	CONSTRAINT `fk_messages_conversation` FOREIGN KEY (`conversation_id`)
		REFERENCES `conversations`(`id`) ON DELETE CASCADE,
	INDEX `messages_conversation` (`conversation_id`, `created_at`)
);
