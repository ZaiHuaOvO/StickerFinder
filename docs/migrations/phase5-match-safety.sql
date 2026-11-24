-- StickerFinder Phase 5：AI 原始判定、安全警告/阻断、SKU/价格核验状态
-- 演示环境 DB_SYNCHRONIZE=true 时启动会自动新增列；本文件用于关闭 synchronize 的部署。
-- 执行前请备份数据库。
--
-- 说明：
-- 1. match_status / confidence 保存安全校验后的最终结果。
-- 2. raw_match_status / raw_confidence 保存 AI 原始判定；旧行可为 NULL。
-- 3. safety_warnings / safety_blockers 为 JSON 字符串数组；旧行可为 NULL，读取端按空数组处理。
-- 4. sku_verification_status / price_verification_status 默认 PENDING；旧行不会自动视为已核验。
-- 5. 不修改任何已有商品、观察记录、AI 历史结果或人工复核记录。
-- 6. manual_sku_decisions 保存 SKU 级人工判断，与商品级 manual_decision 分离；旧行为 NULL。
-- 7. search_runs 增加系列别名与品牌字段，旧行为 NULL，读取端按空数组处理。

-- MySQL 8
ALTER TABLE product_match_results
  ADD COLUMN raw_match_status VARCHAR(32) NULL AFTER next_action,
  ADD COLUMN raw_confidence FLOAT NULL AFTER raw_match_status,
  ADD COLUMN safety_warnings TEXT NULL AFTER raw_confidence,
  ADD COLUMN safety_blockers TEXT NULL AFTER safety_warnings,
  ADD COLUMN sku_verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' AFTER safety_blockers,
  ADD COLUMN price_verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING' AFTER sku_verification_status,
  ADD COLUMN manual_sku_decisions TEXT NULL AFTER manual_note;

ALTER TABLE search_runs
  ADD COLUMN series_aliases TEXT NULL AFTER aliases,
  ADD COLUMN brand_names TEXT NULL AFTER series_aliases;

-- SQLite：每条 ALTER TABLE 只能新增一列
-- ALTER TABLE product_match_results ADD COLUMN raw_match_status VARCHAR(32) NULL;
-- ALTER TABLE product_match_results ADD COLUMN raw_confidence FLOAT NULL;
-- ALTER TABLE product_match_results ADD COLUMN safety_warnings TEXT NULL;
-- ALTER TABLE product_match_results ADD COLUMN safety_blockers TEXT NULL;
-- ALTER TABLE product_match_results ADD COLUMN sku_verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING';
-- ALTER TABLE product_match_results ADD COLUMN price_verification_status VARCHAR(24) NOT NULL DEFAULT 'PENDING';
-- ALTER TABLE product_match_results ADD COLUMN manual_sku_decisions TEXT NULL;
-- ALTER TABLE search_runs ADD COLUMN series_aliases TEXT NULL;
-- ALTER TABLE search_runs ADD COLUMN brand_names TEXT NULL;
