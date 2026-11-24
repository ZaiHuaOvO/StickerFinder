import { MatchTypeEnum, PriceTypeEnum } from '../common/enums';
import { SkuOption } from '../common/interfaces/price.interface';
import { WholesalePriceInfo } from '../common/interfaces/wholesale-price.interface';
import {
  DetailRuleResult,
  EMPTY_PRICE,
  ProductSearchRule,
  RuleEvaluation,
  RulePriceResult,
  RulePriceStatusEnum,
  RuleStatusEnum,
  TitleRuleResult,
} from './rule.types';

const CJK_VARIANTS: Record<string, string> = {
  姸: '妍',
  峯: '峰',
  裏: '里',
  臺: '台',
  喆: '哲',
};

const FULL_SET_PATTERN = /全系列|全套|合集|大合集|全款|整套|六款|allin|[5-9]款|\d{2,}款/;
const BUNDLE_PATTERN = /\+|＋|组合|套装|两款|三款|搭配|任选|混合|加购|\d+款/;

/**
 * 规则文本标准化：NFKC、英文小写、常见异体字统一、忽略所有空白差异。
 * 不删除标点，避免把 21.0 / 4.0 等版本号误合并。
 */
export function normalizeRuleText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFKC')
    .replace(/[姸峯裏臺喆]/g, (char) => CJK_VARIANTS[char] ?? char)
    .replace(/\s+/g, '')
    .toLowerCase();
}

export interface SearchRuleInput {
  name: string;
  seriesName?: string | null;
  aliases?: string[];
  seriesAliases?: string[];
}

/** 只使用用户填写/明确配置的关键词，不做任何自动扩展。 */
export function buildSearchRule(input: SearchRuleInput): ProductSearchRule {
  const clean = (values: Array<string | null | undefined>): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const original = (value ?? '').trim();
      if (!original) continue;
      const normalized = normalizeRuleText(original);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(original);
    }
    return result;
  };
  return {
    targetKeywords: clean([input.name, ...(input.aliases ?? [])]),
    seriesKeywords: clean([
      input.seriesName ?? '',
      ...(input.seriesAliases ?? []),
    ]),
  };
}

function keywordHit(text: string, keywords: string[]): string | null {
  const normalizedText = normalizeRuleText(text);
  if (!normalizedText) return null;
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeRuleText(keyword);
    if (normalizedKeyword && normalizedText.includes(normalizedKeyword)) {
      return keyword;
    }
  }
  return null;
}

/** 标题必须同时命中目标组与系列组；组内 OR。系列为空时只校验目标。 */
export function matchesTitle(
  title: string,
  rule: ProductSearchRule,
): TitleRuleResult {
  if (rule.targetKeywords.length === 0) {
    return {
      matched: false,
      matchedTargetKeyword: null,
      matchedSeriesKeyword: null,
      reason: '未配置目标商品关键词',
    };
  }
  const targetHit = keywordHit(title, rule.targetKeywords);
  if (!targetHit) {
    return {
      matched: false,
      matchedTargetKeyword: null,
      matchedSeriesKeyword: null,
      reason: '标题未包含目标商品关键词',
    };
  }
  if (rule.seriesKeywords.length === 0) {
    return {
      matched: true,
      matchedTargetKeyword: targetHit,
      matchedSeriesKeyword: null,
      reason: `标题包含目标关键词「${targetHit}」`,
    };
  }
  const seriesHit = keywordHit(title, rule.seriesKeywords);
  if (!seriesHit) {
    return {
      matched: false,
      matchedTargetKeyword: targetHit,
      matchedSeriesKeyword: null,
      reason: '标题包含目标关键词，但未包含系列关键词',
    };
  }
  return {
    matched: true,
    matchedTargetKeyword: targetHit,
    matchedSeriesKeyword: seriesHit,
    reason: `标题同时包含目标「${targetHit}」与系列「${seriesHit}」`,
  };
}

export interface DetailIdentityProduct {
  title: string;
  skuOptions?: SkuOption[];
}

/**
 * 详情确认只使用商品身份字段：详情标题与 SKU 名称。
 * 不扫描描述、店铺文案或整个原始 JSON，避免无关推荐词误命中。
 */
export function matchesDetail(
  product: DetailIdentityProduct,
  rule: ProductSearchRule,
): DetailRuleResult {
  const texts = [product.title, ...(product.skuOptions ?? []).map((sku) => sku.name)];
  let matchedKeyword: string | null = null;
  for (const text of texts) {
    const hit = keywordHit(text, rule.targetKeywords);
    if (hit) {
      matchedKeyword = hit;
      break;
    }
  }
  if (!matchedKeyword) {
    return {
      matched: false,
      matchedTargetKeyword: null,
      matchedSkuIds: [],
      matchedSkuNames: [],
      reason: '详情标题与 SKU 均未包含目标商品关键词',
    };
  }
  const matchedSkuIds: string[] = [];
  const matchedSkuNames: string[] = [];
  (product.skuOptions ?? []).forEach((sku, index) => {
    if (!keywordHit(sku.name, rule.targetKeywords)) return;
    matchedSkuIds.push(sku.skuId ?? `sku-${index + 1}`);
    matchedSkuNames.push(sku.name);
  });
  return {
    matched: true,
    matchedTargetKeyword: matchedKeyword,
    matchedSkuIds,
    matchedSkuNames,
    reason:
      matchedSkuIds.length > 0
        ? `详情 SKU 命中「${matchedKeyword}」`
        : `详情标题命中「${matchedKeyword}」`,
  };
}

function knownCurrency(value: string | null | undefined): string | null {
  const currency = (value ?? '').trim();
  if (!currency || currency.toUpperCase() === 'UNKNOWN') return null;
  return currency;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export interface PriceCandidateProduct {
  price?: {
    amount: number | null;
    currency: string;
    priceType: PriceTypeEnum;
  } | null;
  skuOptions?: SkuOption[];
  wholesalePrice?: WholesalePriceInfo | null;
}

/**
 * 只使用接口返回的价格：
 * - 优先命中的 SKU 自身价格；
 * - 1688 使用明确的批发价与币种；
 * - 只有展示价/起步价时标记为 AMBIGUOUS，不伪造成 SKU 成交价。
 */
export function validatePrice(
  product: PriceCandidateProduct,
  matchedSkuIds: string[],
): RulePriceResult {
  const skus = product.skuOptions ?? [];
  const matchedSkuPrices = skus
    .map((sku, index) => ({
      skuId: sku.skuId ?? `sku-${index + 1}`,
      name: sku.name,
      price: positive(sku.price),
    }))
    .filter(
      (entry) =>
        matchedSkuIds.includes(entry.skuId) && entry.price !== null,
    )
    .sort((a, b) => (a.price as number) - (b.price as number));

  const currency = knownCurrency(product.price?.currency);
  if (matchedSkuPrices.length > 0) {
    const best = matchedSkuPrices[0];
    if (!currency) {
      return {
        ...EMPTY_PRICE,
        status: RulePriceStatusEnum.AMBIGUOUS,
        amount: best.price,
        source: 'sku',
        skuId: best.skuId,
        note: 'SKU 价格缺少明确币种',
      };
    }
    return {
      status: RulePriceStatusEnum.VALID,
      amount: best.price,
      currency,
      skuId: best.skuId,
      source: 'sku',
      note: `SKU「${best.name}」价格`,
    };
  }

  const wholesale = product.wholesalePrice;
  if (wholesale) {
    const wholesaleCurrency = knownCurrency(wholesale.currency);
    const amount = positive(wholesale.priceMin);
    if (amount !== null && wholesaleCurrency) {
      return {
        status: RulePriceStatusEnum.VALID,
        amount,
        currency: wholesaleCurrency,
        skuId: null,
        source: 'wholesale',
        note: '1688 批发价（按起订量）',
      };
    }
    if (amount !== null) {
      return {
        ...EMPTY_PRICE,
        status: RulePriceStatusEnum.AMBIGUOUS,
        amount,
        source: 'wholesale',
        note: '批发价缺少明确币种',
      };
    }
  }

  const amount = product.price?.amount ?? null;
  if (amount === null) {
    return { ...EMPTY_PRICE };
  }
  if (!(amount > 0)) {
    return {
      ...EMPTY_PRICE,
      status: RulePriceStatusEnum.INVALID,
      amount,
      note: '价格数值异常',
    };
  }
  if (!currency) {
    return {
      ...EMPTY_PRICE,
      status: RulePriceStatusEnum.AMBIGUOUS,
      amount,
      source: 'listing',
      note: '价格缺少明确币种',
    };
  }
  const priceType = product.price?.priceType;
  if (priceType === PriceTypeEnum.LISTING || priceType === PriceTypeEnum.LOWEST_SKU) {
    return {
      ...EMPTY_PRICE,
      status: RulePriceStatusEnum.AMBIGUOUS,
      amount,
      currency,
      source: 'listing',
      note:
        matchedSkuIds.length > 0
          ? '命中的 SKU 未返回价格，仅有商品展示价；未确认具体 SKU 成交价'
          : '只有商品展示价/起步价，未确认具体 SKU',
    };
  }
  return {
    status: RulePriceStatusEnum.AMBIGUOUS,
    amount,
    currency,
    skuId: null,
    source: 'listing',
    note: '无法确认对应 SKU',
  };
}

function inferMatchType(
  product: DetailIdentityProduct,
  matchedSkuIds: string[],
): MatchTypeEnum {
  if (matchedSkuIds.length === 0) return MatchTypeEnum.EXACT_SINGLE;
  const names = (product.skuOptions ?? [])
    .map((sku, index) => ({ id: sku.skuId ?? `sku-${index + 1}`, name: sku.name }))
    .filter((entry) => matchedSkuIds.includes(entry.id))
    .map((entry) => normalizeRuleText(entry.name));
  if (names.some((name) => FULL_SET_PATTERN.test(name))) {
    return MatchTypeEnum.CONTAINS_TARGET_FULL_SET;
  }
  if (names.some((name) => BUNDLE_PATTERN.test(name))) {
    return MatchTypeEnum.CONTAINS_TARGET_BUNDLE;
  }
  return MatchTypeEnum.TARGET_VARIANT;
}

export interface RuleEvaluationInput {
  rule: ProductSearchRule;
  searchProduct: { title: string; price?: PriceCandidateProduct['price']; skuOptions?: SkuOption[]; wholesalePrice?: WholesalePriceInfo | null };
  detail: {
    attempted: boolean;
    product: (DetailIdentityProduct & PriceCandidateProduct) | null;
    error?: string | null;
  };
}

export function evaluateProductRule(input: RuleEvaluationInput): RuleEvaluation {
  const title = matchesTitle(input.searchProduct.title, input.rule);
  const base = {
    titleMatched: title.matched,
    matchedTargetKeywords: title.matchedTargetKeyword
      ? [title.matchedTargetKeyword]
      : [],
    matchedSeriesKeywords: title.matchedSeriesKeyword
      ? [title.matchedSeriesKeyword]
      : [],
    detailError: input.detail.error ?? null,
  };

  if (!title.matched) {
    return {
      ...base,
      status: RuleStatusEnum.NO_MATCH,
      priceStatus: RulePriceStatusEnum.MISSING,
      detailChecked: false,
      matchedSkuIds: [],
      matchType: null,
      matchedContents: [],
      price: { ...EMPTY_PRICE },
      reason: title.reason,
    };
  }

  if (!input.detail.attempted) {
    return {
      ...base,
      status: RuleStatusEnum.PENDING_DETAIL,
      priceStatus: RulePriceStatusEnum.MISSING,
      detailChecked: false,
      matchedSkuIds: [],
      matchType: null,
      matchedContents: base.matchedTargetKeywords,
      price: { ...EMPTY_PRICE },
      reason: '标题符合规则，等待商品详情确认',
    };
  }

  if (!input.detail.product) {
    return {
      ...base,
      status: RuleStatusEnum.PENDING_DETAIL,
      priceStatus: RulePriceStatusEnum.MISSING,
      detailChecked: false,
      matchedSkuIds: [],
      matchType: null,
      matchedContents: base.matchedTargetKeywords,
      price: { ...EMPTY_PRICE },
      reason: `详情获取失败，保留候选：${input.detail.error ?? '详情接口未返回商品'}`,
    };
  }

  const detail = matchesDetail(input.detail.product, input.rule);
  if (!detail.matched) {
    return {
      ...base,
      status: RuleStatusEnum.NO_MATCH,
      priceStatus: RulePriceStatusEnum.MISSING,
      detailChecked: true,
      matchedSkuIds: [],
      matchType: null,
      matchedContents: [],
      price: { ...EMPTY_PRICE },
      reason: detail.reason,
    };
  }

  const price = validatePrice(input.detail.product, detail.matchedSkuIds);
  const confirmed = price.status === RulePriceStatusEnum.VALID;
  return {
    ...base,
    status: confirmed
      ? RuleStatusEnum.MATCH_CONFIRMED
      : RuleStatusEnum.MATCH_NO_PRICE,
    priceStatus: price.status,
    detailChecked: true,
    matchedSkuIds: detail.matchedSkuIds,
    matchType: inferMatchType(input.detail.product, detail.matchedSkuIds),
    matchedContents: [
      ...new Set([
        detail.matchedTargetKeyword ?? '',
        ...detail.matchedSkuNames,
      ].filter(Boolean)),
    ],
    price,
    reason: `${detail.reason}；${price.note ?? '价格待确认'}`,
  };
}
