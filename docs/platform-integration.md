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

### 3.1 采集方式

抖音使用 Playwright 打开正常网页搜索：

```text
https://www.douyin.com/search/{关键词}?type=goods
```

若商品 Tab 未出现商品卡片，会回退到 `type=general` 再尝试一次。不会调用抖店商家商品管理 API 冒充全站搜索。

### 3.2 登录

首次使用前：

```powershell
npm run browser:login -- douyin
```

- 打开 **可见** Chromium，用户自行扫码/账号登录。
- 登录态保存在 `backend/.auth/douyin/`（持久化用户目录），后续自动复用。
- 该目录已加入 `.gitignore`，绝不能提交。

也可以通过 `BROWSER_USER_DATA_DIR` 修改目录。

### 3.3 解析策略

- 等待页面渲染后扫描 `a[href]`，只保留指向商品详情的链接：
  - `haohuo.jinritemai.com`
  - `douyin.com/goods/`
  - `douyin.com/product/`
  - 包含 `item2` 的链接
- 标题取链接的 `title` 或文本；价格从卡片文本中提取：
  - 单个 `¥` 金额：作为页面展示价（`LISTING`），注明未确认具体 SKU。
  - 带“起”的金额：作为起售价（`LOWEST_SKU`），展示“¥x 起”。
  - 区间价（如 `¥5-¥10`）：不取平均值或最低值，`amount = null`，展示区间并注明无法确认具体 SKU。
  - “券后 / 到手价 / 折后 / 活动价”等：不当作普通现价，`amount = null`、`priceType = UNKNOWN`，仅在说明中保留页面可见金额。
- 图片取卡片内 `img` 的 `currentSrc/src`。
- 同一链接去重，最多返回搜索限制内的数量。

这是 **实验性 DOM 解析**：抖音页面结构、登录门槛和风控策略会变化。页面结构变化时返回 `PARSE_FAILED`，不会编造商品。

### 3.4 错误分类

| 情况 | 结果 |
|---|---|
| 未登录 / 出现登录提示 | `BLOCKED`，`LOGIN_REQUIRED` |
| 出现验证码/安全验证/访问异常 | `BLOCKED`，`BLOCKED_BY_PLATFORM` |
| 页面明确显示暂无相关结果 | `EMPTY` |
| 页面可访问但没有可识别商品卡片，也没有明确无结果提示 | `FAILED`，`PARSE_FAILED` |
| Chromium 未安装 | `NOT_CONFIGURED`，提示运行 `npm run playwright:install` |
| 浏览器通道关闭 | `NOT_CONFIGURED` |

### 3.5 限制

- 不自动破解验证码、不绕过登录、不使用无限重试或代理轮换。
- 当前只提取列表页可见信息，没有进入商品详情页解析 SKU；SKU 未知时 AI 返回 `UNCERTAIN`。
- 抖音网页端商品搜索可能需要登录，实际可用性以账号与页面为准。

---

## 4. 小红书

### 4.1 采集方式

```text
https://www.xiaohongshu.com/search_result?keyword={关键词}&source=web_search_result_notes&type=51
```

使用 Playwright 正常网页访问；不把开放平台授权接口当作全站搜索入口。

### 4.2 登录

```powershell
npm run browser:login -- xiaohongshu
```

登录态保存在 `backend/.auth/xiaohongshu/`。

### 4.3 解析策略

- 扫描页面链接：
  - 商品相关：链接中包含 `goods` / `item` / `product`，且域名属于 `xiaohongshu.com` / `xhslink.com`。
  - 笔记链接（`/explore/`、`/discovery_item/`、`/discovery/item/`）只计数，不作为商品。
- 如果只找到笔记、没有商品链接：返回 `FAILED` / `PARSE_FAILED`，消息明确指出“只返回了笔记，不能把笔记内容当作商品数据”。
- 如果页面明确显示暂无相关结果：返回 `EMPTY`。
- 如果页面要求登录：`BLOCKED` / `LOGIN_REQUIRED`。
- 如果出现验证码/异常访问：`BLOCKED` / `BLOCKED_BY_PLATFORM`。

### 4.4 限制

- 小红书搜索结果大量是笔记，商品卡片可能不出现或需要登录/特定入口；当前不会伪造商品。
- 标题、图片、价格均为页面可见文本；SKU 无法确认时 AI 返回 `UNCERTAIN`。
- 当前未进入商品详情页解析 SKU。

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

`PRODUCT_DATA_API_KEY` 与 `PRODUCT_DATA_API_BASE_URL` 已预留，但当前 **没有实现** 任何第三方 Adapter。不要用环境变量伪装“已接入”；如后续接入，必须：

- 使用合规服务与合法数据来源。
- 记录 `sourceType = third_party`。
- 保留原始响应（脱敏）与采集时间。
- 不绕过平台访问限制。

---

## 7. 合规边界

本项目明确不做：

- 破解验证码、绕过登录或风控。
- 伪造设备信息规避风控。
- 无休止重试、代理轮换绕过限制。
- 自动下单、支付、提交订单。
- 大规模抓取。

请不要把本项目用于违反平台条款或法律法规的用途。
