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
| `backend npm test` | 通过，37 项（URL 规范化、浏览器价格解析、Qovia/OKData 映射、去重与状态聚合、AI Schema/降级、敏感字段脱敏） |
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
- 当前 `QOVIA_API_KEY`、`OKDATA_API_KEY` 为空：
  - Qovia/OKData 渠道正确显示 `NOT_CONFIGURED`；
  - Playwright 渠道独立执行，抖音返回 `PARSE_FAILED`，小红书返回 `BLOCKED_BY_PLATFORM`；
  - 平台聚合为 `FAILED`，渠道卡片分别显示来源、状态、耗时和错误。
- 前端渠道状态、来源标签、原始信息展开、多来源价格对比已用一次性本地数据验证：
  - 同一候选商品关联 Qovia（¥9.00）与 Playwright（¥9.50）两个观察记录；
  - 前端显示“价格不一致”，并列展示两个价格与采集时间，未自动选择真实价格；
  - 验证后已删除测试数据与数据库。
- 新增 37 项单元测试，其中 Qovia/OKData 使用官方文档示例响应测试字段映射，**不代表真实采集成功**；真实第三方结果仍需配置 Key 后验证。

未验证：Qovia/OKData live 调用、真实用户商品结果、真实跨来源同款合并、登录后的 Playwright 双来源结果、MySQL 增量迁移执行。DeepSeek Key 已配置，但本次没有真实候选商品，内容识别与同款判断未做 live 验证。

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

其中若干条在审查验证阶段已被反驳，原因是修复在此前已经落地。当前构建与 37 项单元测试均通过。

---

## 7. 未验证事项

以下项目缺少凭证、账号或账号权限，**未做真实调用验证**：

- MySQL 运行时（仅验证 SQLite；实体与配置按 MySQL 设计，但未实际启动 MySQL 库）。
- 淘宝客接口真实返回、应用权限、价格字段。
- 拼多多多多进宝接口真实返回、签名字段、单买/拼团价格。
- DeepSeek 真实商品识别与同款判断（Key 已配置，但本次没有真实候选商品）。
- Qovia / OKData 真实请求、账号权限、返回字段与地区差异（Key 为空）。
- 抖音登录后的真实商品搜索、卡片解析、价格提取。
- 小红书登录后的商品搜索，以及“仅笔记”场景的真实表现。
- Bamboo / SocialToAI Adapter（仅预留，未实现）。
- 长时间运行、并发搜索、限流与平台风控的实际表现。

---

## 8. 已知限制

- 抖音、小红书当前只解析列表页，未进入详情页提取 SKU 与 SKU 价格；AI 对多数候选会返回 `UNCERTAIN`。
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
