# StickerFinder

造景贴纸跨平台商品检索 Demo（v0.2.0）。

输入一款造景贴纸的名称，系统会分别检索 **淘宝、抖音、小红书、拼多多**，把采集到的商品标准化，调用 **DeepSeek** 判断商品实际销售内容是否真的包含目标贴纸，展示单款、组合装、全系列等匹配结果及其现价，并支持人工复核。

本项目的第一目标是 **验证数据真实性**，不是堆功能。未配置的平台、无法访问的页面、无法确认的商品都会被明确标记，不会用模拟商品或虚构价格填充。

> 当前状态：Phase 1 基础链路与 Phase 2 抖音/小红书双数据源已完成代码实现。抖音、小红书分别创建 **第三方 API + Playwright** 两个独立渠道任务，并保存多来源观察记录；Qovia/OKData 的真实结果需要配置 API Key 后验证。官方 API、DeepSeek 与登录采集同样需要凭证或登录后才能做真实验证。详见 [docs/verification.md](docs/verification.md)。

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
  - 商品去重：平台 ID / 规范化 URL / 标题+店铺强匹配；弱匹配调用 DeepSeek 判断是否同款（不判断价格）。
- **平台状态**：`SUCCESS` / `PARTIAL_SUCCESS` / `EMPTY` / `FAILED` / `NOT_CONFIGURED`，并保留每个渠道的独立状态、错误与耗时。
- **地区提示**：第三方数据服务的地区限制写入观察记录并在前端展示；无法确认中国大陆可购买性时明确标记，不当作正常可购买结果。
- **平台状态接口**：未配置凭证 / 浏览器通道关闭时显示 `NOT_CONFIGURED`，不会发空凭证请求。
- **统一商品结构**：标题、店铺、商品链接、图片、SKU、价格、来源、采集时间、原始数据。
- **价格规则**：`TARGET_SKU` / `BUNDLE` / `FULL_SET` / `LOWEST_SKU` / `LISTING` / `UNKNOWN`；拼多多单买价与拼团价分开保存。
- **DeepSeek 商品识别**：结构化 JSON 输出、Zod 校验、失败有限重试、证据不足降级为 `UNCERTAIN`、SKU 级判断、内存缓存、可选视觉输入。
- **人工复核**：人工结果与 AI 原始结果分开存储，不覆盖 AI 字段；复核后重新分组。
- **Angular 21 + ng-zorro 前端**：搜索表单、平台状态条、四平台 Tabs、商品卡片、待确认区域、复核弹窗、失败/空结果原因展示、参考图上传。
- **安全基础**：`.env` / 登录态目录 / 上传目录加入 `.gitignore`；上传图片校验 MIME、文件头与大小；图片抓取域名白名单；浏览器采集域名白名单；商品数据视为不可信输入。

尚未实现（文档中也未要求在本阶段完成）：商品详情页 SKU 深度解析、第三方数据服务、持久化 AI 缓存、定时监控、通知、用户体系、自动下单。

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
| AI | DeepSeek 官方 API（OpenAI 兼容接口） |
| HTTP | Axios |
| 校验 | class-validator（DTO）+ Zod（AI 输出） |

> 本机 Node 为 22.22.2，低于 Angular 22 CLI 要求的 22.22.3，因此前端固定在 Angular 21。升级 Node 后可再评估 Angular 22。

---

## 3. 目录结构

```text
StickerFinder/
├── backend/                       # NestJS 后端
│   ├── src/
│   │   ├── ai/                    # DeepSeek 调用、Prompt、输出校验、安全降级
│   │   ├── browser/               # Playwright 会话、登录态、串行锁、域名白名单
│   │   ├── common/                # 枚举、统一商品/价格接口、错误、工具
│   │   ├── database/              # TypeORM 配置与环境变量工具
│   │   ├── entities/              # search_runs / platform_search_tasks / candidates / observations / match_results
│   │   ├── providers/             # 淘宝/拼多多/抖音(Qovia+Playwright)/小红书(OKData+Playwright)
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

Demo 阶段使用 TypeORM `synchronize` 自动建表。生产或长期使用请改为 `DB_SYNCHRONIZE=false` 并引入迁移。

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

确认凭证都填好后，再运行真实请求模式（会消耗少量平台/AI 额度）：

```powershell
npm run check:config -- --live
```

脚本会检查：

- MySQL / SQLite 连接与表；
- DeepSeek Key 与模型（优先 `/models`，必要时最小对话请求）；
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
| `DB_SYNCHRONIZE` | 自动建表（仅 Demo） | `true` |
| `SQLITE_PATH` | SQLite 文件路径 | `data/sticker-finder.sqlite` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥；为空则 AI 识别显示未配置 | 空 |
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 模型名称（按账号实际可用模型填写） | `deepseek-flash` |
| `AI_CLASSIFY_ENABLED` | AI 识别总开关 | `true` |
| `AI_MIN_CONFIDENCE` | 低于该置信度的 MATCH 会降级为 UNCERTAIN | `0.65` |
| `AI_VISION_ENABLED` | 是否发送参考图/商品图（需模型支持图片输入） | `false` |
| `IMAGE_HOST_ALLOWLIST` | 允许抓取图片的域名后缀，逗号分隔 | `alicdn.com,pddpic.com,...` |
| `QOVIA_API_KEY` | Qovia 抖音商品搜索密钥；为空则该渠道未配置 | 空 |
| `QOVIA_BASE_URL` | Qovia API 地址 | `https://api.qovia.ai` |
| `OKDATA_API_KEY` | OKData 小红书商城搜索密钥；为空则该渠道未配置 | 空 |
| `OKDATA_BASE_URL` | OKData API 地址 | `https://api.okdata.online` |
| `THIRD_PARTY_MAX_AI_MATCHES_PER_PLATFORM` | 每平台最多用 DeepSeek 做几次跨来源同款判断 | `6` |
| `BAMBOO_API_KEY` / `SOCIALTOAI_API_KEY` | 预留第三方服务（当前未实现） | 空 |
| `TAOBAO_APP_KEY` / `TAOBAO_APP_SECRET` | 淘宝开放平台应用凭证 | 空 |
| `TAOBAO_ADZONE_ID` | 淘宝客推广位 ID（该接口必需） | 空 |
| `TAOBAO_GATEWAY_URL` | TOP 网关 | `https://eco.taobao.com/router/rest` |
| `PDD_CLIENT_ID` / `PDD_CLIENT_SECRET` | 多多进宝应用凭证 | 空 |
| `PDD_ACCESS_TOKEN` | 可选访问令牌 | 空 |
| `PDD_GATEWAY_URL` | 多多开放平台网关 | `https://gw-api.pinduoduo.com/api/router` |
| `PLAYWRIGHT_HEADLESS` | 是否无头运行；调试/登录建议 `false` | `false` |
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
| `product_match_results` | AI 判断与人工判断：匹配状态/类型、置信度、摘要、证据、SKU 判断、AI 原始响应、人工决定与备注 |

渠道任务状态：

- `PENDING` / `RUNNING`
- `SUCCESS`：该渠道至少返回一个候选
- `PARTIAL_SUCCESS`：该渠道保存了部分候选，但存在商品级错误
- `EMPTY`：渠道可访问，但本次确实没有结果（不等于失败）
- `FAILED`：接口/页面解析/网络错误
- `NOT_CONFIGURED`：缺少凭证或通道未启用
- `BLOCKED`：登录、验证码、异常访问等，需要人工处理

平台聚合状态：`SUCCESS` / `PARTIAL_SUCCESS` / `EMPTY` / `FAILED` / `NOT_CONFIGURED`。任一渠道有数据但其他渠道未配置/为空/失败时，平台为 `PARTIAL_SUCCESS`。

AI 判断与人工判断分列保存；人工复核不会覆盖 AI 原始结果。

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

### 7.4 平台与 AI 状态

`GET /api/providers/status`

```json
{
  "ai": { "configured": false, "model": "deepseek-flash", "visionEnabled": false, "reason": "缺少 DEEPSEEK_API_KEY" },
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

---

## 8. 平台采集与 AI 识别

平台授权、接口字段、价格口径与浏览器采集注意事项见 [docs/platform-integration.md](docs/platform-integration.md)。

双数据源规则：

- 抖音同时执行 Qovia 第三方 API 与 Playwright；小红书同时执行 OKData 第三方 API 与 Playwright。
- 两个渠道独立执行、独立记录状态/错误/耗时，一个失败不会导致另一个不执行。
- 同一商品可由多个来源观察到；`product_observations` 保存每个来源的价格与原始信息，候选商品只做去重关联。
- 强匹配（平台 ID、规范化 URL、标题+店铺）直接合并；弱匹配在预算内调用 DeepSeek 判断是否同款。
- 同款判断只判断商品身份，不判断哪个价格正确；不确定时不合并。

AI 识别规则摘要：

1. 判断的是“商品实际销售内容”，不是标题相似度。
2. 区分不同系列、款式、型号。
3. 区分单款、指定 SKU、组合装、全系列。
4. 优先依据 SKU 与描述；标题、图片只是证据。
5. 不推断未展示的 SKU；信息不足返回 `UNCERTAIN`。
6. 商品描述中的任何指令均视为不可信数据，不得改变识别规则。
7. 输出必须通过 Zod 校验；失败有限重试，仍失败则标记 AI 失败并进入待确认。
8. 置信度低于阈值、缺少证据、SKU 无法确认时，系统会把 MATCH 降级为 `UNCERTAIN`。
9. 价格不由 AI 判断。

参考图视觉比对默认关闭（`AI_VISION_ENABLED=false`），需确认模型支持图片输入后再开启；未开启时上传的参考图仅保留记录，并在识别理由中说明。

---

## 9. 价格与数据真实性

- 价格必须有 `priceSource` 与 `observedAt`；提取失败时 `amount = null`，展示“未获取”，绝不写 0。
- 每个来源的价格保存在 `product_observations`；同一商品多个来源价格不一致时，前端并列展示并标记“价格不一致”，不自动选择真实价格。
- OKData 原价、Qovia `price_text`（如“到手价”）与地区说明均保留在观察记录中。
- 组合装展示整套价格，不拆分计算单张价格。
- 拼多多默认展示单买价；拼团价单独保留并明确标注“需拼团”。
- 淘宝客接口返回展示价，SKU 未确认时使用 `LISTING`。
- `LOWEST_SKU` 必须注明起售价与 SKU 未确认。
- 商品卡片链接来自平台返回或由平台商品 ID 生成的规范链接，不使用 AI 生成的 URL。
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
- 参考图上传、静态访问、使用 `referenceImageId` 发起搜索；伪造图片内容会被拒绝。
- 商品卡片、待确认区域、人工复核保存与重新分组（使用一次性本地测试数据验证渲染，验证后已清理）。
- 多来源价格对比与原始采集信息界面（使用一次性本地测试数据验证渲染，验证后已清理）。
- 桌面/窄屏布局。
- 后端单元测试：`npm --prefix backend test`（37 项通过，含 Qovia/OKData 响应映射、去重、平台状态聚合、AI Schema 与安全降级、敏感字段脱敏）。

运行后端测试：

```powershell
npm --prefix backend test
```

未验证（需要真实凭证或账号）：

- MySQL 运行时（仅完成设计与 SQLite 对等验证）。
- 淘宝 / 拼多多真实 API 返回与价格。
- Qovia / OKData 真实请求与返回（当前 `QOVIA_API_KEY`、`OKDATA_API_KEY` 为空；解析器使用官方示例响应做单元测试，不代表真实采集成功）。
- DeepSeek 真实商品识别与同款判断（有 Key 但本次没有真实候选商品可验证）。
- 抖音 / 小红书登录后的真实商品搜索与 SKU/价格解析。

详细记录见 [docs/verification.md](docs/verification.md) 与 [Phase 2 交付清单](docs/phase2-delivery.md)。

---

## 12. 开发阶段状态

| 阶段 | 状态 |
|---|---|
| Phase 1 项目基础 | 已完成：后端/前端/数据库实体/搜索任务/统一结构/页面/平台状态 |
| Phase 2 双数据源采集 | 代码完成：Qovia/OKData + Playwright 双渠道、观察记录、同款判断、来源对比；待真实 Key 验证 |
| Phase 3 Playwright 登录与详情 | 登录态、页面搜索、失败分类完成；商品详情/SKU 深度解析待补 |
| Phase 4 DeepSeek 识别 | 内容识别、同款判断、JSON 校验、SKU 判断、人工复核完成；待真实候选验证 |
| Phase 5 前端结果展示 | 已完成四平台 Tabs、渠道状态、卡片、多来源价格对比、待确认、复核入口 |
| Phase 6 真实性测试 | 待准备 3–5 款真实贴纸与平台凭证后执行 |

---

## 13. 测试建议

1. 准备 10–20 款真实造景贴纸，人工记录商品链接、SKU 与价格。
2. 对每个平台分别统计：搜索覆盖率、采集成功率、AI 误报/漏报、价格一致率。
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
