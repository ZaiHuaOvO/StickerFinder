# 本地验证记录（v0.2.0）

记录时间：2026-11-23  
环境：Windows 11、Node v22.22.2、npm 12.0.2、MySQL 8.4（本机服务存在但未取得密码）、Playwright Chromium 已安装。

本文件只记录 **实际执行过** 的验证，未执行的项明确标记为未验证。验证过程中使用的一次性 UI 测试数据、测试脚本、上传图片与 SQLite 数据库已在结束时删除；下次启动会重新生成空数据库。

---

## 1. 构建与启动

| 项目 | 结果 |
|---|---|
| `backend npm install` | 通过（需批准 better-sqlite3 安装脚本） |
| `backend npm run build` | 通过 |
| `frontend npm install` | 通过（需批准 esbuild / @parcel/watcher / lmdb / msgpackr-extract 安装脚本） |
| `frontend npm run build` | 通过，产物约 2.07 MB（raw）/ 363 KB（transfer） |
| `backend npm test` | 通过，48 项（URL 规范化、浏览器价格解析、Qovia/OKData 映射、去重与状态聚合、AI Schema/v2 降级、敏感字段脱敏） |
| 后端启动（SQLite 模式） | 通过，`/api` 路由注册正常 |
| 前端开发服务器 | 通过，页面可访问；API 代理正常 |

本机 Angular 22 CLI 要求 Node 22.22.3+，当前 Node 22.22.2，因此使用 Angular 21.2.30。

---

## 2. 数据库与任务流程

使用 `DB_TYPE=sqlite`、`SQLITE_PATH=data/sticker-finder.sqlite` 验证。

- TypeORM `synchronize` 自动创建五张表：`search_runs`、`platform_search_tasks`、`product_candidates`、`product_observations`、`product_match_results`。
- `POST /api/searches` 返回 `{ searchId, status: "RUNNING" }`。
- 前端轮询 `GET /api/searches/:id`，任务完成后状态变为 `COMPLETED`。
- 每个**渠道**任务独立记录状态；一次搜索创建 6 个任务（抖音/小红书各 2 个来源）。
- 未配置渠道返回 `NOT_CONFIGURED`，错误信息列出缺少的环境变量。
- 安装 Chromium 后、未登录状态下，抖音 Playwright 返回 `FAILED` / `PARSE_FAILED`，小红书 Playwright 返回 `BLOCKED` / `BLOCKED_BY_PLATFORM`；没有伪造结果。
- 平台聚合：一个渠道有数据、另一个未配置/为空/失败时为 `PARTIAL_SUCCESS`；全部无数据时按失败/空/未配置区分。
- 空结果与失败、未配置状态在前端分别展示。

示例（本地无第三方 Key、无登录）：

```text
淘宝      NOT_CONFIGURED  淘宝客 API 缺少凭证
抖音      FAILED          Qovia NOT_CONFIGURED + Playwright PARSE_FAILED
小红书    FAILED          OKData NOT_CONFIGURED + Playwright BLOCKED
拼多多    NOT_CONFIGURED  多多进宝缺少凭证
```

---

## 3. 上传与参考图

- `POST /api/uploads/reference-image` 上传 1×1 PNG，返回 `referenceImageId` 与 URL。
- 通过 `/uploads/reference/<id>` 访问返回 `200 image/png`。
- 使用该 `referenceImageId` 发起搜索成功，搜索详情 `referenceImageProvided = true`。
- 上传接口拒绝非白名单 MIME；文件头校验防止伪造扩展名；大小限制生效。
- 参考图仅在后端保存路径；API 响应不暴露绝对路径。

---

## 4. 前端与人工复核

在本地 SQLite 中创建一次性测试数据验证 UI，随后删除测试数据与数据库文件。验证项：

- 搜索表单、参考图选择、别名输入、平台状态条。
- 四平台 Tabs 与匹配数/待确认数。
- 未配置、失败、空结果状态提示。
- 商品卡片：图片、平台/组合装标签、标题、店铺、内容摘要、匹配内容、SKU 列表、价格与价格类型、来源、采集时间、判断依据、查看商品链接。
- 待确认区域与不匹配数量提示。
- 复核弹窗：选择“确认不包含”、填写备注、保存。
- 保存后 API 中 `manual_decision = NO_MATCH`，商品从匹配区移出、计入不匹配数量；AI 原始字段未被覆盖。
- 通过 `?searchId=<id>` 可直接恢复并展示某次搜索。
- **中断恢复**：将一条搜索记录与平台任务标记为运行中后重启后端，启动钩子将其改为 `INTERRUPTED`，各平台任务为 `FAILED` / `INTERRUPTED`，没有把未完成任务伪装成成功。

人工复核请求最初依赖 modal 的 `afterClose` 返回值，未触发保存；已改为在 `nzOnOk` 中直接调用保存接口并重新验证通过。

---

## 5. Phase 2 双数据源验证

2026-11-23 在 Phase 1 基础上完成：

- 新增 `product_observations`；`platform_search_tasks` 增加 `provider` 与 `(search_run_id, platform, provider)` 唯一约束。
- 一次搜索实际创建 6 个渠道任务：淘宝 1、抖音 2（Qovia + Playwright）、小红书 2（OKData + Playwright）、拼多多 1。
- Qovia / OKData 已配置试用 Key 并完成 live 验证：
  - `check:config --live`：Qovia 返回 30 个商品卡片，OKData 返回 20 个商品；
  - 使用每平台最多 5 条做了一次真实搜索：Qovia 采集 5 条抖音商品，OKData 采集 5 条小红书商品；
  - 真实标题、图片、价格、店铺、来源与地区说明已入库，并在前端商品卡片展示；
  - 第三方搜索接口没有提供 SKU 详情/商品描述，v1 时期 DeepSeek 按安全规则将 10 条全部标记为 `UNCERTAIN`，没有误判为 MATCH；v2 改为先按类别、系列与标题判断。
- 使用本机 Chrome 登录抖音/小红书（`PLAYWRIGHT_CHANNEL=chrome`，独立 `.auth` 目录）后实测：
  - 抖音网页搜索被重定向到“验证码中间页”，Playwright 渠道返回 `BLOCKED` / `CAPTCHA_REQUIRED`；
  - 小红书登录成功，但普通搜索只返回笔记，渠道返回 `FAILED` / `PARSE_FAILED`，并明确说明不能把笔记当商品；
  - 平台聚合为 `PARTIAL_SUCCESS`（第三方渠道有真实数据，Playwright 渠道失败）。
- 前端渠道状态、来源标签、原始信息展开、多来源价格对比已验证：
  - 多来源价格对比使用一次性本地数据验证（Qovia ¥9.00 / Playwright ¥9.50，显示价格不一致）；测试数据已删除；
  - 真实搜索使用 Qovia/OKData 数据验证了商品卡片、价格来源、地区说明与待确认区域。
- 新增 48 项单元测试，其中 Qovia/OKData 使用官方文档示例响应测试字段映射；真实第三方结果另用试用 Key 验证。

未验证：有完整 SKU/描述时的真实 MATCH、真实跨来源同款合并、淘宝/拼多多真实接口、MySQL 增量迁移执行。DeepSeek 真实调用已完成，但因缺少 SKU/描述，当前没有进入 MATCH 的真实商品样本。

### Prompt v2 live 验证

使用导出数据中「米饼文创4.0系列造景贴纸」候选（只有标题，无 SKU/描述）调用 DeepSeek，v2 Prompt 返回并通过 Zod 校验：

- `candidateRelevance=HIGH`、`categoryMatch=MATCH`、`seriesMatch=MATCH`、`targetItemMatch=UNKNOWN`
- `matchStatus=UNCERTAIN`、`matchType=UNCERTAIN`、`nextAction=FETCH_SKU`
- `visualMatch=VISUAL_UNAVAILABLE`，`evidence` 为结构化对象（`sourceField=title`）

说明 v2 能把“高相关但缺少 SKU”正确表达为待补证据，而不是直接排除或误判 MATCH。

---

## 6. 代码审查与修复

对当前代码运行了一次多代理独立审查（后端、前端、AI/价格、规范四个维度，逐条对抗性验证：28 条候选，10 条确认、18 条被反驳）。确认项均已修复：

| 问题 | 修复 |
|---|---|
| 图片抓取跟随重定向可绕过域名白名单（SSRF） | 禁用重定向，非 2xx 直接视为失败 |
| 参考图置信度扣减发生在阈值判断之后 | 先扣减再判断阈值，低于阈值降级 UNCERTAIN |
| 无 SKU 详情时 TARGET_VARIANT 仍可通过 | 无 SKU 或未指出匹配 SKU 一律降级 |
| EXACT_SINGLE 与自身 SKU 判断矛盾仍保留 MATCH | 有 SKU 但没有任何 SKU 判为 MATCH 时降级 |
| 商品图全部下载失败仍按满置信度识别 | 记录缺失并下调置信度 |
| matchedSkuIds 与 skuDecisions 不一致 | 按 SKU 判断收紧 matchedSkuIds |
| 浏览器正常无结果被当成失败 / 淘宝拼多多异常响应被当成 EMPTY | 增加无结果提示与响应结构校验，区分 EMPTY/FAILED |
| 上传失败后 uploading 不复位 | 使用 RxJS finalize 复位 |
| 轮询一次失败即永久停止 | 指数退避重试，404 等终态直接停止 |
| FAILED 平台的部分已采结果不显示 | 非 SUCCESS 状态也展示已落库的部分结果 |
| 别名条数/长度、纯空格名称未校验 | 前端补齐与后端一致的校验 |
| 人工复核后刷新失败提示误导、分组陈旧 | 本地先更新分组，刷新失败显示准确提示 |
| 浏览器卡片价格无法区分区间/券后/起售价 | 统一价格解析：区间与券后价不冒充普通现价 |

其中若干条在审查验证阶段已被反驳，原因是修复在此前已经落地。当前构建与 48 项单元测试均通过。

---

## 7. 未验证事项

以下项目缺少凭证、账号或账号权限，**未做真实调用验证**：

- MySQL 运行时（仅验证 SQLite；实体与配置按 MySQL 设计，但未实际启动 MySQL 库）。
- 淘宝客接口真实返回、应用权限、价格字段。
- 拼多多多多进宝接口真实返回、签名字段、单买/拼团价格。
- 有完整 SKU/描述时的真实 MATCH 与价格人工核对。
- 真实跨来源同款合并（当前 Playwright 未取得商品，未触发该路径）。
- 抖音/小红书 Playwright 商品采集（登录成功，但分别被验证码与仅笔记结果限制）。
- Bamboo / SocialToAI Adapter（仅预留，未实现）。
- 长时间运行、并发搜索、限流与平台风控的实际表现。

---

## 8. 已知限制

- 抖音、小红书当前只解析列表页，未进入详情页提取 SKU 与 SKU 价格；v2 会先判断类别与系列，目标款式无法确认时返回 `UNCERTAIN`。
- Qovia/OKData 返回的字段可能变化；解析失败会明确报错，不会编造商品。
- 跨来源同款判断依赖 DeepSeek；未配置或不确定时保留为两个候选，可能产生重复商品。
- 淘宝、拼多多官方接口覆盖的是推广商品体系，不代表全站。
- AI 缓存仅在进程内存中，重启失效。
- 数据库使用 `synchronize`；已提供 MySQL 增量迁移 SQL，但未在真实 MySQL 上执行。
- 没有用户/权限体系；`searchId` 为 UUID，但不构成访问控制。
- 前端打包为内部工具级别，未做按需图标加载优化。

---

## 9. 下一步验证建议

1. 配置 MySQL 与 `npm run db:create`，完整跑一次建表与搜索。
2. 填入淘宝、拼多多凭证，记录真实返回字段与价格，与页面人工核对。
3. 填入 DeepSeek 密钥，使用 10–20 个真实样本验证误报/漏报与 SKU 判断。
4. 分别登录抖音、小红书，记录搜索页结构变化与失败原因。
5. 在真实运行中重启后端，验证 `INTERRUPTED` 状态。
6. 按平台统计搜索覆盖率、采集成功率、AI 准确率/召回率、价格准确率，并输出结论。

---

## 10. Phase 3.5 浏览器采集修复验证（2026-11-23）

为不影响正在运行的 3000 主服务与其密钥，验证使用独立测试实例：

```text
DB_TYPE=sqlite  SQLITE_PATH=data/phase35-verify.sqlite  PORT=3001
AI_CLASSIFY_ENABLED=false  BROWSER_PROVIDERS_ENABLED=true  PLAYWRIGHT_HEADLESS=true
```

测试数据库、日志已在验证后删除；未修改主服务数据库。

### 10.1 构建与单元测试

| 项目 | 结果 |
|---|---|
| `backend npm run build` | 通过 |
| `frontend npm run build` | 通过（约 2.10 MB raw / 369 KB transfer） |
| `backend npm test` | 通过，55 项（新增人工验证尝试上限、平台等待状态聚合、小红书商品/笔记链接判定、商品模式分类） |

### 10.2 抖音真实验证码暂停

使用关键词 `StickerFinder 验证测试 20261123` 发起真实搜索：

- 抖音 Playwright 渠道真实遇到验证码，返回 `CAPTCHA_REQUIRED`；
- 渠道状态为 `WAITING_MANUAL_VERIFICATION`，没有标记 `FAILED`；
- 搜索任务（SearchRun）状态为 `WAITING_MANUAL_VERIFICATION`，小红书/拼多多渠道保持 `PENDING`，未继续执行；
- `manual_verification` 已保存：关键词、被拦截时的目标 URL（`...?type=goods`）、Profile 目录 `backend/.auth/douyin`、`attempts=1 / maxAttempts=3`、进度 `2/6` 个渠道、已完成平台 `taobao`、剩余平台 `xiaohongshu`/`pinduoduo`；
- 搜索详情接口向前端返回 `manualVerification` 与 `manualBrowserOpen=false`。

### 10.3 打开验证浏览器与继续采集

- `POST /api/searches/:id/tasks/:taskId/verification/browser` 返回 `opened=true`，启动了一个独立可见浏览器并打开保存的目标 URL，Profile 与自动采集一致；随后搜索详情返回 `manualBrowserOpen=true`、`openedAt` 已写入。
- 在未人工完成验证的情况下调用 `POST .../verification/resume`：
  - 后端先关闭验证浏览器，释放用户数据目录；
  - 渠道从 `PENDING` 重新进入 `RUNNING`，重新加载页面并再次检查验证码/登录；
  - 该次页面没有再出现验证码，但由于测试关键词没有商品卡片，渠道返回 `FAILED` / `PARSE_FAILED`，没有假定“验证成功”；
  - 未发生“两个浏览器进程同时使用同一个 Profile”。
- 尝试次数上限（第 4 次拦截 → 明确失败）由单元测试覆盖，未重复触发真实验证码。

### 10.4 小红书商品模式与 GOODS_SEARCH_UNAVAILABLE

同一真实搜索中的小红书 Playwright 渠道：

- 网页只返回 30 条笔记链接，0 个商品卡片；
- 渠道返回 `FAILED` / `GOODS_SEARCH_UNAVAILABLE`，错误信息明确说明未进入可用的商城商品搜索模式、没有把笔记当作商品；
- 商品候选列表保持为空，没有写入任何笔记数据。
- 验证后收紧了提示语：只要页面只有笔记且没有商品卡片，就不再声称“商品搜索模式可进入”。

### 10.5 前端 UI 验证

- 使用独立 Angular 预览服务（临时代理指向 3001 测试实例）加载新前端。
- 为验证控件，在测试库中构造了一个 `WAITING_MANUAL_VERIFICATION` 渠道状态（仅用于 UI 验证，不冒充真实平台事件）；真实验证码暂停已在 10.2 通过 API 验证。
- UI 正确显示：平台与渠道的“等待人工验证”标签、`CAPTCHA_REQUIRED · 需要人工完成验证码`、关键词、`人工验证 1/3 次`、`进度 2/6 个渠道`、目标 URL、Profile 路径，以及“打开验证浏览器 / 继续采集”按钮。
- 点击“打开验证浏览器”：独立可见浏览器打开，按钮变为“重新打开验证浏览器 / 关闭浏览器”，页面显示“验证浏览器窗口已打开”。
- 点击“继续采集”：验证浏览器被关闭，搜索恢复并重新检查页面；该次因测试关键词无商品卡片返回 `PARSE_FAILED`，UI 显示采集失败，没有假定验证成功。
- 前端预览服务、临时代理配置、测试数据库与日志均已清理。

### 10.6 未验证事项

- 人工真实完成抖音验证码后，继续采集并成功解析商品的完整链路；本次只验证到“重新检查并明确返回失败”。
- 小红书真实商城商品搜索页的名称/图片/价格/链接提取；当前环境网页端只出现笔记。
- 两个外部浏览器进程同时占用 Profile 时的 `BROWSER_PROFILE_BUSY` 实际表现（代码与提示已实现，未构造外部占用）。
- Android 模拟器 + Appium 原生 App 方案：仅完成可行性研究，未接入、未运行。
- 验证码尝试上限的真实第 4 次拦截。

---

## 11. Phase 5 Phase 1：安全层修复验证（2026-11-24）

### 11.1 数据保护

- 改动前使用 better-sqlite3 的 `backup()` 生成备份：`backend/data/backups/sticker-finder-pre-phase5-*.sqlite`。
- 未删除任何商品、观察记录、AI 历史结果或人工复核记录。

### 11.2 变更与测试

- 安全层拆分为硬阻断（`safetyBlockers`）与普通警告（`safetyWarnings`）；只有硬阻断会把 MATCH 降为 UNCERTAIN。
- 视觉未启用、描述/SKU/图片缺失等进入 warnings；置信度低于阈值、无证据、类别/系列/款式冲突、SKU 判断矛盾等进入 blockers。
- 同时保存 AI 原始判定（`rawMatchStatus` / `rawConfidence`）与最终判定（`matchStatus` / `confidence`）。
- 新增独立的 `skuVerificationStatus` 与 `priceVerificationStatus`；搜索列表价不会因为商品 MATCH 就被标记为目标 SKU 价格已核验。
- `backend npm run build` 通过；`backend npm test` 通过 **85 项**，新增用例覆盖：
  - 视觉未启用但置信度仍高于阈值时保持 MATCH；
  - 硬阻断降级时原始/最终判定分别保存；
  - 搜索数据不把 SKU 或价格标记为已核验。
- `frontend npm run build` 通过。

### 11.3 未验证事项

- 2026-11-24「小镇一角」70 条候选的完整重跑（会产生新的 DeepSeek 调用）留到 Phase 8 回归测试。
- 真实商品详情、SKU 价格核验、并行搜索、取消接口、一键人工审核属于后续 Phase。

### 11.4 Phase 2：详情与 SKU 核验

- 每平台详情上限由 3 提升到 10（`EVERYINFRA_DETAIL_MAX_PER_PLATFORM`），详情并发默认 2（`EVERYINFRA_DETAIL_CONCURRENCY`）。
- 详情候选不再机械取前 N 条：按相关性、目标款式确认情况、标题/系列证据排序，跳过 NO_MATCH、类别冲突和无关候选。
- 详情返回 SKU/描述后，用同一候选再次调用 AI（`detailEnriched=true`），并更新已有 matchResult；详情失败时保留原结果，标记 SKU 核验失败和「详情暂不可用」。
- 只有详情后确认目标 SKU 才标记 `skuVerificationStatus=VERIFIED`；目标 SKU 有接口价格时才标记 `priceVerificationStatus=VERIFIED/PARTIAL`，否则保持 `UNVERIFIED`。
- `backend npm test` 通过 **88 项**，新增详情后 SKU/价格核验用例；后端与前端构建通过。
- 真实详情链路（搜索结果 → 详情 → SKU 二次识别 → 价格展示）将在 Phase 8 用真实商品回归。

### 11.5 Phase 3：并行搜索与 AI 并发

- 所选平台通过 `Promise.all` 独立执行，一个平台的搜索/AI/详情不会阻塞其他平台。
- 同一平台的 AI 识别按 `AI_CLASSIFY_CONCURRENCY`（默认 3，最高 5）并发；同款判断预算改为每平台独立。
- 详情补充在每个平台内部并发 2 执行；平台之间互不等待。
- 未选中的平台不创建任务，结果接口只返回实际有任务的平台，不再显示假的 `NOT_CONFIGURED` 页签。
- 平台选择由现有前端复选框和后端 `CreateSearchDto.platforms` 提供。
- `backend npm test` 通过 **88 项**；后端与前端构建通过。
- 真实多平台并行搜索与实时结果更新将在 Phase 8 回归。

### 11.6 Phase 4：取消与中断恢复

- 新增 `POST /api/searches/:id/cancel`、前端「停止搜索」按钮和关闭页面提示。
- 取消后 run 与未完成渠道任务标记为 `CANCELLED`；编排器在平台、渠道、AI 识别和详情队列之间检查取消标志，不再启动新的收费或 AI 请求。
- 已完成商品、观察记录、AI 结果和实际扣费记录保留；UI 不声称第三方请求已退费。
- 进程重启的启动恢复继续把 RUNNING/PENDING 搜索标记为 `INTERRUPTED`，与用户主动 `CANCELLED` 区分。
- `backend npm test` 通过 **89 项**，新增取消状态聚合用例；后端与前端构建通过。
- 真实搜索中取消、等待验证中取消、取消后重新打开页面将在 Phase 8 验证。

### 11.7 Phase 5：一键审核与反馈库

- 商品卡片新增「确认同款 / 排除 / 撤销」一键操作，不再必须打开弹窗；网络失败时按钮恢复并提示，不显示假成功。
- 多 SKU 商品增加「SKU 人工判断」区域，可标记目标款、组合装或排除；`manual_sku_decisions` 与商品级 `manual_decision` 分开保存。
- 人工复核只更新 manual 字段，AI 原始判定、安全警告、SKU/价格核验状态不被覆盖。
- 完全相同商品（平台 ID + 标题 + SKU + 主图一致）会复用历史人工判断；店铺不同或内容变化不自动继承。
- 同一目标/系列/平台的历史人工结论最多 2 条加入 AI 输入，作为辅助证据，Prompt 明确不得据此强制 MATCH。
- `backend npm test` 通过 **89 项**；后端与前端构建通过。
- 真实一键审核、撤销和历史复用在 Phase 8 用真实候选回归。

### 11.8 Phase 6：规范化、去重与价格展示

- 新增 `seriesAliases` / `brandNames` 输入与存储；`search_runs` 增量字段见迁移 SQL。
- 新增 `normalizeTargetText`：NFKC（全角转半角）、去空白、常见异体字（如 姸→妍）与英文小写归一；用于详情优先级、历史案例匹配和标题去重归一，不覆盖原始名称。
- 去重仍按平台 ID → 规范化链接 → 有充分证据的同商品；标题+店铺强匹配要求店铺存在，不会按标题单独合并。
- 价格展示：目标 SKU 已核验时显示具体规格价格；未核验显示「¥X 起 · 规格待确认」；详情失败显示「详情暂不可用」；1688 批发价独立展示。
- `backend npm test` 通过 **90 项**，新增名称归一用例；后端与前端构建通过。
- 真实多店铺同款、SKU 价格与去重效果在 Phase 8 回归。

### 11.9 Phase 7：前端简化与进度

- 商品卡片增加文字状态：「已确认同款 / 系列匹配，规格待确认 / 待确认 / 已排除」；AI 置信度从卡片摘要移除，详细证据、相关性、建议、SKU/价格核验状态收进默认折叠的「判断依据」。
- 平台面板显示「已找到 X · 已识别 Y · 详情核验 Z」；被排除商品可展开查看标题与链接；来源状态默认折叠，等待人工验证时自动展开。
- 搜索表单把别名、系列别名、品牌/创作者放入「更多选项」；主行保留名称、系列，平台选择与参考图仍在下方。
- 商品卡片操作按钮固定在底部，不依赖 hover，移动端可点击。
- 未实现独立的「设置页面」；API/渠道状态改为折叠区域，主页面聚焦搜索与结果。
- 后端与前端构建通过，后端 **90 项测试**通过。
- 真实移动端与浏览器交互在 Phase 8 回归。

---

## 12. Phase 5 Phase 8 真实回归（2026-11-24）

使用数据库副本 + 独立 3101 实例，未修改正式历史数据。

### 12.1 三平台并行

- 淘宝搜索 20 秒超时（`EVERYINFRA_TIMEOUT`），抖音/小红书正常；其他平台未被阻塞。
- 抖音 30 条：20 MATCH / 5 UNCERTAIN / 5 NO_MATCH；小红书 19 条：6 / 7 / 6。
- 扣费 $0.013556；超时请求未扣费。

### 12.2 详情、SKU 与参考图回归

- 抖音搜索 + 2 个详情，$0.024；2 个候选 `skuVerificationStatus=VERIFIED`；详情无 SKU 价格时价格保持 `UNVERIFIED`。
- 参考图 + 淘宝/抖音（45 秒超时）：淘宝 20 条 16 MATCH，抖音 30 条 21 MATCH；28 条 MATCH 保持 MATCH，视觉警告存在但 `safetyBlockers` 为空。
- 1 条 `TARGET_VARIANT` 因没有 SKU 详情合法降级为 UNCERTAIN。
- 4 个详情；1 个淘宝详情短暂失败，原结果保留并标记 SKU FAILED；1 个淘宝 SKU + 价格 `VERIFIED`；扣费 $0.042。

### 12.3 审核与取消

- 一键 MATCH、SKU TARGET、撤销均通过 API 验证；AI 原始字段未被覆盖。
- 取消后 run/平台为 `CANCELLED`，重复取消幂等；取消后无新增 AI/详情调用；在途搜索产生 1 次 $0.005556 扣费。

### 12.4 成本与限制

- Phase 8 测试合计约 **$0.0851**；测试数据库与临时实例已删除。
- 淘宝曾因 20 秒超时失败；默认 `PROVIDER_HTTP_TIMEOUT_MS` 已提高到 30000。
- 前端新交互未做完整浏览器自动化；Android 模拟器 + Appium 未接入。
- 详细交付见 [phase5-delivery.md](phase5-delivery.md)。
