# StickerFinder

造景贴纸跨平台商品检索 Demo（v0.2.0）。

输入一款造景贴纸的名称，系统会分别检索 **淘宝、抖音、小红书、1688、拼多多**，把采集到的商品标准化，用**可解释的关键词规则**判断商品标题、详情与 SKU 是否包含目标贴纸，展示单款、组合装、全系列等匹配结果及其现价，并支持人工复核。1688 为批发采购平台，其采购价、起订量与阶梯价独立展示，不与零售价混用。

本项目的第一目标是 **验证数据真实性**，不是堆功能。未配置的平台、无法访问的页面、无法确认的商品都会被明确标记，不会用模拟商品或虚构价格填充。

> 当前状态：EveryInfra 已接入并完成真实搜索/详情验证；Phase 5 完成详情与 SKU 核验、并行搜索、取消/中断恢复、一键人工审核与名称规范化；Phase 6 已加入价格优先的跨平台最低价汇总、分组比价与极简商品卡片；Phase 7 已加入淘宝/1688 优惠信息采集、搜索快照持久化与只读历史详情；Phase 8 已移除 DeepSeek，改为规则过滤、价格有效性检查与本地数据离线回放。Phase 3.5 的 Playwright 人工验证见 [docs/verification.md](docs/verification.md)，Phase 6 见 [docs/phase6-pricing.md](docs/phase6-pricing.md)，Phase 7 见 [docs/phase7-promotions-history.md](docs/phase7-promotions-history.md)，Phase 8 见 [docs/phase8-rules-offline.md](docs/phase8-rules-offline.md)。
>
> Phase 4：EveryInfra 统一数据服务覆盖淘宝、抖音、小红书与 1688（含批发采购价结构）；真实 Key 已配置，四平台搜索与详情均已实际调用验证，配置与费用说明见 [docs/phase4-everyinfra.md](docs/phase4-everyinfra.md)。

---

## 1. 已实现内容

- **后端**：NestJS 12 + TypeORM，四张业务表，搜索任务异步执行、前端轮询。
- **四平台独立采集器**（Adapter 模式）：
  - 淘宝：`taobao.tbk.dg.material.optional`（淘宝客推广物料搜索）。
  - 拼多多：`pdd.ddk.goods.search`（多多进宝商品搜索）。
  - 抖音：**Qovia 第三方 API** + **Playwright 浏览器**，两个渠道独立任务、独立状态。
  - 小红书：**OKData 第三方 API** + **Playwright 浏览器**，两个渠道独立任务、独立状态。
- **多渠道任务与观察记录**：
  - 同一平台可同时有多个渠道任务；某渠道失败不影响其他渠道。
  - `ProductObservation` 保存每个来源的标题、价格、原价、地区说明与原始响应；同一候选商品可关联多个来源，价格不被覆盖。
  - 商品去重：平台 ID / 规范化 URL / 标题+店铺强匹配；不做 AI 同款判断。
- **平台状态**：`SUCCESS` / `PARTIAL_SUCCESS` / `EMPTY` / `FAILED` / `NOT_CONFIGURED`，并保留每个渠道的独立状态、错误与耗时。
- **地区提示**：第三方数据服务的地区限制写入观察记录并在前端展示；无法确认中国大陆可购买性时明确标记，不当作正常可购买结果。
- **平台状态接口**：未配置凭证 / 浏览器通道关闭时显示 `NOT_CONFIGURED`，不会发空凭证请求。
- **统一商品结构**：标题、店铺、商品链接、图片、SKU、价格、来源、采集时间、原始数据。
- **价格规则**：`TARGET_SKU` / `BUNDLE` / `FULL_SET` / `LOWEST_SKU` / `LISTING` / `UNKNOWN`；拼多多单买价与拼团价分开保存。
- **规则识别**：目标名称/别名与系列名称/系列别名做标准化后，标题必须同时命中两组关键词；命中后才请求详情，再用详情标题与 SKU 名称确认，并校验接口价格。
- **人工复核**：人工判断与规则结果分开保存；复核后重新分组。
- **Angular 21 + ng-zorro 前端**：搜索表单、平台状态条、四平台 Tabs、商品卡片、待确认区域、失败/空结果原因展示、参考图上传、历史记录与本地测试数据回放。
- **安全基础**：`.env` / 登录态目录 / 上传目录加入 `.gitignore`；上传图片校验 MIME、文件头与大小；浏览器采集域名白名单；商品数据视为不可信输入；默认禁止外部收费接口。

尚未实现（文档中也未要求在本阶段完成）：商品详情页 SKU 深度解析、定时监控、通知、用户体系、自动下单。

---

## 2. 技术栈

| 模块 | 选型 |
|---|---|
| 前端 | Angular 21（standalone、zoneless、signals） |
| UI | ng-zorro-antd 21 |
| 后端 | NestJS 12 |
| 数据库 | MySQL 8（设计目标）；SQLite 仅用于本机无 MySQL 时的流程验证 |
| ORM | TypeORM 0.3 |
| 浏览器自动化 | Playwright（Chromium） |
| HTTP | Axios |
| 校验 | class-validator（DTO） |

> 本机 Node 为 22.22.2，低于 Angular 22 CLI 要求的 22.22.3，因此前端固定在 Angular 21。升级 Node 后可再评估 Angular 22。

---

## 3. 目录结构

```text
StickerFinder/
├── backend/                       # NestJS 后端
│   ├── src/
│   │   ├── browser/               # Playwright 会话、登录态、串行锁、域名白名单
│   │   ├── common/                # 枚举、统一商品/价格接口、错误、工具
│   │   ├── database/              # TypeORM 配置、迁移与环境变量工具
│   │   ├── entities/              # 搜索任务、候选、观察、规则结果、优惠、历史 AI 结果
│   │   ├── providers/             # 淘宝/拼多多/抖音(Qovia+Playwright)/小红书(OKData+Playwright)
│   │   ├── replay/                # 本地 fixtures 加载与离线回放
│   │   ├── rules/                 # 关键词标准化、标题/详情规则、价格校验
│   │   ├── search/                # 搜索服务、编排器、控制器、DTO
│   │   ├── uploads/               # 参考图上传
│   │   ├── app.module.ts
│   │   └── main.ts
│   └── scripts/
│       ├── create-database.js     # 创建 MySQL 数据库
│       └── browser-login.js       # Playwright 手动登录
├── frontend/                      # Angular 前端
│   └── src/app/
│       ├── components/            # 搜索表单、平台面板、商品卡片、复核弹窗
│       ├── core/                  # 模型、API 服务、标签映射
│       └── app.ts / app.html / app.less
├── docs/
│   ├── platform-integration.md    # 平台授权与采集说明（含 Qovia / OKData）
│   ├── verification.md            # 本地验证记录与未验证事项
│   ├── phase2-delivery.md         # Phase 2 交付清单与测试矩阵
│   └── migrations/                # MySQL 增量迁移 SQL
├── .env.example
├── .gitignore
└── package.json                   # 根目录便捷脚本
```

---

## 4. 快速开始

### 4.1 前置要求

- Node.js ≥ 22.12（推荐 22.22.3+ 或 24 LTS）
- npm ≥ 10
- MySQL 8（推荐，与文档设计一致；也可先用 SQLite 验证流程）
- 若要使用抖音 / 小红书采集：首次需要手动登录一次

### 4.2 安装依赖

```powershell
npm run install:all
```

> 本环境使用 npm 12，默认会阻止依赖的安装脚本。若安装后提示 `better-sqlite3` / `esbuild` / `@parcel/watcher` 等脚本被阻止，请分别进入 `backend/` 与 `frontend/` 执行：
>
> ```powershell
> npm install-scripts approve better-sqlite3
> npm install-scripts approve esbuild @parcel/watcher lmdb msgpackr-extract
> npm rebuild
> ```
>
> 这些是数据库驱动与 Angular 构建工具所需的本地安装脚本。

### 4.3 配置环境变量

```powershell
Copy-Item .env.example .env
```

编辑根目录 `.env`。完整说明见第 5 节。

### 4.4 准备数据库

**方式 A：MySQL（推荐，符合项目设计）**

```env
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=你的密码
DB_DATABASE=sticker_finder
DB_SYNCHRONIZE=true
```

```powershell
npm run db:create
```

Demo 阶段使用 TypeORM `synchronize` 自动建表。生产或长期使用请改为 `DB_SYNCHRONIZE=false`，并执行 TypeORM 迁移：`npm --prefix backend run migration:run`（查看：`migration:show`，回滚：`migration:revert`）。

**方式 B：SQLite（仅本机快速验证）**

```env
DB_TYPE=sqlite
SQLITE_PATH=data/sticker-finder.sqlite
```

SQLite 只用于在没有 MySQL 密码/实例时验证完整链路；它不改变“目标数据库为 MySQL”的设计。两种模式使用相同的实体和接口。

### 4.5 安装 Playwright 浏览器（抖音 / 小红书需要）

```powershell
npm run playwright:install
```

首次使用某个平台前，打开可见浏览器手动登录：

```powershell
npm run browser:login -- douyin
npm run browser:login -- xiaohongshu
```

登录态保存在 `backend/.auth/<platform>/`（已在 `.gitignore` 中），不会进入 Git。登录完成后关闭浏览器即可。

> 如果登录窗口无法启动，提示 `Executable doesn't exist`、`spawn UNKNOWN` 或终端被沙箱限制，请在 `.env` 设置 `PLAYWRIGHT_CHANNEL=chrome`（或 `msedge`）后重试。项目会使用系统安装的 Chrome/Edge，但仍然使用 `backend/.auth` 下的独立登录目录，不会操作用户日常浏览器配置。

### 4.6 启动

终端 1：

```powershell
npm run dev:backend
```

终端 2：

```powershell
npm run dev:frontend
```

打开 <http://localhost:4200>。前端开发代理会把 `/api` 与 `/uploads` 转发到 `http://localhost:3000`。

生产式启动：

```powershell
npm run build
npm run start:backend
```

前端静态文件位于 `frontend/dist/frontend/browser`，可交给任意静态服务器；注意反向代理 `/api` 与 `/uploads` 到后端。

### 4.7 配置自检

编辑根目录 `.env` 后，先运行只检查配置与本地的模式：

```powershell
npm run check:config
```

确认凭证都填好后，如果确实需要真实请求，先设置 `SEARCH_DATA_MODE=live` 与 `LIVE_PROVIDER_REQUESTS_ENABLED=true`，再运行（会消耗平台额度；未设置时脚本直接拒绝）：

```powershell
npm run check:config -- --live
```

脚本会检查：

- MySQL / SQLite 连接与表；
- 采集模式与真实采集开关；
- Qovia 抖音商品搜索（签名/鉴权，测试关键词“贴纸”，约 $0.025/次）；
- OKData 小红书商城搜索（鉴权，测试关键词“贴纸”，约 $0.02/次）；
- 淘宝客物料搜索（签名 + 权限，测试关键词“贴纸”）；
- 多多进宝商品搜索（签名 + 权限，测试关键词“贴纸”）；
- Playwright Chromium 是否安装、抖音/小红书本地登录资料是否存在。

脚本 **不会打印密钥、密码、Cookie 或完整请求参数**，只显示状态、长度和平台返回的错误信息。`EMPTY` 表示尚未配置；`SKIP` 表示因缺配置未发请求；`FAIL` 表示配置已填写但平台拒绝或网络失败。

> 请直接编辑本地 `.env`，不要把密钥粘贴到聊天、Issue 或提交记录中。

---

## 5. 环境变量

所有密钥只由后端读取，不会下发到 Angular。

| 变量 | 说明 | 默认/示例 |
|---|---|---|
| `PORT` | 后端端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |
| `DB_TYPE` | `mysql` 或 `sqlite` | `mysql` |
| `DB_HOST` / `DB_PORT` | MySQL 地址与端口 | `127.0.0.1` / `3306` |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | MySQL 账号与库名 | 空 / `sticker_finder` |
| `DB_SYNCHRONIZE` | 自动建表（仅 Demo）；生产改为 `false` 并使用迁移 | `true` |
| `SQLITE_PATH` | SQLite 文件路径 | `data/sticker-finder.sqlite` |
| `SEARCH_DATA_MODE` | `fixture` 只读本地测试数据；`live` 允许真实采集 | `fixture` |
| `LIVE_PROVIDER_REQUESTS_ENABLED` | 真实采集显式开关，必须与 `live` 同时满足 | `false` |
| `FIXTURE_DIR` | 本地测试数据目录 | `test/fixtures/raw` |
| `QOVIA_API_KEY` | Qovia 抖音商品搜索密钥；为空则该渠道未配置 | 空 |
| `QOVIA_BASE_URL` | Qovia API 地址 | `https://api.qovia.ai` |
| `OKDATA_API_KEY` | OKData 小红书商城搜索密钥；为空则该渠道未配置 | 空 |
| `OKDATA_BASE_URL` | OKData API 地址 | `https://api.okdata.online` |
| `BAMBOO_API_KEY` / `SOCIALTOAI_API_KEY` | 预留第三方服务（当前未实现） | 空 |
| `TAOBAO_APP_KEY` / `TAOBAO_APP_SECRET` | 淘宝开放平台应用凭证 | 空 |
| `TAOBAO_ADZONE_ID` | 淘宝客推广位 ID（该接口必需） | 空 |
| `TAOBAO_GATEWAY_URL` | TOP 网关 | `https://eco.taobao.com/router/rest` |
| `PDD_CLIENT_ID` / `PDD_CLIENT_SECRET` | 多多进宝应用凭证 | 空 |
| `PDD_ACCESS_TOKEN` | 可选访问令牌 | 空 |
| `PDD_GATEWAY_URL` | 多多开放平台网关 | `https://gw-api.pinduoduo.com/api/router` |
| `PLAYWRIGHT_HEADLESS` | 是否无头运行；调试/登录建议 `false` | `false` |
| `PLAYWRIGHT_CHANNEL` | 可选 `chrome` / `msedge`，使用系统安装的浏览器；留空使用 Playwright 自带 Chromium | 空 |
| `BROWSER_PROVIDERS_ENABLED` | 抖音/小红书浏览器通道开关 | `true` |
| `BROWSER_USER_DATA_DIR` | 浏览器用户数据目录（登录态） | `.auth` |
| `SEARCH_MAX_RESULTS_PER_PLATFORM` | 每平台最多候选数 | `20` |
| `SEARCH_MAX_PAGES` | 每平台最多页数 | `2` |
| `PLATFORM_REQUEST_DELAY_MS` | 平台请求/页面间隔（毫秒） | `2000` |
| `PROVIDER_HTTP_TIMEOUT_MS` | 第三方 API 超时 | `20000` |
| `UPLOAD_DIR` | 上传目录 | `uploads` |
| `UPLOAD_MAX_IMAGE_MB` | 参考图片大小上限 | `5` |
| `PRODUCT_DATA_API_KEY` / `PRODUCT_DATA_API_BASE_URL` | 历史预留字段（当前未实现） | 空 |

凭证为空时，对应渠道直接返回 `NOT_CONFIGURED`，不会使用空凭证请求接口。

---

## 6. 数据库设计

| 表 | 作用 |
|---|---|
| `search_runs` | 每次搜索：目标名称、系列、别名、参考图、状态、起止时间 |
| `platform_search_tasks` | 每个**渠道**的任务：平台、provider、状态、结果数、错误码/原因、耗时 |
| `product_candidates` | 去重后的实际候选商品：标题、店铺、链接、图片、SKU、主价格、来源、采集时间 |
| `product_observations` | 某来源在某一时刻的商品观察：provider/source、标题、店铺、链接、图片、SKU、价格/原价/拼团价、地区说明、原始响应 |
| `product_match_results` | 历史 AI 判断与人工判断（仅保留旧数据，新搜索不再写入） |
| `product_rule_results` | 当前规则结果：标题/详情命中、匹配类型、命中 SKU、价格状态、人工判断 |
| `product_promotions` | 淘宝/1688 优惠券与活动快照 |

渠道任务状态：

- `PENDING` / `RUNNING`
- `SUCCESS`：该渠道至少返回一个候选
- `PARTIAL_SUCCESS`：该渠道保存了部分候选，但存在商品级错误
- `EMPTY`：渠道可访问，但本次确实没有结果（不等于失败）
- `FAILED`：接口/页面解析/网络错误
- `NOT_CONFIGURED`：缺少凭证或通道未启用
- `BLOCKED`：登录、验证码、异常访问等，需要人工处理

平台聚合状态：`SUCCESS` / `PARTIAL_SUCCESS` / `EMPTY` / `FAILED` / `NOT_CONFIGURED`。任一渠道有数据但其他渠道未配置/为空/失败时，平台为 `PARTIAL_SUCCESS`。

规则结果与人工判断分列保存；历史 AI 数据保留但不参与新规则判断。

进程重启时，启动钩子会把残留的 `RUNNING/PENDING` 任务标记为 `INTERRUPTED` / `FAILED`，不会假装任务成功。

---

## 7. 后端 API

统一前缀 `/api`。

### 7.1 发起搜索

`POST /api/searches`

```json
{
  "targetName": "A系列 B贴纸",
  "seriesName": "A系列",
  "aliases": ["A系B款"],
  "referenceImageId": null
}
```

```json
{ "searchId": "uuid", "status": "RUNNING" }
```

任务在进程内异步执行，前端轮询 `GET /api/searches/:id`。本版本不引入 Redis / BullMQ。

### 7.2 查询搜索结果

`GET /api/searches/:id`

返回目标信息、整体状态和四个平台结果。每个平台包含：

```json
{
  "platform": "douyin",
  "status": "PARTIAL_SUCCESS",
  "resultCount": 2,
  "matchedCount": 1,
  "uncertainCount": 1,
  "excludedCount": 0,
  "note": "Qovia 为第三方数据服务……",
  "channels": [
    {
      "provider": "qovia",
      "providerLabel": "Qovia 第三方 API",
      "source": "third_party_api",
      "status": "SUCCESS",
      "resultCount": 2,
      "durationMs": 4210
    },
    {
      "provider": "playwright",
      "providerLabel": "Playwright 浏览器",
      "source": "playwright",
      "status": "BLOCKED",
      "resultCount": 0,
      "errorCode": "LOGIN_REQUIRED",
      "errorMessage": "抖音搜索需要登录……"
    }
  ],
  "products": [],
  "uncertainProducts": []
}
```

每个商品会带 `observations` 数组，保存各来源的价格、原价、地区与原始响应：

```json
{
  "id": "candidate-id",
  "title": "A系列 B贴纸",
  "price": { "amount": 9, "displayText": "¥9.00", "priceType": "LOWEST_SKU" },
  "priceConflict": true,
  "observations": [
    {
      "provider": "qovia",
      "providerLabel": "Qovia 第三方 API",
      "source": "third_party_api",
      "price": { "amount": 9, "displayText": "¥9.00", "priceType": "LISTING" },
      "observedAt": "2026-11-23T12:00:00+08:00",
      "regionNote": "Qovia 未声明数据地区……",
      "rawData": {}
    },
    {
      "provider": "playwright",
      "providerLabel": "Playwright 浏览器",
      "source": "playwright",
      "price": { "amount": 9.5, "displayText": "¥9.50", "priceType": "LISTING" },
      "regionNote": "来自本机登录浏览器……",
      "rawData": {}
    }
  ]
}
```

`priceConflict=true` 表示两个来源价格不一致；前端会并列展示，不会自动选择其中一个作为真实价格。

`products` 只包含最终匹配商品；`uncertainProducts` 单独放置待确认商品；不匹配商品保留在数据库中但不返回列表，只给出数量。人工复核会覆盖显示分组。

### 7.3 最近搜索

`GET /api/searches?limit=20`

### 7.4 平台与采集模式

`GET /api/providers/status`

```json
{
  "searchMode": "fixture",
  "liveRequestsEnabled": false,
  "platforms": {
    "taobao": { "platform": "taobao", "configured": false, "provider": null, "reason": "缺少配置：TAOBAO_APP_KEY、TAOBAO_APP_SECRET、TAOBAO_ADZONE_ID" },
    "douyin": {
      "platform": "douyin",
      "configured": true,
      "provider": "browser",
      "reason": "1/2 个来源已配置",
      "channels": [
        { "key": "qovia", "label": "Qovia 第三方 API", "configured": false, "reason": "缺少配置：QOVIA_API_KEY" },
        { "key": "playwright", "label": "Playwright 浏览器", "configured": true, "reason": "首次使用需要扫码登录" }
      ]
    },
    "xiaohongshu": { "platform": "xiaohongshu", "configured": true, "provider": "browser", "reason": "1/2 个来源已配置", "channels": [] },
    "pinduoduo": { "platform": "pinduoduo", "configured": false, "provider": null, "reason": "缺少配置：PDD_CLIENT_ID、PDD_CLIENT_SECRET" }
  }
}
```

### 7.5 人工复核

`PATCH /api/candidates/:id/review`

```json
{ "decision": "MATCH", "note": "已核对商品图片和 SKU，确实包含目标贴纸" }
```

`decision`：`MATCH` / `NO_MATCH` / `PENDING`。

### 7.6 参考图上传

`POST /api/uploads/reference-image`，`multipart/form-data`，字段名 `file`。

```json
{ "referenceImageId": "uuid.png", "url": "/uploads/reference/uuid.png" }
```

仅支持 PNG / JPEG / WEBP / GIF，限制大小并校验文件头。上传成功后将 `referenceImageId` 放入搜索请求。

### 7.7 搜索历史与离线回放

```http
GET /api/search-history?page=1&pageSize=20&keyword=菜食场&status=COMPLETED
GET /api/search-history/:id
GET /api/replay/fixtures
POST /api/replay
```

- 历史接口只读数据库快照，不调用外部接口。
- 回放接口只读本地 fixtures，使用当前规则重新评估；不写数据库。
- 请求/返回示例见 [docs/phase7-promotions-history.md](docs/phase7-promotions-history.md) 与 [docs/phase8-rules-offline.md](docs/phase8-rules-offline.md)。

---

## 8. 平台采集与规则识别

平台授权、接口字段、价格口径与浏览器采集注意事项见 [docs/platform-integration.md](docs/platform-integration.md)。

双数据源规则：

- 抖音同时执行 Qovia 第三方 API 与 Playwright；小红书同时执行 OKData 第三方 API 与 Playwright。
- 两个渠道独立执行、独立记录状态/错误/耗时，一个失败不会导致另一个不执行。
- 同一商品可由多个来源观察到；`product_observations` 保存每个来源的价格与原始信息，候选商品只做去重关联。
- 强匹配（平台 ID、规范化 URL、标题+店铺）直接合并；不再调用任何 AI 判断同款。
- 同款判断只判断商品身份，不判断哪个价格正确；不确定时不合并。

### 8.1 规则识别（无 AI）

1. 文本标准化：NFKC、英文小写、常见异体字统一、忽略空白；不删除标点，保留版本号差异。
2. 标题必须同时命中目标关键词组与系列关键词组；组内 OR、组间 AND；别名只来自用户输入，不自动扩展。
3. 未命中标题的商品标记 `RULE_NO_MATCH`，**不请求详情**。
4. 标题命中后才请求详情；详情只检查商品标题与 SKU 名称，不扫描描述、店铺宣传或整个原始 JSON。
5. 详情成功且包含目标关键词 → 继续价格校验；详情成功但不包含 → `RULE_NO_MATCH`；详情失败 → `RULE_PENDING_DETAIL`，不判为不匹配。
6. 规则结果写入 `product_rule_results`；新搜索不再创建任何 AI 判断记录。

### 8.2 价格校验

- 优先使用命中的 SKU 自身价格；1688 使用明确的批发价与币种。
- 只有展示价/起步价时标记 `PRICE_AMBIGUOUS`，不伪造成 SKU 成交价。
- 详情确认但无有效价格 → `RULE_MATCH_NO_PRICE`，商品仍保存。
- 只有 `RULE_MATCH_CONFIRMED` 与有效价格才进入最低价汇总；1688 批发价独立展示。
- 价格不由程序推测，缺失保持 `null`，不补 0。

### 8.3 外部请求保护

- 默认 `SEARCH_DATA_MODE=fixture`：页面、历史、回放与测试只读本地数据，`POST /api/searches` 返回 400。
- 真实采集必须同时满足 `SEARCH_DATA_MODE=live` 与 `LIVE_PROVIDER_REQUESTS_ENABLED=true`，并由用户主动发起。
- `EveryInfraClient` 在未授权状态下直接拒绝请求，作为第二层防线。
- 本地数据缺失时明确提示，不会自动切换到在线接口。

### 8.4 离线回放

- `GET /api/replay/fixtures` 列出本地数据集。
- `POST /api/replay` 使用当前最新规则重新评估 fixtures，返回与在线搜索一致的 DTO。
- 回放不写数据库、不调用外部接口、不读取旧 AI 判断；页面会显示“测试模式 · 本地历史数据”。
- 数据和用法见 [docs/phase8-rules-offline.md](docs/phase8-rules-offline.md)。

### 8.5 运行与恢复

- 平台并行：所选平台各自独立执行搜索与详情补充；未选中的平台不创建任务、不发请求。
- 取消与恢复：运行中的搜索可取消；取消后不再启动新请求，已完成结果保留；进程重启会把未完成任务标记为 `INTERRUPTED`。
- 人工复核：商品卡片可一键「确认同款 / 排除 / 撤销」，多 SKU 商品可标记目标款、组合装或排除；人工字段与规则字段分开保存。
- 目标信息与规范化：支持系列别名与品牌/创作者；系列名做全角/半角、空格、异体字归一，原始值保留。
- 去重与价格：按平台 ID → 规范化链接 → 标题+店铺合并，不按标题强制合并不同店铺；未确认目标 SKU 价格时显示「¥X 起 · 规格待确认」，详情失败显示「详情暂不可用」，1688 批发价单独展示。
- 界面简化：商品卡片使用「规则确认 / 已确认·无有效价 / 待详情确认 / 规则不匹配 / 历史数据」状态；平台面板显示「已找到 / 标题命中 / 详情确认 / 价格有效」进度；被排除商品可展开查看；来源状态默认折叠。
- 价格优先汇总（Phase 6）：搜索结果先显示「当前最低已确认价格」，只使用规则确认或人工确认、价格状态为 `PRICE_VALID`、金额大于 0 且币种明确的 SKU 价格；列表价/起售价不参与正式排名。按目标单款、组合装、全系列、1688 批发分组；1688 不参与零售最低价。统一商品列表按分组和价格排序，已确认但价格待核实的商品折叠；只有可能刷新最低价的待确认商品才单独展示。后端返回 `priceSummary`，前端不自行计算价格。
- 1688 搜索实测需要 30–60 秒，使用独立的 `EVERYINFRA_1688_TIMEOUT_MS`（默认 60000），避免被通用 30 秒超时误判失败。
- 增量字段见 [docs/migrations/phase5-match-safety.sql](docs/migrations/phase5-match-safety.sql)。

参考图目前只保存记录，不参与规则判断；项目不再包含图片识别能力。

---

## 9. 价格与数据真实性

- 价格必须有 `priceSource` 与 `observedAt`；提取失败时 `amount = null`，展示“未获取”，绝不写 0。
- 每个来源的价格保存在 `product_observations`；同一商品多个来源价格不一致时，前端并列展示并标记“价格不一致”，不自动选择真实价格。
- OKData 原价、Qovia `price_text`（如“到手价”）与地区说明均保留在观察记录中。
- 组合装展示整套价格，不拆分计算单张价格。
- 拼多多默认展示单买价；拼团价单独保留并明确标注“需拼团”。
- 淘宝客接口返回展示价，SKU 未确认时使用 `LISTING`。
- `LOWEST_SKU` 必须注明起售价与 SKU 未确认。
- 商品卡片链接来自平台返回或由平台商品 ID 生成的规范链接。
- 第三方数据服务未确认中国大陆可购买性时，观察记录与前端都会显示地区限制说明。

---

## 10. 安全与合规

- 不破解验证码、不绕过登录/风控、不轮换代理、不做无限重试。
- 平台请求低频、顺序执行；同一平台的多个渠道独立失败，不互相阻塞。
- Playwright 使用正常浏览器访问；遇到验证码/访问异常立即停止并提示人工处理。
- 登录态、Cookie、密钥不进入 Git；`.env*`、`.auth/`、`storage-state*.json` 已忽略。
- 图片抓取仅允许白名单域名，限制协议、大小与类型，防止 SSRF。
- 浏览器采集限制在平台域名白名单内。
- 上传文件校验 MIME、文件头、大小，文件名使用 UUID。
- `ProductObservation.rawData` 在入库和返回前会递归脱敏（token/secret/cookie/authorization 等字段）并限制深度、数组长度与字符串长度；前端只允许用户主动展开查看。
- Qovia/OKData 密钥只在后端环境变量中读取，不进入请求 URL 或前端。
- 商品标题/描述/SKU 与第三方原始响应均视为不可信输入。
- 当前开发模式 CORS 较宽松，部署到共享环境前应收紧来源并增加访问控制。

---

## 11. 本地验证状态

已在本地验证：

- 前后端依赖安装与生产构建。
- SQLite 模式建表、启动、搜索任务生命周期、轮询、状态区分。
- 启动中断恢复：运行中的搜索在重启后被标记为 `INTERRUPTED`，没有伪装成功。
- 双数据源任务：抖音/小红书各创建 Qovia/OKData + Playwright 两个独立任务；未配置第三方 Key 时显示 `NOT_CONFIGURED`，Playwright 渠道独立执行。
- 平台聚合：渠道成功/未配置/失败组合能正确得到 `PARTIAL_SUCCESS` / `FAILED` / `NOT_CONFIGURED`。
- 渠道状态在前端逐条展示（来源、状态、结果数、耗时、错误）。
- 已登录 Playwright 实测（系统 Chrome，独立登录目录）：
  - 抖音搜索被重定向到“验证码中间页”，渠道返回 `BLOCKED` / `CAPTCHA_REQUIRED`；
  - 小红书普通搜索只返回笔记，渠道返回 `FAILED` / `PARSE_FAILED`，并明确说明不能把笔记当商品。
  - 因此仅靠免费 Playwright 当前无法取得商品数据；需要 Qovia/OKData 第三方 API，或在可见浏览器中人工处理平台验证入口后再评估。
- Qovia / OKData 真实调用（试用余额）：
  - Qovia 返回 5 条真实抖音商品，OKData 返回 5 条真实小红书商品；
  - 标题、图片、价格、店铺、来源与地区说明已入库并展示；
  - 由于第三方搜索接口未提供 SKU/商品描述，Phase 4 的 AI 记录把 10 条全部标为 `UNCERTAIN`（历史记录，Phase 8 已移除 AI）。
- 参考图上传、静态访问、使用 `referenceImageId` 发起搜索；伪造图片内容会被拒绝。
- 商品卡片、待确认区域、人工复核保存与重新分组（使用一次性本地测试数据验证渲染，验证后已清理）。
- 多来源价格对比与原始采集信息界面（使用一次性本地测试数据验证渲染，验证后已清理）。
- 桌面/窄屏布局。
- 后端单元测试：`npm --prefix backend test`（112 项通过，含 Qovia/OKData 响应映射、去重、平台状态聚合、敏感字段脱敏、价格汇总、优惠解析、规则过滤与离线回放）。

运行后端测试：

```powershell
npm --prefix backend test
```

未验证（需要真实凭证或账号）：

- MySQL 运行时（仅完成设计与 SQLite 对等验证）。
- 淘宝 / 拼多多真实 API 返回与价格。
- 有完整 SKU/描述的商品匹配（当前 Qovia/OKData 只有标题级信息，Phase 4 的真实候选均待确认；Phase 8 后使用本地 fixtures 验证规则）。
- 真实 MATCH 的准确率与价格人工核对（需要更完整的商品详情数据）。
- 抖音 / 小红书 Playwright 已登录并验证页面状态，但当前分别被验证码与“仅笔记”限制，未取得真实商品；需要第三方 API 或人工处理平台入口。

详细记录见 [docs/verification.md](docs/verification.md) 与 [Phase 2 交付清单](docs/phase2-delivery.md)。

---

## 12. 开发阶段状态

| 阶段 | 状态 |
|---|---|
| Phase 1 项目基础 | 已完成：后端/前端/数据库实体/搜索任务/统一结构/页面/平台状态 |
| Phase 2 双数据源采集 | 已完成：Qovia/OKData 使用试用余额取得真实商品；Playwright 受验证码/笔记结果限制 |
| Phase 3 Playwright 登录与详情 | 登录态、页面搜索、失败分类完成；商品详情/SKU 深度解析待补 |
| Phase 4 DeepSeek 识别 | 历史阶段：曾对真实候选完成 live 识别；Phase 8 已完全移除 |
| Phase 5 前端结果展示 | 已完成四平台 Tabs、渠道状态、卡片、多来源价格对比、待确认、复核入口 |
| Phase 6 真实性测试 | 已完成 1 次 5+5 真实搜索；3–5 款真实贴纸的人工价格核对待执行 |
| Phase 7 优惠与历史 | 已完成：淘宝/1688 优惠采集、券后价与活动展示、每次搜索快照落库、历史列表与只读详情；见 [docs/phase7-promotions-history.md](docs/phase7-promotions-history.md) |
| Phase 8 规则与离线 | 已完成：移除 AI、关键词规则过滤、价格有效性检查、5 组真实 fixtures、只读回放与外部请求保护；见 [docs/phase8-rules-offline.md](docs/phase8-rules-offline.md) |

---

## 13. 测试建议

1. 准备 10–20 款真实造景贴纸，人工记录商品链接、SKU 与价格。
2. 对每个平台分别统计：搜索覆盖率、采集成功率、规则误报/漏报、价格一致率。
3. 价格核对尽量与采集同时完成，避免正常调价造成误判。
4. 重点检查误判为 MATCH 的商品，以及把起售价/拼团价误当目标 SKU 价格的情况。
5. 无法采集的平台记录具体原因：权限、接口范围、登录、验证码、页面结构或价格解析。

---

## 14. 常见问题

**为什么淘宝/拼多多显示“未配置”？**
需要开放平台应用凭证；淘宝客物料接口还需要推广位 `TAOBAO_ADZONE_ID`。未配置时系统不会伪造结果。

**抖音/小红书显示“采集失败”或“需要登录”？**
先运行 `npm run playwright:install`，再运行 `npm run browser:login -- douyin` / `-- xiaohongshu` 手动登录。页面结构变化会返回 `PARSE_FAILED`，不会编造商品。

**为什么抖音/小红书只显示一个来源成功？**
这两个平台要求同时执行第三方 API 与 Playwright。第三方 Key（`QOVIA_API_KEY` / `OKDATA_API_KEY`）未配置时，对应渠道显示 `NOT_CONFIGURED`，平台会聚合为 `PARTIAL_SUCCESS`（有数据）或 `FAILED`（无数据），不会用另一个渠道的结果冒充双来源成功。

**已经登录了，为什么没有商品？**
当前实测中，抖音会把网页搜索重定向到验证码中间页，小红书普通搜索只返回笔记。Playwright 渠道会如实返回 `BLOCKED`/`PARSE_FAILED`，不会绕过验证码或把笔记当商品。要稳定获取商品数据，建议配置 Qovia（抖音）和 OKData（小红书）第三方 API；或在可见浏览器中人工完成平台验证后再测试。

**Playwright 登录窗口打不开？**
如果提示 `Executable doesn't exist` 或 `spawn UNKNOWN`，在 `.env` 设置 `PLAYWRIGHT_CHANNEL=chrome`（或 `msedge`），使用系统安装的浏览器和独立登录目录。抖音/小红书登录后仍可能遇到验证码或仅笔记结果。

**Qovia / OKData 的价格能直接当作大陆价格吗？**
不能。Qovia 文档未声明数据地区；OKData 文档说明小红书商品为海外 App 视角，促销可能与大陆不同。观察记录与前端都会保留地区提示，需人工核对。

**AI 未配置时会怎样？**
商品仍会采集并保存，但会进入“待确认”区域，状态为 `UNCERTAIN`，不会伪装成匹配。

**MySQL 连接失败？**
确认服务已启动、账号密码正确，并先执行 `npm run db:create`。也可临时使用 `DB_TYPE=sqlite` 验证流程。

**Angular 启动提示 Node 版本？**
Angular 21 需要 Node 22.12+；若升级到 Angular 22，需要 Node 22.22.3+。

**端口占用？**
后端默认 3000，前端默认 4200；可在 `.env` 修改后端端口，并在 `frontend/proxy.conf.json` 与 `angular.json` 同步。

---

## 15. 后续计划

- 商品详情页 SKU / 价格提取（尤其抖音、小红书），提高 `TARGET_SKU` 比例。
- 将 AI 与同款判断缓存持久化，并支持按 Prompt/商品版本失效。
- 持久化采集指标，按平台/来源输出覆盖率、误报率、价格准确率。
- Bamboo / SocialToAI 等可替换第三方 Adapter。
- TypeORM 迁移替代 `synchronize`；生产环境访问控制与更严格 CORS。
- 补充单元测试与端到端测试（签名、AI 校验、人工复核、状态机）。
- 基于真实测试结果决定是否继续投入，以及各平台可达到的能力边界。
