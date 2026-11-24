import { MatchTypeEnum } from '../common/enums';

/** 用户明确配置的搜索规则；不自动扩展任何关键词。 */
export interface ProductSearchRule {
  targetKeywords: string[];
  seriesKeywords: string[];
}

export enum RuleStatusEnum {
  /** 详情确认目标商品，且存在有效价格 */
  MATCH_CONFIRMED = 'RULE_MATCH_CONFIRMED',
  /** 详情确认目标商品，但没有有效价格 */
  MATCH_NO_PRICE = 'RULE_MATCH_NO_PRICE',
  /** 标题或详情不符合规则 */
  NO_MATCH = 'RULE_NO_MATCH',
  /** 详情失败或尚未获取 */
  PENDING_DETAIL = 'RULE_PENDING_DETAIL',
}

export enum RulePriceStatusEnum {
  VALID = 'PRICE_VALID',
  MISSING = 'PRICE_MISSING',
  INVALID = 'PRICE_INVALID',
  AMBIGUOUS = 'PRICE_AMBIGUOUS',
}

export interface RulePriceResult {
  status: RulePriceStatusEnum;
  amount: number | null;
  currency: string | null;
  skuId: string | null;
  source: 'sku' | 'listing' | 'wholesale' | null;
  note: string | null;
}

export interface TitleRuleResult {
  matched: boolean;
  matchedTargetKeyword: string | null;
  matchedSeriesKeyword: string | null;
  reason: string;
}

export interface DetailRuleResult {
  matched: boolean;
  matchedTargetKeyword: string | null;
  matchedSkuIds: string[];
  matchedSkuNames: string[];
  reason: string;
}

export interface RuleEvaluation {
  status: RuleStatusEnum;
  priceStatus: RulePriceStatusEnum;
  titleMatched: boolean;
  detailChecked: boolean;
  matchedTargetKeywords: string[];
  matchedSeriesKeywords: string[];
  matchedSkuIds: string[];
  matchType: MatchTypeEnum | null;
  matchedContents: string[];
  price: RulePriceResult;
  reason: string;
  detailError: string | null;
}

export const EMPTY_PRICE: RulePriceResult = {
  status: RulePriceStatusEnum.MISSING,
  amount: null,
  currency: null,
  skuId: null,
  source: null,
  note: '接口未返回可用价格',
};
