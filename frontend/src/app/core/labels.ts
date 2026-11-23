import {
  MatchStatus,
  MatchType,
  ObservationSource,
  Platform,
  PriceType,
  SourceType,
  TaskStatus,
} from './models';

export const PLATFORM_META: Record<
  Platform,
  { label: string; tone: string; providerHint: string }
> = {
  taobao: { label: '淘宝', tone: 'taobao', providerHint: '淘宝客 API' },
  douyin: { label: '抖音', tone: 'douyin', providerHint: 'Qovia + Playwright' },
  xiaohongshu: {
    label: '小红书',
    tone: 'xiaohongshu',
    providerHint: 'OKData + Playwright',
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
};

export const PROVIDER_META: Record<string, { label: string }> = {
  qovia: { label: 'Qovia 第三方 API' },
  bamboo: { label: 'Bamboo 第三方 API' },
  okdata: { label: 'OKData 第三方 API' },
  socialtoai: { label: 'SocialToAI 第三方 API' },
  playwright: { label: 'Playwright 浏览器' },
  taobao_tbk: { label: '淘宝客 API' },
  pdd_ddk: { label: '多多进宝 API' },
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
