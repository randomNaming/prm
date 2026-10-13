CREATE TABLE `field_defs` (
	`id` VARCHAR(36) PRIMARY KEY,
	`scope` VARCHAR(16) NOT NULL,
	`key` VARCHAR(64) NOT NULL,
	`label` VARCHAR(64) NOT NULL,
	`aliases` JSON NOT NULL,
	`data_type` VARCHAR(16) NOT NULL DEFAULT 'text',
	`origin` VARCHAR(16) NOT NULL,
	`status` VARCHAR(16) NOT NULL,
	`sample_value` TEXT,
	`sample_ref` VARCHAR(36),
	`evidence` JSON,
	`decided_at` BIGINT,
	`created_at` BIGINT NOT NULL,
	`updated_at` BIGINT NOT NULL,
	UNIQUE KEY `field_defs_scope_key` (`scope`, `key`),
	INDEX `field_defs_scope_status` (`scope`, `status`)
);
--> statement-breakpoint
INSERT INTO `field_defs` (`id`, `scope`, `key`, `label`, `aliases`, `data_type`, `origin`, `status`, `created_at`, `updated_at`) VALUES
('fd_contact_title', 'contact', 'title', '职位', JSON_ARRAY('职务', '岗位', '头衔', 'title', 'position', 'job', 'job title'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_email', 'contact', 'email', '邮箱', JSON_ARRAY('邮件', '电子邮箱', '电子邮件', 'email', 'e-mail', 'mail'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_phone', 'contact', 'phone', '电话', JSON_ARRAY('手机', '手机号', '手机号码', '联系电话', '联系方式', '电话号码', 'phone', 'telephone', 'mobile', 'tel', 'cell'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_wechat', 'contact', 'wechat_id', '微信号', JSON_ARRAY('微信', '微信id', '微信好友', 'wechat', 'wechat id', 'wx', 'weixin'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_address', 'contact', 'address', '地址', JSON_ARRAY('联系地址', '通讯地址', '所在地址', 'address', 'addr'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_linkedin', 'contact', 'linkedin', '领英主页', JSON_ARRAY('领英', 'linkedin', '领英链接'), 'text', 'builtin', 'active', 0, 0),
('fd_contact_github', 'contact', 'github', 'GitHub 主页', JSON_ARRAY('github', 'git', '代码仓库'), 'text', 'builtin', 'active', 0, 0),
('fd_company_industry', 'company', 'industry', '行业', JSON_ARRAY('所属行业', '行业类别', '赛道', 'industry', 'sector', 'vertical'), 'text', 'builtin', 'active', 0, 0),
('fd_company_description', 'company', 'description', '主营介绍', JSON_ARRAY('主营', '主营业务', '主营产品', '业务介绍', '公司简介', '简介', 'description', 'business', 'main business', 'about'), 'text', 'builtin', 'active', 0, 0),
('fd_company_address', 'company', 'address', '公司地址', JSON_ARRAY('地址', '公司所在地', '办公地址', '注册地址', 'address', 'addr'), 'text', 'builtin', 'active', 0, 0),
('fd_company_domain', 'company', 'domain', '官网域名', JSON_ARRAY('官网', '网址', '网站', '域名', 'domain', 'website', 'site', 'url'), 'text', 'builtin', 'active', 0, 0);
