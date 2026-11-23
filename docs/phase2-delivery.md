# Phase 2 交付清单：抖音 / 小红书双数据源

版本：v0.2.0  
日期：2026-11-23

## 1. 已实现

- 抖音：`qovia` 第三方 API + `playwright` 浏览器，两个独立渠道任务。
- 小红书：`okdata` 第三方 API + `playwright` 浏览器，两个独立渠道任务。
- 每个渠道独立记录开始/结束时间、状态、结果数、错误码与错误原因。
- 平台聚合状态：`SUCCESS` / `PARTIAL_SUCCESS` / `EMPTY` / `FAILED` / `NOT_CONFIGURED`。
- 新增 `ProductObservation`，候选商品与来源观察记录分离；不同来源价格不互相覆盖。
- 强匹配去重（平台 ID / 规范化 URL / 标题+店铺）+ 弱匹配 DeepSeek 同款判断。
- 前端：渠道状态卡片、来源标签、多来源价格对比、价格不一致提示、原价、地区说明、原始采集信息展开。
- 地区限制：Qovia 未声明地区；OKData 为海外 App 视角；Playwright 为本机登录页面，均记录说明。
- 原始响应脱敏与体积限制后保存，前端可按来源展开查看。

## 2. 新增文件

后端：

- `backend/src/common/platform-channels.ts`
- `backend/src/common/utils/platform-status.util.ts`
- `backend/src/common/utils/product-dedupe.util.ts`
- `backend/src/common/utils/sanitize.util.ts`
- `backend/src/entities/product-observation.entity.ts`
- `backend/src/providers/douyin/qovia.api.ts`
- `backend/src/providers/douyin/qovia.mapper.ts`
- `backend/src/providers/douyin/douyin-third-party.provider.ts`
- `backend/src/providers/xiaohongshu/okdata.api.ts`
- `backend/src/providers/xiaohongshu/okdata.mapper.ts`
- `backend/src/providers/xiaohongshu/okdata.provider.ts`
- `backend/src/ai/same-product.schema.ts`
- `backend/src/ai/same-product.service.ts`
- `backend/src/search/candidate-aggregation.service.ts`
- `backend/test/third-party.test.ts`
- `docs/migrations/phase2-multi-source.sql`

前端：

- `frontend/src/app` 内的 models / labels / platform-panel / product-card 更新（无新增独立文件）。

文档：

- 本文件；README、平台接入说明、验证记录同步更新。

## 3. 修改文件（主要）

- `backend/src/common/enums/index.ts`：新增 provider、observation source、平台聚合状态、渠道部分成功。
- `backend/src/entities/platform-search-task.entity.ts`：新增 `provider` 与 `(search_run_id, platform, provider)` 唯一约束。
- `backend/src/entities/product-candidate.entity.ts`：关联 observations。
- `backend/src/entities/search-run.entity.ts`：关联 observations。
- `backend/src/providers/provider-registry.service.ts`：同一平台多 Provider 注册与聚合状态。
- `backend/src/providers/providers.module.ts`：注册 Qovia/OKData/Playwright。
- `backend/src/providers/douyin/douyin.provider.ts`：改为 `DouyinPlaywrightProvider`。
- `backend/src/providers/xiaohongshu/xiaohongshu.provider.ts`：改为 `XiaohongshuPlaywrightProvider`。
- `backend/src/providers/taobao/*`、`pinduoduo/*`：补充 provider/source 元数据与观察字段，不改变既有采集规则。
- `backend/src/search/search.service.ts`：按渠道创建任务、加载 observations。
- `backend/src/search/search-orchestrator.service.ts`：按平台执行多渠道任务、独立状态、统一识别。
- `backend/src/search/dto/search-response.mapper.ts`：channels、observations、价格冲突、聚合状态。
- `backend/scripts/check-config.js`：增加 Qovia/OKData 检查。
- `.env.example`：新增第三方 Key、同款判断预算。
- 前端 models / labels / platform-panel / product-card / app：渠道与多来源展示。

## 4. 数据库变更

- `platform_search_tasks` 新增 `provider`。
- 唯一索引由 `(search_run_id, platform)` 改为 `(search_run_id, platform, provider)`。
- 新增 `product_observations` 表，外键关联 search_run / candidate / provider_task。
- MySQL 增量 SQL：`docs/migrations/phase2-multi-source.sql`。
- 演示环境使用 TypeORM `synchronize`；正式环境请先备份并按迁移文件执行。

## 5. 新增环境变量

```env
QOVIA_API_KEY=
QOVIA_BASE_URL=https://api.qovia.ai

OKDATA_API_KEY=
OKDATA_BASE_URL=https://api.okdata.online

BAMBOO_API_KEY=
SOCIALTOAI_API_KEY=

THIRD_PARTY_MAX_AI_MATCHES_PER_PLATFORM=6
```

## 6. 验证结果（本地）

| 平台 / 来源 | 结果 |
|---|---|
| 淘宝 `taobao_tbk` | `NOT_CONFIGURED`（无 Key） |
| 拼多多 `pdd_ddk` | `NOT_CONFIGURED`（无 Key） |
| 抖音 `qovia` | `NOT_CONFIGURED`（无 Key） |
| 抖音 `playwright` | `FAILED / PARSE_FAILED`（未登录） |
| 小红书 `okdata` | `NOT_CONFIGURED`（无 Key） |
| 小红书 `playwright` | `BLOCKED / BLOCKED_BY_PLATFORM`（安全限制） |

- 一次搜索实际创建 6 个渠道任务，渠道独立执行与记录。
- 前端渠道卡片、多来源价格对比已验证（一次性数据：Qovia ¥9.00 / Playwright ¥9.50，显示价格不一致）；测试数据已删除。
- 后端单元测试 37 项通过，其中 Qovia/OKData 使用官方示例响应验证字段映射。
- **未进行真实商品价格核对**：缺少 Qovia/OKData Key、淘宝/拼多多凭证以及抖音/小红书登录账号。
- DeepSeek Key 已配置，但本次没有真实候选商品，内容识别与同款判断未做 live 验证。

## 7. 已知问题与后续

- Qovia、OKData 字段均为 Beta/Preview，需持续按官方文档维护解析器。
- Qovia 未声明数据地区；OKData 为海外视角，价格需人工核对大陆实际价格。
- 跨来源同款判断目前只在弱匹配且 AI 可用时调用；未配置 AI 时不会合并重复商品。
- 当前 Playwright 只解析列表页，未进入详情页提取 SKU 与精确 SKU 价格。
- 真实测试仍需：第三方 Key、淘宝/拼多多凭证、抖音/小红书登录、3–5 款真实贴纸人工核对记录。
