-- StickerFinder Phase 3：商品识别 Prompt v2 字段
-- 演示环境 DB_SYNCHRONIZE=true 时，启动会自动新增可空列；本文件用于关闭 synchronize 的部署。
-- 执行前请备份数据库。
--
-- 说明：
-- 1. evidence 列不需要 DDL 变化：它一直是 simple-json/TEXT，v2 只改变 JSON 内容形状。
-- 2. 旧行新增字段保持 NULL，表示“旧版未评估”；接口会返回 null，前端显示为空。
-- 3. 旧 evidence 字符串数组由 search-response.mapper 在读取时归一化为对象，无需 SQL 重写。
-- 4. 如需用 v2 重新判定旧搜索，请重新发起一次搜索；已有 matchResult 的行不会被自动重识别。

-- MySQL 8
ALTER TABLE product_match_results
  ADD COLUMN candidate_relevance VARCHAR(16) NULL AFTER match_type,
  ADD COLUMN category_match VARCHAR(16) NULL AFTER candidate_relevance,
  ADD COLUMN series_match VARCHAR(16) NULL AFTER category_match,
  ADD COLUMN target_item_match VARCHAR(16) NULL AFTER series_match,
  ADD COLUMN visual_match VARCHAR(24) NULL AFTER target_item_match,
  ADD COLUMN next_action VARCHAR(32) NULL AFTER visual_match;

-- SQLite：每条 ALTER TABLE 只能新增一列
-- ALTER TABLE product_match_results ADD COLUMN candidate_relevance VARCHAR(16) NULL;
-- ALTER TABLE product_match_results ADD COLUMN category_match VARCHAR(16) NULL;
-- ALTER TABLE product_match_results ADD COLUMN series_match VARCHAR(16) NULL;
-- ALTER TABLE product_match_results ADD COLUMN target_item_match VARCHAR(16) NULL;
-- ALTER TABLE product_match_results ADD COLUMN visual_match VARCHAR(24) NULL;
-- ALTER TABLE product_match_results ADD COLUMN next_action VARCHAR(32) NULL;
