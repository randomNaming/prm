-- 客户等级：商务价值的分级标签（A 类潜力买家 / B 类稳定客户 / C 类一般客户，可增词）。
-- 智能体可以建议，人工可改 —— 覆盖规则沿用事实通道：人工值永不被覆盖。
ALTER TABLE `contacts` ADD COLUMN `customer_grade` VARCHAR(32);
