# Phase 7：优惠信息采集与搜索历史

本阶段完成两项需求：

1. 淘宝、1688 优惠信息采集、保存与展示（抖音、小红书不改动）。
2. 每次搜索完整落库，并提供历史记录列表与只读历史详情。

> 真实接口核对时间：2026-11-24。所有优惠字段以当时 EveryInfra 实际响应为准，缺失字段保持为空，不做推算。

---

## 1. 代码审查结论（阶段 0）

开发前扫描了当前工作区，结论如下。

### 已有能力（直接复用）

| 能力 | 位置 |
|---|---|
| 搜索任务与渠道任务 | `search_runs` / `platform_search_tasks` |
| 每次采集的商品快照 | `product_observations`（已有价格、SKU、原始数据、采集时间） |
| 单次搜索内商品合并 | `product_candidates`（按 searchRunId 隔离，不跨搜索覆盖） |
| AI 判断与人工复核 | `product_match_results`（AI 字段与人工字段分开） |
| 失败/取消/重启处理 | 渠道失败保留其他平台数据；取消保留已完成数据；启动时把未完成任务标记为 `INTERRUPTED` |
| 历史详情读路径 | `GET /api/searches/:id` 只读数据库，不调用任何外部接口 |
| 原始数据脱敏 | `sanitizeRawData`（token/cookie/authorization/api_key/password 等键名脱敏） |

### 本次新增

- `product_promotions` 表与 `ProductPromotion` 实体。
- `product_observations.coupon_price_data`（接口明确返回的券后价）。
- `SkuOption.couponPrice` / `couponText`（SKU 维度券后价）。
- 淘宝、1688 优惠字段解析。
- 搜索任务 `PARTIAL` 状态与整体状态计算（此前全部平台失败仍标记为 COMPLETED）。
- `GET /api/search-history`（分页、关键词、状态、时间范围）与 `GET /api/search-history/:id`。
- 前端「历史记录」入口、列表与只读详情。
- 商品卡片优惠区、券后价、SKU 券后价。
- TypeORM 迁移机制与首个迁移文件。

### 明确未改动

- 抖音、小红书的采集、映射与展示逻辑。
- 价格排序、商品匹配、人工复核规则。
- `PriceInfo.amount` 的语义：优惠金额不进入该字段，不参与最低价排名。

---

## 2. 数据模型

### 2.1 product_promotions

| 字段 | 说明 |
|---|---|
| id | 主键 |
| observation_id | 关联 `product_observations`，级联删除 |
| sku_id | SKU 级优惠时填写；商品级优惠为空 |
| platform | 平台 |
| promotion_type | `COUPON` / `SHOP_ACTIVITY` / `PLATFORM_ACTIVITY` / `DISCOUNT` / `OTHER` |
| name | 优惠名称（接口原名；没有名称时使用类型通用名） |
| amount | 优惠金额，不是券后价；未返回为 null |
| currency | 币种，未返回为 null |
| discount_rate | 折扣比例 0–1，仅接口给出折扣时填写 |
| minimum_spend | 使用门槛，未返回为 null |
| start_time / end_time | 接口给出的有效期 |
| description | 规则/说明原文（含 1688 的 `summary`） |
| promotion_url | 领取/活动链接 |
| source | 采集渠道（provider key） |
| raw_data | 仅优惠相关原始字段 |
| observed_at | 采集时间 |

### 2.2 快照与去重规则

- 每次采集生成新的 `ProductObservation`，优惠记录挂在观察记录下；再次搜索同一商品不会覆盖旧优惠。
- 同一次采集内的重复条目按「类型 + SKU + 名称 + 金额 + 折扣 + 门槛 + 有效期 + 说明」去重。
- 商品级优惠不会复制到各 SKU；只有接口明确给出 `sku_id` 的优惠才关联 SKU。
- `coupon_price` 只在接口明确返回、且低于当前展示价时保存为券后价；否则不展示。

---

## 3. 真实接口字段核对

### 3.1 淘宝

真实请求：`taobao/search`（关键词“造景贴纸”）与 `taobao/product_detail`，HTTP 200。

搜索返回的关键字段：

```text
id, url, title, price, currency, price_basis, shop_name, image_url, shop_id,
original_price, discount_type, category_id, shop_score_description,
search_rank, free_shipping, images, platform
```

详情返回的关键字段：

```text
id, url, title, price, currency, price_basis, stock, shop_name, skus,
sku_count, spec_values, main_image_url, description_images, description_html,
images, has_price_range, platform
```

SKU 字段：`id, name, price, stock, props_ids, image_url`。

结论：

- 当前淘宝接口**没有返回** `coupon_price`、`promotion_price`、`discount_price`、`price_note`、优惠券数组或 SKU 级券字段。
- 返回了 `discount_type`，真实观测到的值包括 `优惠促销`、`周周精选`、`超级立减活动价`，但都没有金额、门槛或有效期。系统只把接口给出的类型名称保存为一条 `DISCOUNT` 类型、金额为空的优惠记录，不补任何数值。
- `price_basis` 实际值为 `list`（搜索）和 `page`（详情），已分别显示为“页面标价”“页面现价”。
- 券后价、SKU 券后价解析逻辑已实现并有单元测试；接口后续返回这些字段时会自动保存，无需改表。

### 3.2 1688

真实请求：`alibaba1688/search`（关键词“造景贴纸”）与 `alibaba1688/product_detail`，HTTP 200。

搜索返回的关键字段：

```text
id, url, title, price_min, currency, order_count, repurchase_rate, city,
province, supplier_name, images, supplier_type, supplier_years,
supplier_shop_url, supplier_composite_score, sold_count_text,
service_tags, product_badges, platform
```

详情返回的关键字段：

```text
id, url, title, price_min, price_max, currency, min_order_quantity, sold_count,
unit, supplier_name, supplier_type, skus, images, description_images,
promotions, winport_url, promotion_details, supports_mix,
supplier_metric_tags, shipping, unit_weight_kg, platform
```

真实优惠数据：

```json
{
  "promotions": ["满优惠"],
  "promotion_details": [
    {
      "name": "满优惠",
      "type": "SHOP_PROMOTION",
      "summary": "单笔订单满168元，免快递运费"
    }
  ]
}
```

结论：

- 1688 当前**没有返回 `coupons` 或 `price_tiers`**。
- `promotions` 是纯字符串数组，`promotion_details` 是对象数组。两者都解析；同一名称优先保留信息更完整的 `promotion_details`。
- `type: SHOP_PROMOTION` 映射为 `SHOP_ACTIVITY`；`summary` 保存为优惠说明原文。
- 1688 SKU 为 `id/name/options/price/stock/available/image_url`，没有 SKU 券后价。
- 批发价、MOQ、计价单位与阶梯价规则保持不变，优惠信息不影响批发价字段与零售排名。

### 3.3 搜索请求参数

真实错误响应确认了 1688 搜索参数：`keyword` 必填，可选 `city/limit/max_price/min_price/sort`，**不接受 `page`**。当前 Provider 只发送 `keyword` 与 `sort`，符合接口约束。

---

## 4. 数据库迁移

新增迁移：`backend/src/database/migrations/20261124000000-add-product-promotions.ts`。

执行：

```powershell
npm --prefix backend run migration:run
```

查看/回滚：

```powershell
npm --prefix backend run migration:show
npm --prefix backend run migration:revert
```

说明：

- 迁移只新增表与一个可空列，不删除、不修改任何已有列；回滚会删除新增内容。
- 已在当前 SQLite 数据库执行成功，旧搜索记录保持可读。
- `DB_SYNCHRONIZE=true` 仍用于本地开发；生产应设置 `DB_SYNCHRONIZE=false`，并使用迁移。`DB_MIGRATIONS_RUN=true` 可在启动时自动执行未运行迁移。

---

## 5. 搜索历史 API

### 5.1 列表

```http
GET /api/search-history?page=1&pageSize=20&keyword=妍莜&status=COMPLETED&startTime=2026-11-01&endTime=2026-11-30
```

返回：

```json
{
  "items": [
    {
      "searchId": "...",
      "keyword": "霓虹雪夜",
      "targetName": "霓虹雪夜",
      "seriesName": "妍莜 20.0",
      "status": "COMPLETED",
      "platforms": ["taobao", "douyin", "xiaohongshu", "alibaba1688"],
      "productCount": 70,
      "matchedCount": 41,
      "startedAt": "2026-11-24T07:38:13.000Z",
      "completedAt": "2026-11-24T07:43:41.165Z",
      "errorMessage": null
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 20
}
```

- `keyword` 即本次实际发送给平台的搜索词（当前等于 `targetName`）。
- `matchedCount` 与详情页有效状态一致：人工判断优先于 AI 判断。
- 只查询数据库，不调用外部接口。

### 5.2 详情

```http
GET /api/search-history/:id
```

返回与 `GET /api/searches/:id` 相同的快照结构，包含商品、SKU、优惠、AI 判断与人工复核结果。该接口不会重新采集，也不会修改历史数据。

### 5.3 搜索状态

新增 `SearchRunStatusEnum.PARTIAL`：

- 全部平台可用 → `COMPLETED`
- 部分平台不可用 → `PARTIAL`，`errorMessage` 列出未完成平台与错误码
- 全部平台不可用 → `FAILED`

FALLBACK 模式下同一平台只要有一个渠道可用，该平台就算可用。

---

## 6. 前端

- 顶部增加「历史记录」入口。
- 历史列表：关键词、状态、起止日期筛选，分页，显示关键词、系列、平台、时间、状态、商品数与匹配数。
- 历史详情：复用现有结果页与商品卡片，增加「返回历史记录」；**隐藏全部人工复核与人工验证操作**，避免改动历史快照或从历史记录重新触发采集。
- 商品卡片新增：
  - 接口明确返回的券后价（与商品展示价分开显示）。
  - 优惠信息区：类型、名称、金额/折扣、门槛、SKU、有效期、过期标记。
  - 无优惠时不渲染该区域；超过 2 条折叠。
  - SKU 符合项显示各自的券后价（接口返回时）。
- 抖音、小红书不会出现优惠区，因为后端不会为它们生成优惠数据。

---

## 7. 测试与验证

- 后端单元测试：`npm --prefix backend test`，116 项全部通过；新增 `test/promotions.test.ts` 覆盖优惠解析、券后价、SKU 券、1688 券与活动、文本条目、日期截止与整次搜索状态。
- 数据库迁移：已在 SQLite 实际执行，`migration:show` 显示已应用。
- 历史列表 API：真实历史数据 5 条；关键词、状态筛选、分页均验证通过。
- 历史详情 API：真实历史搜索可读取 4 个平台、50 个商品卡片，无外部请求。
- 前端：历史入口、列表、筛选、详情、返回、只读模式在浏览器中实际操作验证。
- 真实搜索：见第 8 节的实际运行结果。

---

## 8. 实际运行结果

### 8.1 真实优惠采集

| 项目 | 结果 |
|---|---|
| 淘宝搜索 | HTTP 200，5 条结果；无优惠券字段，`discount_type=优惠促销` |
| 淘宝详情 | HTTP 200；52 个 SKU；无券字段 |
| 1688 搜索 | HTTP 200，20 条结果；无优惠字段 |
| 1688 详情 | HTTP 200；`promotions=["满优惠"]`，`promotion_details` 含 `满优惠 / SHOP_PROMOTION / 满168元免运费` |

### 8.2 端到端搜索

真实搜索：关键词“造景贴纸”，平台淘宝 + 1688。

| 项目 | 结果 |
|---|---|
| 搜索状态 | COMPLETED |
| 历史列表商品数 / 匹配数 | 40 / 18 |
| 淘宝 | SUCCESS；13 个匹配 + 7 个待确认；8 条优惠 |
| 1688 | SUCCESS；5 个匹配 + 14 个待确认；3 条优惠 |
| 落库优惠总数 | 11（淘宝 DISCOUNT 8、1688 SHOP_ACTIVITY 2、1688 OTHER 1） |
| 同商品跨搜索 | 淘宝商品 `1040477698714` 在 4 次不同搜索中各有一条候选与观察记录，旧记录未被覆盖 |

历史详情接口与前端页面均能读取该次搜索的商品、SKU、优惠、AI 判断与人工复核结果；历史页无“确认同款/排除/人工验证”操作。

验证点：

- 搜索任务在历史列表出现。
- 商品观察记录与优惠记录可被历史详情读取。
- 同一商品再次搜索生成新观察记录，旧记录不覆盖。
- 部分平台失败时任务标记 `PARTIAL`，成功平台数据保留（单元测试覆盖状态计算）。
- 关键词中的 `%`、`_` 不会变成通配符。

---

## 9. 已知限制与后续建议

1. 当前淘宝接口不返回任何优惠券金额/门槛；详情页只显示 `discount_type` 的类型名。若需要券后价，需要服务商补充字段或改用其他合规数据源。
2. 1688 当前不返回 `coupons` 与 `price_tiers`；解析器已支持，接口返回后可直接保存。
3. 优惠有效期、领取链接、活动范围等字段在真实响应中大多缺失，系统保持为空，不推断。
4. 历史详情展示的是数据库快照；但人工复核会更新同一条 `product_match_results`，因此从**当前搜索页**做的人工修正会反映到该次搜索的历史详情中。历史页本身只读，不会产生新的修改。
5. `SQLITE_PATH` 相对 `process.cwd()` 解析：必须在 `backend` 目录启动服务，否则会创建另一个空数据库。
6. 未实现历史删除、趋势图、降价提醒与统计报表（按需求范围）。

---

## 10. 本次改动文件清单

### 后端新增

```text
backend/src/common/interfaces/promotion.interface.ts
backend/src/common/utils/promotion.util.ts
backend/src/common/utils/run-status.util.ts
backend/src/entities/product-promotion.entity.ts
backend/src/database/data-source.ts
backend/src/database/migrations/20261124000000-add-product-promotions.ts
backend/src/search/dto/search-history-query.dto.ts
backend/src/search/search-history.service.ts
backend/src/search/search-history.controller.ts
backend/test/promotions.test.ts
backend/scripts/inspect-promotions.js
```

### 后端修改

```text
backend/src/common/enums/index.ts                     # PARTIAL、PromotionTypeEnum、COUPON_PRICE
backend/src/common/interfaces/normalized-product.interface.ts
backend/src/common/interfaces/price.interface.ts      # SkuOption.couponPrice/couponText
backend/src/entities/index.ts
backend/src/entities/product-observation.entity.ts    # coupon_price_data + promotions 关系
backend/src/database/typeorm.config.ts                # 注册实体与迁移
backend/src/providers/everyinfra/mappers/mapper.util.ts
backend/src/providers/everyinfra/mappers/taobao.mapper.ts
backend/src/providers/everyinfra/mappers/alibaba1688.mapper.ts
backend/src/search/candidate-aggregation.service.ts   # 优惠落库与错误记录
backend/src/search/dto/search-response.mapper.ts      # 优惠 DTO 与去重
backend/src/search/search-orchestrator.service.ts     # 整次搜索状态
backend/src/search/search.module.ts
backend/src/search/search.service.ts                  # 加载优惠关系
backend/package.json                                  # 迁移与核对脚本
```

### 前端新增

```text
frontend/src/app/components/search-history/search-history.component.ts
frontend/src/app/components/search-history/search-history.component.html
frontend/src/app/components/search-history/search-history.component.less
```

### 前端修改

```text
frontend/src/app/app.ts / app.html / app.less
frontend/src/app/components/product-card/*            # 优惠区、券后价、只读模式
frontend/src/app/components/platform-panel/*          # 只读透传
frontend/src/app/core/models.ts / labels.ts / api.service.ts
```

### 文档与配置

```text
README.md
.env.example                                          # DB_MIGRATIONS_RUN
docs/phase7-promotions-history.md
.claude/launch.json                                   # 本机预览用 backend 启动项
```

### 数据库

- `product_promotions`（新增表）
- `product_observations.coupon_price_data`（新增可空列）
- `migrations`（TypeORM 迁移记录表）
