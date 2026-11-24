import {
  CandidateRelevance,
  EvidenceEntry,
  MatchAssessment,
  MatchStatus,
  MatchType,
  NextAction,
  ObservationSource,
  Platform,
  PriceType,
  PriceVerificationStatus,
  SkuVerificationStatus,
  SourceType,
  TaskStatus,
  VisualMatch,
} from './models';

export const PLATFORM_META: Record<
  Platform,
  { label: string; tone: string; providerHint: string }
> = {
  taobao: { label: '淘宝', tone: 'taobao', providerHint: 'EveryInfra / 淘宝客' },
  douyin: { label: '抖音', tone: 'douyin', providerHint: 'EveryInfra / Qovia + Playwright' },
  xiaohongshu: {
    label: '小红书',
    tone: 'xiaohongshu',
    providerHint: 'EveryInfra / OKData + Playwright',
  },
  alibaba1688: {
    label: '1688',
    tone: 'alibaba1688',
    providerHint: 'EveryInfra 1688（批发采购）',
  },
  pinduoduo: { label: '拼多多', tone: 'pinduoduo', providerHint: '多多进宝 API' },
};

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  PENDING: { label: '等待中', tone: 'default' },
  RUNNING: { label: '采集中', tone: 'processing' },
  SUCCESS: { label: '采集成功', tone: 'success' },
  PARTIAL_SUCCESS: { label: '部分成功', tone: 'warning' },
  EMPTY: { label: '无结果', tone: 'default' },
  FAILED: { label: '采集失败', tone: 'error' },
  NOT_CONFIGURED: { label: '未配置', tone: 'warning' },
  BLOCKED: { label: '需人工处理', tone: 'error' },
  CANCELLED: { label: '已取消', tone: 'default' },
  WAITING_MANUAL_VERIFICATION: { label: '等待人工验证', tone: 'warning' },
};

export const ERROR_CODE_LABEL: Record<string, string> = {
  CAPTCHA_REQUIRED: '需要人工完成验证码',
  LOGIN_REQUIRED: '需要人工登录',
  BLOCKED_BY_PLATFORM: '平台限制访问',
  BROWSER_PROFILE_BUSY: '浏览器用户目录被占用',
  BROWSER_ERROR: '浏览器启动失败',
  PLAYWRIGHT_NOT_INSTALLED: 'Playwright 未安装',
  PARSE_FAILED: '页面解析失败',
  GOODS_SEARCH_UNAVAILABLE: '网页无商品搜索入口',
  PROVIDER_NOT_CONFIGURED: '渠道未配置',
  INTERRUPTED: '任务中断',
  EVERYINFRA_API_ERROR: 'EveryInfra 接口错误',
  EVERYINFRA_AUTH_ERROR: 'EveryInfra 认证失败',
  EVERYINFRA_INSUFFICIENT_BALANCE: 'EveryInfra 余额/额度不足',
  EVERYINFRA_RATE_LIMITED: 'EveryInfra 请求频率受限',
  EVERYINFRA_TIMEOUT: 'EveryInfra 请求超时',
  EVERYINFRA_BAD_RESPONSE: 'EveryInfra 响应异常',
  EVERYINFRA_IMAGE_SEARCH_DISABLED: '1688 图搜未启用',
};

export const PROVIDER_META: Record<string, { label: string }> = {
  qovia: { label: 'Qovia 第三方 API' },
  bamboo: { label: 'Bamboo 第三方 API' },
  okdata: { label: 'OKData 第三方 API' },
  socialtoai: { label: 'SocialToAI 第三方 API' },
  playwright: { label: 'Playwright 浏览器' },
  taobao_tbk: { label: '淘宝客 API' },
  pdd_ddk: { label: '多多进宝 API' },
  everyinfra_taobao: { label: 'EveryInfra 淘宝' },
  everyinfra_douyin: { label: 'EveryInfra 抖音' },
  everyinfra_xiaohongshu: { label: 'EveryInfra 小红书' },
  everyinfra_alibaba1688: { label: 'EveryInfra 1688' },
};

export const OBSERVATION_SOURCE_META: Record<ObservationSource, string> = {
  official_api: '官方 API',
  third_party_api: '第三方数据 API',
  playwright: 'Playwright 浏览器',
};

export const MATCH_TYPE_META: Record<MatchType, { label: string; description: string }> = {
  EXACT_SINGLE: { label: '目标单款', description: '商品就是目标贴纸单款' },
  TARGET_VARIANT: { label: '指定 SKU', description: '商品中有包含目标贴纸的 SKU' },
  CONTAINS_TARGET_BUNDLE: { label: '组合装', description: '组合装中包含目标贴纸' },
  CONTAINS_TARGET_FULL_SET: { label: '全系列套装', description: '全系列套装中包含目标贴纸' },
  NOT_MATCH: { label: '不匹配', description: '与目标贴纸无关或只是外观相似' },
  UNCERTAIN: { label: '待确认', description: '信息不足，需人工判断' },
};

export const MATCH_STATUS_META: Record<MatchStatus, { label: string; tone: string }> = {
  MATCH: { label: '已匹配', tone: 'success' },
  NO_MATCH: { label: '不匹配', tone: 'default' },
  UNCERTAIN: { label: '待确认', tone: 'warning' },
};

export const CANDIDATE_RELEVANCE_META: Record<
  CandidateRelevance,
  { label: string; tone: string; description: string }
> = {
  HIGH: { label: '高相关', tone: 'processing', description: '商品类别与目标系列均明确匹配' },
  MEDIUM: { label: '中相关', tone: 'warning', description: '品牌或系列有关联，仍需进一步核实' },
  LOW: { label: '低相关', tone: 'default', description: '只有弱关键词或模糊关联' },
  NONE: { label: '无关', tone: 'error', description: '与目标商品完全无关' },
};

export const MATCH_ASSESSMENT_META: Record<MatchAssessment, { label: string; tone: string }> = {
  MATCH: { label: '匹配', tone: 'success' },
  CONFLICT: { label: '冲突', tone: 'error' },
  UNKNOWN: { label: '未知', tone: 'default' },
};

export const VISUAL_MATCH_META: Record<VisualMatch, { label: string; tone: string }> = {
  VISUAL_EXACT: { label: '视觉一致', tone: 'success' },
  VISUAL_SIMILAR: { label: '视觉相似', tone: 'warning' },
  VISUAL_ABSENT: { label: '无视觉证据', tone: 'default' },
  VISUAL_UNAVAILABLE: { label: '未做视觉比对', tone: 'default' },
};

export const NEXT_ACTION_META: Record<NextAction, { label: string; description: string }> = {
  NONE: { label: '无需处理', description: '无需额外补充信息' },
  FETCH_PRODUCT_DETAIL: { label: '补充商品详情', description: '需要获取商品详情' },
  FETCH_SKU: { label: '补充 SKU', description: '需要获取 SKU 列表' },
  FETCH_IMAGES: { label: '补充图片', description: '需要补充商品图片' },
  MANUAL_REVIEW: { label: '人工复核', description: '机器无法继续确认，需要人工检查' },
};

export const EVIDENCE_SOURCE_LABEL: Record<EvidenceEntry['sourceField'], string> = {
  title: '标题',
  description: '描述',
  sku: 'SKU',
  image: '图片',
};

export const SKU_VERIFICATION_META: Record<
  SkuVerificationStatus,
  { label: string; tone: string }
> = {
  PENDING: { label: 'SKU 待核验', tone: 'warning' },
  VERIFIED: { label: 'SKU 已核验', tone: 'success' },
  PARTIAL: { label: '部分 SKU 已核验', tone: 'processing' },
  NOT_AVAILABLE: { label: '无 SKU 信息', tone: 'default' },
  FAILED: { label: 'SKU 核验失败', tone: 'error' },
};

export const PRICE_VERIFICATION_META: Record<
  PriceVerificationStatus,
  { label: string; tone: string }
> = {
  PENDING: { label: '价格待核验', tone: 'warning' },
  VERIFIED: { label: '目标价已核验', tone: 'success' },
  PARTIAL: { label: '部分价格已核验', tone: 'processing' },
  UNVERIFIED: { label: '仅列表价', tone: 'default' },
  FAILED: { label: '价格获取失败', tone: 'error' },
};

export const PRICE_TYPE_META: Record<PriceType, string> = {
  TARGET_SKU: '目标 SKU 价',
  BUNDLE: '组合装价',
  FULL_SET: '全套价',
  LOWEST_SKU: '最低 SKU 起售价',
  LISTING: '商品展示价',
  UNKNOWN: '价格含义未知',
};

export const SOURCE_TYPE_META: Record<SourceType, string> = {
  official_api: '官方 API',
  browser: '浏览器采集',
  third_party: '第三方数据服务',
};

export const AI_STATUS_LABEL: Record<string, string> = {
  OK: 'AI 已识别',
  FAILED: 'AI 识别失败',
  SKIPPED: 'AI 未配置',
};

export const MANUAL_DECISION_LABEL: Record<string, string> = {
  PENDING: '待人工判断',
  MATCH: '人工确认匹配',
  NO_MATCH: '人工确认不匹配',
};

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}
