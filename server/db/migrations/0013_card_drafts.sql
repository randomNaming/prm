-- 名片识图草稿：AI 只写草稿，人确认才进 contacts。
--
-- 服务器不存图片，只留 image_hash（同一组图的判重/审计指纹）与 image_bytes 两个数字；
-- 这一行本身就是操作流水（谁、何时、哪张图、什么模型、多久、落到哪个联系人），
-- 随 1 天保留期一起清理；识别失败也记一条 status=failed 的行（只有元数据，无字段值）。
CREATE TABLE `card_drafts` (
	`id` VARCHAR(36) PRIMARY KEY,
	`device_id` VARCHAR(64) NOT NULL,
	`status` VARCHAR(16) NOT NULL DEFAULT 'pending',
	`name` VARCHAR(191),
	`company` VARCHAR(191),
	`title` VARCHAR(191),
	`phone` VARCHAR(64),
	`email` VARCHAR(191),
	`wechat` VARCHAR(191),
	`country` VARCHAR(64),
	`address` VARCHAR(191),
	`evidence` JSON,
	`raw_text` MEDIUMTEXT,
	`image_hash` CHAR(64),
	`image_bytes` INT,
	`model` VARCHAR(64),
	`ms` INT,
	`error` VARCHAR(255),
	`matched_contact_id` VARCHAR(36),
	`contact_id` VARCHAR(36),
	`created_at` BIGINT NOT NULL,
	`confirmed_at` BIGINT,
	`decided_note` VARCHAR(255)
);
--> statement-breakpoint
CREATE INDEX `card_drafts_status` ON `card_drafts` (`status`);
--> statement-breakpoint
CREATE INDEX `card_drafts_hash` ON `card_drafts` (`image_hash`);
--> statement-breakpoint
CREATE INDEX `card_drafts_phone` ON `card_drafts` (`phone`);
