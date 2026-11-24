# StickerFinder Phase 5 交付说明

## 状态

Phase 0–8 已按顺序完成。后端 `npm run build` 与 **90 项测试**通过，前端 `npm run build` 通过。真实 API 回归使用数据库副本和独立 3101 实例，未修改正式历史数据；正式库在改动前已备份。

## 交付内容

| 阶段 | 结果 |
|---|---|
| Phase 0 | 审计现有 AI/编排/provider/数据库/前端；备份 `backend/data/backups/sticker-finder-pre-phase5-*.sqlite` |
| Phase 1 | 安全层拆分为 `safetyBlockers` / `safetyWarnings`；只有硬阻断会降级 MATCH；保存 raw/final 判定与 SKU/价格核验状态 |
| Phase 2 | 每平台最多 10 个详情、并发 2；按相关性/标题证据排序；详情后做 SKU 二次 AI 识别 |
| Phase 3 | 平台并行搜索；AI 识别按 `AI_CLASSIFY_CONCURRENCY`（默认 3）并发；未选平台不建任务 |
| Phase 4 | `POST /api/searches/:id/cancel`、前端停止按钮、关闭页面提示；`CANCELLED` 与 `INTERRUPTED` 区分 |
| Phase 5 | 商品卡片一键确认/排除/撤销；SKU 级目标款/组合装/排除；相同商品复用历史人工判断；历史案例最多 2 条进入 AI |
| Phase 6 | 系列别名/品牌结构化；名称全角、空白、异体字归一；去重保持 ID → URL → 充分证据；价格按目标 SKU 核验状态展示 |
| Phase 7 | 卡片文字状态、平台进度、排除项展开、来源状态折叠、搜索表单「更多选项」 |
| Phase 8 | 真实三平台并行、详情/SKU、参考图 P0 回归、一键审核、取消与成本核对 |

## 数据库迁移

文件：[docs/migrations/phase5-match-safety.sql](migrations/phase5-match-safety.sql)

`product_match_results` 新增：

- `raw_match_status`、`raw_confidence`
- `safety_warnings`、`safety_blockers`
- `sku_verification_status`、`price_verification_status`
- `manual_sku_decisions`

`search_runs` 新增：

- `series_aliases`、`brand_names`

演示环境 `DB_SYNCHRONIZE=true` 会自动加列；关闭 synchronize 的环境按迁移 SQL 执行。旧行保持 NULL/默认值，不删除任何历史数据。

## 环境变量

```env
AI_CLASSIFY_CONCURRENCY=3
EVERYINFRA_DETAIL_MAX_PER_PLATFORM=10
EVERYINFRA_DETAIL_CONCURRENCY=2
PROVIDER_HTTP_TIMEOUT_MS=30000
```

`PROVIDER_HTTP_TIMEOUT_MS` 由 20000 调整为 30000：真实回归中淘宝搜索曾因 20 秒超时失败，随后同一接口在 1.75 秒内成功；30 秒用于给第三方接口留出抖动余量，仍可按需调高。

## 真实回归结果

### A. 三平台并行（无参考图）

- 淘宝：20 秒超时，`EVERYINFRA_TIMEOUT`；其他平台未受影响。
- 抖音：30 条，20 MATCH / 5 UNCERTAIN / 5 NO_MATCH。
- 小红书：19 条，6 MATCH / 7 UNCERTAIN / 6 NO_MATCH。
- 扣费：$0.013556（超时请求未扣费）。

### B. 抖音详情与 SKU

- 搜索 + 2 个详情，共 3 次调用，扣费 $0.024。
- 2 个候选 `skuVerificationStatus=VERIFIED`；详情未返回 SKU 价格，价格保持 `UNVERIFIED`。
- 详情观察记录 2 条，原始搜索结果保留。

### C. 参考图 + 淘宝/抖音（45 秒超时）

- 淘宝：20 条，16 MATCH / 2 UNCERTAIN / 2 NO_MATCH，搜索 1.75 秒完成。
- 抖音：30 条，21 MATCH / 4 UNCERTAIN / 5 NO_MATCH。
- 参考图已上传、`AI_VISION_ENABLED=false`：28 条 MATCH 保持 MATCH，`safetyWarnings` 记录视觉未启用，`safetyBlockers` 为空。
- 唯一 1 条 MATCH→UNCERTAIN：AI 选择 `TARGET_VARIANT` 但无 SKU 详情，属于合法硬阻断。
- 4 个详情；1 个淘宝详情短暂失败，原结果保留并标记 SKU 核验失败；1 个淘宝 SKU + 价格 `VERIFIED`。
- 扣费 $0.042。

### D. 一键审核与取消

- 商品级 MATCH → 200，`manualDecision=MATCH`；SKU 级 TARGET → 200；撤销产品级判断后 SKU 判断保留；AI 原始字段未变。
- 取消搜索 → run/平台 `CANCELLED`；重复取消仍为 `CANCELLED`；取消后不再产生 AI/详情调用；已在途的搜索请求产生 1 次 $0.005556 扣费，符合「已发出请求不保证退费」。

### 成本

Phase 8 测试合计约 **$0.0851**（$0.013556 + $0.024 + $0.005556 + $0.042）。测试实例、测试数据库和临时文件已清理。

## 已知限制

- 淘宝搜索曾出现一次 20 秒超时；已把默认超时提高到 30 秒，若网络持续抖动可调到 45 秒。
- 抖音详情不一定返回 SKU 级价格；没有价格时保持 `UNVERIFIED`，不用列表价冒充目标价。
- 详情请求失败时保留原搜索结果；该候选 SKU 核验标记 `FAILED`，不伪造价格。
- 历史人工复用只对「平台商品 ID + 标题 + SKU + 主图」完全一致的记录生效；不同店铺不自动继承。
- 历史 AI 参考案例限制为同目标/系列/平台的最近 2 条。
- 前端新交互（一键审核、停止按钮、折叠区）通过构建和 API 验证；尚未用完整浏览器自动化逐项点击。
- Android 模拟器 + Appium 原生小红书商品搜索仍未接入。

## 验证命令

```powershell
npm --prefix backend run build
npm --prefix backend test
npm --prefix frontend run build
npm --prefix backend run start:prod
```
