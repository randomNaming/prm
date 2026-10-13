ALTER TABLE `contacts` CHANGE COLUMN `relation_type` `business_role` VARCHAR(32);
--> statement-breakpoint
ALTER TABLE `companies` CHANGE COLUMN `relation_type` `cooperation_role` VARCHAR(32);
--> statement-breakpoint
DELETE FROM `field_defs` WHERE `key` = 'relation_type';
--> statement-breakpoint
INSERT INTO `field_defs` (`id`, `scope`, `key`, `label`, `aliases`, `options`, `data_type`, `origin`, `status`, `agent_writable`, `created_at`, `updated_at`) VALUES
('fd_contact_business_role', 'contact', 'business_role', '业务角色', JSON_ARRAY('角色', '业务身份', 'business role', 'role'), JSON_ARRAY('对接人', '决策人', '技术', '老板', '采购'), 'enum', 'builtin', 'active', 1, 0, 0),
('fd_company_cooperation_role', 'company', 'cooperation_role', '合作角色', JSON_ARRAY('合作类型', '合作身份', '角色', 'cooperation role', 'role'), JSON_ARRAY('客户', '供应商'), 'enum', 'builtin', 'active', 1, 0, 0);
