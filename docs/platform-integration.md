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
- 接口通常不返回 SKU 详情；v2 不会因此自动判为 `UNCERTAIN`：先按类别、系列与标题判断，目标款式无法确认时才返回 `UNCERTAIN`。

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
- 接口不返回可确认的目标 SKU 时，AI 会结合类别、系列与标题判断；目标款式无法确认时返回 `UNCERTAIN`。
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
- 可用 `--url=<地址>` 直接打开某个搜索/验证页面，例如：
  `npm run browser:login -- douyin --url="https://www.douyin.com/search/米饼贴纸?type=goods"`。

解析策略：

- 等待页面渲染后扫描 `a[href]`，只保留指向商品详情的链接：`haohuo.jinritemai.com`、`douyin.com/goods/`、`douyin.com/product/`、包含 `item2` 的链接。
- 标题取链接的 `title` 或文本；价格使用统一可见价格解析：
  - 单个 `¥` 金额：`LISTING`，注明未确认具体 SKU。
  - 带“起”：`LOWEST_SKU`，展示“¥x 起”。
  - 区间价：`amount = null`，展示区间，不取平均或最低值。
  - “券后 / 到手价 / 折后 / 活动价”：`amount = null`、`priceType = UNKNOWN`，仅保留页面可见金额说明。
- 图片取卡片内 `img` 的 `currentSrc/src`；同一链接去重。

页面结构变化时返回 `PARSE_FAILED`，不会编造商品。

#### 3.2.1 验证码与人工验证恢复

抖音网页搜索可能返回验证码中间页。此时不会自动破解或绕过验证码，也不会把渠道直接判为失败：

1. 自动采集检测到 `CAPTCHA_REQUIRED`（或需要登录的 `LOGIN_REQUIRED`）。
2. 关闭本次自动浏览器上下文（Playwright 无法把运行中的 headless 上下文切换为 headed，因此必须重新启动）。
3. 渠道任务状态改为 `WAITING_MANUAL_VERIFICATION`，整个搜索暂停；已成功的渠道与已采集候选保留。
4. 任务保存 `keyword`、被拦截时的目标 URL、平台 Profile 目录、暂停次数与渠道进度（见 `platform_search_tasks.manual_verification`）。
5. 前端渠道卡片提供“打开验证浏览器”“关闭浏览器”“继续采集”按钮。
6. “打开验证浏览器”启动一个 **独立可见** Chromium（始终 headed，使用同一个持久化 Profile）；用户手动完成平台验证。
7. 点击“继续采集”时，后端先关闭验证浏览器（避免两个进程同时占用同一个用户数据目录），把任务恢复为 `PENDING` 并重新执行该渠道；页面会重新加载并再次检查验证码/登录，**不会假定验证一定成功**。
8. 每次暂停计数一次；超过 `BROWSER_MANUAL_VERIFICATION_MAX_ATTEMPTS`（默认 3）后渠道明确 `FAILED`，错误码保留 `CAPTCHA_REQUIRED`/`LOGIN_REQUIRED`，不做无限重试。
9. 服务进程重启不会把等待中的任务判为失败；重启后需要重新打开验证浏览器（界面会提示）。

接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/searches/:searchId/tasks/:taskId/verification/browser` | 打开独立可见验证浏览器 |
| `DELETE` | `/api/searches/:searchId/tasks/:taskId/verification/browser` | 关闭验证浏览器 |
| `POST` | `/api/searches/:searchId/tasks/:taskId/verification/resume` | 关闭浏览器并继续采集 |

限制：验证浏览器与自动采集共用同一个 Profile，不能同时运行；若 `npm run browser:login` 仍在运行，会返回 `BROWSER_PROFILE_BUSY` 并提示先关闭。

### 3.3 错误分类

| 情况 | 渠道结果 |
|---|---|
| Qovia Key 未配置 | `NOT_CONFIGURED` |
| Qovia 401 / scope / 余额不足等 | `FAILED`，`QOVIA_API_ERROR` |
| Qovia 响应字段异常 | `FAILED`，`PARSE_FAILED` |
| Playwright 未登录 / 出现登录提示 | `WAITING_MANUAL_VERIFICATION`，`LOGIN_REQUIRED`（人工登录后可恢复） |
| Playwright 验证码/人机验证 | `WAITING_MANUAL_VERIFICATION`，`CAPTCHA_REQUIRED`（人工验证后可恢复） |
| 人工验证超过次数上限仍被拦截 | `FAILED`，`CAPTCHA_REQUIRED` / `LOGIN_REQUIRED` |
| Playwright 其他安全限制/访问异常 | `BLOCKED`，`BLOCKED_BY_PLATFORM`（不提供自动恢复） |
| 浏览器用户目录被其他进程占用 | `FAILED`，`BROWSER_PROFILE_BUSY` |
| Playwright 页面明确暂无结果 | `EMPTY` |
| Playwright 无商品卡片且无明确空结果提示 | `FAILED`，`PARSE_FAILED` |
| Chromium 未安装 | `NOT_CONFIGURED` |

平台聚合：任一渠道等待人工验证 → 平台 `WAITING_MANUAL_VERIFICATION`；一个渠道有数据、另一个渠道未配置/为空/失败 → `PARTIAL_SUCCESS`；两个渠道均成功 → `SUCCESS`；均无数据且至少一个失败 → `FAILED`；均无数据且均空 → `EMPTY`；全部未配置 → `NOT_CONFIGURED`。

### 3.4 限制

- 不自动破解验证码、不绕过登录、不使用无限重试或代理轮换。
- 当前 Playwright 只提取列表页可见信息，没有进入详情页解析 SKU；目标款式无法确认时 AI 返回 `UNCERTAIN`。
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

### 4.2 Playwright 网页商品搜索

小红书官方 deeplink 定义为：

```text
xhsdiscover://search/result?keyword={关键词}&target_search=goods
```

浏览器无法唤起原生 App，因此 Playwright 渠道会依次探测网页端可用的商品搜索入口（最多 3 个地址，不无限重试）：

1. `https://www.xiaohongshu.com/search_result?keyword={关键词}&source=web_search_result_notes&type=51`：先打开当前可用的搜索页；如果页面存在“商品”Tab，则点击一次进入商品模式。
2. `https://www.xiaohongshu.com/search_result?keyword={关键词}&target_search=goods`。
3. `https://www.xiaohongshu.com/search_result?keyword={关键词}&type=goods`。

首次使用前：

```powershell
npm run browser:login -- xiaohongshu
```

登录态保存在 `backend/.auth/xiaohongshu/`。遇到验证码/登录拦截时与抖音一致进入 `WAITING_MANUAL_VERIFICATION`，可打开验证浏览器人工处理后继续。

商品与笔记分离：

- 只接受明确的商品详情链接：路径包含 `/goods-detail/`、`/goods/`、`/product/`，或查询参数包含 `goods_id` / `product_id`，且域名属于 `xiaohongshu.com` / `xhslink.com`。
- 笔记链接（`/explore/`、`/discovery_item/`、`/discovery/item/`）只计数，**永远不进入商品集合**，也不会写入候选商品。
- 商品卡片提取：名称（标题/名称节点）、图片（`img.currentSrc/src`）、价格（价格节点可见文本，统一价格解析）、商品链接。
- 只有在确认进入商品搜索模式（URL 含 `target_search=goods`/`type=goods`，或“商品”Tab 处于选中状态）且页面明确无结果时，才返回 `EMPTY`。
- 只有笔记、没有商品入口或无法确认商品模式时，返回 `GOODS_SEARCH_UNAVAILABLE`，而不是 `PARSE_FAILED`，也不会把笔记归类为商品。
- 价格使用统一可见价格解析，不把券后价、区间价或起售价冒充普通现价。

`GET /api/providers/status` 和搜索详情会保留渠道错误码 `GOODS_SEARCH_UNAVAILABLE`；前端会明确提示“网页端无商品搜索入口”。

### 4.3 原生 App / Appium 方案研究（未接入）

如果业务必须使用商城商品搜索，网页端可能不足，需要原生 App。可行性研究结论：

1. **Deep Link**：`adb shell am start -a android.intent.action.VIEW -d "xhsdiscover://search/result?keyword=<关键词>&target_search=goods"` 可直接打开小红书 App 的商品搜索结果页（需已安装 App 并登录）。Playwright/Chromium 无法调用该 scheme。
2. **Android 模拟器**：需要安装小红书 App、登录账号，并保证模拟器网络可访问商城；账号与设备风控可能触发验证码，仍需人工处理。模拟器上的商品页结构与网页不同，不能复用现有 DOM 解析。
3. **Appium 方案**：使用 Appium + UiAutomator2 驱动 `com.xingin.xhs`，通过 resource-id/text 定位商品卡片，读取名称、价格、图片与商品详情入口。适合作为 **独立采集模块**，不应塞进现有 Playwright 模块。
4. **限制与风险**：无官方开放接口、页面与控件 ID 随版本变化、模拟器可能被判定为异常环境、需要账号登录与人工验证、合规与平台条款风险高。当前版本**未接入** Appium，也未内置模拟器控制；代码中不会伪造这一能力。
5. **建议**：优先使用 OKData 商城商品接口；若要自建 App 采集，单独建立 `providers/xiaohongshu-app` 模块和独立任务类型，并沿用“不绕过验证码、不伪造数据、失败明确返回”的原则。

当前网页端如果无法进入商城商品搜索，会明确返回 `GOODS_SEARCH_UNAVAILABLE`。

### 4.4 限制与地区

- 小红书网页端是否提供商品搜索入口取决于账号、地区和页面版本；无法进入时返回 `GOODS_SEARCH_UNAVAILABLE`，不会把笔记当作商品。
- 商品搜索结果大量是笔记或混合卡片，系统会严格区分；商品卡片结构变化时返回 `PARSE_FAILED`。
- 当前未进入商品详情页解析 SKU；目标款式无法确认时 AI 返回 `UNCERTAIN`。
- 第三方 API 的地区/促销差异必须通过观察记录和前端提示保留，不能把海外视角价格当作大陆默认价格。
- 需要人工核对商品链接、店铺、SKU 与地理位置。

---

## 5. 浏览器采集通用机制

- 每个平台独立的持久化用户目录；登录一次后复用。
- 同一进程内使用串行锁，自动采集、打开验证浏览器与关闭浏览器都经过同一把锁，避免并发启动；**同一个用户数据目录同一时间只允许一个浏览器进程**。
- 默认 `PLAYWRIGHT_HEADLESS=false`，便于观察和登录；生产/自动化可设为 `true`。验证浏览器始终以 headed 启动，因为 Playwright 不能把运行中的 headless 上下文切换为 headed。
- 可选 `PLAYWRIGHT_CHANNEL=chrome` 或 `msedge`：某些环境下 Playwright 自带 Chromium 的可见窗口无法启动（`spawn UNKNOWN` / 终端沙箱限制），此时使用系统安装的浏览器；登录目录仍是 `backend/.auth/<platform>/`，不操作用户日常浏览器配置。
- 域名白名单：`taobao.com`、`tmall.com`、`douyin.com`、`jinritemai.com`、`xiaohongshu.com`、`xhslink.com`、`pinduoduo.com`、`yangkeduo.com`。浏览器模块拒绝访问白名单外地址。
- 页面出现验证码/登录提示时：抖音、小红书的浏览器渠道暂停为 `WAITING_MANUAL_VERIFICATION`，由用户在独立可见浏览器中处理；其他安全限制（`BLOCKED_BY_PLATFORM`）直接终止本渠道，不提供“绕过”能力。
- 验证码/登录最多暂停 `BROWSER_MANUAL_VERIFICATION_MAX_ATTEMPTS` 次（默认 3），超过后明确失败；等待/页面解析使用有限超时，不无限重试。
- 恢复采集只重跑未结束的渠道；已成功/失败/空/未配置的渠道不重复请求，第三方 API 不会因恢复而被重复计费。
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
