ALTER TABLE `contacts` ADD COLUMN `address` VARCHAR(191) AFTER `wechat_id`;
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `address` VARCHAR(191) AFTER `industry`;
--> statement-breakpoint
CREATE TABLE `company_facts` (
	`id` VARCHAR(36) PRIMARY KEY,
	`company_id` VARCHAR(36) NOT NULL,
	`field` VARCHAR(32) NOT NULL,
	`value` TEXT NOT NULL,
	`status` VARCHAR(16) NOT NULL,
	`evidence` JSON NOT NULL,
	`source` VARCHAR(16) NOT NULL,
	`decided_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	CONSTRAINT `fk_company_facts_company` FOREIGN KEY (`company_id`)
		REFERENCES `companies`(`id`) ON DELETE CASCADE,
	INDEX `company_facts_field` (`company_id`, `field`, `status`)
);
