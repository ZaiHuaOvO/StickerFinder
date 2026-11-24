-- StickerFinder Phase 4：EveryInfra 四平台接入（MySQL 8）
-- 说明：
-- 1. 演示环境使用 TypeORM synchronize=true 时会自动加列；本文件用于已有 MySQL 数据的手工迁移。
-- 2. 执行前请备份数据库。以下语句可重复执行前先检查列是否已存在。
-- 3. 旧渠道、旧配置与旧数据不需要修改；本阶段只新增列和新枚举值。

ALTER TABLE platform_search_tasks
  ADD COLUMN api_request_count INT NOT NULL DEFAULT 0,
  ADD COLUMN charged_usd FLOAT NULL,
  ADD COLUMN last_request_id VARCHAR(200) NULL;

ALTER TABLE product_candidates
  ADD COLUMN wholesale_price_data TEXT NULL;

ALTER TABLE product_observations
  ADD COLUMN wholesale_price_data TEXT NULL;

-- 说明：
-- - wholesale_price_data 保存 1688 批发价格（priceMin/priceMax/currency/unit/
--   minOrderQuantity/priceTiers），与零售 price_data 分开，不能互相覆盖。
-- - charged_usd 只保存服务商 billing 返回的实际扣费；未返回 billing 时为 NULL，
--   不使用本地估算金额。
-- - platform / provider 都是 VARCHAR，不需要修改枚举类型；新值：
--   platform=alibaba1688，provider=everyinfra_taobao / everyinfra_douyin /
--   everyinfra_xiaohongshu / everyinfra_alibaba1688。
