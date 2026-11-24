import {
  ManualDecisionEnum,
  MatchStatusEnum,
  MatchTypeEnum,
  PlatformEnum,
} from '../common/enums';
import { normalizeTargetText } from '../common/utils/text.util';
import { ProductCandidate } from '../entities';
import { RulePriceStatusEnum, RuleStatusEnum } from '../rules/rule.types';
import {
  PlatformPriceSummaryDto,
  PRICE_GROUP_ORDER,
  PriceComparisonGroup,
  PriceGroupSummaryDto,
  PriceSummaryDto,
  PriceSummaryItemDto,
} from './dto/price-summary.dto';

const FULL_SET_PATTERN = /全系列|全套|合集|大合集|全款|整套|六款|allin|[5-9]款|\d{2,}款/;
const BUNDLE_PATTERN = /\+|＋|组合|套装|两款|三款|搭配|任选|混合|加购|\d+款/;
const RETAIL_GROUPS: PriceComparisonGroup[] = [
  'TARGET_SINGLE',
  'TARGET_BUNDLE',
  'TARGET_FULL_SET',
];

function effectiveStatus(candidate: ProductCandidate): MatchStatusEnum | null {
  const manual =
    candidate.ruleResult?.manualDecision ?? candidate.matchResult?.manualDecision;
  if (manual === ManualDecisionEnum.MATCH) return MatchStatusEnum.MATCH;
  if (manual === ManualDecisionEnum.NO_MATCH) return MatchStatusEnum.NO_MATCH;
  switch (candidate.ruleResult?.status) {
    case RuleStatusEnum.MATCH_CONFIRMED:
    case RuleStatusEnum.MATCH_NO_PRICE:
      return candidate.ruleResult.status === RuleStatusEnum.MATCH_CONFIRMED
        ? MatchStatusEnum.MATCH
        : MatchStatusEnum.UNCERTAIN;
    case RuleStatusEnum.NO_MATCH:
      return MatchStatusEnum.NO_MATCH;
    case RuleStatusEnum.PENDING_DETAIL:
      return MatchStatusEnum.UNCERTAIN;
    default:
      return null;
  }
}

function inferSkuGroup(
  matchType: MatchTypeEnum | null,
  skuName: string,
): PriceComparisonGroup {
  const name = normalizeTargetText(skuName);
  if (FULL_SET_PATTERN.test(name)) return 'TARGET_FULL_SET';
  if (BUNDLE_PATTERN.test(name)) return 'TARGET_BUNDLE';
  if (matchType === MatchTypeEnum.CONTAINS_TARGET_FULL_SET) return 'TARGET_FULL_SET';
  if (matchType === MatchTypeEnum.CONTAINS_TARGET_BUNDLE) return 'TARGET_BUNDLE';
  return 'TARGET_SINGLE';
}

function inferUncertainGroup(candidate: ProductCandidate): PriceComparisonGroup | null {
  const rule = candidate.ruleResult;
  if (!rule) return null;
  if (rule.matchType === MatchTypeEnum.EXACT_SINGLE) return 'TARGET_SINGLE';
  if (rule.matchType === MatchTypeEnum.CONTAINS_TARGET_BUNDLE) return 'TARGET_BUNDLE';
  if (rule.matchType === MatchTypeEnum.CONTAINS_TARGET_FULL_SET) return 'TARGET_FULL_SET';
  const matchedIds = rule.matchedSkuIds ?? [];
  const skus = candidate.skuData ?? [];
  const matchedSku = skus.find((sku, index) =>
    matchedIds.includes(sku.skuId ?? `sku-${index + 1}`),
  );
  if (matchedSku) return inferSkuGroup(rule.matchType, matchedSku.name);
  const content = (rule.matchedContents ?? [])[0];
  if (content) return inferSkuGroup(rule.matchType, content);
  return null;
}

function currencyOf(candidate: ProductCandidate): string {
  const direct = candidate.priceData?.currency?.trim();
  if (direct) return direct;
  for (const observation of candidate.observations ?? []) {
    const currency = observation.priceData?.currency?.trim();
    if (currency) return currency;
  }
  return '';
}

function toItem(
  candidate: ProductCandidate,
  skuId: string | null,
  skuName: string,
  amount: number,
  currency: string,
  group: PriceComparisonGroup,
): PriceSummaryItemDto {
  return {
    candidateId: candidate.id,
    platform: candidate.platform,
    title: candidate.title,
    shopName: candidate.shopName ?? null,
    productUrl: candidate.productUrl,
    imageUrl: candidate.imageUrls?.[0] ?? null,
    skuId,
    skuName,
    amount: Math.round(amount * 100) / 100,
    currency,
    comparisonGroup: group,
    priceType:
      group === 'TARGET_BUNDLE'
        ? 'BUNDLE'
        : group === 'TARGET_FULL_SET'
          ? 'FULL_SET'
          : group === 'WHOLESALE'
            ? 'WHOLESALE'
            : 'TARGET_SKU',
    observedAt: candidate.collectedAt.toISOString(),
  };
}

function summarizeGroup(
  items: PriceSummaryItemDto[],
  group: PriceComparisonGroup,
): PriceGroupSummaryDto {
  const grouped = items.filter((item) => item.comparisonGroup === group);
  if (grouped.length === 0) {
    return { group, minAmount: null, maxAmount: null, currency: null, verifiedCount: 0 };
  }
  const currencyCounts = new Map<string, number>();
  for (const item of grouped) {
    currencyCounts.set(item.currency, (currencyCounts.get(item.currency) ?? 0) + 1);
  }
  const currency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sameCurrency = grouped.filter((item) => item.currency === currency);
  return {
    group,
    minAmount: Math.min(...sameCurrency.map((item) => item.amount)),
    maxAmount: Math.max(...sameCurrency.map((item) => item.amount)),
    currency,
    verifiedCount: new Set(sameCurrency.map((item) => item.candidateId)).size,
  };
}

function bestOfGroup(
  items: PriceSummaryItemDto[],
  summary: PriceGroupSummaryDto,
): PriceSummaryItemDto | null {
  if (summary.minAmount === null || !summary.currency) return null;
  return (
    items
      .filter(
        (item) =>
          item.comparisonGroup === summary.group &&
          item.currency === summary.currency &&
          item.amount === summary.minAmount,
      )
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0] ?? null
  );
}

function referencePrice(candidate: ProductCandidate): number | null {
  const rule = candidate.ruleResult;
  if (!rule) return null;
  const matchedIds = rule.matchedSkuIds ?? [];
  const skus = candidate.skuData ?? [];
  const prices = skus
    .map((sku, index) => ({
      id: sku.skuId ?? `sku-${index + 1}`,
      price: sku.price,
    }))
    .filter(
      (entry) =>
        matchedIds.includes(entry.id) &&
        typeof entry.price === 'number' &&
        entry.price > 0,
    )
    .map((entry) => entry.price as number);
  if (prices.length > 0) return Math.min(...prices);
  const amount = candidate.priceData?.amount;
  return typeof amount === 'number' && amount > 0 ? amount : null;
}

export function buildPriceSummary(candidates: ProductCandidate[]): PriceSummaryDto {
  const items: PriceSummaryItemDto[] = [];
  const matchedCandidates = candidates.filter(
    (candidate) => effectiveStatus(candidate) === MatchStatusEnum.MATCH,
  );

  for (const candidate of matchedCandidates) {
    const rule = candidate.ruleResult;
    // 历史 AI 判断不作为新规则的判断结果。
    if (!rule) continue;
    if (candidate.platform === PlatformEnum.ALIBABA1688) {
      const wholesale = candidate.wholesalePriceData;
      const wholesaleAmount = wholesale?.priceMin;
      const currency = wholesale?.currency?.trim();
      if (
        wholesale &&
        typeof wholesaleAmount === 'number' &&
        wholesaleAmount > 0 &&
        currency
      ) {
        items.push(
          toItem(
            candidate,
            null,
            wholesale.minOrderQuantity
              ? `批发 ${wholesale.unit ?? '件'} · 起订 ${wholesale.minOrderQuantity}`
              : `批发 ${wholesale.unit ?? '件'}`,
            wholesaleAmount,
            currency,
            'WHOLESALE',
          ),
        );
      }
      continue;
    }

    if (rule.priceStatus !== RulePriceStatusEnum.VALID) continue;
    const currency = currencyOf(candidate);
    if (!currency) continue;

    const matchedIds = rule.matchedSkuIds ?? [];
    const skus = candidate.skuData ?? [];
    skus.forEach((sku, index) => {
      const skuId = sku.skuId ?? `sku-${index + 1}`;
      if (!matchedIds.includes(skuId)) return;
      if (typeof sku.price !== 'number' || sku.price <= 0) return;
      const group = inferSkuGroup(rule.matchType, sku.name);
      items.push(toItem(candidate, skuId, sku.name, sku.price, currency, group));
    });
  }

  items.sort(
    (a, b) =>
      PRICE_GROUP_ORDER.indexOf(a.comparisonGroup) -
        PRICE_GROUP_ORDER.indexOf(b.comparisonGroup) ||
      a.amount - b.amount ||
      b.observedAt.localeCompare(a.observedAt),
  );

  const groups = PRICE_GROUP_ORDER.map((group) => summarizeGroup(items, group));
  const bestByGroup = groups
    .map((summary) => bestOfGroup(items, summary))
    .filter((item): item is PriceSummaryItemDto => item !== null);
  const bestPrice =
    bestByGroup.find((item) => item.comparisonGroup === 'TARGET_SINGLE') ??
    bestByGroup.find((item) => item.comparisonGroup === 'TARGET_BUNDLE') ??
    bestByGroup.find((item) => item.comparisonGroup === 'TARGET_FULL_SET') ??
    null;

  const platformsPresent = [
    PlatformEnum.TAOBAO,
    PlatformEnum.DOUYIN,
    PlatformEnum.XIAOHONGSHU,
    PlatformEnum.ALIBABA1688,
    PlatformEnum.PINDUODUO,
  ].filter((platform) => candidates.some((candidate) => candidate.platform === platform));

  const platforms: PlatformPriceSummaryDto[] = platformsPresent.map((platform) => {
    const platformItems = items.filter((item) => item.platform === platform);
    const platformCandidates = matchedCandidates.filter(
      (candidate) => candidate.platform === platform,
    );
    const wholesaleCandidates = platformCandidates
      .map((candidate) => candidate.wholesalePriceData)
      .filter(
        (value): value is NonNullable<typeof value> =>
          Boolean(value) && typeof value?.priceMin === 'number' && Boolean(value?.currency),
      );
    const wholesale = wholesaleCandidates.length
      ? {
          priceMin: Math.min(
            ...wholesaleCandidates.map((value) => value.priceMin as number),
          ),
          priceMax: Math.max(
            ...wholesaleCandidates.map((value) =>
              typeof value.priceMax === 'number' ? value.priceMax : (value.priceMin as number),
            ),
          ),
          currency: wholesaleCandidates[0].currency,
          unit: wholesaleCandidates[0].unit,
          minOrderQuantity:
            wholesaleCandidates
              .map((value) => value.minOrderQuantity)
              .filter((value): value is number => typeof value === 'number')
              .sort((a, b) => a - b)[0] ?? null,
        }
      : null;
    return {
      platform,
      groups: RETAIL_GROUPS.map((group) => summarizeGroup(platformItems, group)),
      wholesale,
    };
  });

  const confirmedRetail = items.filter((item) => item.comparisonGroup !== 'WHOLESALE');
  const hasConfirmedRetail = confirmedRetail.length > 0;
  const groupMin = new Map(
    groups
      .filter((group) => group.minAmount !== null && group.currency)
      .map((group) => [group.group, group.minAmount as number]),
  );

  const reasonableUncertain = candidates.filter((candidate) => {
    const rule = candidate.ruleResult;
    if (!rule || !rule.titleMatched) return false;
    return effectiveStatus(candidate) === MatchStatusEnum.UNCERTAIN;
  });

  const potential: string[] = [];
  for (const candidate of reasonableUncertain) {
    const group = inferUncertainGroup(candidate);
    const price = referencePrice(candidate);
    if (!hasConfirmedRetail) {
      potential.push(candidate.id);
      continue;
    }
    if (group && groupMin.has(group) && price !== null && price < (groupMin.get(group) as number)) {
      potential.push(candidate.id);
    }
  }

  const sortedPotential = potential.slice(0, 10);
  const potentialSet = new Set(sortedPotential);
  const allUncertain = candidates.filter(
    (candidate) => effectiveStatus(candidate) === MatchStatusEnum.UNCERTAIN,
  );
  const otherUncertainCount = allUncertain.filter(
    (candidate) => !potentialSet.has(candidate.id),
  ).length;

  const unverifiedMatchCount = new Set(
    matchedCandidates
      .filter(
        (candidate) =>
          candidate.platform !== PlatformEnum.ALIBABA1688 &&
          !items.some((item) => item.candidateId === candidate.id),
      )
      .map((candidate) => candidate.id),
  ).size;

  return {
    bestPrice,
    bestComparisonGroup: bestPrice?.comparisonGroup ?? null,
    bestByGroup,
    groups,
    platforms,
    items,
    potentialCheaperCandidateIds: sortedPotential,
    otherUncertainCount,
    unverifiedMatchCount,
    totalConfirmed: new Set(items.map((item) => item.candidateId)).size,
  };
}
