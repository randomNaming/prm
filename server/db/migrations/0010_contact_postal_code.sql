-- 「邮编」成为联系人固定字段：contacts 加列，与地址、国家并列。
-- 不做回填：存量地址串里的邮编样式各异（并入地址还是独立存没有统一痕迹），人工按需补。
ALTER TABLE `contacts` ADD COLUMN `postal_code` VARCHAR(32);
