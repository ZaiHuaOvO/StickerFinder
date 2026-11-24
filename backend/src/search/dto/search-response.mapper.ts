import {
  CandidateRelevanceEnum,
  ManualDecisionEnum,
  MatchAssessmentEnum,
  MatchStatusEnum,
  NextActionEnum,
  ObservationSourceEnum,
  PlatformEnum,
  PlatformStatusEnum,
  PlatformTaskStatusEnum,
  PriceVerificationStatusEnum,
  PromotionTypeEnum,
  SkuVerificationStatusEnum,
  SourceTypeEnum,
  VisualMatchEnum,
} from '../../common/enums';
import { PriceInfo, SkuOption } from '../../common/interfaces/price.interface';
import { WholesalePriceInfo } from '../../common/interfaces/wholesale-price.interface';
import { ManualVerificationState } from '../../common/interfaces/manual-verification.interface';
import {
  PROVIDER_LABELS,
  channelsForPlatform,
} from '../../common/platform-channels';
import { aggregatePlatformStatus } from '../../common/utils/platform-status.util';
import { buildPriceSummary } from '../price-summary.util';
import type { PriceSummaryDto } from './price-summary.dto';
import type {
  EvidenceEntry,
  SkuDecision,
  SkuManualDecision,
} from '../../entities/product-match-result.entity';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductObservation,
  ProductPromotion,
  SearchRun,
} from '../../entities';

export interface MatchDto {
  aiStatus: string;
  matchStatus: MatchStatusEnum;
  matchType: string | null;
  candidateRelevance: CandidateRelevanceEnum | null;
  categoryMatch: MatchAssessmentEnum | null;
  seriesMatch: MatchAssessmentEnum | null;
  targetItemMatch: MatchAssessmentEnum | null;
  visualMatch: VisualMatchEnum | null;
  confidence: number | null;
  summary: string | null;
  reason: string | null;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: EvidenceEntry[];
  nextAction: NextActionEnum | null;
  rawMatchStatus: MatchStatusEnum | null;
  rawConfidence: number | null;
  safetyWarnings: string[];
  safetyBlockers: string[];
  skuVerificationStatus: SkuVerificationStatusEnum;
  priceVerificationStatus: PriceVerificationStatusEnum;
  needsManualReview: boolean;
  manualDecision: ManualDecisionEnum;
  manualNote: string | null;
  manualSkuDecisions: SkuManualDecision[];
  reviewedAt: Date | null;
  aiModel: string | null;
  aiError: string | null;
}

export interface PromotionDto {
  id: string;
  skuId: string | null;
  promotionType: PromotionTypeEnum;
  promotionTypeLabel: string;
  name: string;
  amount: number | null;
  currency: string | null;
  discountRate: number | null;
  minimumSpend: number | null;
  startTime: Date | null;
  endTime: Date | null;
  description: string | null;
  promotionUrl: string | null;
  /** 按当前时间判断，仅用于展示标记，不修改已保存的优惠数据 */
  expired: boolean;
  source: string | null;
  observedAt: Date;
}

export interface ObservationDto {
  id: string;
  provider: string;
  providerLabel: string;
  source: string;
  sourceLabel: string;
  sourceProductId: string | null;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrls: string[];
  price: PriceInfo | null;
  originalPrice: PriceInfo | null;
  groupPrice: PriceInfo | null;
  /** 接口明确返回的券后价；没有返回时为 null */
  couponPrice: PriceInfo | null;
  /** 1688 批发采购价，独立于零售 price */
  wholesalePrice: WholesalePriceInfo | null;
  promotions: PromotionDto[];
  salesText: string | null;
  rating: number | null;
  region: string | null;
  regionNote: string | null;
  matchReason: string | null;
  observedAt: Date;
  collectedAt: Date;
  rawData: Record<string, unknown> | null;
}

export interface ProductDto {
  id: string;
  platform: string;
  platformProductId: string | null;
  title: string;
  shopName: string | null;
  productUrl: string;
  imageUrls: string[];
  description: string | null;
  skuOptions: SkuOption[];
  price: PriceInfo | null;
  groupPrice: PriceInfo | null;
  wholesalePrice: WholesalePriceInfo | null;
  /** 各观察记录去重后的最新优惠集合 */
  promotions: PromotionDto[];
  sourceType: string;
  collectedAt: Date;
  effectiveMatchStatus: MatchStatusEnum;
  match: MatchDto | null;
  observations: ObservationDto[];
  priceConflict: boolean;
}

export interface ChannelResultDto {
  taskId: string;
  provider: string;
  providerLabel: string;
  source: string;
  sourceLabel: string;
  providerType: string | null;
  status: PlatformTaskStatusEnum;
  resultCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  /** 实际收费 API 请求次数（服务商响应为准） */
  apiRequestCount: number;
  /** 服务商 billing 实际扣费；null 表示未返回 billing */
  chargedUsd: number | null;
  lastRequestId: string | null;
  /** 等待人工验证时保存的关键词、目标 URL、Profile 与进度 */
  manualVerification: ManualVerificationState | null;
  /** 当前是否有该平台的可见验证浏览器窗口处于打开状态 */
  manualBrowserOpen: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
}

export interface PlatformResultDto {
  platform: string;
  status: PlatformStatusEnum;
  providerType: string | null;
  resultCount: number;
  matchedCount: number;
  uncertainCount: number;
  excludedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  note: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  channels: ChannelResultDto[];
  products: ProductDto[];
  uncertainProducts: ProductDto[];
  excludedProducts: ProductDto[];
}

export interface SearchDetailDto {
  searchId: string;
  status: string;
  targetName: string;
  seriesName: string | null;
  aliases: string[];
  seriesAliases: string[];
  brandNames: string[];
  referenceImageProvided: boolean;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  platforms: PlatformResultDto[];
  priceSummary: PriceSummaryDto;
}

const SOURCE_LABELS: Record<string, string> = {
  [ObservationSourceEnum.OFFICIAL_API]: '官方 API',
  [ObservationSourceEnum.THIRD_PARTY_API]: '第三方数据 API',
  [ObservationSourceEnum.PLAYWRIGHT]: 'Playwright 浏览器',
};

const PROMOTION_TYPE_LABELS: Record<PromotionTypeEnum, string> = {
  [PromotionTypeEnum.COUPON]: '优惠券',
  [PromotionTypeEnum.SHOP_ACTIVITY]: '店铺活动',
  [PromotionTypeEnum.PLATFORM_ACTIVITY]: '平台活动',
  [PromotionTypeEnum.DISCOUNT]: '优惠',
  [PromotionTypeEnum.OTHER]: '优惠',
};

const PROMOTION_TYPE_RANK: Record<PromotionTypeEnum, number> = {
  [PromotionTypeEnum.COUPON]: 0,
  [PromotionTypeEnum.SHOP_ACTIVITY]: 1,
  [PromotionTypeEnum.PLATFORM_ACTIVITY]: 2,
  [PromotionTypeEnum.DISCOUNT]: 3,
  [PromotionTypeEnum.OTHER]: 4,
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS] ?? provider;
}

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function effectiveMatchStatus(match: MatchDto | null): MatchStatusEnum {
  if (!match) return MatchStatusEnum.UNCERTAIN;
  if (match.manualDecision === ManualDecisionEnum.MATCH) return MatchStatusEnum.MATCH;
  if (match.manualDecision === ManualDecisionEnum.NO_MATCH) return MatchStatusEnum.NO_MATCH;
  return match.matchStatus;
}

function toPromotionDto(
  promotion: ProductPromotion,
  now: number,
): PromotionDto {
  return {
    id: promotion.id,
    skuId: promotion.skuId,
    promotionType: promotion.promotionType,
    promotionTypeLabel:
      PROMOTION_TYPE_LABELS[promotion.promotionType] ?? promotion.promotionType,
    name: promotion.name,
    amount: promotion.amount,
    currency: promotion.currency,
    discountRate: promotion.discountRate,
    minimumSpend: promotion.minimumSpend,
    startTime: promotion.startTime,
    endTime: promotion.endTime,
    description: promotion.description,
    promotionUrl: promotion.promotionUrl,
    expired: Boolean(
      promotion.endTime && promotion.endTime.getTime() < now,
    ),
    source: promotion.source,
    observedAt: promotion.observedAt,
  };
}

function promotionDtoKey(promotion: PromotionDto): string {
  return [
    promotion.promotionType,
    promotion.skuId ?? '',
    promotion.name,
    promotion.amount ?? '',
    promotion.currency ?? '',
    promotion.discountRate ?? '',
    promotion.minimumSpend ?? '',
    promotion.startTime ? new Date(promotion.startTime).toISOString() : '',
    promotion.endTime ? new Date(promotion.endTime).toISOString() : '',
    promotion.description ?? '',
  ].join('|');
}

/** 商品级优惠集合：按优惠内容去重，保留最近一次采集的版本。 */
function collectPromotions(observations: ObservationDto[]): PromotionDto[] {
  const byKey = new Map<string, PromotionDto>();
  for (const observation of observations) {
    for (const promotion of observation.promotions) {
      const key = promotionDtoKey(promotion);
      const current = byKey.get(key);
      if (
        !current ||
        new Date(promotion.observedAt).getTime() >
          new Date(current.observedAt).getTime()
      ) {
        byKey.set(key, promotion);
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.expired) - Number(b.expired) ||
      PROMOTION_TYPE_RANK[a.promotionType] -
        PROMOTION_TYPE_RANK[b.promotionType] ||
      a.name.localeCompare(b.name),
  );
}

function toObservationDto(observation: ProductObservation): ObservationDto {
  const now = Date.now();
  return {
    id: observation.id,
    provider: observation.provider,
    providerLabel: providerLabel(observation.provider),
    source: observation.source,
    sourceLabel: sourceLabel(observation.source),
    sourceProductId: observation.sourceProductId,
    title: observation.title,
    shopName: observation.shopName,
    productUrl: observation.productUrl,
    imageUrls: observation.imageUrls ?? [],
    price: observation.priceData,
    originalPrice: observation.originalPriceData,
    groupPrice: observation.groupPriceData,
    couponPrice: observation.couponPriceData ?? null,
    wholesalePrice: observation.wholesalePriceData,
    promotions: (observation.promotions ?? []).map((promotion) =>
      toPromotionDto(promotion, now),
    ),
    salesText: observation.salesText,
    rating: observation.rating,
    region: observation.region,
    regionNote: observation.regionNote,
    matchReason: observation.matchReason,
    observedAt: observation.observedAt,
    collectedAt: observation.collectedAt,
    rawData: observation.rawData,
  };
}

function hasPriceConflict(observations: ObservationDto[]): boolean {
  const values = observations
    .filter((observation) => typeof observation.price?.amount === 'number')
    .map(
      (observation) =>
        `${observation.price?.currency ?? 'UNKNOWN'}:${observation.price?.amount?.toFixed(2)}`,
    );
  return new Set(values).size > 1;
}

function normalizeEvidence(entries: unknown): EvidenceEntry[] {
  if (!Array.isArray(entries)) return [];
  const allowed = new Set(['title', 'description', 'sku', 'image']);
  const normalized: EvidenceEntry[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.trim()) {
      normalized.push({
        sourceField: 'title',
        content: entry,
        interpretation: '历史数据（旧格式）',
      });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      if (typeof record.content !== 'string' || !record.content.trim()) continue;
      if (typeof record.sourceField !== 'string' || !allowed.has(record.sourceField)) {
        continue;
      }
      normalized.push({
        sourceField: record.sourceField as EvidenceEntry['sourceField'],
        content: record.content,
        interpretation:
          typeof record.interpretation === 'string' ? record.interpretation : '',
      });
    }
  }
  return normalized;
}

export function toProductDto(candidate: ProductCandidate): ProductDto {
  const result = candidate.matchResult;
  const observations = [...(candidate.observations ?? [])]
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
    .map(toObservationDto);
  const match: MatchDto | null = result
    ? {
        aiStatus: result.aiStatus,
        matchStatus: result.matchStatus,
        matchType: result.matchType,
        candidateRelevance: result.candidateRelevance,
        categoryMatch: result.categoryMatch,
        seriesMatch: result.seriesMatch,
        targetItemMatch: result.targetItemMatch,
        visualMatch: result.visualMatch,
        confidence: result.confidence,
        summary: result.summary,
        reason: result.reason,
        matchedContents: result.matchedContents ?? [],
        matchedSkuIds: result.matchedSkuIds ?? [],
        skuDecisions: result.skuDecisions ?? [],
        evidence: normalizeEvidence(result.evidence),
        nextAction: result.nextAction,
        rawMatchStatus: result.rawMatchStatus ?? null,
        rawConfidence: result.rawConfidence ?? null,
        safetyWarnings: result.safetyWarnings ?? [],
        safetyBlockers: result.safetyBlockers ?? [],
        skuVerificationStatus:
          result.skuVerificationStatus ?? SkuVerificationStatusEnum.PENDING,
        priceVerificationStatus:
          result.priceVerificationStatus ?? PriceVerificationStatusEnum.PENDING,
        needsManualReview: result.needsManualReview,
        manualDecision: result.manualDecision,
        manualNote: result.manualNote,
        manualSkuDecisions: result.manualSkuDecisions ?? [],
        reviewedAt: result.reviewedAt,
        aiModel: result.aiModel,
        aiError: result.aiError,
      }
    : null;

  return {
    id: candidate.id,
    platform: candidate.platform,
    platformProductId: candidate.platformProductId,
    title: candidate.title,
    shopName: candidate.shopName,
    productUrl: candidate.productUrl,
    imageUrls: candidate.imageUrls ?? [],
    description: candidate.description,
    skuOptions: candidate.skuData ?? [],
    price: candidate.priceData,
    groupPrice: candidate.groupPriceData,
    wholesalePrice: candidate.wholesalePriceData,
    promotions: collectPromotions(observations),
    sourceType: candidate.sourceType,
    collectedAt: candidate.collectedAt,
    effectiveMatchStatus: effectiveMatchStatus(match),
    match,
    observations,
    priceConflict: hasPriceConflict(observations),
  };
}

function taskDuration(task: PlatformSearchTask): number | null {
  if (!task.startedAt || !task.completedAt) return null;
  return Math.max(0, task.completedAt.getTime() - task.startedAt.getTime());
}

function toChannelDto(
  task: PlatformSearchTask,
  manualBrowserOpen: boolean,
): ChannelResultDto {
  return {
    taskId: task.id,
    provider: task.provider,
    providerLabel: providerLabel(task.provider),
    source:
      task.provider === 'playwright'
        ? ObservationSourceEnum.PLAYWRIGHT
        : task.providerType === SourceTypeEnum.THIRD_PARTY
          ? ObservationSourceEnum.THIRD_PARTY_API
          : ObservationSourceEnum.OFFICIAL_API,
    sourceLabel:
      task.provider === 'playwright'
        ? sourceLabel(ObservationSourceEnum.PLAYWRIGHT)
        : task.providerType === SourceTypeEnum.THIRD_PARTY
          ? sourceLabel(ObservationSourceEnum.THIRD_PARTY_API)
          : sourceLabel(ObservationSourceEnum.OFFICIAL_API),
    providerType: task.providerType,
    status: task.status,
    resultCount: task.resultCount,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    note: task.note,
    apiRequestCount: task.apiRequestCount ?? 0,
    chargedUsd: task.chargedUsd ?? null,
    lastRequestId: task.lastRequestId ?? null,
    manualVerification: task.manualVerification ?? null,
    manualBrowserOpen:
      manualBrowserOpen &&
      task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: taskDuration(task),
  };
}

function relevanceRank(value: CandidateRelevanceEnum | null | undefined): number {
  switch (value) {
    case CandidateRelevanceEnum.HIGH:
      return 3;
    case CandidateRelevanceEnum.MEDIUM:
      return 2;
    case CandidateRelevanceEnum.LOW:
      return 1;
    case CandidateRelevanceEnum.NONE:
      return 0;
    default:
      return -1;
  }
}

function byRelevanceThenConfidence(a: ProductDto, b: ProductDto): number {
  const byRelevance =
    relevanceRank(b.match?.candidateRelevance) -
    relevanceRank(a.match?.candidateRelevance);
  if (byRelevance !== 0) return byRelevance;
  return (b.match?.confidence ?? -1) - (a.match?.confidence ?? -1);
}

export function toPlatformResultDto(
  platform: PlatformEnum,
  tasks: PlatformSearchTask[],
  candidates: ProductCandidate[],
  manualBrowserOpen = false,
): PlatformResultDto {
  const channelOrder = channelsForPlatform(platform).map((channel) => channel.provider);
  const orderedTasks = [...tasks].sort((a, b) => {
    const left = channelOrder.indexOf(a.provider as never);
    const right = channelOrder.indexOf(b.provider as never);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
  });
  const products = candidates
    .map(toProductDto)
    .sort(byRelevanceThenConfidence);

  const matched = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.MATCH,
  );
  const uncertain = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.UNCERTAIN,
  );
  const excluded = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.NO_MATCH,
  );
  const channels = orderedTasks.map((task) => toChannelDto(task, manualBrowserOpen));
  const status = aggregatePlatformStatus(tasks);
  const startedTimes = tasks
    .map((task) => task.startedAt)
    .filter((value): value is Date => Boolean(value));
  const completedTimes = tasks
    .map((task) => task.completedAt)
    .filter((value): value is Date => Boolean(value));

  const failure = tasks.find(
    (task) =>
      task.status === PlatformTaskStatusEnum.FAILED ||
      task.status === PlatformTaskStatusEnum.BLOCKED,
  );
  const notConfigured = tasks.find(
    (task) => task.status === PlatformTaskStatusEnum.NOT_CONFIGURED,
  );
  const waitingTask = tasks.find(
    (task) => task.status === PlatformTaskStatusEnum.WAITING_MANUAL_VERIFICATION,
  );
  const errorTask =
    status === PlatformStatusEnum.FAILED
      ? failure
      : status === PlatformStatusEnum.NOT_CONFIGURED
        ? notConfigured
        : status === PlatformStatusEnum.WAITING_MANUAL_VERIFICATION
          ? waitingTask
          : undefined;

  return {
    platform,
    status,
    providerType:
      tasks.find((task) => task.providerType)?.providerType ?? null,
    resultCount: products.length,
    matchedCount: matched.length,
    uncertainCount: uncertain.length,
    excludedCount: excluded.length,
    errorCode: errorTask?.errorCode ?? null,
    errorMessage: errorTask?.errorMessage ?? null,
    note:
      [...new Set(
        tasks
          .map((task) => task.note)
          .filter((note): note is string => Boolean(note)),
      )].join('\n') || null,
    startedAt: startedTimes.length
      ? new Date(Math.min(...startedTimes.map((value) => value.getTime())))
      : null,
    completedAt:
      status === PlatformStatusEnum.WAITING_MANUAL_VERIFICATION
        ? null
        : completedTimes.length
          ? new Date(Math.max(...completedTimes.map((value) => value.getTime())))
          : null,
    channels,
    products: matched,
    uncertainProducts: uncertain,
    excludedProducts: excluded,
  };
}

export function toSearchDetailDto(
  run: SearchRun,
  tasks: PlatformSearchTask[],
  candidates: ProductCandidate[],
  manualBrowserOpen: Partial<Record<PlatformEnum, boolean>> = {},
): SearchDetailDto {
  const byPlatform = new Map<string, ProductCandidate[]>();
  for (const candidate of candidates) {
    const list = byPlatform.get(candidate.platform) ?? [];
    list.push(candidate);
    byPlatform.set(candidate.platform, list);
  }

  const platforms = [
    PlatformEnum.TAOBAO,
    PlatformEnum.DOUYIN,
    PlatformEnum.XIAOHONGSHU,
    PlatformEnum.ALIBABA1688,
    PlatformEnum.PINDUODUO,
  ]
    // 未选中的平台不创建任务，也不在结果里伪造一个 NOT_CONFIGURED 页签。
    .filter(
      (platform) =>
        tasks.some((task) => task.platform === platform) ||
        byPlatform.has(platform),
    )
    .map((platform) =>
      toPlatformResultDto(
        platform,
        tasks.filter((task) => task.platform === platform),
        byPlatform.get(platform) ?? [],
        manualBrowserOpen[platform] ?? false,
      ),
    );

  return {
    searchId: run.id,
    status: run.status,
    targetName: run.targetName,
    seriesName: run.seriesName,
    aliases: run.aliases ?? [],
    seriesAliases: run.seriesAliases ?? [],
    brandNames: run.brandNames ?? [],
    referenceImageProvided: Boolean(run.referenceImage),
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    platforms,
    priceSummary: buildPriceSummary(candidates),
  };
}
