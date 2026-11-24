# Phase 8：移除 AI 识别，改为规则过滤与离线测试

本阶段完成：

1. 彻底移除 DeepSeek 在商品搜索、识别、过滤、价格判断中的使用。
2. 用可解释的关键词规则完成标题筛选、详情确认与价格有效性判断。
3. 把真实历史响应整理为本地 fixtures，并提供只读离线回放。
4. 在配置与代码两层禁止未经授权的收费接口调用。

---

## 1. 阶段 0 审查结论

### 已移除的 AI 组件

| 文件 | 用途 | 处理 |
|---|---|---|
| `backend/src/ai/ai.module.ts` | AI 模块注册 | 删除 |
| `backend/src/ai/deepseek.service.ts` | DeepSeek HTTP 调用 | 删除 |
| `backend/src/ai/product-classifier.service.ts` | 商品识别、置信度、安全层 | 删除 |
| `backend/src/ai/same-product.service.ts` | AI 跨来源同款判断 | 删除 |
| `backend/src/ai/image-fetcher.service.ts` | AI 视觉输入 | 删除 |
| `backend/src/ai/ai.schema.ts` / `same-product.schema.ts` | AI 输出校验 | 删除 |
| `backend/src/ai/prompts/product-classification.prompt.ts` | 识别 Prompt | 删除 |
| `backend/test/classifier.test.ts` | AI 分类测试 | 删除 |
| 前端 `review-modal.component.ts` | 未使用的 AI 复核弹窗 | 删除 |

保留：

- `product_match_results` 表与历史 AI 数据（不迁移、不删除）。
- 确定性商品去重（平台 ID / URL / 标题+店铺）。
- 人工复核接口与历史人工记录。
- 价格比较、优惠、历史记录、搜索快照结构。

### 移除的配置

`.env.example` 已移除 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`AI_CLASSIFY_ENABLED`、`AI_CLASSIFY_CONCURRENCY`、`AI_MIN_CONFIDENCE`、`AI_VISION_ENABLED`、`IMAGE_HOST_ALLOWLIST`、`THIRD_PARTY_MAX_AI_MATCHES_PER_PLATFORM`。

本机真实 `.env` 中的旧 AI 变量已不再被读取，可由用户自行删除；本次未读取或输出任何密钥。

---

## 2. 规则识别模块

### 2.1 文件

```text
backend/src/rules/rule.types.ts     # 规则状态、价格状态、评估结果
backend/src/rules/rule.engine.ts    # 标准化、标题筛选、详情确认、价格校验
backend/src/entities/product-rule-result.entity.ts
backend/src/database/migrations/20261124100000-add-product-rule-results.ts
```

### 2.2 状态

| 规则状态 | 条件 |
|---|---|
| `RULE_MATCH_CONFIRMED` | 详情确认目标商品，且价格有效 |
| `RULE_MATCH_NO_PRICE` | 详情确认目标商品，但没有有效价格 |
| `RULE_NO_MATCH` | 标题或详情不符合关键词规则 |
| `RULE_PENDING_DETAIL` | 标题符合，但详情失败或尚未获取 |

价格状态：`PRICE_VALID` / `PRICE_MISSING` / `PRICE_INVALID` / `PRICE_AMBIGUOUS`。

### 2.3 文本标准化

- Unicode NFKC（全角转半角）。
- 英文小写。
- 常见异体字统一（如 `姸` → `妍`）。
- 忽略所有空白差异。
- 不删除标点，避免把 `21.0`、`4.0` 等版本号误合并。

### 2.4 标题筛选

- `targetKeywords`：目标名称 + 用户填写的别名。
- `seriesKeywords`：系列名称 + 用户填写的系列别名。
- 组内 OR，组间 AND。
- 系列为空时只校验目标关键词。
- 不自动把 `妍莜21.0` 扩展为 `妍莜`。

### 2.5 详情确认

只使用商品身份字段：

- 详情标题。
- SKU 名称（含规格值）。

不使用描述、店铺宣传、推荐商品或整个原始 JSON。SKU 名称命中时会记录对应 SKU ID。

### 2.6 价格校验

- 优先命中的 SKU 自身价格。
- 1688 使用明确的批发价与币种。
- 只有展示价/起步价时标记 `PRICE_AMBIGUOUS`，不伪造成 SKU 成交价。
- 缺失价格保持 `null`，不补 0。

### 2.7 搜索流程

```text
搜索结果 → 标题规则 → 不命中标记 RULE_NO_MATCH（不请求详情）
         → 命中 → 商品详情 → 详情标题/SKU 确认 → 价格校验
         → RULE_MATCH_CONFIRMED / RULE_MATCH_NO_PRICE / RULE_NO_MATCH
```

- 不再等待 DeepSeek。
- 没有 AI 队列、并发、超时与重试。
- 详情失败只标记 `RULE_PENDING_DETAIL`，不判定为不匹配。
- 规则结果写入新表 `product_rule_results`；新搜索不再创建 AI 判断记录。

---

## 3. 离线测试数据

### 3.1 来源与规模

2026-11-24 额度到期前，通过 EveryInfra 真实采集（未调用 DeepSeek）：

| 数据集 | 目标 / 系列 | 淘宝 | 抖音 | 小红书 | 1688 |
|---|---|---|---|---|---|
| sticker-01 | 菜食场 / 利胜 15.0 | 20 商品 + 2 详情 | 30 + 1 | 20 + 1 | 超时 |
| sticker-02 | 琉璃盏 / 天空岛 10.0 | 20 + 0 | 30 + 1 | 20 + 1 | 超时 |
| sticker-03 | 疯人院 / 星眠 9.0 | 20 + 2 | 30 + 1 | 20 + 1 | 20 + 2 |
| sticker-04 | 非实用之家 / 芋泥小盒子 10.0 | 20 + 2 | 30 + 0 | 0 | 20 + 0 |
| sticker-05 | 雅物书房 / 利胜 15.0 | 20 + 2 | 7 + 1 | 20 + 1 | 20 + 2 |

- 目录：`backend/test/fixtures/raw/`
- 清单：`manifest.json`
- 体积：约 1.5 MB
- 费用：$0.226614（预算 $0.30）
- 外部请求：搜索 20 次（2 次 1688 超时）、详情 20 次；DeepSeek 0 次。
- 保留：平台商品 ID、标题、店铺、SKU、价格、优惠、图片地址、采集时间、原始商品字段。
- 清理：原始数据经 `sanitizeRawData` 去除 token/cookie/authorization 等敏感键。
- 未修改任何商品价格或 SKU 内容；数据库历史记录未被覆盖。

### 3.2 缺失数据

- 1688 对 sticker-01、sticker-02 搜索超时，未重试、未联网补齐。
- sticker-04 小红书返回空结果。
- 原始 fixtures 只包含商品数据，不包含旧 AI 判断；因此没有把 AI 结果当作人工标签。
- 历史数据库里的人工确认未合并进 fixtures（fixtures 来自 API 原始响应）。回放中的规则结果独立计算，`manual.decision` 为 `PENDING`。

---

## 4. 离线回放

### 4.1 接口

```http
GET /api/replay/fixtures
POST /api/replay
{
  "fixtureId": "sticker-01",
  "targetName": "菜食场",
  "seriesName": "利胜15.0",
  "aliases": [],
  "seriesAliases": []
}
```

- 每次请求都会用当前最新规则重新计算。
- 返回结构与在线搜索一致（含商品、SKU、优惠、价格汇总）。
- `dataSource: "fixture"`、`replay: true`。
- 不写数据库、不调用 EveryInfra、不读取旧 AI 判断。

### 4.2 前端

- 默认进入“测试模式 · 本地历史数据”，顶部显示模式标识。
- 搜索表单上方提供测试数据选择器（5 个数据集）。
- 提交后直接调用回放接口，不轮询、不创建搜索任务。
- 回放结果只读：不显示人工复核、人工验证和取消按钮。
- 本地无数据时明确提示，不会自动切换到真实接口。

### 4.3 回放结果（当前规则）

格式：`平台: 确认 / 待确认 / 未匹配`

| 数据集 | 淘宝 | 抖音 | 小红书 | 1688 | 最低确认价 |
|---|---|---|---|---|---|
| sticker-01 | 2/0/18 | 0/15/15 | 0/1/19 | 无数据 | ¥12.80 |
| sticker-02 | 0/0/20 | 0/1/29 | 0/1/19 | 无数据 | — |
| sticker-03 | 0/3/17 | 0/0/30 | 0/0/20 | 0/0/20 | — |
| sticker-04 | 0/2/18 | 0/0/30 | 空 | 0/0/20 | — |
| sticker-05 | 2/10/8 | 0/4/3 | 0/0/20 | 0/2/18 | ¥11.80 |

说明：

- 规则要求标题同时包含目标与系列，因此大量仅含单一关键词的商品被排除，这是预期行为。
- 部分标题命中的商品没有对应详情（采集时只取前 2 条），显示为“待详情确认”。
- sticker-02/03/04 的标题普遍不含完整系列名，确认数为 0，未通过放宽规则来“凑数量”。

---

## 5. 外部接口保护

新增配置：

```env
SEARCH_DATA_MODE=fixture
LIVE_PROVIDER_REQUESTS_ENABLED=false
FIXTURE_DIR=test/fixtures/raw
```

- 默认 `fixture`：`POST /api/searches`、恢复人工验证、1688 图搜均返回 400，不触发任何外部请求。
- `EveryInfraClient.call` 在非授权状态下直接抛出 `LIVE_REQUESTS_DISABLED`（第二层防线）。
- 真实采集必须同时满足：`SEARCH_DATA_MODE=live` + `LIVE_PROVIDER_REQUESTS_ENABLED=true`，并由用户主动发起。
- `scripts/check-config.js --live` 在未满足上述两个条件时直接拒绝执行。
- 页面加载、历史查询、回放、测试均不经过真实采集入口。
- DeepSeek 代码与配置已删除，不存在隐式 AI 调用。

---

## 6. 测试

- 后端测试：**112 项通过**。
  - 新增 `test/rules.test.ts`（23 项）：标准化、标题 OR/AND、别名、详情字段、价格校验、整体状态。
  - 新增 `test/replay.test.ts`（4 项）：fixture 列表、规则重算、自定义条件、只读且不读取旧 AI。
  - 更新 `test/price-summary.test.ts`：改为规则结果驱动，并验证旧 AI 结果不参与价格汇总。
  - 删除 AI 分类相关测试与导入。
- 前端生产构建通过。
- 浏览器验证：
  - 测试模式标识、5 个数据集选择器；
  - 回放“菜食场 / 利胜15.0”：20 张商品卡、最低确认价 ¥12.80、规则/价格标签正常；
  - 回放页无人工复核按钮；
  - 历史详情仍可读取，旧数据标记为“历史数据 · 未评估”；
  - 页面无 DeepSeek/AI 文案，控制台无报错。

---

## 7. 数据模型变化

新增 `product_rule_results`（1:1 候选商品）：

- 规则状态、价格状态、标题/详情是否命中。
- 命中关键词、命中 SKU、匹配类型。
- 价格金额/币种/来源/SKU。
- 人工判断字段（与旧 AI 表分开）。
- 规则说明、详情错误、评估时间。

迁移：`npm --prefix backend run migration:run`（已在当前 SQLite 执行成功）。

旧 `product_match_results` 与历史 AI 数据保持不变；新搜索不再写入该表。

---

## 8. 已知问题

1. 旧历史搜索没有规则结果，详情页显示“历史数据 · 未评估”，不进入价格汇总；如需重新评估，可使用回放为未来版本增加“历史记录重算”能力。
2. fixtures 不包含人工确认标签；人工标签仍保留在数据库历史记录中，未混入测试数据。
3. 1688 搜索有 2 次超时、无对应数据；未补采。
4. 详情映射在接口缺字段时会沿用同一次商品请求的基础标题/SKU；真实响应通常包含详情标题与 SKU。
5. 规则只做透明关键词包含判断，不做同义词、拼音或语义推断；系列名缺失时确认数会偏低，这是有意的准确性取舍。
6. Phase 8 的**在线搜索链路**（规则 + 真实 Provider + 数据库）未再发起真实请求验证；当前默认 `fixture` 模式且额度已到期。开启 `SEARCH_DATA_MODE=live` + `LIVE_PROVIDER_REQUESTS_ENABLED=true` 后，需由用户主动发起一次真实搜索做最终线上验证。
7. 历史搜索的 `matchedCount` 只统计规则确认或人工确认，不再使用旧 AI 的 MATCH；旧搜索可能显示较低的匹配数，这是预期行为。
