-- 关系维护：把「这个客户的关系现在是什么状态」记在联系人上。
-- 留空 = 正常关系，进「长期养着」的池子（节日问候、群发营销）。
-- 填了「关系待修复」时，用 repair_note 写清要修什么。
--
-- field_defs 里的登记（关系维护 / 修复说明）由进程启动时的 seedBuiltinFields 补齐，
-- 这里只管加列。
ALTER TABLE `contacts` ADD COLUMN `relationship_state` VARCHAR(32);
--> statement-breakpoint
ALTER TABLE `contacts` ADD COLUMN `repair_note` VARCHAR(191);
