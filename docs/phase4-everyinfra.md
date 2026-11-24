# Phase 4：EveryInfra 四平台接入（淘宝 / 抖音 / 小红书 / 1688）

版本：v1.1  
状态：**代码、Mock 测试、四平台真实搜索/详情与 1688 图搜单接口验证已完成**；应用端到端尚未真实验证。验证过程未充值、未重复调用成功请求，也未输出真实 Key。

---

## 1. 本阶段做了什么

- 新增统一 `EveryInfraClient`：所有平台共用 `POST https://api.everyinfra.com/api/v1/social`、同一把 Bearer Key、统一超时/错误/billing/请求 ID 处理。
- 新增四个平台 Provider：淘宝、抖音、小红书、1688。
- 1688 作为独立平台 `alibaba1688`，新增独立 Tab 与「批发采购」展示，不伪装成淘宝或拼多多。
- 保留全部旧渠道：淘宝客、多多进宝、Qovia、OKData、Playwright，以及全部旧配置与数据。
- 新增数据源选择模式、费用控制、详情补充、billing 记录与用量接口。
- 未修改 DeepSeek 商品识别 Prompt v2 与 Phase 3.5 人工验证逻辑。

### 接口映射（严格按官方文档，不得改动）

| 平台 | platform | action | 用途 |
|---|---|---|---|
| 淘宝 | `taobao` | `search` | 商品搜索 |
| 淘宝 | `taobao` | `product_detail` | 商品详情 |
| 抖音 | `douyin` | `product_search` | 商品搜索 |
| 抖音 | `douyin` | `product_detail` | 商品详情 |
| 小红书 | `xiaohongshu` | `product_search` | 商城商品搜索 |
| 小红书 | `xiaohongshu` | `product_detail` | 商品详情 |
| 1688 | `alibaba1688` | `search` | 货源搜索 |
| 1688 | `alibaba1688` | `product_detail` | 商品详情 |
| 1688 | `alibaba1688` | `image_search` | 图片搜索（默认关闭） |

---

## 2. 代码修改文件清单

### 新增

```text
backend/src/providers/everyinfra/
  everyinfra.config.ts            # Key / Base URL / 平台开关 / 分页 / 详情 / 图搜限制
  everyinfra.types.ts             # platform/action、响应、billing 类型
  everyinfra.client.ts            # 统一 POST、认证、超时、错误分类、响应解析、日志
  everyinfra-error.ts             # HTTP/业务错误 -> 稳定错误码
  everyinfra.usage.service.ts     # 调用次数、billing、请求 ID 内存用量统计
  everyinfra-provider.base.ts     # Provider 公共搜索/详情/费用累计逻辑
  mappers/mapper.util.ts
  mappers/taobao.mapper.ts
  mappers/douyin.mapper.ts
  mappers/xiaohongshu.mapper.ts
  mappers/alibaba1688.mapper.ts

backend/src/providers/taobao/taobao-everyinfra.provider.ts
backend/src/providers/douyin/douyin-everyinfra.provider.ts
backend/src/providers/xiaohongshu/xiaohongshu-everyinfra.provider.ts
backend/src/providers/alibaba1688/alibaba1688-everyinfra.provider.ts

backend/src/common/interfaces/wholesale-price.interface.ts
backend/src/common/utils/source-mode.util.ts
backend/test/everyinfra.test.ts
docs/migrations/phase4-everyinfra.sql
docs/phase4-everyinfra.md
```

### 修改

```text
backend/src/common/enums/index.ts                       # alibaba1688、EveryInfra ProviderKey、错误码、模式枚举
backend/src/common/interfaces/normalized-product.interface.ts   # wholesalePrice
backend/src/common/interfaces/provider.interface.ts     # 用量统计、可选 fetchDetail
backend/src/common/platform-channels.ts                 # 新渠道、主数据源、按模式建任务
backend/src/entities/platform-search-task.entity.ts     # api_request_count / charged_usd / last_request_id
backend/src/entities/product-candidate.entity.ts        # wholesale_price_data
backend/src/entities/product-observation.entity.ts      # wholesale_price_data
backend/src/providers/provider-registry.service.ts      # 注册四个新 Provider
backend/src/providers/providers.module.ts
backend/src/search/search.service.ts                    # 按模式建任务、用量接口、1688 图搜入口
backend/src/search/search-orchestrator.service.ts       # FALLBACK、用量落库、HIGH 候选详情补充
backend/src/search/dto/search-response.mapper.ts        # alibaba1688、批发价、渠道用量
backend/src/search/search.controller.ts                 # 用量与图搜接口
backend/package.json                                    # 测试脚本加入 everyinfra.test.ts
frontend/src/app/core/models.ts                         # alibaba1688、WholesalePriceInfo、渠道用量
frontend/src/app/core/labels.ts                         # 平台/渠道/错误码标签
frontend/src/app/components/product-card/*              # 批发采购标识与独立价格块
frontend/src/app/components/platform-panel/*            # 1688 色调、渠道 API 用量
frontend/src/app/app.html                               # 五平台文案
.env.example
```

---

## 3. 新增 Provider 说明

| Provider | 平台 | 搜索 action | 详情 action | 备注 |
|---|---|---|---|---|
| `TaobaoEveryInfraProvider` | 淘宝 | `search` | `product_detail` | 价格区分页面现价/划线价；搜索与详情价格分开保存 |
| `DouyinEveryInfraProvider` | 抖音 | `product_search` | `product_detail` | 只请求第一页，按实际返回数量入库（实现上限 50）；`price_cny` 与 `price_label` 一起保存；`promotion_id` 不当作商品 ID |
| `XiaohongshuEveryInfraProvider` | 小红书 | `product_search` | `product_detail` | 只收商城商品，笔记直接丢弃；币种为 null 时显示「币种未知」 |
| `Alibaba1688EveryInfraProvider` | 1688 | `search` | `product_detail` | 独立批发价；`image_search` 默认关闭，只接受公网 HTTPS 图片 |

所有 Provider 实现现有 `PlatformProvider` 接口。API Key 为空或平台开关关闭时：

- `isConfigured()` 返回 `false`；
- 搜索抛出 `NotConfiguredError`，任务状态为 `NOT_CONFIGURED`；
- 不会发送请求，也不会生成任何模拟商品。

---

## 4. 1688 数据结构说明

1688 的价格与零售平台分开保存。`NormalizedProduct.wholesalePrice`：

```ts
interface WholesalePriceInfo {
  priceMin: number | null;          // 接口未返回则为 null
  priceMax: number | null;
  currency: string | null;          // 未返回则为 null，不假设人民币
  unit: string | null;              // 计价单位，例如“件”
  minOrderQuantity: number | null;  // MOQ
  priceTiers: Array<{               // 阶梯价，按 minQuantity 升序
    minQuantity: number;
    price: number;
  }>;
  note?: string | null;             // 订单数/复购率/缺货/一件代发等接口事实
}
```

数据库：

- `product_candidates.wholesale_price_data`
- `product_observations.wholesale_price_data`

规则：

1. 1688 的通用零售 `price` 保持为空，不把批发价写进零售价字段。
2. 1688 不参与淘宝/抖音/小红书的零售价格排名。
3. `price_tiers[].min_quantity` 是采购数量门槛，不能当作单件价。
4. MOQ、单位、阶梯价、币种缺失时显示「未知」，不自行推算。
5. 同一商品的不同来源、不同 SKU、不同阶梯价分别保留在观察记录与批发价结构中。
6. 图搜返回的 `rank` 只是本次结果顺序，不是销量排名。

真实接口补充（2026-11-24）：1688 `product_detail` **没有返回 `price_tiers`**。实际返回的是 `skus[]`（每个 SKU 的名称、价格、库存）和 `mix_wholesale`（如满 ¥99、1 款起）以及独立运费。系统不会把 SKU 单价或混批门槛伪造成阶梯价；`price_tiers` 为空时前端显示“未知”，采购条件写入批发价 `note`。

前端 1688 卡片展示：商品图、标题、供应商、链接、价格范围、MOQ、计价单位、SKU 规格、阶梯价、采集来源、采集时间，并有「批发采购 · 非零售价」标识与免责说明。

---

## 5. 环境变量填写说明

完整示例见仓库根目录 `.env.example`。最少只需填写：

```env
EVERYINFRA_API_KEY=你自己的真实Key
EVERYINFRA_BASE_URL=https://api.everyinfra.com
EVERYINFRA_ENABLED=true
```

常用控制项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `DATA_SOURCE_MODE` | `PRIMARY` | `PRIMARY` 只用主数据源；`PARALLEL` 所有渠道并行；`FALLBACK` 主源失败后按顺序换源 |
| `EVERYINFRA_TAOBAO_ENABLED` 等 | `true` | 单个平台开关；关闭后不发请求 |
| `EVERYINFRA_TAOBAO_MAX_PAGES` | `1` | 淘宝分页，第一版只请求第一页 |
| `EVERYINFRA_XIAOHONGSHU_MAX_PAGES` | `1` | 小红书分页 |
| `EVERYINFRA_ALIBABA1688_MAX_RESULTS` | `20` | 1688 单次条数（接口最多 100） |
| `EVERYINFRA_DETAIL_ENABLED` | `true` | 是否自动补充详情 |
| `EVERYINFRA_DETAIL_MAX_PER_PLATFORM` | `3` | 每平台每轮最多详情数，代码硬上限 3 |
| `EVERYINFRA_1688_IMAGE_SEARCH_ENABLED` | `false` | 1688 图搜开关，默认关闭 |

抖音/小红书按接口实际返回数量入库，不受 `SEARCH_MAX_RESULTS_PER_PLATFORM` 截断；代码实现上限为 50 条/平台。淘宝单页最多 20 条，1688 默认 20 条。

旧变量全部保留：`TAOBAO_APP_KEY/SECRET/ADZONE_ID`、`PDD_*`、`QOVIA_API_KEY`、`OKDATA_API_KEY`、Playwright 配置等。**不要把真实 Key 写入 `.env.example` 或提交到 Git。**

`DATA_SOURCE_MODE` 说明：

- `PRIMARY`（默认）：淘宝/抖音/小红书/1688 只调用 EveryInfra，拼多多调用多多进宝。
- `PARALLEL`：EveryInfra 与 Qovia/OKData/Playwright/淘宝客等全部执行，便于对照；费用更高。
- `FALLBACK`：EveryInfra 未配置或失败时，按渠道顺序尝试旧来源；每个备用渠道最多一次，余额不足/明确拒绝不会无限重试。

EveryInfra 尚未配置 Key 时，`PRIMARY` 模式下相关平台会明确显示 `NOT_CONFIGURED`。如果希望先继续使用旧渠道，可设为 `FALLBACK`。

---

## 6. EveryInfra API Key 获取教程

1. **注册登录**：访问 <https://everyinfra.com/app>，用自己的账号进入控制台。
2. **创建统一 API Key**：进入 `API Keys`，创建一把新 Key。四个平台共用这一把 Key，不需要创建四把。完整 Key 只显示一次，请立即安全保存。
3. **检查权限**：确认该 Key 具有调用 EveryData 数据接口的权限；如果启用了产品限制，不要误禁用数据接口。不需要账户管理、付款或 Key 写入权限。
4. **领取免费额度**：见下一节。
5. **填写环境变量**：把 Key 填入本地 `.env` 的 `EVERYINFRA_API_KEY=`。该文件已被 `.gitignore` 忽略。
6. **验证余额**：

   ```powershell
   curl.exe -s -H "Authorization: Bearer 你的KEY" https://api.everyinfra.com/api/v1/account
   ```

   该接口用于查询余额/用量，不产生数据采集费用（以官方文档为准）。

7. **先做单接口测试**：见第 8 节。不要一上来就跑四平台完整搜索。

> 不要把真实 Key 发到聊天窗口、截图或提交 GitHub。若 Key 泄露，请在控制台立即吊销并重建。

## 7. 免费额度领取教程

EveryInfra 官方文档当前提供的领取方式：

1. 给以下两个仓库点 Star：
   - <https://github.com/everyinfra/everyinfra-agent-plugins>
   - <https://github.com/everyinfra/seo-skills>
2. 回到 EveryInfra 控制台的「余额与充值」页面，按当前提示领取 $1 免费额度。
3. 注意：该额度是限时赠送额度，领取后 24 小时内有效，不是永久余额。领取规则以控制台/官方文档当前说明为准。

本项目不会自动领取、不会自动充值，也不会替用户调用任何收费接口。

---

## 8. 预计费用与首次单接口测试步骤

### 8.1 预计费用（公开标价参考，实际以 EveryInfra 当前文档与 billing 为准）

| 平台 | 搜索单价 | 详情单价 | 单平台一轮（搜索 + 最多 3 详情） |
|---|---:|---:|---:|
| 淘宝 | $0.0135 | $0.0045 | $0.0270 |
| 抖音 | $0.008 | $0.008 | $0.0320 |
| 小红书 | $0.005556 | $0.005556 | $0.022224 |
| 1688 | $0.00278 | $0.00244 | $0.01011 |
| 1688 图搜 | $0.00556/次 | — | 默认关闭，仅手动触发 |

- 只搜索、不补详情：四个 EveryInfra 平台合计约 **$0.0298 / 次**。
- 每平台补满 3 个详情：四个平台合计约 **$0.0913 / 次**（以上方单价计算）。
- 费用通过 `EVERYINFRA_DETAIL_ENABLED=false` 或调小 `EVERYINFRA_DETAIL_MAX_PER_PLATFORM` 控制。
- 用量查看：`GET /api/providers/everyinfra/usage`（内存统计，服务重启清零）；每个渠道任务也保存 `api_request_count`、`charged_usd`、`last_request_id`。

### 8.2 首次测试顺序（必须逐个平台验证）

建议顺序：**1688 search → 小红书 product_search → 抖音 product_search → 淘宝 search → 各平台 product_detail**。每次只发一个关键词。

```powershell
curl.exe -s -X POST "https://api.everyinfra.com/api/v1/social" ^
  -H "Authorization: Bearer 你的KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"platform\":\"alibaba1688\",\"action\":\"search\",\"params\":{\"keyword\":\"造景贴纸\"}}"
```

```powershell
curl.exe -s -X POST "https://api.everyinfra.com/api/v1/social" ^
  -H "Authorization: Bearer 你的KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"platform\":\"xiaohongshu\",\"action\":\"product_search\",\"params\":{\"keyword\":\"造景贴纸\"}}"
```

```powershell
curl.exe -s -X POST "https://api.everyinfra.com/api/v1/social" ^
  -H "Authorization: Bearer 你的KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"platform\":\"douyin\",\"action\":\"product_search\",\"params\":{\"keyword\":\"造景贴纸\"}}"
```

```powershell
curl.exe -s -X POST "https://api.everyinfra.com/api/v1/social" ^
  -H "Authorization: Bearer 你的KEY" ^
  -H "Content-Type: application/json" ^
  -d "{\"platform\":\"taobao\",\"action\":\"search\",\"params\":{\"keyword\":\"造景贴纸\",\"page\":1,\"limit\":20,\"sort\":\"relevance\"}}"
```

每个响应检查：

1. `platform` 与 `action` 是否与请求一致；
2. 是否有真实 `results` / `data`，商品标题、链接、图片是否真实；
3. `billing` 是否存在、扣费是否合理、`balance_after_usd` 是否变化；
4. 是否返回请求 ID（响应顶层 `id` 或 `x-request-id`，用于与服务商对账）；
5. HTTP 200 也可能包含业务错误，必须检查错误字段，不能只看状态码。

> Windows 命令行直接 `-d` 传中文可能被本地编码破坏，导致 HTTP 400 `There was an error parsing the body`。请把 JSON 保存为 UTF-8 文件，再用 `curl --data-binary @body.json` 发送；也可在应用内调用，后端统一按 UTF-8 发送。

单接口验证通过后，再在 `.env` 中填写 Key 并启动后端，做完整搜索。四条 `product_detail` 已于 2026-11-24 真实验证，请求参数如下（每次一个商品）：

| 平台 | action | params |
|---|---|---|
| 1688 | `product_detail` | `{"url":"https://detail.1688.com/offer/商品ID.html"}` |
| 抖音 | `product_detail` | `{"product_id":"商品ID"}` |
| 小红书 | `product_detail` | `{"product_id":"24位商品ID"}` |
| 淘宝 | `product_detail` | `{"url":"商品链接或商品数字ID"}` |

> `product_detail` 的 `results` 是**单个对象**，不是数组；客户端已兼容该结构。

1688 图搜（确认余额与费用后再手动开启）：

```powershell
curl.exe -s -X POST "http://localhost:3000/api/providers/everyinfra/alibaba1688/image-search" ^
  -H "Content-Type: application/json" ^
  -d "{\"imageUrl\":\"https://公网可访问的图片地址.jpg\"}"
```

只有在 `.env` 设置 `EVERYINFRA_1688_IMAGE_SEARCH_ENABLED=true` 后才会真正请求；本地文件路径会被拒绝。

---

## 9. 错误与安全边界

- `EVERYINFRA_AUTH_ERROR`：Key 无效或无权限。
- `EVERYINFRA_INSUFFICIENT_BALANCE`：余额/额度不足，不重试。
- `EVERYINFRA_RATE_LIMITED`：请求过于频繁，不无限重试。
- `EVERYINFRA_TIMEOUT`：超时。
- `EVERYINFRA_API_ERROR` / `EVERYINFRA_BAD_RESPONSE`：业务错误或无法解析的响应。
- `NOT_CONFIGURED`：没有 Key、总开关关闭或平台开关关闭。
- 详情补充失败只写入任务备注，不改变原搜索结果。
- 未启用的 Provider 不会被调用；未启用的平台不会出现在请求中。
- 原始响应保存在 `rawData`，敏感字段由既有 `sanitizeRawData` 处理。

---

## 10. 验证状态（2026-11-24）

### 10.1 已完成

- 后端 `npm run build`、前端 `npm run build` 通过。
- 后端测试 82 项通过，其中 EveryInfra 27 项；这些测试全部使用 **Mock HTTP**，不是真实 API 测试。
- 使用用户自己的 Key 完成初始账户查询、四平台搜索、四平台详情、1688 图搜与结束后账户查询；未充值、未重复调用已成功的请求。
- 初始余额 $1.00（赠送额度，paid $0.00），最终余额 **$0.944111**。
- 账户 `usage_24h.spent_usd` = **$0.055889**；搜索 $0.029834 + 详情 $0.020500 + 图搜 $0.005556（billing 舍入差异）。
- 已用保存的真实响应离线回放搜索与详情 mapper（不再产生请求）。

**搜索（关键词“造景贴纸”）**

| 平台 | HTTP | 条数 | 首条真实商品 | 扣费 | 验证后余额 | 请求 ID |
|---|---:|---:|---|---:|---:|---|
| 1688 `search` | 200 | 20 | 提拉多微缩场景合集本9.0造景贴纸… | $0.002778 | $0.997222 | `req_00e9ca0a743e41f0` |
| 小红书 `product_search` | 200 | 20 | 妍莜·20.0霓虹雪夜…造景贴纸 | $0.005556 | $0.991667 | `req_9ff72c5dbe594613` |
| 抖音 `product_search` | 200 | 30 | Tripaw三脚喵32.0蔓 原创造景贴纸 | $0.008000 | $0.983667 | `req_9291b3e7d5e1475b` |
| 淘宝 `search` | 200 | 20 | 森游39.0花园系列造景贴纸… | $0.013500 | $0.970167 | `req_dca056c8eb7249f8` |

**详情（各取上述首条商品）**

| 平台 | HTTP | 关键真实字段 | 扣费 | 验证后余额 | 请求 ID |
|---|---:|---|---:|---:|---|
| 1688 `product_detail` | 200 | ¥14.40–¥18.80 / 件；MOQ 1；5 个 SKU；库存 19596；混批满 ¥99、1 款起；运费 ¥3 | $0.002444 | $0.967722 | `req_f906722d3b8946ec` |
| 小红书 `product_detail` | 200 | ¥13.90 CNY；有货；销量；`variant_name`；主图 + 详情图；店铺 | $0.005556 | $0.962167 | `req_b1696c1998e4454b` |
| 抖音 `product_detail` | 200 | `price_cny=18.80`；折扣字段 10.80；7 个款式；12 主图 / 18 详情图；免运费 | $0.008000 | $0.954167 | `req_872b16e8f9704343` |
| 淘宝 `product_detail` | 200 | ¥16.80；店铺；3 个 SKU（16.80–32.80）；库存 600；`price_basis=page` | $0.004500 | $0.949667 | `req_23da308d5ac34c57` |

**1688 图搜（公网 HTTPS 图片）**

| 接口 | HTTP | 候选数 | 关键结果 | 扣费 | 验证后余额 | 请求 ID |
|---|---:|---:|---|---:|---:|---|
| `alibaba1688 / image_search` | 200 | 5 | 第 5 个即图片中的“妍莜21.0小镇一角…”；返回 id/url/title/price/currency/order_count/supplier_name/image_url/rank | $0.005556 | $0.944111 | `req_885dd649467c4fb6` |

图片 URL 在调用前已确认公网可读：HTTP 200、`Content-Type: image/webp`、226324 字节。图搜结果只有 1 个 `price` 字段，**没有 MOQ、计价单位、地址区间或 `price_tiers`**；`rank` 只是本次结果顺序，不是销量排名。Provider 路径用该真实响应离线回放：5/5 映射成功，usage 记录 1 次调用、$0.005556、上述请求 ID。

真实响应核对结果：

- 搜索响应包含 `platform`、`action`、`results`、`count`、`billing`、`quota`；请求 ID 在 `x-request-id` 与顶层 `id`（`req_...`）。
- 详情响应的 `results` 是**单个商品对象**，不是数组；客户端已兼容并增加测试。
- 1688 详情没有 `price_tiers`，但返回 `skus[]`、`mix_wholesale`、`shipping`、`stock`、`sold_count`；系统不把 SKU 价或混批门槛当阶梯价。
- 小红书详情返回 `variant_name`、`image_urls`、`detail_image_urls`、`in_stock`、`sold_count`；未混入笔记。
- 抖音详情没有商品链接字段，使用 `product_id` 生成平台标准链接；`discount_price_cny` 只写入备注，不直接当作结算价。
- 淘宝详情 `price_basis` 是机器值 `page`，已转换为“页面现价（page）”；详情包含店铺、SKU、库存、主图与详情图。
- 1688 搜索价（16.80 起）与详情区间（14.40–18.80）不按字段拼接：详情批发价整体覆盖候选展示值，搜索与详情两条观察记录各自保留；`mergeWholesale` 有专门测试防止跨请求拼出虚假区间。
- 1688 图搜返回最多 5 个候选，字段为 `id/url/title/price/currency/order_count/supplier_name/image_url/rank`；没有 MOQ、单位、价格区间、阶梯价与完整 SKU。图搜结果应再调用 `product_detail` 确认采购条件，不能直接当作货架价格。
- 图搜只接受公网 HTTPS 图片；本地文件路径会被拒绝，系统不提供用户图片的公开托管。
- 原价与现价相等时不再显示划线价。

### 10.2 仍未完成

- 未通过应用完整链路（搜索任务 → 去重 → DeepSeek 识别 → 数据库 → 前端）跑真实数据；单接口、Mapper 回放与组件预览已通过。
- 1688 图搜虽已通过直连 API 验证，但应用内仍受 `EVERYINFRA_1688_IMAGE_SEARCH_ENABLED=false` 限制，需显式开启并重启后端后才能通过应用接口调用。
- 运行在 3000 端口的主服务仍是旧代码；需要按原方式重启后才会加载本阶段代码。
- 分页第二页未验证，当前默认只请求第一页。
- 1688 阶梯价：接口当前未返回 `price_tiers`；如果后续返回，mapper 已支持 `min_quantity/price` 结构。
- 真实响应字段仍可能变化；mapper 已保留完整 `rawData`，出现差异时应以真实响应为准修正。
