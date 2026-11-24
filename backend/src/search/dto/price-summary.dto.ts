export type PriceComparisonGroup =
  | 'TARGET_SINGLE'
  | 'TARGET_BUNDLE'
  | 'TARGET_FULL_SET'
  | 'WHOLESALE';

export interface PriceSummaryItemDto {
  candidateId: string;
  platform: string;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrl: string | null;
  skuId: string | null;
  skuName: string;
  amount: number;
  currency: string;
  comparisonGroup: PriceComparisonGroup;
  priceType: string;
  observedAt: string;
}

export interface PriceGroupSummaryDto {
  group: PriceComparisonGroup;
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  verifiedCount: number;
}

export interface PlatformPriceSummaryDto {
  platform: string;
  groups: PriceGroupSummaryDto[];
  wholesale: {
    priceMin: number | null;
    priceMax: number | null;
    currency: string | null;
    unit: string | null;
    minOrderQuantity: number | null;
  } | null;
}

export interface PriceSummaryDto {
  /** 默认优先单款；没有单款时退到组合装/全系列；1688 批发不参与零售最低价 */
  bestPrice: PriceSummaryItemDto | null;
  bestComparisonGroup: PriceComparisonGroup | null;
  bestByGroup: PriceSummaryItemDto[];
  groups: PriceGroupSummaryDto[];
  platforms: PlatformPriceSummaryDto[];
  items: PriceSummaryItemDto[];
  potentialCheaperCandidateIds: string[];
  otherUncertainCount: number;
  unverifiedMatchCount: number;
  totalConfirmed: number;
}

export const PRICE_GROUP_ORDER: PriceComparisonGroup[] = [
  'TARGET_SINGLE',
  'TARGET_BUNDLE',
  'TARGET_FULL_SET',
  'WHOLESALE',
];
