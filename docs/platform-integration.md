# 平台接入与采集说明

本文说明四个平台在当前版本中的接入方式、字段口径、错误分类与限制。平台接口和页面会变化，实际接入时应以对应平台的 **最新官方文档** 为准。

采集优先级：

1. 官方开放 API。
2. Playwright 正常网页访问。
3. 合规的第三方数据服务（预留，当前未实现）。

任何平台无法配置或采集失败时，接口会返回明确状态，不使用模拟数据。

---

## 1. 淘宝

### 1.1 接口

- **API**：`taobao.tbk.dg.material.optional`（淘宝客推广者物料搜索）
- **文档**：<https://developer.alibaba.com/docs/api.htm?apiId=35896>
- **网关**：`https://eco.taobao.com/router/rest`（可通过 `TAOBAO_GATEWAY_URL` 覆盖）

### 1.2 必需配置

| 变量 | 说明 |
|---|---|
| `TAOBAO_APP_KEY` | 淘宝开放平台应用 AppKey |
| `TAOBAO_APP_SECRET` | 应用 AppSecret |
| `TAOBAO_ADZONE_ID` | 淘宝客推广位 ID（该接口必需） |

需要在淘宝开放平台创建应用，并确认应用具备淘宝客物料搜索接口权限。接口权限、推广位与账号资质由平台审核决定。

### 1.3 签名与请求

- 公共参数：`method`、`app_key`、`timestamp`、`format=json`、`v=2.0`、`sign_method=md5`。
- 业务参数：`q`（关键词）、`adzone_id`、`page_no`、`page_size`。
- 签名：将除 `sign` 外的非空参数按 key 字典序拼接为 `key+value`，计算 `MD5(secret + 拼接串 + secret)`，转大写。
- `timestamp` 使用 GMT+8 的 `yyyy-MM-dd HH:mm:ss`。
- 请求通过表单 POST 发送。

### 1.4 字段映射

| 平台字段 | 内部字段 | 说明 |
|---|---|---|
| `item_id` | `platformProductId` | 商品 ID |
| `title` / `item_basic_info.title` | `title` | 标题 |
| `pict_url`、`small_images.string[]` | `imageUrls` | 图片 |
| `item_url`（否则用商品 ID 生成规范链接） | `productUrl` | 原始商品链接 |
| `shop_title` | `shopName` | 店铺 |
| `zk_final_price` | `price.amount` | 当前展示价；解析失败为 `null` |
| `coupon_amount`、`reserve_price` 等 | `rawData` | 仅保存用于排查，不主动计算券后价 |

- `priceType` 使用 `LISTING`：接口没有返回可确认的目标 SKU。
- 优惠券金额不会从现价中扣除。
- 接口通常不返回 SKU 详情，因此 AI 倾向于返回 `UNCERTAIN`；这是预期行为，不应强行视为单款匹配。

### 1.5 限制

- 搜索范围是 **淘宝客推广商品**，不是淘宝全站商品；搜索不到不代表平台没有该商品。
- 需要应用权限；错误会以 `TAOBAO_API_ERROR` 返回，信息中包含平台错误码与说明。
- 当前没有接入 Playwright 作为淘宝补充采集；后续可作为 fallback。

---

## 2. 拼多多

### 2.1 接口

- **API**：`pdd.ddk.goods.search`（多多进宝商品搜索）
- **文档**：<https://open.pinduoduo.com/application/document/api?id=pdd.ddk.goods.search>
- **网关**：`https://gw-api.pinduoduo.com/api/router`（可通过 `PDD_GATEWAY_URL` 覆盖）

### 2.2 必需配置

| 变量 | 说明 |
|---|---|
| `PDD_CLIENT_ID` | 应用 client_id |
| `PDD_CLIENT_SECRET` | 应用 client_secret |
| `PDD_ACCESS_TOKEN` | 可选；若账号/接口需要则填写 |

### 2.3 签名与请求

- 公共参数：`type=pdd.ddk.goods.search`、`client_id`、`timestamp`（秒）、`data_type=JSON`。
- 业务参数：`keyword`、`page`、`page_size`、`sort_type`。
- 签名：参数（除 `sign`）按 key 字典序拼接为 `key+value`，计算 `MD5(secret + 拼接串 + secret)`，转大写。
- 请求通过表单 POST 发送。

### 2.4 字段与价格

| 平台字段 | 内部字段 | 说明 |
|---|---|---|
| `goods_id` | `platformProductId` | 商品 ID |
| `goods_name` | `title` | 标题 |
| `goods_image_url` / `goods_thumbnail_url` | `imageUrls` | 图片 |
| `goods_url`（若返回）或由 `goods_id` 生成 `mobile.yangkeduo.com/goods.html?goods_id=` | `productUrl` | 商品链接 |
| `mall_name` | `shopName` | 店铺 |
| `goods_desc` | `description` | 描述 |
| `min_normal_price`（分） | `price.amount` | 单买价（最低 SKU），除以 100 |
| `min_group_price`（分） | `groupPrice.amount` | 拼团价，单独保存 |

价格规则：

- 默认主价格使用 **单买价**；显示为“¥x 起”，`priceType = LOWEST_SKU`，并注明 SKU 未确认。
- 拼团价单独显示为“拼团 ¥x（需拼团）”，不能当作普通单买价。
- 若只返回拼团价，主价格 `amount = null`，并说明“接口未返回单买价”。
- 优惠券信息保留在 `rawData`，不主动计算券后价。

### 2.5 限制

- 多多进宝商品体系，不代表拼多多全站商品。
- 接口不返回可确认的目标 SKU 时，AI 会返回 `UNCERTAIN`。
- 需要应用权限；错误以 `PDD_API_ERROR` 返回。

---

## 3. 抖音

抖音同时使用两个独立渠道：

1. **Qovia 第三方商品搜索 API**（`qovia`）。
2. **Playwright 正常网页采集**（`playwright`）。

两个渠道分别创建任务、分别记录状态、耗时、错误；一个失败不会阻止另一个执行。

### 3.1 Qovia 第三方 API

- **Endpoint**：`GET https://api.qovia.ai/v1/raw/douyin/goods_search`
- **认证**：`Authorization: Bearer $QOVIA_API_KEY`
- **参数（仅这三个）**：
  - `keyword`：搜索词，最长 100 字符。
  - `page`：页码，从 1 开始，最大 50，约 30 条/页。
  - `search_id`：第一页省略；后续页传上一页 `extra.search_id`。
- **响应**：`{ request_id, data, meta }`；`data.promotions`、`data.summary_promotions`、`data.has_more`、`data.extra.search_id`；空结果通过 `meta.empty=true` 表示。
- **字段映射**：
  - `product_id` → `platformProductId` / `sourceProductId`。
  - `promotions[].base_info.title` 或 `summary_promotions[].base_model.product_info.name` → 标题。
  - `base_info.detail_url` → 商品链接；缺失时用商品 ID 生成抖音商品详情 URL。
  - `base_info.main_img.url_list` → 图片。
  - `summary_promotions[].base_model.shop_info.shop_name` → 店铺。
  - `price.origin`（分）→ 价格（元）；`price_text`（例如“到手价”）写入价格说明，`priceType = LISTING`，不冒充 SKU 价。
  - `month_sale.origin` → 销量描述；`good_ratio` 保留在原始数据。
- **地区**：Qovia 文档未声明数据地区；观察记录标记“未确认中国大陆可购买性”。
- **费用**：Qovia 文档标价约 $0.02536/次成功调用（Live Beta），失败/空结果不计费；本项目只做低频查询，且不保证额度。
- **稳定性**：接口为 Live Beta，字段可能变化；解析失败时返回 `PARSE_FAILED`，不编造商品。

### 3.2 Playwright 网页采集

抖音使用 Playwright 打开正常网页搜索：

```text
https://www.douyin.com/search/{关键词}?type=goods
```

若商品 Tab 未出现商品卡片，会回退到 `type=general` 再尝试一次。不会调用抖店商家商品管理 API 冒充全站搜索。

首次使用前：

```powershell
npm run browser:login -- douyin
```

- 打开 **可见** Chromium，用户自行扫码/账号登录。
- 登录态保存在 `backend/.auth/douyin/`（持久化用户目录），后续自动复用。
- 该目录已加入 `.gitignore`，绝不能提交。

解析策略：

- 等待页面渲染后扫描 `a[href]`，只保留指向商品详情的链接：`haohuo.jinritemai.com`、`douyin.com/goods/`、`douyin.com/product/`、包含 `item2` 的链接。
- 标题取链接的 `title` 或文本；价格使用统一可见价格解析：
  - 单个 `¥` 金额：`LISTING`，注明未确认具体 SKU。
  - 带“起”：`LOWEST_SKU`，展示“¥x 起”。
  - 区间价：`amount = null`，展示区间，不取平均或最低值。
  - “券后 / 到手价 / 折后 / 活动价”：`amount = null`、`priceType = UNKNOWN`，仅保留页面可见金额说明。
- 图片取卡片内 `img` 的 `currentSrc/src`；同一链接去重。

页面结构变化时返回 `PARSE_FAILED`，不会编造商品。

### 3.3 错误分类

| 情况 | 渠道结果 |
|---|---|
| Qovia Key 未配置 | `NOT_CONFIGURED` |
| Qovia 401 / scope / 余额不足等 | `FAILED`，`QOVIA_API_ERROR` |
| Qovia 响应字段异常 | `FAILED`，`PARSE_FAILED` |
| Playwright 未登录 / 出现登录提示 | `BLOCKED`，`LOGIN_REQUIRED` |
| Playwright 验证码/安全验证/访问异常 | `BLOCKED`，`BLOCKED_BY_PLATFORM` |
| Playwright 页面明确暂无结果 | `EMPTY` |
| Playwright 无商品卡片且无明确空结果提示 | `FAILED`，`PARSE_FAILED` |
| Chromium 未安装 | `NOT_CONFIGURED` |

平台聚合：一个渠道有数据、另一个渠道未配置/为空/失败 → `PARTIAL_SUCCESS`；两个渠道均成功 → `SUCCESS`；均无数据且至少一个失败 → `FAILED`；均无数据且均空 → `EMPTY`；全部未配置 → `NOT_CONFIGURED`。

### 3.4 限制

- 不自动破解验证码、不绕过登录、不使用无限重试或代理轮换。
- 当前 Playwright 只提取列表页可见信息，没有进入详情页解析 SKU；SKU 未知时 AI 返回 `UNCERTAIN`。
- Qovia 数据地区未声明，价格必须人工核对。
- 抖音网页端商品搜索可能需要登录，实际可用性以账号与页面为准。

---

## 4. 小红书

小红书同时使用两个独立渠道：

1. **OKData 小红书商城商品搜索 API**（`okdata`）。
2. **Playwright 正常网页采集**（`playwright`）。

两个渠道分别创建任务、分别记录状态与错误。

### 4.1 OKData 第三方 API

- **Endpoint**：`GET https://api.okdata.online/v1/xiaohongshu/shop/products/search`
- **认证**：`Authorization: Bearer $OKDATA_API_KEY`
- **参数**：
  - `query`：必填，关键词。
  - `cursor`：可选，上一页 `page.next_cursor`。
  - `view`：本项目使用 `standard`，以获取 `original_price` 与 `images`。
  - `fields`：可选，本项目未使用。
- **响应**：`data.items`（约 20 个/页）、`page.next_cursor`、`page.has_more`、`meta`；`code` 必须为 `ok`。
- **商品字段**：`id`、`url`、`title`、`price`（最低规格现价）、`original_price`、`currency`、`sold`、`rating`、`reviews`、`images[]`、`shop{id,name,url}`。
- **映射**：
  - `id` → `platformProductId`；`url` → 商品链接；`shop.name` → 店铺。
  - `price` → 最低规格价格，`priceType = LOWEST_SKU`，注明未确认目标 SKU。
  - `original_price` → 原价字段，保留在观察记录与前端。
  - `currency` 原样保存；为空时标记 `UNKNOWN`，不假定为 CNY。
- **地区限制**：OKData 文档说明其小红书商品详情为 **海外 App 用户视角**，促销可能与大陆用户不同。观察记录设置 `region = overseas_app_view`，并提示“未确认中国大陆可购买性”。
- **费用与稳定性**：约 $0.02/次；接口为 Preview，字段可能变化；解析失败返回 `PARSE_FAILED`。

### 4.2 Playwright 网页采集

```text
https://www.xiaohongshu.com/search_result?keyword={关键词}&source=web_search_result_notes&type=51
```

使用 Playwright 正常网页访问；不把开放平台授权接口当作全站搜索入口。

首次使用前：

```powershell
npm run browser:login -- xiaohongshu
```

登录态保存在 `backend/.auth/xiaohongshu/`。

解析策略：

- 商品相关链接：链接中包含 `goods` / `item` / `product`，且域名属于 `xiaohongshu.com` / `xhslink.com`。
- 笔记链接（`/explore/`、`/discovery_item/`、`/discovery/item/`）只计数，不作为商品。
- 只找到笔记、没有商品链接：`FAILED` / `PARSE_FAILED`，明确提示不能把笔记当作商品。
- 页面明确无结果：`EMPTY`。
- 登录/验证码/异常访问：`BLOCKED`。
- 价格使用统一可见价格解析，不把券后价、区间价或起售价冒充普通现价。

### 4.3 限制与地区

- 小红书搜索结果大量是笔记，商品卡片可能不出现或需要登录/特定入口；不会伪造商品。
- 当前未进入商品详情页解析 SKU；SKU 无法确认时 AI 返回 `UNCERTAIN`。
- 第三方 API 的地区/促销差异必须通过观察记录和前端提示保留，不能把海外视角价格当作大陆默认价格。
- 需要人工核对商品链接、店铺、SKU 与实际购买地区。

---

## 5. 浏览器采集通用机制

- 每个平台独立的持久化用户目录；登录一次后复用。
- 同一进程内使用串行锁，避免同时启动多个浏览器实例。
- 默认 `PLAYWRIGHT_HEADLESS=false`，便于观察和登录；生产/自动化可设为 `true`。
- 域名白名单：`taobao.com`、`tmall.com`、`douyin.com`、`jinritemai.com`、`xiaohongshu.com`、`xhslink.com`、`pinduoduo.com`、`yangkeduo.com`。浏览器模块拒绝访问白名单外地址。
- 页面出现“验证码 / 安全验证 / 访问过于频繁 / 访问异常”等关键词时立即终止本平台采集，交由人工处理。
- 等待与页面结构解析使用有限超时，不无限重试。
- 请求间隔由 `PLATFORM_REQUEST_DELAY_MS` 控制；平台之间顺序执行。

---

## 6. 第三方数据服务

当前已实现：

- **Qovia**：抖音商品搜索（`qovia`），环境变量 `QOVIA_API_KEY`。
- **OKData**：小红书商城商品搜索（`okdata`），环境变量 `OKDATA_API_KEY`。

预留但未实现 Adapter：

- `BAMBOO_API_KEY`（竹简/Bamboo）
- `SOCIALTOAI_API_KEY`（SocialToAI）

接入第三方服务必须：

- 使用合规服务与合法数据来源。
- 记录 `provider` 与 `source = third_party_api`。
- 保存原始响应（脱敏、限制体积）与采集时间。
- 记录服务商声明的地区限制；无法确认中国大陆可购买性时标记为不确定。
- 不绕过平台访问限制。
- 不把第三方返回价格直接当作大陆用户实付价。

### 6.1 配置步骤

Qovia：

1. 在 <https://qovia.ai/console/?tab=keys> 创建 API Key（以 `sk-qovia-` 开头）。
2. 确认 Key 具备 `raw:douyin` 或 `raw:*` scope。
3. 在根目录 `.env` 填入 `QOVIA_API_KEY`；可选修改 `QOVIA_BASE_URL`。
4. 运行 `npm run check:config`，再运行 `npm run check:config -- --live`（会产生约 $0.025 的调用费用）。

OKData：

1. 在 <https://okdata.online/> 创建 API Key（以 `okd_` 开头）。
2. 在根目录 `.env` 填入 `OKDATA_API_KEY`；可选修改 `OKDATA_BASE_URL`。
3. 运行 `npm run check:config`，再运行 `npm run check:config -- --live`（会产生约 $0.02 的调用费用）。

两者都不需要平台账号、Cookie 或扫码登录；但必须遵守服务条款与数据使用限制。`check:config` 不会打印密钥。

---

## 7. 合规边界

本项目明确不做：

- 破解验证码、绕过登录或风控。
- 伪造设备信息规避风控。
- 无休止重试、代理轮换绕过限制。
- 自动下单、支付、提交订单。
- 大规模抓取。

请不要把本项目用于违反平台条款或法律法规的用途。
