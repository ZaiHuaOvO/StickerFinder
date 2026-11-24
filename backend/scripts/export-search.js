/* 导出一次搜索的完整数据，供人工/另一个 AI 做识别优化。
 * 用法：node scripts/export-search.js <searchId> [outputRoot]
 * 当前仅支持本地 SQLite 模式。
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const axios = require('axios');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');

dotenv.config({
  path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '../.env')],
});

const searchId = process.argv[2];
const outputRoot = path.resolve(
  process.cwd(),
  process.argv[3] || path.join('..', 'exports'),
);
if (!searchId) {
  console.error('用法：node scripts/export-search.js <searchId> [outputRoot]');
  process.exit(1);
}
if ((process.env.DB_TYPE || 'mysql').toLowerCase() !== 'sqlite') {
  console.error('当前导出脚本仅支持 DB_TYPE=sqlite。');
  process.exit(1);
}

const dbFile = path.resolve(
  process.cwd(),
  process.env.SQLITE_PATH || path.join('data', 'sticker-finder.sqlite'),
);
const db = new Database(dbFile, { readonly: true, fileMustExist: true });

const PLATFORM_ORDER = ['taobao', 'douyin', 'xiaohongshu', 'pinduoduo'];
const PROVIDER_LABELS = {
  taobao_tbk: '淘宝客 API',
  pdd_ddk: '多多进宝 API',
  qovia: 'Qovia 第三方 API',
  bamboo: 'Bamboo 第三方 API',
  okdata: 'OKData 第三方 API',
  socialtoai: 'SocialToAI 第三方 API',
  playwright: 'Playwright 浏览器',
};
const SOURCE_LABELS = {
  official_api: '官方 API',
  third_party_api: '第三方数据 API',
  playwright: 'Playwright 浏览器',
};

function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseDbDate(value) {
  if (!value) return null;
  const text = String(value);
  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function iso(value) {
  const date = parseDbDate(value);
  return date ? date.toISOString() : null;
}

function localTime(value) {
  const date = parseDbDate(value);
  return date
    ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '—';
}

function durationMs(task) {
  const start = parseDbDate(task.started_at);
  const end = parseDbDate(task.completed_at);
  return start && end ? Math.max(0, end.getTime() - start.getTime()) : null;
}

function aggregatePlatformStatus(tasks) {
  if (tasks.some((task) => task.status === 'RUNNING')) return 'RUNNING';
  if (tasks.some((task) => task.status === 'PENDING')) return 'PENDING';
  if (tasks.length === 0) return 'NOT_CONFIGURED';
  const notConfigured = tasks.filter((task) => task.status === 'NOT_CONFIGURED');
  const configured = tasks.filter((task) => task.status !== 'NOT_CONFIGURED');
  if (configured.length === 0) return 'NOT_CONFIGURED';
  const withData = configured.filter(
    (task) =>
      task.result_count > 0 || task.status === 'SUCCESS' || task.status === 'PARTIAL_SUCCESS',
  );
  const failures = configured.filter(
    (task) => task.status === 'FAILED' || task.status === 'BLOCKED',
  );
  const empties = configured.filter((task) => task.status === 'EMPTY');
  if (withData.length > 0) {
    if (
      withData.length < tasks.length ||
      notConfigured.length > 0 ||
      failures.length > 0 ||
      empties.length > 0 ||
      withData.some((task) => task.status === 'PARTIAL_SUCCESS')
    ) {
      return 'PARTIAL_SUCCESS';
    }
    return 'SUCCESS';
  }
  if (failures.length > 0) return 'FAILED';
  if (empties.length > 0) return 'EMPTY';
  return 'NOT_CONFIGURED';
}

function effectiveStatus(match) {
  if (!match) return 'UNCERTAIN';
  if (match.manual_decision === 'MATCH') return 'MATCH';
  if (match.manual_decision === 'NO_MATCH') return 'NO_MATCH';
  return match.match_status;
}

function safeFileName(value) {
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function mdEscape(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function downloadImage(url, targetBase, referer) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      headers: {
        'User-Agent': 'Mozilla/5.0 StickerFinder export',
        Accept: 'image/*',
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const contentType = String(response.headers['content-type'] || '').split(';')[0];
    if (!contentType.startsWith('image/')) {
      return { error: `非图片响应：${contentType || 'unknown'}` };
    }
    const ext =
      contentType === 'image/png'
        ? '.png'
        : contentType === 'image/webp'
          ? '.webp'
          : contentType === 'image/gif'
            ? '.gif'
            : '.jpg';
    const file = `${targetBase}${ext}`;
    await fsp.writeFile(file, Buffer.from(response.data));
    return { file, contentType, bytes: response.data.byteLength };
  } catch (error) {
    return { error: error.message };
  }
}

async function main() {
  const run = db.prepare('select * from search_runs where id = ?').get(searchId);
  if (!run) throw new Error(`搜索任务不存在：${searchId}`);

  const tasks = db
    .prepare('select * from platform_search_tasks where search_run_id = ?')
    .all(searchId);
  const candidates = db
    .prepare(
      "select * from product_candidates where search_run_id = ? order by platform, collected_at asc",
    )
    .all(searchId);
  const observations = db
    .prepare('select * from product_observations where search_run_id = ? order by observed_at asc')
    .all(searchId);
  const matches = db
    .prepare(
      `select m.* from product_match_results m
       join product_candidates c on c.id = m.candidate_id
       where c.search_run_id = ?`,
    )
    .all(searchId);

  const observationsByCandidate = new Map();
  for (const observation of observations) {
    const list = observationsByCandidate.get(observation.candidate_id) || [];
    list.push(observation);
    observationsByCandidate.set(observation.candidate_id, list);
  }
  const matchByCandidate = new Map(matches.map((match) => [match.candidate_id, match]));

  const folder = path.join(
    outputRoot,
    `${safeFileName(run.target_name)}-${searchId.slice(0, 8)}`,
  );
  await fsp.mkdir(path.join(folder, 'images'), { recursive: true });

  const referenceImageInfo = {
    provided: Boolean(run.reference_image),
    fileName: run.reference_image ? path.basename(run.reference_image) : null,
    exportedPath: null,
  };
  if (run.reference_image && fs.existsSync(run.reference_image)) {
    const ext = path.extname(run.reference_image) || '.img';
    const target = path.join(folder, `reference-image${ext}`);
    await fsp.copyFile(run.reference_image, target);
    referenceImageInfo.exportedPath = path.relative(folder, target).replace(/\\/g, '/');
  }

  const promptSource = fs.readFileSync(
    path.join(__dirname, '../src/ai/prompts/product-classification.prompt.ts'),
    'utf8',
  );
  const promptMatch = promptSource.match(/CLASSIFICATION_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  const promptVersionMatch = promptSource.match(/PROMPT_VERSION = '([^']+)'/);

  const platformResults = [];
  const candidateExports = [];
  let index = 0;

  for (const platform of PLATFORM_ORDER) {
    const platformTasks = tasks.filter((task) => task.platform === platform);
    const platformCandidates = candidates.filter((candidate) => candidate.platform === platform);
    const status = aggregatePlatformStatus(platformTasks);

    const candidateDtos = [];
    for (const candidate of platformCandidates) {
      index += 1;
      const match = matchByCandidate.get(candidate.id) || null;
      const observationDtos = (observationsByCandidate.get(candidate.id) || []).map((obs) => ({
        id: obs.id,
        provider: obs.provider,
        providerLabel: PROVIDER_LABELS[obs.provider] || obs.provider,
        source: obs.source,
        sourceLabel: SOURCE_LABELS[obs.source] || obs.source,
        sourceProductId: obs.source_product_id,
        title: obs.title,
        shopName: obs.shop_name,
        productUrl: obs.product_url,
        imageUrls: safeJson(obs.image_urls, []),
        description: obs.description,
        skuOptions: safeJson(obs.sku_data, []),
        price: safeJson(obs.price_data, null),
        originalPrice: safeJson(obs.original_price_data, null),
        groupPrice: safeJson(obs.group_price_data, null),
        salesText: obs.sales_text,
        rating: obs.rating,
        region: obs.region,
        regionNote: obs.region_note,
        matchReason: obs.match_reason,
        rawData: safeJson(obs.raw_data, null),
        observedAt: iso(obs.observed_at),
        observedAtLocal: localTime(obs.observed_at),
        collectedAt: iso(obs.collected_at),
      }));

      const imageUrls = safeJson(candidate.image_urls, []);
      const primaryImageUrl = imageUrls[0] || observationDtos.find((obs) => obs.imageUrls[0])?.imageUrls[0];
      let localImage = null;
      if (primaryImageUrl) {
        const download = await downloadImage(
          primaryImageUrl,
          path.join(folder, 'images', `${String(index).padStart(2, '0')}-${candidate.id}`),
          candidate.product_url,
        );
        if (download.file) {
          localImage = {
            path: path.relative(folder, download.file).replace(/\\/g, '/'),
            contentType: download.contentType,
            bytes: download.bytes,
          };
        } else {
          localImage = { error: download.error };
        }
      }

      const dto = {
        index,
        candidateId: candidate.id,
        platform,
        platformProductId: candidate.platform_product_id,
        title: candidate.title,
        shopName: candidate.shop_name,
        productUrl: candidate.product_url,
        imageUrls,
        primaryImageUrl: primaryImageUrl || null,
        localImage,
        description: candidate.description,
        skuOptions: safeJson(candidate.sku_data, []),
        primaryPrice: safeJson(candidate.price_data, null),
        groupPrice: safeJson(candidate.group_price_data, null),
        sourceType: candidate.source_type,
        collectedAt: iso(candidate.collected_at),
        collectedAtLocal: localTime(candidate.collected_at),
        observations: observationDtos,
        ai: match
          ? {
              matchStatus: match.match_status,
              matchType: match.match_type,
              candidateRelevance: match.candidate_relevance,
              categoryMatch: match.category_match,
              seriesMatch: match.series_match,
              targetItemMatch: match.target_item_match,
              visualMatch: match.visual_match,
              confidence: match.confidence,
              summary: match.summary,
              reason: match.reason,
              matchedContents: safeJson(match.matched_contents, []),
              matchedSkuIds: safeJson(match.matched_sku_ids, []),
              skuDecisions: safeJson(match.sku_decisions, []),
              evidence: safeJson(match.evidence, []),
              nextAction: match.next_action,
              rawMatchStatus: match.raw_match_status,
              rawConfidence: match.raw_confidence,
              safetyWarnings: safeJson(match.safety_warnings, []),
              safetyBlockers: safeJson(match.safety_blockers, []),
              skuVerificationStatus: match.sku_verification_status,
              priceVerificationStatus: match.price_verification_status,
              needsManualReview: Boolean(match.needs_manual_review),
              aiStatus: match.ai_status,
              aiModel: match.ai_model,
              aiError: match.ai_error,
              rawResponse: safeJson(match.ai_raw_response, null),
              classifiedAt: iso(match.classified_at),
              manualDecision: match.manual_decision,
              manualNote: match.manual_note,
              reviewedAt: iso(match.reviewed_at),
            }
          : null,
        effectiveMatchStatus: effectiveStatus(match),
      };
      candidateDtos.push(dto);
      candidateExports.push(dto);
    }

    const statusOrder = { MATCH: 0, UNCERTAIN: 1, NO_MATCH: 2 };
    candidateDtos.sort(
      (a, b) =>
        (statusOrder[a.effectiveMatchStatus] ?? 9) -
          (statusOrder[b.effectiveMatchStatus] ?? 9) ||
        (b.ai?.confidence ?? -1) - (a.ai?.confidence ?? -1),
    );

    platformResults.push({
      platform,
      status,
      candidateCount: candidateDtos.length,
      matchedCount: candidateDtos.filter((c) => c.effectiveMatchStatus === 'MATCH').length,
      uncertainCount: candidateDtos.filter((c) => c.effectiveMatchStatus === 'UNCERTAIN').length,
      excludedCount: candidateDtos.filter((c) => c.effectiveMatchStatus === 'NO_MATCH').length,
      channels: platformTasks.map((task) => ({
        taskId: task.id,
        provider: task.provider,
        providerLabel: PROVIDER_LABELS[task.provider] || task.provider,
        providerType: task.provider_type,
        status: task.status,
        resultCount: task.result_count,
        errorCode: task.error_code,
        errorMessage: task.error_message,
        note: task.note,
        startedAt: iso(task.started_at),
        completedAt: iso(task.completed_at),
        durationMs: durationMs(task),
      })),
      candidates: candidateDtos,
    });
  }

  const exportData = {
    exportVersion: '1.0',
    exportedAt: new Date().toISOString(),
    purpose: '用于另一个 AI/人工优化 StickerFinder 的商品识别与同款判断',
    search: {
      searchId: run.id,
      targetName: run.target_name,
      seriesName: run.series_name,
      aliases: safeJson(run.aliases, []),
      seriesAliases: safeJson(run.series_aliases, []),
      brandNames: safeJson(run.brand_names, []),
      referenceImage: referenceImageInfo,
      status: run.status,
      errorMessage: run.error_message,
      startedAt: iso(run.started_at),
      startedAtLocal: localTime(run.started_at),
      completedAt: iso(run.completed_at),
      completedAtLocal: localTime(run.completed_at),
      durationMs:
        parseDbDate(run.started_at) && parseDbDate(run.completed_at)
          ? parseDbDate(run.completed_at).getTime() - parseDbDate(run.started_at).getTime()
          : null,
    },
    configuration: {
      database: 'sqlite',
      ai: {
        configured: Boolean(process.env.DEEPSEEK_API_KEY),
        model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        classifyEnabled: (process.env.AI_CLASSIFY_ENABLED || 'true') !== 'false',
        visionEnabled: (process.env.AI_VISION_ENABLED || 'false') === 'true',
        minConfidence: Number(process.env.AI_MIN_CONFIDENCE || '0.65'),
        promptVersion: promptVersionMatch ? promptVersionMatch[1] : null,
      },
      search: {
        maxResultsPerPlatform: Number(process.env.SEARCH_MAX_RESULTS_PER_PLATFORM || '20'),
        maxPages: Number(process.env.SEARCH_MAX_PAGES || '2'),
      },
      browser: {
        headless: (process.env.PLAYWRIGHT_HEADLESS || 'false') === 'true',
        channel: process.env.PLAYWRIGHT_CHANNEL || null,
      },
      providers: {
        taobaoConfigured: Boolean(process.env.TAOBAO_APP_KEY && process.env.TAOBAO_APP_SECRET && process.env.TAOBAO_ADZONE_ID),
        pddConfigured: Boolean(process.env.PDD_CLIENT_ID && process.env.PDD_CLIENT_SECRET),
        qoviaConfigured: Boolean(process.env.QOVIA_API_KEY),
        okdataConfigured: Boolean(process.env.OKDATA_API_KEY),
        playwrightProfiles: {
          douyin: fs.existsSync(path.resolve(process.cwd(), process.env.BROWSER_USER_DATA_DIR || '.auth', 'douyin')),
          xiaohongshu: fs.existsSync(path.resolve(process.cwd(), process.env.BROWSER_USER_DATA_DIR || '.auth', 'xiaohongshu')),
        },
      },
    },
    aiPrompt: {
      systemPrompt: promptMatch ? promptMatch[1] : null,
      promptVersion: promptVersionMatch ? promptVersionMatch[1] : null,
      note: '这是导出时项目中实际使用的 DeepSeek 系统提示词；输出 JSON 字段见提示词末尾。',
    },
    platformResults,
    candidates: candidateExports,
    optimizationNotes: [
      '当前 Qovia/OKData 搜索接口只提供标题级信息，没有商品描述与 SKU。',
      '参考图已上传，但本次 AI_VISION_ENABLED=false，视觉比对未参与判断。',
      '抖音/XHS 的 Playwright 渠道分别被验证码中间页和仅笔记结果限制，未提供商品。',
      'v2 会区分候选相关性（candidateRelevance）与匹配状态，并给出 nextAction；信息不足但类别/系列匹配的候选应显示为高相关 + 待补 SKU，不应直接排除。',
      '请重点检查：系列匹配但缺少 SKU 的候选是否被正确标为 HIGH + UNCERTAIN + FETCH_SKU；明确无关类别或其他系列单款是否直接 NO_MATCH；如何在不引入误报的前提下继续优化 Prompt。',
    ],
  };

  await fsp.writeFile(
    path.join(folder, 'search-export.json'),
    JSON.stringify(exportData, null, 2),
    'utf8',
  );

  const lines = [];
  lines.push(`# StickerFinder 搜索导出：${run.target_name}`);
  lines.push('');
  lines.push(`- 搜索 ID：\`${run.id}\``);
  lines.push(`- 导出时间：${localTime(new Date().toISOString())}`);
  lines.push(`- 目标贴纸：**${run.target_name}**`);
  lines.push(`- 系列：${run.series_name || '未填写'}`);
  lines.push(`- 别名：${safeJson(run.aliases, []).join('、') || '未填写'}`);
  lines.push(`- 参考图：${referenceImageInfo.provided ? `已上传，导出为 \`${referenceImageInfo.exportedPath || '（本地文件不存在）'}\`` : '未上传'}`);
  lines.push(`- 搜索状态：${run.status}`);
  lines.push(`- 开始：${localTime(run.started_at)}｜完成：${localTime(run.completed_at)}`);
  lines.push('');
  lines.push('## 这次是怎么搜的');
  lines.push('');
  lines.push('搜索表单输入：');
  lines.push('');
  lines.push('| 字段 | 值 |');
  lines.push('|---|---|');
  lines.push(`| 目标贴纸名称 | ${mdEscape(run.target_name)} |`);
  lines.push(`| 系列名称 | ${mdEscape(run.series_name || '未填写')} |`);
  lines.push(`| 其他名称/别名 | ${mdEscape(safeJson(run.aliases, []).join('、') || '未填写')} |`);
  lines.push(`| 参考图片 | ${referenceImageInfo.provided ? '已上传（视觉比对未启用）' : '未上传'} |`);
  lines.push('');
  lines.push('AI/搜索配置：');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(exportData.configuration, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 平台与渠道状态');
  lines.push('');
  lines.push('| 平台 | 平台状态 | 候选 | 匹配 | 待确认 | 已排除 |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const platform of platformResults) {
    lines.push(
      `| ${platform.platform} | ${platform.status} | ${platform.candidateCount} | ${platform.matchedCount} | ${platform.uncertainCount} | ${platform.excludedCount} |`,
    );
  }
  lines.push('');
  for (const platform of platformResults) {
    lines.push(`### ${platform.platform} 渠道`);
    lines.push('');
    lines.push('| 来源 | 状态 | 结果数 | 耗时 | 错误/备注 |');
    lines.push('|---|---|---:|---:|---|');
    for (const channel of platform.channels) {
      lines.push(
        `| ${channel.providerLabel} | ${channel.status} | ${channel.resultCount} | ${channel.durationMs == null ? '—' : `${(channel.durationMs / 1000).toFixed(1)}s`} | ${mdEscape(channel.errorMessage || channel.note || '')} |`,
      );
    }
    lines.push('');
  }
  lines.push('## 全部候选商品（包含未展示的已排除项）');
  lines.push('');
  lines.push('| # | 平台 | 最终状态 | AI 状态 | 类型 | 置信度 | 标题 | 店铺 | 价格 | 来源 |');
  lines.push('|---:|---|---|---|---|---:|---|---|---|---|');
  for (const candidate of candidateExports) {
    const source = [...new Set(candidate.observations.map((obs) => obs.providerLabel))].join(' / ') || candidate.sourceType;
    lines.push(
      `| ${candidate.index} | ${candidate.platform} | ${candidate.effectiveMatchStatus} | ${candidate.ai?.matchStatus || '—'} | ${candidate.ai?.matchType || '—'} | ${candidate.ai?.confidence ?? '—'} | ${mdEscape(candidate.title)} | ${mdEscape(candidate.shopName || '—')} | ${mdEscape(candidate.primaryPrice?.displayText || '未获取')} | ${mdEscape(source)} |`,
    );
  }
  lines.push('');
  for (const candidate of candidateExports) {
    lines.push(`### ${candidate.index}. ${candidate.title}`);
    lines.push('');
    lines.push(`- 平台：${candidate.platform}`);
    lines.push(`- 商品链接：${candidate.productUrl}`);
    lines.push(`- 店铺：${candidate.shopName || '—'}`);
    lines.push(`- 最终状态：${candidate.effectiveMatchStatus}`);
    lines.push(`- AI 状态/类型/置信度：${candidate.ai?.matchStatus || '—'} / ${candidate.ai?.matchType || '—'} / ${candidate.ai?.confidence ?? '—'}`);
    lines.push(`- AI 摘要：${candidate.ai?.summary || '—'}`);
    lines.push(`- AI 理由：${candidate.ai?.reason || '—'}`);
    if (candidate.ai?.evidence?.length) {
      const evidenceText = candidate.ai.evidence
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : `[${entry.sourceField || '未知'}] ${entry.content || ''}${
                entry.interpretation ? `（${entry.interpretation}）` : ''
              }`,
        )
        .join('；');
      lines.push(`- 证据：${evidenceText}`);
    }
    if (candidate.ai?.candidateRelevance) {
      lines.push(
        `- 相关性/类别/系列/款式/视觉：${candidate.ai.candidateRelevance} / ${candidate.ai.categoryMatch || '—'} / ${candidate.ai.seriesMatch || '—'} / ${candidate.ai.targetItemMatch || '—'} / ${candidate.ai.visualMatch || '—'}`,
      );
    }
    if (candidate.ai?.nextAction && candidate.ai.nextAction !== 'NONE') {
      lines.push(`- 建议下一步：${candidate.ai.nextAction}`);
    }
    if (candidate.ai?.rawMatchStatus && candidate.ai.rawMatchStatus !== candidate.ai.matchStatus) {
      lines.push(
        `- AI 原始/最终：${candidate.ai.rawMatchStatus} / ${candidate.ai.matchStatus}（原始置信度 ${candidate.ai.rawConfidence ?? '—'}，最终 ${candidate.ai.confidence ?? '—'}）`,
      );
    }
    if (candidate.ai?.safetyBlockers?.length) {
      lines.push(`- 系统阻断：${candidate.ai.safetyBlockers.join('；')}`);
    }
    if (candidate.ai?.safetyWarnings?.length) {
      lines.push(`- 系统警告：${candidate.ai.safetyWarnings.join('；')}`);
    }
    if (candidate.ai?.skuVerificationStatus) {
      lines.push(
        `- SKU/价格核验：${candidate.ai.skuVerificationStatus} / ${candidate.ai.priceVerificationStatus || '—'}`,
      );
    }
    if (candidate.ai?.matchedContents?.length) {
      lines.push(`- 匹配内容：${candidate.ai.matchedContents.join('、')}`);
    }
    if (candidate.ai?.needsManualReview !== undefined) {
      lines.push(`- 需人工复核：${candidate.ai.needsManualReview ? '是' : '否'}`);
    }
    if (candidate.localImage?.path) {
      lines.push(`- 导出主图：\`${candidate.localImage.path}\``);
    }
    for (const obs of candidate.observations) {
      lines.push(
        `- 来源观察：${obs.providerLabel}｜${obs.price?.displayText || '未获取'}｜${obs.price?.priceType || '价格类型未知'}｜采集 ${obs.observedAtLocal}${obs.regionNote ? `｜地区：${obs.regionNote}` : ''}`,
      );
    }
    lines.push('');
  }
  lines.push('## 给识别优化 AI 的任务');
  lines.push('');
  lines.push('请基于本资料包，对以下问题给出具体优化方案：');
  lines.push('');
  lines.push('1. 判断哪些候选实际上包含/不包含目标贴纸“' + run.target_name + '”，重点检查系列匹配候选与明显无关候选。');
  lines.push('2. 评估当前 AI 判定：误报、漏报、过度保守的 UNCERTAIN；说明每条依据。');
  lines.push('3. 在只有标题、缺少 SKU/描述的情况下，如何设计更可靠、低误报的识别规则；是否需要参考图视觉比对。');
  lines.push('4. 给出改进后的系统 Prompt 或判定流程，以及必须新增/保留的证据字段。');
  lines.push('5. 不要使用价格高低作为商品身份判断依据；价格仅用于核对。');
  lines.push('');
  lines.push('完整结构化数据在 `search-export.json`；其中包含每个候选的 observations、原始响应、AI 原始 JSON 和当前系统 Prompt。');
  lines.push('');
  lines.push('## 当前系统 Prompt');
  lines.push('');
  lines.push('```text');
  lines.push(exportData.aiPrompt.systemPrompt || '（未读取到 Prompt）');
  lines.push('```');
  lines.push('');
  lines.push('## 备注');
  lines.push('');
  lines.push('- 抖音 Playwright 返回验证码中间页；小红书 Playwright 普通搜索只返回笔记，均未进入商品数据。');
  lines.push('- Qovia/OKData 的搜索接口只返回标题级商品信息，缺少描述与 SKU。');
  lines.push('- 参考图已上传但 AI_VISION_ENABLED=false，未参与视觉判断。');
  lines.push('');

  await fsp.writeFile(path.join(folder, 'search-export.md'), lines.join('\n'), 'utf8');

  console.log(`EXPORT_DIR=${folder}`);
  console.log(`CANDIDATES=${candidateExports.length}`);
  console.log(`PLATFORMS=${JSON.stringify(platformResults.map((p) => ({ platform: p.platform, status: p.status, count: p.candidateCount })))}`);
  console.log(`REFERENCE_IMAGE=${referenceImageInfo.exportedPath || 'none'}`);
  console.log(`JSON=${path.join(folder, 'search-export.json')}`);
  console.log(`MARKDOWN=${path.join(folder, 'search-export.md')}`);
}

main()
  .catch((error) => {
    console.error('导出失败：', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
