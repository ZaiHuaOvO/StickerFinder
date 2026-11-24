import {
  MatchStatus,
  MatchType,
  ObservationSource,
  Platform,
  PriceComparisonGroup,
  PriceType,
  PromotionType,
  RulePriceStatus,
  RuleStatus,
  SearchRunStatus,
  SourceType,
  TaskStatus,
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
  fixture: { label: '本地测试数据' },
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

export const RULE_STATUS_META: Record<
  RuleStatus,
  { label: string; tone: string; description: string }
> = {
  RULE_MATCH_CONFIRMED: {
    label: '规则确认',
    tone: 'success',
    description: '标题与详情均包含目标商品，且价格有效',
  },
  RULE_MATCH_NO_PRICE: {
    label: '已确认 · 无有效价',
    tone: 'warning',
    description: '详情确认包含目标商品，但没有可用的 SKU 价格',
  },
  RULE_NO_MATCH: {
    label: '规则不匹配',
    tone: 'default',
    description: '标题或详情不符合关键词规则',
  },
  RULE_PENDING_DETAIL: {
    label: '待详情确认',
    tone: 'warning',
    description: '标题符合规则，等待详情确认',
  },
};

export const RULE_PRICE_STATUS_META: Record<
  RulePriceStatus,
  { label: string; tone: string }
> = {
  PRICE_VALID: { label: '价格有效', tone: 'success' },
  PRICE_MISSING: { label: '价格缺失', tone: 'default' },
  PRICE_INVALID: { label: '价格异常', tone: 'error' },
  PRICE_AMBIGUOUS: { label: '价格待确认', tone: 'warning' },
};

export const PRICE_TYPE_META: Record<PriceType, string> = {
  TARGET_SKU: '目标 SKU 价',
  BUNDLE: '组合装价',
  FULL_SET: '全套价',
  LOWEST_SKU: '最低 SKU 起售价',
  LISTING: '商品展示价',
  COUPON_PRICE: '券后价',
  UNKNOWN: '价格含义未知',
};

export const PROMOTION_TYPE_META: Record<PromotionType, { label: string; tone: string }> = {
  COUPON: { label: '优惠券', tone: 'red' },
  SHOP_ACTIVITY: { label: '店铺活动', tone: 'orange' },
  PLATFORM_ACTIVITY: { label: '平台活动', tone: 'blue' },
  DISCOUNT: { label: '优惠', tone: 'gold' },
  OTHER: { label: '优惠', tone: 'default' },
};

export const RUN_STATUS_META: Record<SearchRunStatus, { label: string; tone: string }> = {
  PENDING: { label: '排队中', tone: 'default' },
  RUNNING: { label: '进行中', tone: 'processing' },
  COMPLETED: { label: '已完成', tone: 'success' },
  PARTIAL: { label: '部分完成', tone: 'warning' },
  FAILED: { label: '失败', tone: 'error' },
  INTERRUPTED: { label: '已中断', tone: 'error' },
  CANCELLED: { label: '已取消', tone: 'default' },
  WAITING_MANUAL_VERIFICATION: { label: '等待验证', tone: 'warning' },
};

export function formatPromotionValue(
  amount: number | null,
  currency: string | null,
  discountRate: number | null,
  minimumSpend: number | null,
): string {
  const parts: string[] = [];
  if (minimumSpend !== null) {
    parts.push(`满${formatMoney(minimumSpend, currency)}`);
  }
  if (amount !== null) {
    parts.push(`减${formatMoney(amount, currency)}`);
  } else if (discountRate !== null) {
    parts.push(`${(discountRate * 10).toFixed(1)}折`);
  }
  return parts.join(' ');
}

export function formatMoney(amount: number, currency: string | null): string {
  const value = amount.toFixed(2);
  if (currency === 'CNY') return `¥${value}`;
  if (currency) return `${currency} ${value}`;
  return `¥${value}`;
}

export function formatPromotionPeriod(
  start: string | null,
  end: string | null,
): string | null {
  if (!start && !end) return null;
  const short = (value: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}`;
  };
  if (start && end) return `${short(start)} 至 ${short(end)}`;
  if (end) return `${short(end)} 截止`;
  return `${short(start!)} 起`;
}

export const PRICE_GROUP_LABEL: Record<PriceComparisonGroup, string> = {
  TARGET_SINGLE: '目标单款',
  TARGET_BUNDLE: '组合装',
  TARGET_FULL_SET: '全系列',
  WHOLESALE: '批发采购',
};

export const SOURCE_TYPE_META: Record<SourceType, string> = {
  official_api: '官方 API',
  browser: '浏览器采集',
  third_party: '第三方数据服务',
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

export function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}
