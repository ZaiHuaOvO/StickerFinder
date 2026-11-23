import {
  ManualDecisionEnum,
  MatchStatusEnum,
  ObservationSourceEnum,
  PlatformEnum,
  PlatformStatusEnum,
  PlatformTaskStatusEnum,
  SourceTypeEnum,
} from '../../common/enums';
import { PriceInfo, SkuOption } from '../../common/interfaces/price.interface';
import {
  PROVIDER_LABELS,
  channelsForPlatform,
} from '../../common/platform-channels';
import { aggregatePlatformStatus } from '../../common/utils/platform-status.util';
import type { SkuDecision } from '../../entities/product-match-result.entity';
import {
  PlatformSearchTask,
  ProductCandidate,
  ProductObservation,
  SearchRun,
} from '../../entities';

export interface MatchDto {
  aiStatus: string;
  matchStatus: MatchStatusEnum;
  matchType: string | null;
  confidence: number | null;
  summary: string | null;
  reason: string | null;
  matchedContents: string[];
  matchedSkuIds: string[];
  skuDecisions: SkuDecision[];
  evidence: string[];
  needsManualReview: boolean;
  manualDecision: ManualDecisionEnum;
  manualNote: string | null;
  reviewedAt: Date | null;
  aiModel: string | null;
  aiError: string | null;
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
}

export interface SearchDetailDto {
  searchId: string;
  status: string;
  targetName: string;
  seriesName: string | null;
  aliases: string[];
  referenceImageProvided: boolean;
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  platforms: PlatformResultDto[];
}

const SOURCE_LABELS: Record<string, string> = {
  [ObservationSourceEnum.OFFICIAL_API]: '官方 API',
  [ObservationSourceEnum.THIRD_PARTY_API]: '第三方数据 API',
  [ObservationSourceEnum.PLAYWRIGHT]: 'Playwright 浏览器',
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

function toObservationDto(observation: ProductObservation): ObservationDto {
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
        confidence: result.confidence,
        summary: result.summary,
        reason: result.reason,
        matchedContents: result.matchedContents ?? [],
        matchedSkuIds: result.matchedSkuIds ?? [],
        skuDecisions: result.skuDecisions ?? [],
        evidence: result.evidence ?? [],
        needsManualReview: result.needsManualReview,
        manualDecision: result.manualDecision,
        manualNote: result.manualNote,
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

function toChannelDto(task: PlatformSearchTask): ChannelResultDto {
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
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: taskDuration(task),
  };
}

export function toPlatformResultDto(
  platform: PlatformEnum,
  tasks: PlatformSearchTask[],
  candidates: ProductCandidate[],
): PlatformResultDto {
  const channelOrder = channelsForPlatform(platform).map((channel) => channel.provider);
  const orderedTasks = [...tasks].sort((a, b) => {
    const left = channelOrder.indexOf(a.provider as never);
    const right = channelOrder.indexOf(b.provider as never);
    return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
  });
  const products = candidates
    .map(toProductDto)
    .sort((a, b) => (b.match?.confidence ?? -1) - (a.match?.confidence ?? -1));

  const matched = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.MATCH,
  );
  const uncertain = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.UNCERTAIN,
  );
  const excluded = products.filter(
    (product) => product.effectiveMatchStatus === MatchStatusEnum.NO_MATCH,
  );
  const channels = orderedTasks.map(toChannelDto);
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
  const errorTask =
    status === PlatformStatusEnum.FAILED
      ? failure
      : status === PlatformStatusEnum.NOT_CONFIGURED
        ? notConfigured
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
    completedAt: completedTimes.length
      ? new Date(Math.max(...completedTimes.map((value) => value.getTime())))
      : null,
    channels,
    products: matched,
    uncertainProducts: uncertain,
  };
}

export function toSearchDetailDto(
  run: SearchRun,
  tasks: PlatformSearchTask[],
  candidates: ProductCandidate[],
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
    PlatformEnum.PINDUODUO,
  ].map((platform) =>
    toPlatformResultDto(
      platform,
      tasks.filter((task) => task.platform === platform),
      byPlatform.get(platform) ?? [],
    ),
  );

  return {
    searchId: run.id,
    status: run.status,
    targetName: run.targetName,
    seriesName: run.seriesName,
    aliases: run.aliases ?? [],
    referenceImageProvided: Boolean(run.referenceImage),
    errorMessage: run.errorMessage,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    platforms,
  };
}
