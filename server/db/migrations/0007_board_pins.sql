-- 四象限看板的手工覆盖。
--
-- 象限本身是自动推断出来的（逾期任务=紧急、停滞商机=紧急、关系维护=不重要不紧急），
-- 这张表只存「你拖动过的那些」，让手工判断盖过推断。
-- 三类事项共用一张表：item_type 区分 task / deal / contact。
--
-- 没有对应记录时视为「未拖动」，跟着推断走 —— 所以删掉 pin 就等于恢复自动。
CREATE TABLE `board_pins` (
	`item_type` VARCHAR(16) NOT NULL,
	`item_id` VARCHAR(36) NOT NULL,
	`quadrant` VARCHAR(24) NOT NULL,
	`updated_at` BIGINT NOT NULL,
	PRIMARY KEY (`item_type`, `item_id`)
);
