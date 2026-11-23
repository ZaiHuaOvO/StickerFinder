-- StickerFinder Phase 2：多渠道任务与商品观察记录（MySQL 8）
-- 注意：
-- 1. 演示环境若使用 TypeORM synchronize=true，启动时会自动调整；本文件用于已有 MySQL 数据的手工迁移。
-- 2. 执行前请备份数据库。
-- 3. 旧唯一索引的名称因环境而异，请先执行 SHOW INDEX FROM platform_search_tasks; 找到
--    (search_run_id, platform) 上的旧唯一索引，删除后再添加新唯一索引。

ALTER TABLE platform_search_tasks
  ADD COLUMN provider VARCHAR(32) NOT NULL DEFAULT 'legacy' AFTER platform;

-- 将旧任务标注为 legacy；历史数据不会自动拆成多个来源。
-- 如果旧唯一索引存在，先删除：
-- ALTER TABLE platform_search_tasks DROP INDEX <旧唯一索引名>;
ALTER TABLE platform_search_tasks
  ADD UNIQUE KEY uq_platform_task_channel (search_run_id, platform, provider);

CREATE TABLE product_observations (
  id VARCHAR(36) NOT NULL,
  search_run_id VARCHAR(36) NOT NULL,
  candidate_id VARCHAR(36) NOT NULL,
  provider_task_id VARCHAR(36) NULL,
  platform VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  source VARCHAR(32) NOT NULL,
  source_product_id VARCHAR(200) NULL,
  title VARCHAR(512) NOT NULL,
  shop_name VARCHAR(255) NULL,
  product_url TEXT NOT NULL,
  image_urls TEXT NOT NULL,
  description TEXT NULL,
  sku_data TEXT NOT NULL,
  price_data TEXT NULL,
  original_price_data TEXT NULL,
  group_price_data TEXT NULL,
  sales_text VARCHAR(100) NULL,
  rating FLOAT NULL,
  region VARCHAR(50) NULL,
  region_note TEXT NULL,
  match_reason VARCHAR(100) NULL,
  raw_data TEXT NULL,
  observed_at DATETIME NOT NULL,
  collected_at DATETIME NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_obs_run_platform (search_run_id, platform),
  KEY idx_obs_candidate_provider (candidate_id, provider),
  CONSTRAINT fk_obs_run FOREIGN KEY (search_run_id) REFERENCES search_runs (id) ON DELETE CASCADE,
  CONSTRAINT fk_obs_candidate FOREIGN KEY (candidate_id) REFERENCES product_candidates (id) ON DELETE CASCADE,
  CONSTRAINT fk_obs_task FOREIGN KEY (provider_task_id) REFERENCES platform_search_tasks (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 回填旧候选商品的观察记录，避免历史价格丢失。
INSERT INTO product_observations (
  id, search_run_id, candidate_id, provider_task_id, platform, provider, source,
  source_product_id, title, shop_name, product_url, image_urls, description,
  sku_data, price_data, group_price_data, raw_data, observed_at, collected_at
)
SELECT
  UUID(),
  c.search_run_id,
  c.id,
  (
    SELECT t.id FROM platform_search_tasks t
    WHERE t.search_run_id = c.search_run_id AND t.platform = c.platform
    ORDER BY t.started_at ASC
    LIMIT 1
  ),
  c.platform,
  'legacy',
  CASE c.source_type
    WHEN 'browser' THEN 'playwright'
    WHEN 'third_party' THEN 'third_party_api'
    ELSE 'official_api'
  END,
  c.platform_product_id,
  c.title,
  c.shop_name,
  c.product_url,
  c.image_urls,
  c.description,
  c.sku_data,
  c.price_data,
  c.group_price_data,
  c.raw_data,
  c.collected_at,
  c.collected_at
FROM product_candidates c;

-- 说明：
-- - 旧任务 provider 为 legacy，属于历史单来源数据。
-- - 新搜索会为抖音/小红书分别创建第三方 API 与 Playwright 两个任务。
-- - 新候选商品会按来源写入 product_observations，多个价格不会被覆盖。
