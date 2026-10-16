-- 关系洞察引擎：三层冰山的第二、三层（相处说明书 + 双轨温度）。
--
-- 两类洞察结构不同但生命周期一致：整段由一次导入产出、下一次导入整段刷新，
-- 所以共用一张表、payload 存 JSON，kind 区分。旧版本行置 superseded 保留可回溯，
-- 详情页只取每个 kind 最新的一条。
CREATE TABLE `relationship_insights` (
	`id` VARCHAR(36) PRIMARY KEY,
	`contact_id` VARCHAR(36) NOT NULL,
	`kind` VARCHAR(16) NOT NULL,
	`payload` JSON NOT NULL,
	`evidence` JSON NOT NULL,
	`source` VARCHAR(16) NOT NULL DEFAULT 'agent',
	`status` VARCHAR(16) NOT NULL DEFAULT 'applied',
	`created_at` BIGINT NOT NULL,
	CONSTRAINT `fk_insights_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `insights_contact_kind` ON `relationship_insights` (`contact_id`, `kind`, `status`);
--> statement-breakpoint
-- 双向承诺与期权账本：我方欠对方的（待兑现债务）与对方许我方的（待收割筹码）。
-- due_hint 存文本（如「样品签收后3天」）而不是日期：条件触发的承诺没有可靠时点，
-- 硬造日期是假数据。闭环由人在界面上确认。
CREATE TABLE `promises` (
	`id` VARCHAR(36) PRIMARY KEY,
	`contact_id` VARCHAR(36) NOT NULL,
	`direction` VARCHAR(8) NOT NULL,
	`title` VARCHAR(191) NOT NULL,
	`detail` VARCHAR(191),
	`due_hint` VARCHAR(64),
	`status` VARCHAR(16) NOT NULL DEFAULT 'open',
	`evidence` JSON NOT NULL,
	`source` VARCHAR(16) NOT NULL DEFAULT 'agent',
	`created_at` BIGINT NOT NULL,
	`closed_at` BIGINT,
	`closed_note` VARCHAR(191),
	CONSTRAINT `fk_promises_contact` FOREIGN KEY (`contact_id`) REFERENCES `contacts` (`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `promises_contact_status` ON `promises` (`contact_id`, `status`, `direction`);
