-- 聊天留底的已读标记：详情页「聊天留底」标签上红点的依据。
-- null = 还没看过；打开该标签后由 /api/intake-viewed 写入时间戳。
--
-- 存量会话一律视为已看：加这列之前导入的都不算「新到的」，
-- 以后每次新导入从 null 开始，红点只提示真正没看过的。
ALTER TABLE `conversations` ADD COLUMN `viewed_at` BIGINT;
--> statement-breakpoint
UPDATE `conversations` SET `viewed_at` = ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000) WHERE `viewed_at` IS NULL;
