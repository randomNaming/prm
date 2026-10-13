ALTER TABLE `contacts` ADD COLUMN `relation_type` VARCHAR(32) AFTER `address`;
--> statement-breakpoint
ALTER TABLE `companies` ADD COLUMN `relation_type` VARCHAR(32) AFTER `address`;
--> statement-breakpoint
ALTER TABLE `field_defs` ADD COLUMN `options` JSON;
--> statement-breakpoint
ALTER TABLE `field_defs` ADD COLUMN `agent_writable` TINYINT NOT NULL DEFAULT 1;
--> statement-breakpoint
INSERT INTO `field_defs` (`id`, `scope`, `key`, `label`, `aliases`, `options`, `data_type`, `origin`, `status`, `agent_writable`, `created_at`, `updated_at`) VALUES
('fd_contact_relation', 'contact', 'relation_type', '关系类型', JSON_ARRAY('关系', '身份', 'relation', 'relationship'), JSON_ARRAY('客户', '供应商'), 'enum', 'builtin', 'active', 0, 0, 0),
('fd_company_relation', 'company', 'relation_type', '关系类型', JSON_ARRAY('关系', '身份', 'relation', 'relationship'), JSON_ARRAY('客户', '供应商'), 'enum', 'builtin', 'active', 0, 0, 0);
