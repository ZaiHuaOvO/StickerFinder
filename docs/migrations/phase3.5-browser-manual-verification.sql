-- StickerFinder Phase 3.5：浏览器人工验证恢复
-- 演示环境 DB_SYNCHRONIZE=true 时，启动会自动新增可空列；本文件用于关闭 synchronize 的部署。
-- 执行前请备份数据库。
--
-- 说明：
-- 1. manual_verification 保存等待人工验证时的关键词、目标 URL、Profile 目录、暂停次数与进度。
-- 2. 新增状态值 WAITING_MANUAL_VERIFICATION 属于 VARCHAR 内容，不需要 DDL 变化。
-- 3. 旧行该列为 NULL，表示从未进入人工验证流程。

-- MySQL 8
ALTER TABLE platform_search_tasks
  ADD COLUMN manual_verification JSON NULL AFTER note;

-- SQLite
-- ALTER TABLE platform_search_tasks ADD COLUMN manual_verification TEXT NULL;
