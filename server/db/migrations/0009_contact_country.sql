-- 「国家」成为联系人固定字段：contacts 加列，值存标准中文国名。
ALTER TABLE `contacts` ADD COLUMN `country` VARCHAR(64);
--> statement-breakpoint
-- 之前 agent 提过自定义字段「所在国家」（已生效，示例值：美国）。国家转正后它就没必要
-- 单独存在了：事实行改指新键 country，旧字段定义删掉（进程启动的种子会补上
-- fd_contact_country，别名里包含「所在国家」，agent 用旧叫法也能写对地方）。
UPDATE `contact_facts` SET `field` = 'country' WHERE `field` = '所在国家';
--> statement-breakpoint
DELETE FROM `field_defs` WHERE `scope` = 'contact' AND `key` = '所在国家';
--> statement-breakpoint
-- 已生效的国家值同步进新列：没有这步，详情页「国家」会显示 — 而值还躺在事实表里。
UPDATE `contacts` c
JOIN `contact_facts` f
	ON f.`contact_id` = c.`id` AND f.`field` = 'country' AND f.`status` = 'applied'
SET c.`country` = f.`value`;
